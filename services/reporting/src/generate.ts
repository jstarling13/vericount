import { prisma } from "@vericount/db";
import {
  getProfitAndLoss,
  getBalanceSheet,
  parseFinancialData,
  refreshAccessToken,
} from "@vericount/qbo";
import { generateMonthlyNarrative, PriorMonthSummary } from "@vericount/ai";
import { notifyReportSent } from "@vericount/slack";
import { ReportPayload, QBOFinancialData } from "@vericount/shared";
import { buildReportPDF } from "@vericount/pdf";
import { emailReport } from "./email";

export async function generateReportForClient(
  clientId: string,
  year: number,
  month: number  // 1-12
): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error(`Client ${clientId} not found`);
  if (!client.qboRealmId || !client.qboAccessToken) {
    throw new Error(`Client ${clientId} has no QBO connection`);
  }

  const period = `${monthName(month)} ${year}`;
  const periodKey = `${year}-${String(month).padStart(2, "0")}`;

  // Idempotency: skip if already generated
  const existing = await prisma.report.findUnique({
    where: { clientId_type_period: { clientId, type: "MONTHLY", period: periodKey } },
  });
  if (existing?.emailedAt) {
    console.log(`[reporting] Report already sent for ${client.name} ${period}`);
    return;
  }

  // Refresh QBO token if needed
  const accessToken = await ensureFreshQBOToken(client);

  // Date range: first to last day of month
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  console.log(`[reporting] Pulling QBO data for ${client.name} — ${period}`);

  const [pnlRaw, bsRaw] = await Promise.all([
    getProfitAndLoss(accessToken, client.qboRealmId, startDate, endDate),
    getBalanceSheet(accessToken, client.qboRealmId, endDate),
  ]);

  const financialData = parseFinancialData(pnlRaw, bsRaw, period);

  // Fetch prior month's report for MoM comparison
  const priorDate = new Date(year, month - 2, 1); // month-1 goes back one month (month is 1-based)
  const priorPeriodKey = `${priorDate.getFullYear()}-${String(priorDate.getMonth() + 1).padStart(2, "0")}`;
  const priorReport = await prisma.report.findUnique({
    where: { clientId_type_period: { clientId, type: "MONTHLY", period: priorPeriodKey } },
    select: { rawQboData: true, period: true },
  });

  let priorMonth: PriorMonthSummary | undefined;
  if (priorReport?.rawQboData) {
    const priorData = priorReport.rawQboData as unknown as QBOFinancialData;
    if (priorData?.pnl) {
      const priorRevenue  = priorData.pnl.revenue.reduce((s, r) => s + r.amount, 0);
      const priorExpenses = priorData.pnl.expenses.reduce((s, r) => s + r.amount, 0);
      const priorLabel = `${monthName(priorDate.getMonth() + 1)} ${priorDate.getFullYear()}`;
      priorMonth = {
        period: priorLabel,
        revenue:  priorRevenue,
        expenses: priorExpenses,
        netIncome: priorData.pnl.netIncome,
      };
    }
  }

  // Generate AI narrative (with MoM comparison if prior month data available)
  console.log(`[reporting] Generating AI narrative for ${client.name}${priorMonth ? " (with MoM comparison)" : ""}`);
  const narrative = await generateMonthlyNarrative({
    businessName: client.businessName,
    period,
    data: financialData,
    priorMonth,
  });

  const payload: ReportPayload = {
    clientId: client.id,
    clientName: client.name,
    businessName: client.businessName,
    period,
    financialData,
    narrative,
  };

  // Build PDF
  console.log(`[reporting] Building PDF for ${client.name}`);
  const pdfBytes = await buildReportPDF(payload);

  // Save report record
  await prisma.report.upsert({
    where: { clientId_type_period: { clientId, type: "MONTHLY", period: periodKey } },
    update: { rawQboData: financialData as unknown as Record<string, unknown>, narrative },
    create: {
      clientId,
      type: "MONTHLY",
      period: periodKey,
      rawQboData: financialData as unknown as Record<string, unknown>,
      narrative,
    },
  });

  // Email report
  console.log(`[reporting] Emailing report to ${client.email}`);
  await emailReport({ ...payload, pdfBytes });

  await prisma.report.update({
    where: { clientId_type_period: { clientId, type: "MONTHLY", period: periodKey } },
    data: { emailedAt: new Date() },
  });

  // Notify Slack
  if (client.slackChannelId) {
    await notifyReportSent(client.slackChannelId, client.name, period);
  }

  console.log(`[reporting] Done — ${client.name} ${period} net income: $${financialData.pnl.netIncome.toFixed(2)}`);
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

function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString("en-US", { month: "long" });
}
