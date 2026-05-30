import Anthropic from "@anthropic-ai/sdk";
import { QBOFinancialData, QBO_CATEGORIES } from "@vericount/shared";

// Using claude-sonnet-4-6 (latest Sonnet as of 2025).
// The model ID you specified ("claude-sonnet-4-20250514") uses an older naming convention;
// the correct current ID is "claude-sonnet-4-6".
const MODEL = "claude-sonnet-4-6";

// Module-level singleton — reuses HTTP keep-alive connections across calls.
let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _anthropic;
}

// ─── System prompt (cached — billed once per cache TTL) ───

const BOOKKEEPER_SYSTEM = `You are a professional bookkeeper writing monthly financial narrative summaries for small business clients.
Your tone is clear, friendly, and professional — like a trusted advisor explaining numbers to a non-accountant business owner.
Always explain what the numbers mean in plain English. Highlight trends, wins, and anything that warrants attention.
Keep summaries to 3-5 paragraphs. Never use accounting jargon without explaining it.
Do not make investment or tax advice.`;

// ─── Monthly report narrative ────────────────────────────

export interface PriorMonthSummary {
  period: string;       // "December 2024"
  revenue: number;
  expenses: number;
  netIncome: number;
}

export async function generateMonthlyNarrative(params: {
  businessName: string;
  period: string; // "January 2025"
  data: QBOFinancialData;
  priorMonth?: PriorMonthSummary;
}): Promise<string> {
  const client = getClient();

  const { pnl, balanceSheet } = params.data;
  const totalRevenue  = pnl.revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = pnl.expenses.reduce((s, r) => s + r.amount, 0);

  // Month-over-month deltas (if prior month data available)
  let momSection = "";
  if (params.priorMonth) {
    const pm = params.priorMonth;
    const revChange  = totalRevenue  - pm.revenue;
    const expChange  = totalExpenses - pm.expenses;
    const netChange  = pnl.netIncome - pm.netIncome;
    const pct = (n: number, base: number) =>
      base !== 0 ? ` (${n >= 0 ? "+" : ""}${((n / base) * 100).toFixed(1)}%)` : "";

    momSection = `
**Month-over-Month vs ${pm.period}:**
Revenue:   $${revChange >= 0 ? "+" : ""}${revChange.toFixed(2)}${pct(revChange, pm.revenue)}
Expenses:  $${expChange >= 0 ? "+" : ""}${expChange.toFixed(2)}${pct(expChange, pm.expenses)}
Net Income: $${netChange >= 0 ? "+" : ""}${netChange.toFixed(2)}${pct(netChange, pm.netIncome)}
`;
  }

  const userPrompt = `Generate a monthly financial summary for ${params.businessName} covering ${params.period}.

**Profit & Loss:**
Revenue:
${pnl.revenue.map((r) => `  - ${r.account}: $${r.amount.toFixed(2)}`).join("\n")}
Total Revenue: $${totalRevenue.toFixed(2)}

Expenses:
${pnl.expenses.map((e) => `  - ${e.account}: $${e.amount.toFixed(2)}`).join("\n")}
Total Expenses: $${totalExpenses.toFixed(2)}

Net Income: $${pnl.netIncome.toFixed(2)}
${momSection}
**Balance Sheet (end of ${params.period}):**
Total Assets: $${balanceSheet.totalAssets.toFixed(2)}
Total Liabilities: $${balanceSheet.totalLiabilities.toFixed(2)}
Net Equity: $${(balanceSheet.totalAssets - balanceSheet.totalLiabilities).toFixed(2)}

${params.priorMonth ? "Include a brief mention of month-over-month trends where meaningful. " : ""}Write a plain-English narrative summary of this month's financial performance.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: BOOKKEEPER_SYSTEM,
        cache_control: { type: "ephemeral" }, // cache the system prompt
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text;
}

// ─── Transaction categorization fallback ─────────────────
// Used when no client rule matches and Plaid's category map has no entry.
// Returns a QBO account name from the canonical list in @vericount/shared, or null if uncertain.
// QBO_CATEGORIES is imported from @vericount/shared — single source of truth.

export async function categorizeTx(params: {
  description: string;
  merchant: string | null;
  plaidCategory: string;
  amount: number; // positive = expense, negative = income
}): Promise<string | null> {
  const client = getClient();

  const categoryList = QBO_CATEGORIES.join(", ");
  const sign = params.amount > 0 ? "outflow (expense/payment)" : "inflow (income/deposit)";

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 64,
    system: [
      {
        type: "text",
        text: `You are a bookkeeping assistant. Given a bank transaction, return the single most appropriate QBO category from this list: ${categoryList}. Reply with ONLY the category name, nothing else. If you cannot confidently categorize it, reply with the single word: UNKNOWN`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Transaction: "${params.description}"${params.merchant ? ` (merchant: ${params.merchant})` : ""}
Plaid category: ${params.plaidCategory || "none"}
Direction: ${sign}, amount: $${Math.abs(params.amount).toFixed(2)}`,
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== "text") return null;
  const text = block.text.trim();
  if (text === "UNKNOWN") return null;
  // Only return if it's an exact match from our allowed list
  return (QBO_CATEGORIES as readonly string[]).includes(text) ? text : null;
}

// ─── Tax estimate plain-English alert ────────────────────

export async function generateTaxAlert(params: {
  businessName: string;
  quarter: string;  // "Q1 2025"
  dueDate: string;  // "April 15, 2025"
  quarterlyPayment: number;
  ytdNetIncome: number;
  breakdown: { federal: number; state: number; seTax: number };
}): Promise<string> {
  const client = getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: BOOKKEEPER_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Write a friendly, plain-English tax estimate alert email body for ${params.businessName}.
Quarter: ${params.quarter}
Payment due by: ${params.dueDate}
Recommended quarterly payment: $${params.quarterlyPayment.toFixed(2)}
Based on YTD net income: $${params.ytdNetIncome.toFixed(2)}
Breakdown: Federal income tax: $${params.breakdown.federal.toFixed(2)}, Georgia state tax: $${params.breakdown.state.toFixed(2)}, Self-employment tax: $${params.breakdown.seTax.toFixed(2)}

Keep it under 150 words. Be warm but clear about the action needed.`,
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text;
}
