import Stripe from "stripe";
import { TierKey, TIERS } from "@vericount/shared";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2024-11-20.acacia",
    typescript: true,
  });
}

function getPriceId(tier: TierKey): string {
  const envKey = TIERS[tier].stripePriceEnvKey;
  const priceId = process.env[envKey];
  if (!priceId) throw new Error(`Missing env var: ${envKey}`);
  return priceId;
}

// ─── Customer ─────────────────────────────────────────────

export async function createCustomer(params: {
  name: string;
  email: string;
  businessName: string;
  clientId: string;
}): Promise<Stripe.Customer> {
  const stripe = getStripe();
  return stripe.customers.create({
    name: params.name,
    email: params.email,
    metadata: {
      vericount_client_id: params.clientId,
      business_name: params.businessName,
    },
  });
}

// ─── Subscription ────────────────────────────────────────

export async function createSubscription(params: {
  customerId: string;
  tier: TierKey;
  trialDays?: number;
}): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  return stripe.subscriptions.create({
    customer: params.customerId,
    items: [{ price: getPriceId(params.tier) }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.payment_intent"],
    ...(params.trialDays ? { trial_period_days: params.trialDays } : {}),
  });
}

export async function cancelSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.cancel(subscriptionId);
}

export async function updateSubscriptionTier(
  subscriptionId: string,
  newTier: TierKey
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) throw new Error("No subscription item found");

  return stripe.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, price: getPriceId(newTier) }],
    proration_behavior: "create_prorations",
  });
}

// ─── Webhook verification ────────────────────────────────

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  return getStripe().webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
}

// ─── Billing portal session ───────────────────────────────

export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string
): Promise<string> {
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}
