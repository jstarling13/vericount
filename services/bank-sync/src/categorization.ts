import { prisma, CategorizationRule } from "@vericount/db";
import { categorizeTx } from "@vericount/ai";
import { PLAID_TO_QBO } from "@vericount/shared";

// ─── Rules engine ─────────────────────────────────────────
// Rules are evaluated highest priority first.
// A rule matches if its pattern is found in the transaction's description or merchant name.

export interface CategorizationCandidate {
  description: string;
  merchant: string | null;
  plaidCategory: string[];
  amount?: number;
}

export async function categorize(
  clientId: string,
  tx: CategorizationCandidate,
  prefetchedRules?: CategorizationRule[]
): Promise<{ qboCategory: string; source: string } | null> {
  // 1. Try client-specific rules first (ordered by priority desc).
  // Accept pre-fetched rules to avoid an N+1 when called in a loop over transactions.
  const rules = prefetchedRules ?? await prisma.categorizationRule.findMany({
    where: { clientId, isActive: true },
    orderBy: { priority: "desc" },
  });

  const haystack = [tx.description, tx.merchant ?? ""]
    .join(" ")
    .toLowerCase();

  for (const rule of rules) {
    if (matches(rule, haystack)) {
      return { qboCategory: rule.qboCategory, source: "rule" };
    }
  }

  // 2. Fall back to Plaid category → QBO account mapping
  const plaidMapped = mapPlaidCategory(tx.plaidCategory);
  if (plaidMapped) {
    return { qboCategory: plaidMapped, source: "plaid" };
  }

  // 3. AI fallback — call Claude when rules and Plaid map both fail
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const aiCategory = await categorizeTx({
        description: tx.description,
        merchant: tx.merchant,
        plaidCategory: tx.plaidCategory.join(" > "),
        amount: tx.amount ?? 0,
      });
      if (aiCategory) {
        return { qboCategory: aiCategory, source: "ai" };
      }
    } catch {
      // AI unavailable — fall through to null (flagged as uncategorized)
    }
  }

  return null;
}

function matches(rule: CategorizationRule, haystack: string): boolean {
  if (rule.isRegex) {
    try {
      return new RegExp(rule.pattern, "i").test(haystack);
    } catch {
      return false;
    }
  }
  return haystack.includes(rule.pattern.toLowerCase());
}

// ─── Train a new rule ─────────────────────────────────────

export async function addRule(params: {
  clientId: string;
  name: string;
  pattern: string;
  qboCategory: string;
  isRegex?: boolean;
  priority?: number;
}): Promise<CategorizationRule> {
  return prisma.categorizationRule.create({
    data: {
      clientId: params.clientId,
      name: params.name,
      pattern: params.pattern,
      qboCategory: params.qboCategory,
      isRegex: params.isRegex ?? false,
      priority: params.priority ?? 0,
    },
  });
}

// PLAID_TO_QBO is imported from @vericount/shared — single canonical source
// shared with webhooks/sync-runner.ts to prevent drift.

function mapPlaidCategory(categories: string[]): string | null {
  // Try progressively less specific keys
  for (let i = categories.length; i > 0; i--) {
    const key = categories.slice(0, i).join(".");
    if (PLAID_TO_QBO[key]) return PLAID_TO_QBO[key];
  }
  return null;
}
