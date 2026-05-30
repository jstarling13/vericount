// DocuSign Connect webhook — fires when envelope status changes.
// Configured in DocuSign Admin → Connect → Add Configuration.
// Set the Trigger Events to: Envelope Completed, Envelope Declined, Envelope Voided.
// Set the URL to: https://your-domain.com/webhooks/docusign
// Optionally set the HMAC key in the Connect config and check DOCUSIGN_CONNECT_SECRET below.

import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "@vericount/db";
import { postToChannel } from "@vericount/slack";

interface DocuSignConnectEvent {
  event?: string;
  envelopeId?: string;
  status?: string; // "completed", "declined", "voided", "sent", "delivered"
  envelopeSummary?: {
    envelopeId?: string;
    status?: string;
    completedDateTime?: string;
    voidedReason?: string;
  };
}

function verifyConnectSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = process.env.DOCUSIGN_CONNECT_SECRET;
  // If no secret configured, skip verification (acceptable for internal use)
  if (!secret) return true;
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

export async function handleDocuSignWebhook(
  req: Request,
  res: Response
): Promise<void> {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from("");
  const signature = req.headers["x-docusign-signature-1"] as string | undefined;

  if (!verifyConnectSignature(rawBody, signature)) {
    console.warn("[docusign-webhook] Signature verification failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  res.status(200).json({ received: true });

  handleDocuSignEvent(req.body as DocuSignConnectEvent).catch((err) => {
    console.error("[docusign-webhook] Handler error:", err);
  });
}

async function handleDocuSignEvent(event: DocuSignConnectEvent): Promise<void> {
  const summary = event.envelopeSummary ?? {};
  const envelopeId = summary.envelopeId ?? event.envelopeId;
  const status = summary.status ?? event.status;

  if (!envelopeId || !status) return;

  const client = await prisma.client.findFirst({
    where: { docusignEnvelopeId: envelopeId },
  });

  if (!client) {
    console.log(`[docusign-webhook] No client found for envelope ${envelopeId}`);
    return;
  }

  console.log(`[docusign-webhook] Envelope ${envelopeId} status: ${status} for ${client.name}`);

  if (status === "completed") {
    // Client signed the engagement letter
    await prisma.client.update({
      where: { id: client.id },
      data: { docusignSignedAt: new Date(summary.completedDateTime ?? Date.now()) },
    });

    if (client.slackChannelId) {
      await postToChannel(
        client.slackChannelId,
        `:pencil: *${client.name}* has signed their engagement letter.`
      );
    }
  } else if (status === "declined" || status === "voided") {
    // Log a flag for follow-up
    await prisma.flaggedItem.create({
      data: {
        clientId: client.id,
        type: "docusign_issue",
        description: `Engagement letter ${status}${summary.voidedReason ? `: ${summary.voidedReason}` : ""}. Envelope: ${envelopeId}`,
        referenceId: envelopeId,
      },
    });

    if (client.slackChannelId) {
      await postToChannel(
        client.slackChannelId,
        `:x: Engagement letter ${status} for *${client.name}*. Follow up required.`
      );
    }
  }
}
