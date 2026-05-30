import { Request, Response } from "express";
import { constructWebhookEvent } from "@vericount/stripe-client";
import { prisma } from "@vericount/db";
import { postToChannel } from "@vericount/slack";
import Stripe from "stripe";

export async function handleStripeWebhook(
  req: Request,
  res: Response
): Promise<void> {
  const signature = req.headers["stripe-signature"] as string;
  if (!signature) {
    res.status(400).json({ error: "Missing stripe-signature" });
    return;
  }

  let event: Stripe.Event;
  try {
    const rawBody = (req as Request & { rawBody: Buffer }).rawBody;
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    console.error("[stripe] Webhook verification failed:", err);
    res.status(400).json({ error: "Webhook verification failed" });
    return;
  }

  res.status(200).json({ received: true });

  // Process asynchronously after responding
  handleStripeEvent(event).catch((err) => {
    console.error(`[stripe] Handler error for ${event.type}:`, err);
  });
}

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.deleted":
    case "customer.subscription.paused": {
      const sub = event.data.object as Stripe.Subscription;
      const client = await prisma.client.findFirst({
        where: { stripeSubscriptionId: sub.id },
      });
      if (!client) return;

      const newStatus =
        event.type === "customer.subscription.deleted" ? "CHURNED" : "SUSPENDED";

      await prisma.client.update({
        where: { id: client.id },
        data: { status: newStatus },
      });

      if (client.slackChannelId) {
        await postToChannel(
          client.slackChannelId,
          `:warning: Subscription ${event.type === "customer.subscription.deleted" ? "cancelled" : "paused"} for *${client.name}* (${client.businessName}). Status set to ${newStatus}.`
        );
      }
      break;
    }

    case "customer.subscription.resumed":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.status === "active") {
        await prisma.client.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { status: "ACTIVE" },
        });
      }
      break;
    }

    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      const client = await prisma.client.findFirst({
        where: { stripeSubscriptionId: sub.id },
      });
      if (!client) return;

      const trialEnd = sub.trial_end
        ? new Date(sub.trial_end * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        : "soon";

      if (client.slackChannelId) {
        const dashUrl = `${process.env.DASHBOARD_URL ?? "http://localhost:3002"}/clients/${client.id}`;
        await postToChannel(
          client.slackChannelId,
          `:hourglass: *${client.name}*'s trial ends on ${trialEnd}. Ensure payment method is on file. <${dashUrl}|View client>`
        );
      }

      // Create a flag so it shows up in the dashboard review queue
      await prisma.flaggedItem.create({
        data: {
          clientId: client.id,
          type: "trial_ending",
          description: `Trial period ending ${trialEnd} — confirm payment method is on file.`,
        },
      });
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;

      if (!customerId) return;

      const client = await prisma.client.findFirst({
        where: { stripeCustomerId: customerId },
      });
      if (!client) return;

      await prisma.flaggedItem.create({
        data: {
          clientId: client.id,
          type: "payment_failed",
          description: `Invoice ${invoice.id} payment failed. Amount: $${((invoice.amount_due ?? 0) / 100).toFixed(2)}`,
          referenceId: invoice.id,
        },
      });

      if (client.slackChannelId) {
        await postToChannel(
          client.slackChannelId,
          `:x: *Payment failed* for ${client.name} — Invoice ${invoice.id}. Amount: $${((invoice.amount_due ?? 0) / 100).toFixed(2)}`
        );
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
      if (!customerId) return;

      const client = await prisma.client.findFirst({
        where: { stripeCustomerId: customerId },
      });
      if (!client) return;

      // Resolve any open payment_failed flags — they paid
      await prisma.flaggedItem.updateMany({
        where: { clientId: client.id, type: "payment_failed", resolved: false },
        data: { resolved: true, resolvedAt: new Date() },
      });
      break;
    }

    default:
      // Unhandled event types — no-op
      break;
  }
}
