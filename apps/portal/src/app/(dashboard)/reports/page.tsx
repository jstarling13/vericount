import { getAuthenticatedClient } from "@/lib/auth";
import { prisma } from "@vericount/db";
import { formatDate, formatCurrency, getPeriodLabel } from "@/lib/utils";
import { QBOFinancialData } from "@vericount/shared";

function extractPnlSummary(raw: Record<string, unknown> | null) {
  if (!raw) return null;
  const data = raw as unknown as QBOFinancialData;
  if (!data?.pnl) return null;
  const revenue  = data.pnl.revenue.reduce((s, r) => s + r.amount, 0);
  const expenses = data.pnl.expenses.reduce((s, r) => s + r.amount, 0);
  return { revenue, expenses, net: data.pnl.netIncome };
}

export default async function ReportsPage() {
  const client = await getAuthenticatedClient();

  const reports = await prisma.report.findMany({
    where: { clientId: client.id },
    orderBy: { period: "desc" },
  });

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Reports</h1>

      {reports.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">
            No reports yet. Your first report will be sent on the 1st of next month.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const pnl = extractPnlSummary(report.rawQboData as Record<string, unknown> | null);
            return (
              <div
                key={report.id}
                className="bg-white rounded-xl border border-gray-200 p-6"
              >
                {/* Header row */}
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-gray-900">
                        {getPeriodLabel(report.period)}
                      </span>
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                        {report.type === "MONTHLY" ? "Monthly" : "Quarterly Tax"}
                      </span>
                      {report.emailedAt ? (
                        <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                          Delivered
                        </span>
                      ) : (
                        <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">
                          Pending delivery
                        </span>
                      )}
                    </div>
                    {report.emailedAt && (
                      <p className="text-xs text-gray-400">Sent {formatDate(report.emailedAt)}</p>
                    )}
                  </div>

                  {/* PDF download */}
                  {report.rawQboData && report.narrative && (
                    <a
                      href={`/api/reports/${report.id}/pdf`}
                      className="ml-4 flex items-center gap-1.5 text-sm font-medium text-[#0f4c81] hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      PDF
                    </a>
                  )}
                </div>

                {/* Financial summary */}
                {pnl && (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <FinanceStat label="Revenue" value={formatCurrency(pnl.revenue)} color="text-green-600" />
                    <FinanceStat label="Expenses" value={formatCurrency(pnl.expenses)} color="text-gray-700" />
                    <FinanceStat
                      label="Net Income"
                      value={formatCurrency(pnl.net)}
                      color={pnl.net >= 0 ? "text-[#0f4c81]" : "text-red-600"}
                    />
                  </div>
                )}

                {/* Narrative snippet */}
                {report.narrative && (
                  <p className="text-sm text-gray-500 mt-3 line-clamp-2 leading-relaxed">
                    {report.narrative}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FinanceStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2.5">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}
