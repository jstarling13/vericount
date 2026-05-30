// Triggers monthly report generation for a single client on demand.
// Used by the internal dashboard endpoint so ops can regenerate or force-send reports.

import { Resend } from "resend";
import { prisma } from "@vericount/db";
import { getProfitAndLoss, getBalanceSheet, parseFinancialData, refreshAccessToken } from "@vericount/qbo";
import { generateMonthlyNarrative, PriorMonthSummary } from "@vericount/ai";
import { buildReportPDF } from "@vericount/pdf";
import { notifyReportSent } from "@vericount/slack";
import { ReportPayload, QBOFinancialData } from "@vericount/shared";

const resend = new Resend(process.env.RESEND_API_KEY!);

// Generate and email the report for a given client + month.
// Defaults to the previous calendar month if year/month not specified.
export async function generateReport(
  clientId: string,
  year?: number,
  month?: number   // 1-12
): Promise<void> {
  const now = new Date();
  // Default to previous month
  const targetDate = new Date(now.getFullYear(), (month != null ? month - 1 : now.getMonth() - 1), 1);
  const y = year ?? targetDate.getFullYear();
  const m = month ?? targetDate.getMonth() + 1;

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error(`Client ${clientId} not found`);
  if (!client.qboRealmId || !client.qboAccessToken) {
    throw new Error(`Client ${clientId} has no QBO connection`);
  }

  const periodLabel = `${monthName(m)} ${y}`;
  const periodKey = `${y}-${String(m).padStart(2, "0")}`;

  const accessToken = await ensureFreshQBOToken(client);

  const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;

  const [pnlRaw, bsRaw] = await Promise.all([
    getProfitAndLoss(accessToken, client.qboRealmId, startDate, endDate),
    getBalanceSheet(accessToken, client.qboRealmId, endDate),
  ]);

  const financialData = parseFinancialData(pnlRaw, bsRaw, periodLabel);

  // Fetch prior month for MoM comparison
  const priorDate = new Date(y, m - 2, 1);
  const priorPeriodKey = `${priorDate.getFullYear()}-${String(priorDate.getMonth() + 1).padStart(2, "0")}`;
  const priorReport = await prisma.report.findUnique({
    where: { clientId_type_period: { clientId: client.id, type: "MONTHLY", period: priorPeriodKey } },
    select: { rawQboData: true },
  });

  let priorMonth: PriorMonthSummary | undefined;
  if (priorReport?.rawQboData) {
    const priorData = priorReport.rawQboData as unknown as QBOFinancialData;
    if (priorData?.pnl) {
      priorMonth = {
        period: `${monthName(priorDate.getMonth() + 1)} ${priorDate.getFullYear()}`,
        revenue:  priorData.pnl.revenue.reduce((s, r) => s + r.amount, 0),
        expenses: priorData.pnl.expenses.reduce((s, r) => s + r.amount, 0),
        netIncome: priorData.pnl.netIncome,
      };
    }
  }

  const narrative = await generateMonthlyNarrative({
    businessName: client.businessName,
    period: periodLabel,
    data: financialData,
    priorMonth,
  });

  const payload: ReportPayload = {
    clientId: client.id,
    clientName: client.name,
    businessName: client.businessName,
    period: periodLabel,
    financialData,
    narrative,
  };

  const pdfBytes = await buildReportPDF(payload);

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

  const filename = `vericount-report-${periodLabel.replace(/\s+/g, "-").toLowerCase()}.pdf`;
  const pnl = financialData.pnl;
  const fmt = (n: number) =>
    `${n < 0 ? "-$" : "$"}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  await resend.emails.send({
    from: `${process.env.RESEND_FROM_NAME} <${process.env.RESEND_FROM_EMAIL}>`,
    to: [client.email],
    subject: `Your Vericount Report — ${periodLabel}`,
    html: `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:620px;margin:0 auto;color:#1a1a1a">
  <div style="background:#0f4c81;padding:28px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:22px">Monthly Report</h1>
    <p style="color:rgba(255,255,255,.75);margin:4px 0 0;font-size:14px">${periodLabel} — ${client.businessName}</p>
  </div>
  <div style="padding:28px 32px;background:#f7f8fa;border-radius:0 0 8px 8px">
    <p>Hi ${client.name},</p>
    <p>Your monthly financial report for <strong>${periodLabel}</strong> is attached.</p>
    <table style="width:100%;background:white;border-radius:8px;padding:20px;border:1px solid #e5e7eb;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px">Revenue</td><td style="text-align:right;font-weight:600">${fmt(pnl.revenue.reduce((s, r) => s + r.amount, 0))}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px">Expenses</td><td style="text-align:right;font-weight:600">${fmt(pnl.expenses.reduce((s, r) => s + r.amount, 0))}</td></tr>
      <tr><td style="padding:8px 0;font-weight:700">Net Income</td><td style="text-align:right;font-weight:700;color:${pnl.netIncome >= 0 ? "#1a7f37" : "#c0392b"}">${fmt(pnl.netIncome)}</td></tr>
    </table>
    <div style="background:white;border-radius:8px;padding:20px;margin:20px 0;border:1px solid #e5e7eb;border-left:4px solid #0f4c81">
      <p style="margin:0 0 8px;font-weight:700;font-size:13px;color:#0f4c81;text-transform:uppercase;letter-spacing:.05em">Bookkeeper's Note</p>
      <p style="margin:0;line-height:1.6;font-size:14px;color:#374151">${narrative.replace(/\n/g, "<br>")}</p>
    </div>
    <a href="${process.env.PORTAL_URL}/reports" style="background:#0f4c81;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View in Portal →</a>
  </div>
</body></html>`,
    attachments: [{ filename, content: Buffer.from(pdfBytes).toString("base64") }],
  });

  await prisma.report.update({
    where: { clientId_type_period: { clientId, type: "MONTHLY", period: periodKey } },
    data: { emailedAt: new Date() },
  });

  if (client.slackChannelId) {
    await notifyReportSent(client.slackChannelId, client.name, periodLabel);
  }
}

async function ensureFreshQBOToken(
  client: NonNullable<Awaited<ReturnType<typeof prisma.client.findUnique>>>
): Promise<string> {
  const now = new Date();
  const expiry = client!.qboTokenExpiry;
  if (!expiry || expiry.getTime() - now.getTime() < 5 * 60 * 1000) {
    if (!client!.qboRefreshToken) throw new Error("No QBO refresh token");
    const fresh = await refreshAccessToken(client!.qboRefreshToken);
    await prisma.client.update({
      where: { id: client!.id },
      data: { qboAccessToken: fresh.accessToken, qboRefreshToken: fresh.refreshToken, qboTokenExpiry: fresh.accessTokenExpiry },
    });
    return fresh.accessToken;
  }
  return client!.qboAccessToken!;
}

function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString("en-US", { month: "long" });
}
