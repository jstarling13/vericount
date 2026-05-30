import { Resend } from "resend";
import { generateTaxAlert } from "@vericount/ai";
import { TaxCalculationResult } from "@vericount/shared";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function sendTaxEstimateAlert(params: {
  clientEmail: string;
  clientName: string;
  businessName: string;
  quarter: string;     // "Q1 2025"
  dueDate: string;     // "April 15, 2025"
  result: TaxCalculationResult;
}): Promise<void> {
  const aiBody = await generateTaxAlert({
    businessName: params.businessName,
    quarter: params.quarter,
    dueDate: params.dueDate,
    quarterlyPayment: params.result.quarterlyPayment,
    ytdNetIncome: params.result.ytdNetIncome,
    breakdown: {
      federal: params.result.federalIncomeTax,
      state: params.result.gaStateTax,
      seTax: params.result.seTax,
    },
  });

  await resend.emails.send({
    from: `${process.env.RESEND_FROM_NAME} <${process.env.RESEND_FROM_EMAIL}>`,
    to: [params.clientEmail],
    subject: `Quarterly Tax Estimate — ${params.quarter} (Due ${params.dueDate})`,
    html: buildTaxEmail(params, aiBody),
  });
}

function buildTaxEmail(
  p: {
    clientName: string;
    businessName: string;
    quarter: string;
    dueDate: string;
    result: TaxCalculationResult;
  },
  aiBody: string
): string {
  const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 620px; margin: 0 auto; color: #1a1a1a;">
  <div style="background: #0f4c81; padding: 28px 32px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px;">Quarterly Tax Estimate</h1>
    <p style="color: rgba(255,255,255,0.75); margin: 4px 0 0; font-size: 14px;">${p.quarter} — Due ${p.dueDate}</p>
  </div>
  <div style="padding: 28px 32px; background: #f7f8fa; border-radius: 0 0 8px 8px;">
    <p style="margin-top: 0;">Hi ${p.clientName},</p>
    <p style="line-height: 1.6;">${aiBody.replace(/\n/g, "<br>")}</p>

    <!-- Highlight box -->
    <div style="background: #0f4c81; color: white; border-radius: 8px; padding: 20px 24px; margin: 20px 0; text-align: center;">
      <p style="margin: 0 0 4px; font-size: 13px; opacity: 0.8;">SET ASIDE THIS QUARTER</p>
      <p style="margin: 0; font-size: 36px; font-weight: 700;">${fmt(p.result.quarterlyPayment)}</p>
      <p style="margin: 6px 0 0; font-size: 12px; opacity: 0.7;">Due ${p.dueDate}</p>
    </div>

    <!-- Breakdown -->
    <div style="background: white; border-radius: 8px; padding: 20px; border: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="margin: 0 0 14px; font-weight: 700; font-size: 14px;">Estimate Breakdown (annualized)</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">YTD Net Income</td>
          <td style="text-align: right; border-bottom: 1px solid #f3f4f6;">${fmt(p.result.ytdNetIncome)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Self-Employment Tax</td>
          <td style="text-align: right; border-bottom: 1px solid #f3f4f6;">${fmt(p.result.seTax)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Federal Income Tax (est.)</td>
          <td style="text-align: right; border-bottom: 1px solid #f3f4f6;">${fmt(p.result.federalIncomeTax)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Georgia State Tax (est.)</td>
          <td style="text-align: right; border-bottom: 1px solid #f3f4f6;">${fmt(p.result.gaStateTax)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0 0; font-weight: 700;">Annual Total (est.)</td>
          <td style="text-align: right; padding: 8px 0 0; font-weight: 700;">${fmt(p.result.totalAnnual)}</td>
        </tr>
      </table>
    </div>

    <p style="font-size: 12px; color: #9ca3af; line-height: 1.5;">
      <strong>Disclaimer:</strong> This is an estimate based on your current YTD figures and may differ from your actual tax liability.
      These figures do not constitute tax advice. Please consult a licensed tax professional before making tax payments.
    </p>
  </div>
</body>
</html>`;
}
