import { Request, Response } from "express";
import crypto from "crypto";
import { TypeformWebhookSchema, OnboardingData, TierKey } from "@vericount/shared";
import { runOnboarding } from "../onboarding";

// Typeform sends a SHA-256 HMAC signature in the `typeform-signature` header.
function verifySignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.TYPEFORM_WEBHOOK_SECRET!;
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64")}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Map Typeform field refs to our schema.
// Set these field refs in your Typeform form builder to match.
const FIELD_REFS = {
  name: "full_name",
  email: "email_address",
  businessName: "business_name",
  tier: "service_tier",
} as const;

const TIER_LABEL_MAP: Record<string, TierKey> = {
  "Starter – $79/month": "STARTER",
  "Growth – $149/month": "GROWTH",
  "Pro – $299/month": "PRO",
  // Also accept bare labels
  Starter: "STARTER",
  Growth: "GROWTH",
  Pro: "PRO",
};

function extractOnboardingData(
  payload: ReturnType<typeof TypeformWebhookSchema.parse>
): OnboardingData {
  const answers = payload.form_response.answers;
  const get = (ref: string) =>
    answers.find((a) => a.field.ref === ref);

  const nameAnswer = get(FIELD_REFS.name);
  const emailAnswer = get(FIELD_REFS.email);
  const businessAnswer = get(FIELD_REFS.businessName);
  const tierAnswer = get(FIELD_REFS.tier);

  const name = nameAnswer?.text ?? "";
  const email = emailAnswer?.email ?? "";
  const businessName = businessAnswer?.text ?? "";
  const tierLabel = tierAnswer?.choice?.label ?? "";
  const tier = TIER_LABEL_MAP[tierLabel];

  if (!name || !email || !businessName || !tier) {
    throw new Error(
      `Missing required fields — name:${name} email:${email} business:${businessName} tier:${tierLabel}`
    );
  }

  return {
    name,
    email,
    businessName,
    tier,
    typeformResponseId: payload.form_response.token,
  };
}

export async function handleTypeformWebhook(
  req: Request,
  res: Response
): Promise<void> {
  const signature = req.headers["typeform-signature"] as string;
  if (!signature) {
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  // rawBody is attached by the express raw middleware in index.ts
  const rawBody = (req as Request & { rawBody: Buffer }).rawBody;
  if (!verifySignature(rawBody, signature)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let parsed;
  try {
    parsed = TypeformWebhookSchema.parse(req.body);
  } catch (err) {
    console.error("[typeform] Parse error:", err);
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  if (parsed.event_type !== "form_response") {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  let onboardingData: OnboardingData;
  try {
    onboardingData = extractOnboardingData(parsed);
  } catch (err) {
    console.error("[typeform] Field extraction error:", err);
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  // Respond immediately — onboarding runs async so Typeform doesn't time out.
  res.status(200).json({ ok: true, responseId: onboardingData.typeformResponseId });

  runOnboarding(onboardingData).catch((err) => {
    console.error("[typeform] Onboarding failed:", err);
  });
}
