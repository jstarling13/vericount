import "dotenv/config";
import cron from "node-cron";
import { prisma } from "@vericount/db";
import { syncClient } from "./sync";

// Runs nightly at 2:00 AM local server time
const CRON_SCHEDULE = "0 2 * * *";

async function runAllClients(): Promise<void> {
  console.log("[bank-sync] Starting nightly sync run...");

  const clients = await prisma.client.findMany({
    where: {
      status: "ACTIVE",
      plaidAccessToken: { not: null },
    },
  });

  console.log(`[bank-sync] Syncing ${clients.length} active clients`);

  // Process sequentially to avoid overwhelming the Plaid API
  for (const client of clients) {
    try {
      await syncClient(client);
    } catch (err) {
      console.error(
        `[bank-sync] Failed to sync client ${client.id} (${client.name}):`,
        err
      );
    }
  }

  console.log("[bank-sync] Nightly sync complete");
}

// ─── Schedule nightly job ─────────────────────────────────

cron.schedule(CRON_SCHEDULE, () => {
  runAllClients().catch((err) => {
    console.error("[bank-sync] Fatal error in runAllClients:", err);
  });
});

console.log(`[bank-sync] Scheduler started. Next run: nightly at 2:00 AM (${CRON_SCHEDULE})`);

// Also run immediately if RUN_NOW env flag is set (useful for testing)
if (process.env.RUN_NOW === "1") {
  runAllClients().catch(console.error);
}

// Run for a single specific client (useful for debugging/development)
// Usage: RUN_NOW_CLIENT=cld_xxx pnpm dev
if (process.env.RUN_NOW_CLIENT) {
  const targetId = process.env.RUN_NOW_CLIENT;
  prisma.client.findUnique({ where: { id: targetId } })
    .then(async (client) => {
      if (!client) { console.error(`[bank-sync] Client ${targetId} not found`); return; }
      console.log(`[bank-sync] Running single-client sync for ${client.name} (${targetId})`);
      await syncClient(client);
    })
    .catch(console.error);
}
