import { prisma } from "@vericount/db";
import { TIERS } from "@vericount/shared";
import Link from "next/link";
import { Suspense } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { ClientsFilter } from "@/components/ClientsFilter";
import { NewClientButton } from "@/components/NewClientButton";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; tier?: string }>;
}) {
  const params = await searchParams;
  const search = params.search?.trim() ?? "";
  const statusFilter = params.status ?? "";
  const tierFilter = params.tier ?? "";

  const clientWhere = {
    ...(statusFilter ? { status: statusFilter as "PENDING" | "ACTIVE" | "SUSPENDED" | "CHURNED" } : {}),
    ...(tierFilter ? { tier: tierFilter as "STARTER" | "GROWTH" | "PRO" } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { businessName: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [clients, openFlags, recentLogs, unreadMessages, recentUnreadMsgs, uncategorizedCount] = await Promise.all([
    prisma.client.findMany({
      where: clientWhere,
      orderBy: { createdAt: "desc" },
      include: {
        syncLogs: { orderBy: { startedAt: "desc" }, take: 1 },
        reports: { orderBy: { period: "desc" }, take: 1, where: { type: "MONTHLY" } },
        _count: {
          select: {
            flaggedItems: { where: { resolved: false } },
            messages: { where: { sender: "CLIENT", readAt: null } },
          },
        },
      },
    }),
    prisma.flaggedItem.count({ where: { resolved: false } }),
    prisma.syncLog.findMany({
      where: { status: "ERROR", startedAt: { gte: sevenDaysAgo } },
      orderBy: { startedAt: "desc" },
      take: 5,
      include: { client: { select: { name: true } } },
    }),
    prisma.message.count({ where: { sender: "CLIENT", readAt: null } }),
    // Recent unread client messages (for the preview section)
    prisma.message.findMany({
      where: { sender: "CLIENT", readAt: null },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { client: { select: { id: true, name: true } } },
    }),
    // Transactions needing categorization across all clients
    prisma.transaction.count({ where: { pending: false, qboCategory: null } }),
  ]);

  const activeCount = clients.filter((c) => c.status === "ACTIVE").length;
  const mrr = clients
    .filter((c) => c.status === "ACTIVE")
    .reduce((s, c) => s + TIERS[c.tier].price, 0);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vericount Ops</h1>
          <p className="text-gray-400 text-sm mt-0.5">Internal dashboard</p>
        </div>
        <form action="/api/auth/logout" method="POST">
          <button className="text-xs text-gray-400 hover:text-gray-600 underline">Sign out</button>
        </form>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Active clients" value={activeCount} />
        <StatCard label="MRR" value={`$${mrr.toLocaleString()}`} />
        <StatCard label="Open flags" value={openFlags} warn={openFlags > 0} />
        <StatCard label="Unread messages" value={unreadMessages} warn={unreadMessages > 0} />
      </div>

      {/* Uncategorized transactions alert */}
      {uncategorizedCount > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-amber-500 text-base">⚠</span>
            <span className="text-xs font-medium text-amber-800">
              {uncategorizedCount.toLocaleString()} transaction{uncategorizedCount !== 1 ? "s" : ""} across all clients need categorization
            </span>
          </div>
          <span className="text-xs text-amber-600">Use the Re-apply rules button on each client to batch-categorize</span>
        </div>
      )}

      {/* Unread client messages */}
      {recentUnreadMsgs.length > 0 && (
        <div className="mb-8 bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-blue-800 mb-3">
            Unread Messages ({unreadMessages})
          </h2>
          <div className="space-y-2">
            {recentUnreadMsgs.map((msg) => (
              <div key={msg.id} className="flex items-start gap-3">
                <a
                  href={`/clients/${msg.client.id}`}
                  className="text-xs font-semibold text-blue-700 hover:underline shrink-0 mt-0.5 min-w-[120px]"
                >
                  {msg.client.name}
                </a>
                <p className="text-xs text-blue-800 truncate flex-1">{msg.content}</p>
                <span className="text-xs text-blue-500 shrink-0">
                  {fmtDate(msg.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent errors */}
      {recentLogs.length > 0 && (
        <div className="mb-8 bg-red-50 border border-red-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-red-800 mb-3">Recent Sync Errors</h2>
          <div className="space-y-2">
            {recentLogs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 text-sm">
                <span className="text-red-600 font-medium">{log.client.name}</span>
                <span className="text-red-500 text-xs">[{log.type}]</span>
                <span className="text-red-700 text-xs truncate">{log.errorMsg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Client table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-gray-900">
              Clients
              <span className="ml-2 text-sm font-normal text-gray-400">({clients.length})</span>
            </h2>
            <a
              href="/api/clients/export"
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Export CSV
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Suspense>
              <ClientsFilter search={search} status={statusFilter} tier={tierFilter} />
            </Suspense>
            <NewClientButton />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {["Client", "Tier", "Status", "Last sync", "Last report", "Flags", "Msgs", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {clients.map((client) => {
                const lastSync = client.syncLogs[0];
                const lastReport = client.reports[0];
                const flagCount = client._count.flaggedItems;
                const unreadCount = client._count.messages;

                return (
                  <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{client.name}</div>
                      <div className="text-xs text-gray-400">{client.businessName}</div>
                    </td>
                    <td className="px-5 py-3">
                      <TierBadge tier={client.tier} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={client.status} />
                    </td>
                    <td className="px-5 py-3">
                      {lastSync ? (
                        <div>
                          <SyncStatusDot status={lastSync.status} />
                          <span className="text-xs text-gray-400 ml-1.5">
                            {fmtDate(lastSync.startedAt)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">Never</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500">
                      {lastReport ? lastReport.period : <span className="text-gray-300">None</span>}
                    </td>
                    <td className="px-5 py-3">
                      {flagCount > 0 ? (
                        <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                          {flagCount}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {unreadCount > 0 ? (
                        <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
                          {unreadCount}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/clients/${client.id}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl border p-5 ${warn ? "border-red-200" : "border-gray-200"}`}>
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${warn ? "text-red-600" : "text-[#0f4c81]"}`}>
        {value}
      </p>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, string> = {
    STARTER: "bg-gray-100 text-gray-600",
    GROWTH: "bg-blue-100 text-blue-700",
    PRO: "bg-purple-100 text-purple-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[tier] ?? "bg-gray-100 text-gray-500"}`}>
      {tier}
    </span>
  );
}

function SyncStatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    SUCCESS: "bg-green-500",
    ERROR: "bg-red-500",
    RUNNING: "bg-yellow-500",
    PENDING: "bg-gray-300",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? "bg-gray-300"}`}
    />
  );
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
