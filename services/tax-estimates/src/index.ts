import "dotenv/config";
import cron from "node-cron";
import { prisma } from "@vericount/db";
import { getProfitAndLoss, parseFinancialData, refreshAccessToken } from "@vericount/qbo";
import {
  calculateTaxEstimate,
  annualizeMultiplierForQuarter,
  getQuarterlyDueDate,
} from "./calculator";
import { sendTaxEstimateAlert } from "./email";
import { postToChannel } from "@vericount/slack";
import { Decimal } from "@prisma/client/runtime/library";

// Run on the 1st of each quarter month at 7 AM:
// January 1 (Q4 prior year, due Jan 15), April 1 (Q1, due Apr 15),
// July 1 (Q2, due Jun 15), October 1 (Q3, due Sep 15)
const CRON_SCHEDULE = "0 7 1 1,4,7,10 *";

// Determine which quarter/year to estimate based on when the cron fires.
// January 1 is a special case: we use Q4 of the prior year (full Dec 31 data),
// rather than Q1 of the new year (which has no data yet and would generate a $0 estimate).
function getRunContext(now: Date): {
  quarter: 1 | 2 | 3 | 4;
  year: number;
  ytdStart: string;
  ytdEnd: string;
} {
  const month = now.getMonth() + 1; // 1-based
  if (month === 1) {
    // January 1 → Q4 of the prior year (complete data, Jan 1 – Dec 31), due Jan 15
    const priorYear = now.getFullYear() - 1;
    return {
      quarter: 4,
      year: priorYear,
      ytdStart: `${priorYear}-01-01`,
      ytdEnd:   `${priorYear}-12-31`,
    };
  }
  const year = now.getFullYear();
  return {
    quarter: Math.ceil(month / 3) as 1 | 2 | 3 | 4,
    year,
    ytdStart: `${year}-01-01`,
    ytdEnd:   now.toISOString().split("T")[0],
  };
}

