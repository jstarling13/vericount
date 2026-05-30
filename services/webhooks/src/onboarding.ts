// Onboarding orchestration — runs after a Typeform submission is verified.
// Steps: create DB record → Stripe customer+subscription → DocuSign letter → Slack channel → welcome email

import { prisma } from "@vericount/db";
import { createCustomer, createSubscription } from "@vericount/stripe-client";
import { sendEngagementLetter } from "@vericount/docusign";
import { createClientChannel, postToChannel } from "@vericount/slack";
import { OnboardingData, TIERS } from "@vericount/shared";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function runOnboarding(data: OnboardingData): Promise<void> {
  console.log(`[onboarding] Starting for ${data.email} — tier ${data.tier}`);

  // 1. Create client record (idempotent via upsert on typeformResponseId)
  const client = await prisma.client.upsert({
    where: { typeformResponseId: data.typeformResponseId },
    update: {},
    create: {
      email: data.email,
      name: data.name,
      businessName: data.businessName,
      tier: data.tier,
      status: "PENDING",
      typeformResponseId: data.typeformResponseId,
    },
  });
  console.log(`[onboarding] Client record ${client.id} created/found`);

  // 2. Stripe — create customer + subscription
  let stripeCustomerId = client.stripeCustomerId;
  let stripeSubscriptionId = client.stripeSubscriptionId;

  if (!stripeCustomerId) {
    const customer = await createCustomer({
      name: data.name,
      email: data.email,
      businessName: data.businessName,
      clientId: client.id,
    });
    stripeCustomerId = customer.id;
    console.log(`[onboarding] Stripe customer ${stripeCustomerId} created`);
  }

  if (!stripeSubscriptionId && stripeCustomerId) {
    const subscription = await createSubscription({
      customerId: stripeCustomerId,
      tier: data.tier,
      trialDays: 7, // 7-day trial on all tiers
    });
    stripeSubscriptionId = subscription.id;
    console.log(`[onboarding] Stripe subscription ${stripeSubscriptionId} created`);
  }

  await prisma.client.update({
    where: { id: client.id },
    data: { stripeCustomerId, stripeSubscriptionId },
  });

  // 3. DocuSign — send engagement letter
  let docusignEnvelopeId = client.docusignEnvelopeId;
  if (!docusignEnvelopeId) {
    docusignEnvelopeId = await sendEngagementLetter({
      clientName: data.name,
      clientEmail: data.email,
      businessName: data.businessName,
      tier: TIERS[data.tier].label,
      monthlyFee: TIERS[data.tier].price,
    });
    await prisma.client.update({
      where: { id: client.id },
      data: { docusignEnvelopeId },
    });
    console.log(`[onboarding] DocuSign envelope ${docusignEnvelopeId} sent`);
  }

  // 4. Slack — create dedicated channel
  let slackChannelId = client.slackChannelId;
  if (!slackChannelId) {
    slackChannelId = await createClientChannel(data.name, client.id);
    await prisma.client.update({
      where: { id: client.id },
      data: { slackChannelId },
    });
    console.log(`[onboarding] Slack channel ${slackChannelId} created`);
  }

  // Post onboarding summary to the Slack channel
  await postToChannel(
    slackChannelId,
    `:rocket: New client onboarded!\n*Name:* ${data.name}\n*Business:* ${data.businessName}\n*Tier:* ${TIERS[data.tier].label} ($${TIERS[data.tier].price}/mo)\n*Email:* ${data.email}\n\n:white_check_mark: Stripe subscription created\n:white_check_mark: DocuSign engagement letter sent\n\n*Next steps:* Client needs to connect their QuickBooks Online account via the portal.`
  );

  // 5. Welcome email with QBO connect link
  const portalUrl = process.env.PORTAL_URL!;
  const connectQboUrl = `${portalUrl}/connect-qbo?clientId=${client.id}`;

  await resend.emails.send({
    from: `${process.env.RESEND_FROM_NAME} <${process.env.RESEND_FROM_EMAIL}>`,
    to: [data.email],
    subject: `Welcome to Vericount, ${data.name}!`,
    html: buildWelcomeEmail({
      name: data.name,
      email: data.email,
      businessName: data.businessName,
      tier: TIERS[data.tier].label,
      monthlyFee: TIERS[data.tier].price,
      portalUrl,
      connectQboUrl,
    }),
  });
  console.log(`[onboarding] Welcome email sent to ${data.email}`);

  // 6. Mark client as ACTIVE
  await prisma.client.update({
    where: { id: client.id },
    data: { status: "ACTIVE", onboardedAt: new Date() },
  });

  console.log(`[onboarding] Complete for ${data.email}`);
}

function buildWelcomeEmail(p: {
  name: string;
  email: string;
  businessName: string;
  tier: string;
  monthlyFee: number;
  portalUrl: string;
  connectQboUrl: string;
}): string {
  const signUpUrl = `${p.portalUrl}/sign-up`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <div style="background: #0f4c81; padding: 32px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Welcome to Vericount</h1>
    <p style="color: rgba(255,255,255,.8); margin: 6px 0 0; font-size: 15px;">${p.businessName}</p>
  </div>
  <div style="padding: 32px; background: #f9f9f9; border-radius: 0 0 8px 8px;">
    <p style="margin-top:0">Hi ${p.name},</p>
    <p>You're all set on the <strong>${p.tier} plan</strong> ($${p.monthlyFee}/month). Your engagement letter is on its way — check your email for the DocuSign link.</p>

    <p style="font-weight: 700; color: #0f4c81; font-size: 15px; margin: 24px 0 8px;">Three quick steps to get started:</p>

    <!-- Step 1 -->
    <div style="background: white; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; border: 1px solid #e5e7eb;">
      <p style="margin: 0 0 6px; font-weight: 700; font-size: 14px;">① Sign your engagement letter</p>
      <p style="margin: 0; font-size: 13px; color: #6b7280;">Check your email for a DocuSign message from Vericount.</p>
    </div>

    <!-- Step 2 -->
    <div style="background: white; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; border: 1px solid #e5e7eb;">
      <p style="margin: 0 0 6px; font-weight: 700; font-size: 14px;">② Connect QuickBooks Online</p>
      <p style="margin: 0 0 12px; font-size: 13px; color: #6b7280;">So I can start categorizing your transactions and keeping your books.</p>
      <a href="${p.connectQboUrl}" style="background: #0f4c81; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 13px; display: inline-block;">
        Connect QuickBooks Online →
      </a>
    </div>

    <!-- Step 3 -->
    <div style="background: white; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; border: 1px solid #e5e7eb;">
      <p style="margin: 0 0 6px; font-weight: 700; font-size: 14px;">③ Create your client portal account</p>
      <p style="margin: 0 0 12px; font-size: 13px; color: #6b7280;">View your reports, transaction history, tax estimates, and message me anytime.</p>
      <a href="${signUpUrl}" style="background: white; color: #0f4c81; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 13px; display: inline-block; border: 2px solid #0f4c81;">
        Create Portal Account →
      </a>
    </div>

    <p style="font-size: 13px; color: #6b7280;">Sign up using this email address (<strong>${p.email}</strong>) so your account links automatically.</p>
    <p>Looking forward to working with you!</p>
    <p style="margin-top: 32px; color: #9ca3af; font-size: 12px;">
      Questions? Reply to this email or visit <a href="${p.portalUrl}" style="color: #0f4c81;">${p.portalUrl}</a>
    </p>
  </div>
</body>
</html>`;
}
