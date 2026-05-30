import { z } from "zod";

// ─── Tier pricing ────────────────────────────────────────

export const TIERS = {
  STARTER: { label: "Starter", price: 79, stripePriceEnvKey: "STRIPE_STARTER_PRICE_ID" },
  GROWTH: { label: "Growth", price: 149, stripePriceEnvKey: "STRIPE_GROWTH_PRICE_ID" },
  PRO: { label: "Pro", price: 299, stripePriceEnvKey: "STRIPE_PRO_PRICE_ID" },
} as const;

export type TierKey = keyof typeof TIERS;

// ─── Typeform webhook payload ─────────────────────────────

export const TypeformWebhookSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  form_response: z.object({
    form_id: z.string(),
    token: z.string(),
    submitted_at: z.string(),
    answers: z.array(
      z.object({
        field: z.object({ id: z.string(), type: z.string(), ref: z.string().optional() }),
        type: z.string(),
        text: z.string().optional(),
        email: z.string().optional(),
        choice: z.object({ label: z.string() }).optional(),
      })
    ),
    hidden: z.record(z.string()).optional(),
  }),
});

export type TypeformWebhook = z.infer<typeof TypeformWebhookSchema>;

// ─── Onboarding data (extracted from Typeform) ────────────

export const OnboardingDataSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  businessName: z.string().min(1),
  tier: z.enum(["STARTER", "GROWTH", "PRO"]),
  typeformResponseId: z.string(),
});

export type OnboardingData = z.infer<typeof OnboardingDataSchema>;

// ─── QBO types ────────────────────────────────────────────

export interface QBOTokens {
  accessToken: string;
  refreshToken: string;
  expiry: Date;
}

export interface QBOReportRow {
  account: string;
  amount: number;
}

export interface QBOFinancialData {
  pnl: {
    revenue: QBOReportRow[];
    expenses: QBOReportRow[];
    netIncome: number;
    period: string;
  };
  balanceSheet: {
    assets: QBOReportRow[];
    liabilities: QBOReportRow[];
    equity: QBOReportRow[];
    totalAssets: number;
    totalLiabilities: number;
    period: string;
  };
}

// ─── Tax calculation ──────────────────────────────────────

export interface TaxCalculationInput {
  ytdRevenue: number;
  ytdExpenses: number;
  annualizeMultiplier: number; // e.g. 12/3 for Q1
}

export interface TaxCalculationResult {
  ytdNetIncome: number;
  annualizedNetIncome: number;
  seTax: number;
  federalIncomeTax: number;
  gaStateTax: number;
  totalAnnual: number;
  quarterlyPayment: number;
}

// ─── Report generation ────────────────────────────────────

export interface ReportPayload {
  clientId: string;
  clientName: string;
  businessName: string;
  period: string;         // "January 2025"
  financialData: QBOFinancialData;
  narrative: string;
}

// ─── Allowed QBO account / category names ────────────────
// Single canonical list — used by the AI categorizer, the rules validator,
// and the reapply endpoint so they never drift apart.

export const QBO_CATEGORIES = [
  "Advertising & Marketing",
  "Auto & Transport",
  "Bank Charges & Fees",
  "Computer & Internet",
  "Education & Training",
  "Health & Medical",
  "Insurance",
  "Legal & Professional",
  "Meals & Entertainment",
  "Office Supplies",
  "Payroll & Wages",
  "Rent & Lease",
  "Repairs & Maintenance",
  "Software & Subscriptions",
  "Taxes & Licenses",
  "Travel",
  "Utilities",
  "Other Business Expense",
  "Sales Income",
  "Service Revenue",
  "Credit Card Payment",
  "Bank Transfer",
] as const;

export type QBOCategory = (typeof QBO_CATEGORIES)[number];

// ─── Plaid category → QBO account mapping ────────────────
// Single canonical source — imported by bank-sync and webhooks/sync-runner
// so the two services never drift apart.

export const PLAID_TO_QBO: Record<string, string> = {
  "Food and Drink":                           "Meals & Entertainment",
  "Food and Drink.Restaurants":               "Meals & Entertainment",
  "Food and Drink.Coffee Shop":               "Meals & Entertainment",
  "Travel":                                   "Travel",
  "Travel.Airlines and Aviation Services":    "Travel",
  "Travel.Car Service":                       "Travel",
  "Travel.Hotels":                            "Travel",
  "Transportation":                           "Auto & Transport",
  "Transportation.Gas Stations":              "Auto & Transport",
  "Transportation.Parking":                   "Auto & Transport",
  "Shops":                                    "Office Supplies",
  "Shops.Office Supplies":                    "Office Supplies",
  "Shops.Computers and Electronics":          "Computer & Internet",
  "Service.Advertising and Marketing":        "Advertising & Marketing",
  "Service.Insurance":                        "Insurance",
  "Service.Utilities":                        "Utilities",
  "Service.Telecommunication Services":       "Utilities",
  "Service.Software":                         "Software & Subscriptions",
  "Payment.Credit Card":                      "Credit Card Payment",
  "Transfer":                                 "Bank Transfer",
  "Bank Fees":                                "Bank Charges & Fees",
  "Tax":                                      "Taxes & Licenses",
  "Healthcare":                               "Health & Medical",
  "Education":                                "Education & Training",
};

// ─── API response shapes ──────────────────────────────────

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
