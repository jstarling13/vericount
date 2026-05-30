// Plaid webhook handler — fires when transactions are added/modified/removed.
// This triggers an immediate re-sync for the affected item so you don't wait
// until the 2 AM nightly cron for new transactions to appear.
//
// Plaid sends webhooks for many event types; we handle the transaction-relevant ones.
// JWT verification is performed via Plaid's rotating JWK endpoint (see plaid-verification.ts).
// Verification is skipped in sandbox mode to allow Plaid's dashboard test events to work.

import { Request, Response } from "express";
import { prisma } from "@vericount/db";
import { postToChannel } from "@vericount/slack";
import { verifyPlaidWebhook } from "../plaid-verification";

interface PlaidWebhookBody {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  error?: { error_code: string; error_message: string } | null;
  new_transactions?: number;
  removed_transactions?: string[];
}

// Transaction webhook codes that warrant an immediate re-sync
const RESYNC_CODES = new Set([
  "INITIAL_UPDATE",      // first batch of historical transactions ready
  "HISTORICAL_UPDATE",   // full historical data ready
  "DEFAULT_UPDATE",      // new transactions available
  "TRANSACTIONS_REMOVED", // transactions were removed
  "SYNC_UPDATES_AVAILABLE", // sync API has updates
]);

export async function handlePlaidWebhook(
  req: Request,
  res: Response
): Promise<void> {
  // Verify webhook authenticity before processing
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from("");
  const signedJWT = req.headers["plaid-verification"] as string | undefined;
  const valid = await verifyPlaidWebhook(rawBody, signedJWT);
  if (!valid) {
    console.warn("[plaid-webhook] Verification failed — rejecting request");
    res.status(401).json({ error: "Webhook verification failed" });
    return;
  }

  // Acknowledge immediately — Plaid retries if we don't respond within 10s
  res.status(200).json({ received: true });

  const body = req.body as PlaidWebhookBody;

  // Handle ITEM errors (e.g. bank login expired)
  if (body.webhook_type === "ITEM") {
    await handleItemWebhook(body);
    return;
  }

  if (body.webhook_type !== "TRANSACTIONS" || !RESYNC_CODES.has(body.webhook_code)) {
    return;
  }

  const itemId = body.item_id;
  if (!itemId) return;

  const client = await prisma.client.findFirst({
    where: { plaidItemId: itemId, status: "ACTIVE" },
  });

  if (!client) {
    console.log(`[plaid-webhook] No active client for item_id ${itemId}`);
    return;
  }

  console.log(
    `[plaid-webhook] ${body.webhook_code} for ${client.name} (item ${itemId}) — queuing sync`
  );

  // Trigger sync in the background
  triggerClientSync(client.id).catch((err) => {
    console.error(`[plaid-webhook] Sync failed for ${client.name}:`, err);
  });
}

async function triggerClientSync(clientId: string): Promise<void> {
  const { syncClient } = await import("../sync-runner");
  await syncClient(clientId);
}

async function handleItemWebhook(body: PlaidWebhookBody): Promise<void> {
  const itemId = body.item_id;
  if (!itemId) return;

  const client = await prisma.client.findFirst({ where: { plaidItemId: itemId } });
  if (!client) return;

  if (body.webhook_code === "ERROR" && body.error?.error_code === "ITEM_LOGIN_REQUIRED") {
    console.log(`[plaid-webhook] ITEM_LOGIN_REQUIRED for ${client.name}`);

    await prisma.client.update({
      where: { id: client.id },
      data: { plaidNeedsLogin: true },
    });

    const existing = await prisma.flaggedItem.findFirst({
      where: { clientId: client.id, type: "plaid_login_required", resolved: false },
    });
    if (!existing) {
      await prisma.flaggedItem.create({
        data: {
          clientId: client.id,
          type: "plaid_login_required",
          description: `Bank connection needs re-authentication. Client must reconnect via portal.`,
        },
      });
    }

    if (client.slackChannelId) {
      const dashUrl = `${process.env.DASHBOARD_URL ?? "http://localhost:3002"}/clients/${client.id}`;
      await postToChannel(
        client.slackChannelId,
        `:warning: *${client.name}* — bank connection expired (ITEM_LOGIN_REQUIRED). Client needs to reconnect via portal.\n<${dashUrl}|View in dashboard>`
      );
    }
  }

  if (body.webhook_code === "USER_PERMISSION_REVOKED") {
    console.log(`[plaid-webhook] USER_PERMISSION_REVOKED for ${client.name}`);

    // Client disconnected at their bank — clear Plaid credentials
    await prisma.client.update({
      where: { id: client.id },
      data: { plaidAccessToken: null, plaidItemId: null, plaidSyncCursor: null, plaidNeedsLogin: false },
    });

    const existing = await prisma.flaggedItem.findFirst({
      where: { clientId: client.id, type: "plaid_disconnected", resolved: false },
    });
    if (!existing) {
      await prisma.flaggedItem.create({
        data: {
          clientId: client.id,
          type: "plaid_disconnected",
          description: `Client revoked Plaid access. Bank sync paused until they reconnect via portal.`,
        },
      });
    }

    if (client.slackChannelId) {
      const dashUrl = `${process.env.DASHBOARD_URL ?? "http://localhost:3002"}/clients/${client.id}`;
      await postToChannel(
        client.slackChannelId,
        `:x: *${client.name}* revoked bank access (USER_PERMISSION_REVOKED). Plaid connection cleared. <${dashUrl}|View in dashboard>`
      );
    }
  }
}
