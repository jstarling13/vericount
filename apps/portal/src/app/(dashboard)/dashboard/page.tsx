import { getAuthenticatedClient, getUnreadMessageCount } from "@/lib/auth";
import { prisma } from "@vericount/db";
import { formatCurrency, formatDate, getPeriodLabel } from "@/lib/utils";
import Link from "next/link";
import { ConnectQBOBanner } from "@/components/ConnectQBOBanner";
import { ConnectPlaidBanner } from "@/components/ConnectPlaidBanner";
import { ReconnectPlaidBanner } from "@/components/ReconnectPlaidBanner";

export default async function DashboardPage() {
  const client = await getAuthenticatedClient();

  const [reports, recentTxs, unreadCount, plaidAccounts, nextTaxEstimate] = await Promise.all([
    // Latest two reports for MoM comparison
    prisma.report.findMany({
      where: { clientId: client.id, type: "MONTHLY", emailedAt: { not: null } },
      orderBy: { period: "desc" },
      take: 2,
    }),
    // Recent transactions (last 8)
    prisma.transaction.findMany({
      where: { clientId: client.id, pending: false },
      orderBy: { date: "desc" },
      take: 8,
    }),
    // Shares the cached result with the layout — no extra DB round-trip
    getUnreadMessageCount(client.id),
    // Bank account balances
    prisma.plaidAccount.findMany({
      where: { clientId: client.id, isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    // Next upcoming tax estimate
    prisma.taxEstimate.findFirst({
      where: { clientId: client.id, dueDate: { gte: new Date() } },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  const latestReport = reports[0] ?? null;
  const priorReport  = reports[1] ?? null;

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {client.name.split(" ")[0]}
        </h1>
        <p className="text-gray-500 text-sm mt-1">{client.businessName}</p>
      </div>

      {/* Connection banners */}
      {!client.qboRealmId && <ConnectQBOBanner clientId={client.id} />}
      {/* Show reconnect if QBO token hasn't been refreshed in 30+ days (refresh token likely expired) */}
      {client.qboRealmId && client.qboTokenExpiry && (
        new Date().getTime() - client.qboTokenExpiry.getTime() > 30 * 24 * 60 * 60 * 1000
      ) && <QBOReconnectBanner clientId={client.id} />}
      {client.plaidItemId && client.plaidNeedsLogin && (
        <ReconnectPlaidBanner clientId={client.id} />
      )}
      {!client.plaidItemId && client.qboRealmId && (
        <ConnectPlaidBanner clientId={client.id} />
      )}

      {/* Stats row */}
      {latestReport?.rawQboData && (
        <StatsRow
          data={latestReport.rawQboData as Record<string, unknown>}
          period={latestReport.period}
          priorData={priorReport?.rawQboData as Record<string, unknown> | undefined}
        />
      )}

      {/* Bank account balances */}
      {plaidAccounts.length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Connected Accounts</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {plaidAccounts.map((acct) => (
              <div key={acct.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{acct.name}</p>
                  <p className="text-xs text-gray-400 capitalize">
                    {acct.type}{acct.subtype ? ` · ${acct.subtype}` : ""}{acct.mask ? ` ···${acct.mask}` : ""}
                  </p>
                </div>
                <span className="text-sm font-semibold text-gray-800">
                  {acct.currentBalance != null
                    ? formatCurrency(Number(acct.currentBalance))
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Latest report */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Latest Report</h2>
            <Link href="/reports" className="text-sm text-blue-600 hover:underline">
              View all →
            </Link>
          </div>
          {latestReport ? (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-medium text-gray-900">
                  {getPeriodLabel(latestReport.period)}
                </span>
                <span className="text-xs text-gray-400">
                  · Sent {latestReport.emailedAt ? formatDate(latestReport.emailedAt) : ""}
                </span>
              </div>
              {latestReport.narrative && (
                <p className="text-sm text-gray-600 leading-relaxed line-clamp-4">
                  {latestReport.narrative}
                </p>
              )}
              <div className="flex items-center gap-3 mt-4">
                {latestReport.rawQboData && latestReport.narrative && (
                  <a
                    href={`/api/reports/${latestReport.id}/pdf`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0f4c81] hover:text-blue-700"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download PDF
                  </a>
                )}
                <Link href="/reports" className="text-sm text-gray-400 hover:text-gray-600">
                  All reports →
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              Your first report will be sent on the 1st of next month once your accounts are connected.
            </p>
          )}
        </div>

        {/* Quick actions */}
        <div className="space-y-4">
          {/* Messages */}
          <Link
            href="/messages"
            className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Messages</span>
              {unreadCount > 0 && (
                <span className="bg-[#0f4c81] text-white text-xs font-bold rounded-full px-2 py-0.5">
                  {unreadCount}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {unreadCount > 0 ? `${unreadCount} unread from your bookkeeper` : "Message your bookkeeper"}
            </p>
          </Link>

          {/* Next tax estimate */}
          {nextTaxEstimate && (
            <Link
              href="/tax-estimates"
              className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 transition-colors"
            >
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">Next Tax Payment</p>
              <p className="text-xl font-bold text-[#0f4c81]">
                {formatCurrency(Number(nextTaxEstimate.quarterlyAmt))}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Due {nextTaxEstimate.dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {" "}· {nextTaxEstimate.year} Q{nextTaxEstimate.quarter}
              </p>
            </Link>
          )}

          {/* Tier badge */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">Your Plan</p>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-900">{client.tier} Plan</span>
              <Link
                href="/api/billing/portal"
                className="text-xs text-blue-600 hover:underline"
              >
                Manage billing
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      {recentTxs.length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Transactions</h2>
            <Link href="/transactions" className="text-sm text-blue-600 hover:underline">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recentTxs.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-6 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{tx.description}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDate(tx.date)}
                    {tx.qboCategory && (
                      <span className="ml-2 text-blue-500">{tx.qboCategory}</span>
                    )}
                  </p>
                </div>
                <span
                  className={`text-sm font-semibold ml-4 shrink-0 ${
                    Number(tx.amount) < 0 ? "text-green-600" : "text-gray-900"
                  }`}
                >
                  {formatCurrency(Number(tx.amount))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QBOReconnectBanner({ clientId }: { clientId: string }) {
  return (
    <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-4">
      <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-red-800">QuickBooks connection needs to be renewed</p>
        <p className="text-xs text-red-700 mt-0.5">
          Your QuickBooks authorization has expired. Please reconnect so your bookkeeper can continue syncing your books.
        </p>
        <a
          href={`/api/qbo/connect?clientId=${clientId}`}
          className="inline-block mt-3 bg-red-600 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
        >
          Reconnect QuickBooks Online →
        </a>
      </div>
    </div>
  );
}

type PnlData = { pnl?: { revenue?: { amount: number }[]; expenses?: { amount: number }[]; netIncome?: number } };

function extractPnl(data: Record<string, unknown>) {
  const pnl = (data as PnlData).pnl;
  if (!pnl) return null;
  return {
    revenue:  (pnl.revenue  ?? []).reduce((s: number, r: { amount: number }) => s + r.amount, 0),
    expenses: (pnl.expenses ?? []).reduce((s: number, r: { amount: number }) => s + r.amount, 0),
    net: pnl.netIncome ?? 0,
  };
}

function StatsRow({
  data,
  period,
  priorData,
}: {
  data: Record<string, unknown>;
  period: string;
  priorData?: Record<string, unknown>;
}) {
  const curr = extractPnl(data);
  if (!curr) return null;
  const prior = priorData ? extractPnl(priorData) : null;

  function delta(curr: number, prior: number | undefined): string | null {
    if (prior === undefined || prior === null || prior === 0) return null;
    const pct = ((curr - prior) / Math.abs(prior)) * 100;
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(0)}% vs prior month`;
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <StatCard
        label="Revenue"
        value={formatCurrency(curr.revenue)}
        sublabel={getPeriodLabel(period)}
        delta={prior ? delta(curr.revenue, prior.revenue) : null}
        deltaPositive={prior ? curr.revenue >= prior.revenue : null}
        color="green"
      />
      <StatCard
        label="Expenses"
        value={formatCurrency(curr.expenses)}
        sublabel={getPeriodLabel(period)}
        delta={prior ? delta(curr.expenses, prior.expenses) : null}
        deltaPositive={prior ? curr.expenses <= prior.expenses : null}
        color="red"
      />
      <StatCard
        label="Net Income"
        value={formatCurrency(curr.net)}
        sublabel={getPeriodLabel(period)}
        delta={prior ? delta(curr.net, prior.net) : null}
        deltaPositive={prior ? curr.net >= prior.net : null}
        color={curr.net >= 0 ? "blue" : "red"}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  sublabel,
  color,
  delta,
  deltaPositive,
}: {
  label: string;
  value: string;
  sublabel: string;
  color: "green" | "red" | "blue";
  delta?: string | null;
  deltaPositive?: boolean | null;
}) {
  const colorMap = {
    green: "text-green-600",
    red: "text-red-600",
    blue: "text-[#0f4c81]",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colorMap[color]}`}>{value}</p>
      <div className="flex items-center gap-2 mt-1">
        <p className="text-xs text-gray-400">{sublabel}</p>
        {delta && (
          <span className={`text-[10px] font-medium ${deltaPositive ? "text-green-600" : "text-red-500"}`}>
            {deltaPositive ? "↑" : "↓"} {delta}
          </span>
        )}
      </div>
    </div>
  );
}
