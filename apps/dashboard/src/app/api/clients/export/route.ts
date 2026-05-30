import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";

export async function GET(_req: NextRequest) {
  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { transactions: true } },
      syncLogs: { orderBy: { startedAt: "desc" }, take: 1 },
    },
  });

  const PRICES = { STARTER: 79, GROWTH: 149, PRO: 299 };

  const rows = [
    // Header row
    [
      "Name", "Business", "Email", "Tier", "MRR", "Status",
      "QBO Connected", "Plaid Connected", "DocuSign Signed",
      "Transactions", "Last Sync", "Onboarded", "Created",
    ],
    // Data rows
    ...clients.map((c) => [
      c.name,
      c.businessName,
      c.email,
      c.tier,
      PRICES[c.tier],
      c.status,
      c.qboRealmId ? "Yes" : "No",
      c.plaidItemId ? "Yes" : "No",
      c.docusignSignedAt ? c.docusignSignedAt.toISOString().split("T")[0] : (c.docusignEnvelopeId ? "Pending" : "No"),
      c._count.transactions,
      c.syncLogs[0]?.startedAt.toISOString().split("T")[0] ?? "",
      c.onboardedAt?.toISOString().split("T")[0] ?? "",
      c.createdAt.toISOString().split("T")[0],
    ]),
  ];

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const today = new Date().toISOString().split("T")[0];

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vericount-clients-${today}.csv"`,
    },
  });
}
