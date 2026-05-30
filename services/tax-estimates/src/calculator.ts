import { TaxCalculationInput, TaxCalculationResult } from "@vericount/shared";

// ─── Federal income tax brackets 2025 (single filer) ─────
// These apply to taxable income. For sole proprietors we deduct
// the "above the line" SE tax deduction + standard deduction.

const FEDERAL_BRACKETS_2025 = [
  { upTo: 11925,  rate: 0.10 },
  { upTo: 48475,  rate: 0.12 },
  { upTo: 103350, rate: 0.22 },
  { upTo: 197300, rate: 0.24 },
  { upTo: 250525, rate: 0.32 },
  { upTo: 626350, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];

const STANDARD_DEDUCTION_2025 = 15000;  // single filer
const SE_TAX_WAGE_BASE_2025   = 176100; // SS portion cap
const GA_FLAT_RATE_2025       = 0.0539; // Georgia flat rate for 2025
const GA_STANDARD_DEDUCTION   = 5400;   // Georgia standard deduction (single)

export function calculateTaxEstimate(
  input: TaxCalculationInput
): TaxCalculationResult {
  const ytdNetIncome = input.ytdRevenue - input.ytdExpenses;
  const annualizedNetIncome = ytdNetIncome * input.annualizeMultiplier;

  if (annualizedNetIncome <= 0) {
    return {
      ytdNetIncome,
      annualizedNetIncome,
      seTax: 0,
      federalIncomeTax: 0,
      gaStateTax: 0,
      totalAnnual: 0,
      quarterlyPayment: 0,
    };
  }

  // ── Self-employment tax ───────────────────────────────
  // Net self-employment income = net income * 0.9235 (removes the employer portion)
  const netSEIncome = annualizedNetIncome * 0.9235;
  const ssSEIncome  = Math.min(netSEIncome, SE_TAX_WAGE_BASE_2025);
  const seTax       = ssSEIncome * 0.124 + netSEIncome * 0.029;
  // Additional Medicare 0.9% over $200k
  const additionalMedicare =
    netSEIncome > 200000 ? (netSEIncome - 200000) * 0.009 : 0;
  const totalSETax = seTax + additionalMedicare;

  // ── Federal income tax ────────────────────────────────
  // SE tax deduction: half of SE tax is deductible from gross income
  const seDeduction      = totalSETax / 2;
  const federalAGI       = annualizedNetIncome - seDeduction;
  const federalTaxable   = Math.max(0, federalAGI - STANDARD_DEDUCTION_2025);
  const federalIncomeTax = calcBracketTax(federalTaxable, FEDERAL_BRACKETS_2025);

  // ── Georgia state tax ─────────────────────────────────
  const gaTaxable = Math.max(0, annualizedNetIncome - GA_STANDARD_DEDUCTION);
  const gaStateTax = gaTaxable * GA_FLAT_RATE_2025;

  const totalAnnual     = totalSETax + federalIncomeTax + gaStateTax;
  const quarterlyPayment = totalAnnual / 4;

  return {
    ytdNetIncome,
    annualizedNetIncome,
    seTax: round2(totalSETax),
    federalIncomeTax: round2(federalIncomeTax),
    gaStateTax: round2(gaStateTax),
    totalAnnual: round2(totalAnnual),
    quarterlyPayment: round2(quarterlyPayment),
  };
}

function calcBracketTax(
  taxableIncome: number,
  brackets: { upTo: number; rate: number }[]
): number {
  let tax = 0;
  let prev = 0;
  for (const { upTo, rate } of brackets) {
    const bucketTop = Math.min(taxableIncome, upTo);
    if (bucketTop <= prev) break;
    tax += (bucketTop - prev) * rate;
    prev = upTo;
    if (taxableIncome <= upTo) break;
  }
  return tax;
}

// Return the annualize multiplier for a given quarter (months-to-year ratio)
export function annualizeMultiplierForQuarter(quarter: 1 | 2 | 3 | 4): number {
  // Q1 = Jan-Mar (3 months), Q2 = Jan-Jun (6 months), Q3 = Jan-Sep (9 months), Q4 = Jan-Dec (12)
  const monthsElapsed = quarter * 3;
  return 12 / monthsElapsed;
}

// IRS quarterly due dates
export function getQuarterlyDueDate(year: number, quarter: 1 | 2 | 3 | 4): Date {
  const dates: Record<number, [number, number]> = {
    1: [3, 15],  // April 15
    2: [5, 15],  // June 15
    3: [8, 15],  // Sept 15
    4: [0, 15],  // Jan 15 next year (month is 0-indexed in Date constructor)
  };
  const [month, day] = dates[quarter];
  const targetYear = quarter === 4 ? year + 1 : year;
  return new Date(targetYear, month, day);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