async function runTaxEstimates(clientIdFilter?: string): Promise<void> {
  const now = new Date();
  const { quarter, year, ytdStart, ytdEnd } = getRunContext(now);
  const dueDate = getQuarterlyDueDate(year, quarter);
  const dueDateStr = dueDate.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  const quarterStr = `Q${quarter} ${year}`;

  console.log(`[tax-estimates] Running for ${quarterStr}, due ${dueDateStr} (YTD: ${ytdStart} → ${ytdEnd})`);

  const clients = await prisma.client.findMany({
    where: {
      ...(clientIdFilter ? { id: clientIdFilter } : { status: "ACTIVE" }),
      qboRealmId: { not: null },
      qboAccessToken: { not: null },
    },
  });

  for (const client of clients) {
    try {
      // Ensure fresh QBO token
      const accessToken = await ensureFreshQBOToken(client);

      // Pull YTD P&L for the correct date range
      const pnlRaw = await getProfitAndLoss(
        accessToken,
        client.qboRealmId!,
        ytdStart,
        ytdEnd
      );
      const financialData = parseFinancialData(pnlRaw, {}, `YTD ${year}`);

      const ytdRevenue  = financialData.pnl.revenue.reduce((s, r) => s + r.amount, 0);
      const ytdExpenses = financialData.pnl.expenses.reduce((s, r) => s + r.amount, 0);

      const result = calculateTaxEstimate({
        ytdRevenue,
        ytdExpenses,
        annualizeMultiplier: annualizeMultiplierForQuarter(quarter),
      });

      // Save / update estimate (always refresh the figures)
      const estimate = await prisma.taxEstimate.upsert({
        where: { clientId_year_quarter: { clientId: client.id, year, quarter } },
        update: {
          ytdRevenue: new Decimal(ytdRevenue),
          ytdExpenses: new Decimal(ytdExpenses),
          ytdNetIncome: new Decimal(result.ytdNetIncome),
          seTax: new Decimal(result.seTax),
          federalEst: new Decimal(result.federalIncomeTax),
          gaStateEst: new Decimal(result.gaStateTax),
          totalEst: new Decimal(result.totalAnnual),
          quarterlyAmt: new Decimal(result.quarterlyPayment),
        },
        create: {
          clientId: client.id,
          year,
          quarter,
          dueDate,
          ytdRevenue: new Decimal(ytdRevenue),
          ytdExpenses: new Decimal(ytdExpenses),
          ytdNetIncome: new Decimal(result.ytdNetIncome),
          seTax: new Decimal(result.seTax),
          federalEst: new Decimal(result.federalIncomeTax),
          gaStateEst: new Decimal(result.gaStateTax),
          totalEst: new Decimal(result.totalAnnual),
          quarterlyAmt: new Decimal(result.quarterlyPayment),
        },
      });

      // Only send the alert email once per quarter
      if (!estimate.alertSentAt) {
        await sendTaxEstimateAlert({
          clientEmail: client.email,
          clientName: client.name,
          businessName: client.businessName,
          quarter: quarterStr,
          dueDate: dueDateStr,
          result,
        });

        await prisma.taxEstimate.update({
          where: { clientId_year_quarter: { clientId: client.id, year, quarter } },
          data: { alertSentAt: new Date() },
        });

        // Notify Slack channel about the tax estimate
        if (client.slackChannelId) {
          const dashUrl = `${process.env.DASHBOARD_URL ?? "http://localhost:3002"}/clients/${client.id}`;
          await postToChannel(
            client.slackChannelId,
            `:moneybag: *${client.name}* — ${quarterStr} tax estimate sent.\nQuarterly payment: *$${result.quarterlyPayment.toLocaleString("en-US", { minimumFractionDigits: 2 })}* due ${dueDateStr}\n<${dashUrl}|View in dashboard>`
          ).catch(() => {}); // non-fatal
        }
      } else {
        console.log(`[tax-estimates] ${client.name}: alert already sent for ${quarterStr}, skipping`);
      }

      console.log(
        `[tax-estimates] ${client.name}: Q${quarter} est = $${result.quarterlyPayment.toFixed(2)}/quarter`
      );
    } catch (err) {
      console.error(`[tax-estimates] Failed for ${client.name}:`, err);
      await prisma.flaggedItem.create({
        data: {
          clientId: client.id,
          type: "tax_estimate_error",
          description: `Tax estimate failed for ${quarterStr}: ${(err as Error).message}`,
        },
      });
    }
  }

  console.log(`[tax-estimates] ${quarterStr} run complete`);
}

async function ensureFreshQBOToken(
  client: NonNullable<Awaited<ReturnType<typeof prisma.client.findUnique>>>
): Promise<string> {
  const now = new Date();
  const expiry = client.qboTokenExpiry;
  if (!expiry || expiry.getTime() - now.getTime() < 5 * 60 * 1000) {
    if (!client.qboRefreshToken) throw new Error("No QBO refresh token");
    const fresh = await refreshAccessToken(client.qboRefreshToken);
    await prisma.client.update({
      where: { id: client.id },
      data: {
        qboAccessToken: fresh.accessToken,
        qboRefreshToken: fresh.refreshToken,
        qboTokenExpiry: fresh.accessTokenExpiry,
      },
    });
    return fresh.accessToken;
  }
  return client.qboAccessToken!;
}

cron.schedule(CRON_SCHEDULE, () => {
  runTaxEstimates().catch((err) =>
    console.error("[tax-estimates] Fatal error:", err)
  );
});

console.log(`[tax-estimates] Scheduler started (${CRON_SCHEDULE})`);

if (process.env.RUN_NOW === "1") {
  runTaxEstimates().catch(console.error);
}

// Run for a single specific client: RUN_NOW_CLIENT=cld_xxx pnpm dev
if (process.env.RUN_NOW_CLIENT) {
  const singleClientId = process.env.RUN_NOW_CLIENT;
  console.log(`[tax-estimates] Running single-client estimate for ${singleClientId}`);
  runTaxEstimates(singleClientId).catch(console.error);
}
