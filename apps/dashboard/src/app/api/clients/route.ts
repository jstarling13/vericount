import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";
import { createCustomer, createSubscription } from "@vericount/stripe-client";
import { sendEngagementLetter } from "@vericount/docusign";
import { createClientChannel, postToChannel } from "@vericount/slack";
import { TIERS } from "@vericount/shared";
import { Resend } from "resend";
import { z } from "zod";

const resend = new Resend(process.env.RESEND_API_KEY!);

const CreateClientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  businessName: z.string().min(1),
  tier: z.enum(["STARTER", "GROWTH", "PRO"]),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = CreateClientSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { name, email, businessName, tier } = parsed.data;

  // Check for duplicate email
  const existing = await prisma.client.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "A client with this email already exists" }, { status: 409 });
  }

  // 1. Create client record
  const client = await prisma.client.create({
    data: { name, email, businessName, tier, status: "PENDING" },
  });

  const errors: string[] = [];

  // 2. Stripe — customer + subscription (best-effort)
  try {
    const customer = await createCustomer({ name, email, businessName, clientId: client.id });
    const subscription = await createSubscription({
      customerId: customer.id,
      tier,
      trialDays: 7,
    });
    await prisma.client.update({
      where: { id: client.id },
      data: { stripeCustomerId: customer.id, stripeSubscriptionId: subscription.id },
    });
  } catch (err) {
    errors.push(`Stripe: ${(err as Error).message}`);
    console.error("[api/clients] Stripe setup failed:", err);
  }

  // 3. DocuSign — engagement letter (best-effort)
  try {
    const envelopeId = await sendEngagementLetter({
      clientName: name,
      clientEmail: email,
      businessName,
      tier: TIERS[tier].label,
      monthlyFee: TIERS[tier].price,
    });
    await prisma.client.update({
      where: { id: client.id },
      data: { docusignEnvelopeId: envelopeId },
    });
  } catch (err) {
    errors.push(`DocuSign: ${(err as Error).message}`);
    console.error("[api/clients] DocuSign failed:", err);
  }

  // 4. Slack channel (best-effort)
  try {
    const slackChannelId = await createClientChannel(name, client.id);
    await prisma.client.update({
      where: { id: client.id },
      data: { slackChannelId },
    });
    await postToChannel(
      slackChannelId,
      `:rocket: *New client added manually*\n*Name:* ${name}\n*Business:* ${businessName}\n*Tier:* ${TIERS[tier].label} ($${TIERS[tier].price}/mo)\n*Email:* ${email}`
    );
  } catch (err) {
    errors.push(`Slack: ${(err as Error).message}`);
    console.error("[api/clients] Slack failed:", err);
  }

  // 5. Welcome email (best-effort)
  try {
    const portalUrl = process.env.PORTAL_URL ?? "";
    const connectQboUrl = `${portalUrl}/connect-qbo?clientId=${client.id}`;

    await resend.emails.send({
      from: `${process.env.RESEND_FROM_NAME} <${process.env.RESEND_FROM_EMAIL}>`,
      to: [email],
      subject: `Welcome to Vericount, ${name}!`,
      html: buildWelcomeEmail({ name, email, businessName, tier: TIERS[tier].label, monthlyFee: TIERS[tier].price, portalUrl, connectQboUrl }),
    });
  } catch (err) {
    errors.push(`Email: ${(err as Error).message}`);
    console.error("[api/clients] Welcome email failed:", err);
  }

  // Re-fetch to return the latest data
  const fresh = await prisma.client.findUnique({ where: { id: client.id } });

  return NextResponse.json(
    { client: fresh, warnings: errors.length > 0 ? errors : undefined },
    { status: 201 }
  );
}

function buildWelcomeEmail(p: {
  name: string; email: string; businessName: string;
  tier: string; monthlyFee: number; portalUrl: string; connectQboUrl: string;
}): string {
  const signUpUrl = `${p.portalUrl}/sign-up`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#0f4c81;padding:32px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:24px;">Welcome to Vericount</h1>
    <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:15px;">${p.businessName}</p>
  </div>
  <div style="padding:32px;background:#f9f9f9;border-radius:0 0 8px 8px;">
    <p style="margin-top:0">Hi ${p.name},</p>
    <p>You're on the <strong>${p.tier} plan</strong> ($${p.monthlyFee}/month). Your engagement letter is on its way — check your email for the DocuSign link.</p>
    <p style="font-weight:700;color:#0f4c81;font-size:15px;margin:24px 0 8px;">Three steps to get started:</p>
    <div style="background:white;border-radius:8px;padding:16px 20px;margin-bottom:12px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;font-weight:700;font-size:14px;">① Sign your engagement letter</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">Check your inbox for the DocuSign message from Vericount.</p>
    </div>
    <div style="background:white;border-radius:8px;padding:16px 20px;margin-bottom:12px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;font-weight:700;font-size:14px;">② Connect QuickBooks Online</p>
      <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">So I can start categorizing your transactions and keeping your books.</p>
      <a href="${p.connectQboUrl}" style="background:#0f4c81;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;display:inline-block;">Connect QuickBooks Online →</a>
    </div>
    <div style="background:white;border-radius:8px;padding:16px 20px;margin-bottom:24px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 6px;font-weight:700;font-size:14px;">③ Create your client portal account</p>
      <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">View reports, transactions, tax estimates, and message me anytime.</p>
      <a href="${signUpUrl}" style="background:white;color:#0f4c81;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;display:inline-block;border:2px solid #0f4c81;">Create Portal Account →</a>
    </div>
    <p style="font-size:13px;color:#6b7280;">Sign up using <strong>${p.email}</strong> so your account links automatically.</p>
    <p>Looking forward to working with you!</p>
    <p style="margin-top:32px;color:#9ca3af;font-size:12px;">Questions? Reply to this email or visit <a href="${p.portalUrl}" style="color:#0f4c81;">${p.portalUrl}</a></p>
  </div>
</body></html>`;
}
