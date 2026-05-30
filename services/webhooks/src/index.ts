import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { handleTypeformWebhook } from "./handlers/typeform";
import { handleStripeWebhook } from "./handlers/stripe";
import { handlePlaidWebhook } from "./handlers/plaid";
import { handleDocuSignWebhook } from "./handlers/docusign";

const app = express();
const PORT = process.env.WEBHOOKS_PORT ?? 3000;

// Capture raw body for signature verification BEFORE JSON parsing.
// Both Typeform and Stripe require the raw body to verify the HMAC.
app.use((req: Request & { rawBody?: Buffer }, _res: Response, next: NextFunction) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);
    try {
      (req as Request).body = JSON.parse(req.rawBody.toString("utf8"));
    } catch {
      (req as Request).body = {};
    }
    next();
  });
});

// ─── Routes ──────────────────────────────────────────────

app.post("/webhooks/typeform", handleTypeformWebhook);
app.post("/webhooks/stripe", handleStripeWebhook);
app.post("/webhooks/plaid", handlePlaidWebhook);
app.post("/webhooks/docusign", handleDocuSignWebhook);

// Internal endpoint — called by the dashboard to trigger a manual sync for a single client.
// Protected by the same CRON_SECRET used for scheduled jobs.
app.post("/internal/sync/:clientId", async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { clientId } = req.params as { clientId: string };
  res.status(202).json({ queued: true, clientId });

  // Run in background after responding
  const { syncClient } = await import("./sync-runner");
  syncClient(clientId).catch((err: unknown) => {
    console.error(`[internal-sync] Failed for ${clientId}:`, err);
  });
});

// Trigger report generation for a single client.
// Optional query params: ?year=2025&month=4 — defaults to previous calendar month.
app.post("/internal/report/:clientId", async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { clientId } = req.params as { clientId: string };
  const year  = req.query.year  ? parseInt(req.query.year  as string) : undefined;
  const month = req.query.month ? parseInt(req.query.month as string) : undefined;

  res.status(202).json({ queued: true, clientId, year, month });

  const { generateReport } = await import("./report-runner");
  generateReport(clientId, year, month).catch((err: unknown) => {
    console.error(`[internal-report] Failed for ${clientId}:`, err);
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "vericount-webhooks", ts: new Date().toISOString() });
});

// ─── Start ────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[webhooks] Listening on port ${PORT}`);
});
