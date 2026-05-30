import "dotenv/config";
import cron from "node-cron";
import { prisma } from "@vericount/db";
import { generateReportForClient } from "./generate";

// Runs on the 1st of every month at 6:00 AM
const CRON_SCHEDULE = "0 6 1 * *";

async function runMonthlyReports(): Promise<void> {
  const now = new Date();
  // Report for the PREVIOUS month
  const reportDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = reportDate.getFullYear();
  const month = reportDate.getMonth() + 1;

  console.log(`[reporting] Generating reports for ${month}/${year}`);

  const clients = await prisma.client.findMany({
    where: {
      status: "ACTIVE",
      qboRealmId: { not: null },
      qboAccessToken: { not: null },
    },
  });

  console.log(`[reporting] ${clients.length} clients to report`);

  for (const client of clients) {
    const syncLog = await prisma.syncLog.create({
      data: { clientId: client.id, type: "report", status: "RUNNING" },
    });
    try {
      await generateReportForClient(client.id, year, month);
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: { status: "SUCCESS", completedAt: new Date() },
      });
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[reporting] Failed for ${client.name}:`, msg);
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: { status: "ERROR", completedAt: new Date(), errorMsg: msg },
      });
      // Flag for manual review
      await prisma.flaggedItem.create({
        data: {
          clientId: client.id,
          type: "report_generation_error",
          description: `Monthly report failed for ${month}/${year}: ${msg}`,
        },
      });
    }
  }

  console.log("[reporting] Monthly run complete");
}

cron.schedule(CRON_SCHEDULE, () => {
  runMonthlyReports().catch((err) => {
    console.error("[reporting] Fatal error:", err);
  });
});

console.log(`[reporting] Scheduler started. Reports run on the 1st of each month at 6 AM (${CRON_SCHEDULE})`);

if (process.env.RUN_NOW === "1") {
  runMonthlyReports().catch(console.error);
}

// Run for a single specific client (useful for debugging/re-sending)
// Usage: RUN_NOW_CLIENT=cld_xxx pnpm dev
// Optionally specify month: RUN_NOW_CLIENT=cld_xxx RUN_YEAR=2025 RUN_MONTH=3 pnpm dev
if (process.env.RUN_NOW_CLIENT) {
  const targetId = process.env.RUN_NOW_CLIENT;
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year  = process.env.RUN_YEAR  ? parseInt(process.env.RUN_YEAR)  : prevMonth.getFullYear();
  const month = process.env.RUN_MONTH ? parseInt(process.env.RUN_MONTH) : prevMonth.getMonth() + 1;
  console.log(`[reporting] Running single-client report for ${targetId} (${month}/${year})`);
  generateReportForClient(targetId, year, month).catch(console.error);
}
