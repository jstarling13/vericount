import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";
import { PLAID_TO_QBO } from "@vericount/shared";

function mapPlaidCategory(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split(" > ");
  for (let i = parts.length; i > 0; i--) {
    const key = parts.slice(0, i).join(".");
    if (PLAID_TO_QBO[key]) return PLAID_TO_QBO[key];
  }
  return null;
}

/**
 * POST /api/clients/[id]/rules/reapply
 * Re-applies all active categorization rules + the Plaid fallback map to every
 * uncategorized, non-pending transaction for this client.
 * Also resolves uncategorized_tx flaggedItems for transactions that get categorized.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;

  // Load rules and uncategorized transactions in parallel
  const [rules, transactions] = await Promise.all([
    prisma.categorizationRule.findMany({
      where: { clientId, isActive: true },
      orderBy: { priority: "desc" },
    }),
    prisma.transaction.findMany({
      where: { clientId, pending: false, qboCategory: null },
      select: { id: true, description: true, merchant: true, plaidCategory: true, plaidTransactionId: true },
    }),
  ]);

  // Categorize each transaction and collect matched updates
  type Update = { id: string; qboCategory: string; categorySource: string };
  const updates: Update[] = [];
  const categorizedPlaidIds: string[] = [];

  for (const tx of transactions) {
    const haystack = [tx.description, tx.merchant ?? ""].join(" ").toLowerCase();

    let matched: string | null = null;
    let source = "rule";

    // 1. Try client rules
    for (const rule of rules) {
      let hit = false;
      if (rule.isRegex) {
        try { hit = new RegExp(rule.pattern, "i").test(haystack); } catch { /* invalid regex */ }
      } else {
        hit = haystack.includes(rule.pattern.toLowerCase());
      }
      if (hit) { matched = rule.qboCategory; break; }
    }

    // 2. Plaid category fallback
    if (!matched) {
      matched = mapPlaidCategory(tx.plaidCategory);
      source = "plaid";
    }

    if (matched) {
      updates.push({ id: tx.id, qboCategory: matched, categorySource: source });
      if (tx.plaidTransactionId) categorizedPlaidIds.push(tx.plaidTransactionId);
    }
  }

  if (updates.length > 0) {
    // Batch updates: group by (qboCategory, categorySource) to use updateMany
    // instead of one round-trip per transaction.
    const groups = new Map<string, string[]>(); // "category::source" → [txId]
    for (const { id, qboCategory, categorySource } of updates) {
      const key = `${qboCategory}::${categorySource}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(id);
    }

    await Promise.all([
      // Batch update transactions by category group
      ...[...groups.entries()].map(([key, ids]) => {
        const sepIdx = key.lastIndexOf("::");
        const category = key.slice(0, sepIdx);
        const source   = key.slice(sepIdx + 2);
        return prisma.transaction.updateMany({
          where: { id: { in: ids } },
          data: { qboCategory: category, categorySource: source },
        });
      }),
      // Resolve uncategorized_tx flags for the newly categorized transactions
      categorizedPlaidIds.length > 0
        ? prisma.flaggedItem.updateMany({
            where: {
              clientId,
              type: "uncategorized_tx",
              referenceId: { in: categorizedPlaidIds },
              resolved: false,
            },
            data: { resolved: true, resolvedAt: new Date() },
          })
        : Promise.resolve(),
    ]);
  }

  return NextResponse.json({
    updated: updates.length,
    stillUncategorized: transactions.length - updates.length,
  });
}
