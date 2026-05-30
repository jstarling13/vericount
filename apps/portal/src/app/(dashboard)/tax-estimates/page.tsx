import { getAuthenticatedClient } from "@/lib/auth";
import { prisma } from "@vericount/db";

const QUARTER_LABELS: Record<number, string> = { 1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4" };
const QUARTER_MONTHS: Record<number, string> = {
  1: "Jan – Mar",
  2: "Jan – Jun",
  3: "Jan – Sep",
  4: "Jan – Dec",
};

function fmt(n: number | string | { toString(): string }) {
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function TaxEstimatesPage() {
  const client = await getAuthenticatedClient();

  const estimates = await prisma.taxEstimate.findMany({
    where: { clientId: client.id },
    orderBy: [{ year: "desc" }, { quarter: "desc" }],
  });

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Tax Estimates</h1>
      <p className="text-sm text-gray-500 mb-6">
        Quarterly estimated payments for federal income tax, self-employment tax, and Georgia state tax.
        These are estimates based on your YTD income — consult a CPA for filing.
      </p>

      {estimates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">
            No tax estimates yet. Estimates are generated on the 1st of January, April, July, and October.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {estimates.map((est) => {
            const isPastDue = est.dueDate < new Date();
            return (
              <div key={est.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-base font-semibold text-gray-900">
                        {est.year} {QUARTER_LABELS[est.quarter]}
                      </span>
                      <span className="text-xs text-gray-400">{QUARTER_MONTHS[est.quarter]}</span>
                    </div>
                    <p className={`text-xs mt-0.5 ${isPastDue ? "text-red-500 font-medium" : "text-gray-400"}`}>
                      {isPastDue ? "Past due — " : "Due "}
                      {fmtDate(est.dueDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Quarterly payment</p>
                    <p className="text-2xl font-bold text-[#0f4c81]">{fmt(est.quarterlyAmt)}</p>
                  </div>
                </div>

                {/* Breakdown */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-gray-100">
                  <TaxCell label="YTD Net Income" value={fmt(est.ytdNetIncome)} neutral />
                  <TaxCell label="Self-Employment Tax" value={fmt(est.seTax)} />
                  <TaxCell label="Federal Income Tax" value={fmt(est.federalEst)} />
                  <TaxCell label="Georgia State Tax" value={fmt(est.gaStateEst)} />
                </div>

                {/* Total annual */}
                <div className="px-6 py-3 bg-gray-50 flex items-center justify-between">
                  <span className="text-xs text-gray-500">Estimated annual tax liability</span>
                  <span className="text-sm font-semibold text-gray-800">{fmt(est.totalEst)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-gray-400">
        Estimates use 2025 tax brackets, the $15,000 federal standard deduction, and Georgia&apos;s 5.39% flat rate.
        Figures are annualized from your YTD income through the end of the quarter.
      </p>
    </div>
  );
}

function TaxCell({
  label,
  value,
  neutral,
}: {
  label: string;
  value: string;
  neutral?: boolean;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-sm font-semibold ${neutral ? "text-gray-700" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}
