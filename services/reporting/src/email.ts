import { Resend } from "resend";
import { prisma } from "@vericount/db";
import { ReportPayload } from "@vericount/shared";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function emailReport(
  params: ReportPayload & { pdfBytes: Uint8Array }
): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: params.clientId } });
  if (!client?.email) throw new Error(`Client ${params.clientId} not found`);

  const filename = `vericount-report-${params.period.replace(/\s+/g, "-").toLowerCase()}.pdf`;

  await resend.emails.send({
    from: `${process.env.RESEND_FROM_NAME} <${process.env.RESEND_FROM_EMAIL}>`,
    to: [client.email],
    subject: `Your Vericount Report — ${params.period}`,
    html: buildReportEmail(params),
    attachments: [
      {
        filename,
        content: Buffer.from(params.pdfBytes).toString("base64"),
      },
    ],
  });
}

function buildReportEmail(p: ReportPayload): string {
  const pnl = p.financialData.pnl;
  const netPositive = pnl.netIncome >= 0;
  const netColor = netPositive ? "#1a7f37" : "#c0392b";
  const fmt = (n: number) =>
    `${n < 0 ? "($" : "$"}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}${n < 0 ? ")" : ""}`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 620px; margin: 0 auto; color: #1a1a1a; background: #ffffff;">
  <div style="background: #0f4c81; padding: 28px 32px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px;">Monthly Report</h1>
    <p style="color: rgba(255,255,255,0.75); margin: 4px 0 0; font-size: 14px;">${p.period} — ${p.businessName}</p>
  </div>
  <div style="padding: 28px 32px; background: #f7f8fa; border-radius: 0 0 8px 8px;">
    <p style="margin-top: 0;">Hi ${p.clientName},</p>
    <p>Your monthly financial report for <strong>${p.period}</strong> is ready. Here's your summary:</p>

    <div style="background: white; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #e5e7eb;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">Total Revenue</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; text-align: right; font-weight: 600; font-size: 14px;">${fmt(pnl.revenue.reduce((s, r) => s + r.amount, 0))}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">Total Expenses</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; text-align: right; font-weight: 600; font-size: 14px;">${fmt(pnl.expenses.reduce((s, r) => s + r.amount, 0))}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0 0; font-weight: 700; font-size: 15px;">Net Income</td>
          <td style="padding: 10px 0 0; text-align: right; font-weight: 700; font-size: 15px; color: ${netColor};">${fmt(pnl.netIncome)}</td>
        </tr>
      </table>
    </div>

    <div style="background: white; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #e5e7eb; border-left: 4px solid #0f4c81;">
      <p style="margin: 0 0 8px; font-weight: 700; font-size: 13px; color: #0f4c81; text-transform: uppercase; letter-spacing: 0.05em;">Bookkeeper's Note</p>
      <p style="margin: 0; line-height: 1.6; font-size: 14px; color: #374151;">${p.narrative.replace(/\n/g, "<br>")}</p>
    </div>

    <p style="font-size: 13px; color: #6b7280;">Your full report with detailed P&L and balance sheet is attached as a PDF.</p>
    <div style="margin: 24px 0;">
      <a href="${process.env.PORTAL_URL}/reports" style="background: #0f4c81; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">
        View in Portal →
      </a>
    </div>
    <p style="font-size: 12px; color: #9ca3af; margin-top: 32px;">
      Questions about your report? Reply to this email or message me in your client portal.
    </p>
  </div>
</body>
</html>`;
}
