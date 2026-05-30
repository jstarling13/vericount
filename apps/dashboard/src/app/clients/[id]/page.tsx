import { prisma } from "@vericount/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { FlaggedItems } from "@/components/FlaggedItems";
import { RulesManager } from "@/components/RulesManager";
import { SyncButton } from "@/components/SyncButton";
import { ReportButton } from "@/components/ReportButton";
import { NotesEditor } from "@/components/NotesEditor";
import { MessagePanel } from "@/components/MessagePanel";
import { EditableClientFields } from "@/components/EditableClientFields";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      plaidAccounts: { orderBy: { createdAt: "asc" } },
      syncLogs: { orderBy: { startedAt: "desc" }, take: 10 },
      reports: { orderBy: { period: "desc" }, take: 6 },
      taxEstimates: { orderBy: { year: "desc" } },
      flaggedItems: { where: { resolved: false }, orderBy: { createdAt: "desc" } },
      categorizationRules: { where: { isActive: true }, orderBy: { priority: "desc" } },
      messages: { orderBy: { createdAt: "asc" }, take: 50 },
      _count: { select: { transactions: true } },
    },
  });

  if (!client) notFound();

  const tierPrices = { STARTER: 79, GROWTH: 149, PRO: 299 };

  return (
    <div className="p-8 max-w-6xl">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-400 mb-6">
        <Link href="/" className="hover:text-gray-600">← All clients</Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
          <p className="text-gray-500 mt-0.5">{client.businessName}</p>
          <div className="flex items-center gap-2 mt-2">
            <StatusBadge status={client.status} />
            <span className="text-xs text-gray-400">{client.tier} · ${tierPrices[client.tier]}/mo</span>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {client.qboRealmId && <ReportButton clientId={client.id} />}
          {client.plaidItemId && (
            <SyncButton clientId={client.id} needsLogin={client.plaidNeedsLogin} />
          )}
          {client.slackChannelId && (
            <a
              href={`https://slack.com/app_redirect?channel=${client.slackChannelId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs bg-[#4a154b] text-white px-3 py-1.5 rounded-lg hover:opacity-90"
            >
              Open Slack
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: details + connections */}
        <div className="space-y-4">
          <InfoCard title="Contact">
            <KV label="Email" value={client.email} />
            <KV label="Joined" value={client.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
            <KV label="Onboarded" value={client.onboardedAt ? client.onboardedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"} />
          </InfoCard>

          <EditableClientFields
            clientId={client.id}
            initialStatus={client.status}
            initialTier={client.tier}
            stripeCustomerId={client.stripeCustomerId}
          />

          <InfoCard title="Integrations">
            <IntegrationRow
              label="QuickBooks Online"
              connected={!!client.qboRealmId}
              detail={client.qboRealmId ?? undefined}
            />
            <IntegrationRow
              label="Plaid"
              connected={!!client.plaidItemId}
              detail={client.plaidAccounts.map((a) => a.name).join(", ") || undefined}
            />
            <IntegrationRow
              label="Stripe"
              connected={!!client.stripeSubscriptionId}
              detail={client.stripeSubscriptionId ?? undefined}
            />
            <IntegrationRow
              label="DocuSign"
              connected={!!client.docusignSignedAt}
              detail={
                client.docusignSignedAt
                  ? `Signed ${client.docusignSignedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                  : client.docusignEnvelopeId
                  ? "Sent — awaiting signature"
                  : undefined
              }
            />
          </InfoCard>

          <InfoCard title="Activity">
            <KV label="Transactions" value={client._count.transactions} />
            <KV label="Reports" value={client.reports.length} />
            <KV label="Tax estimates" value={client.taxEstimates.length} />
          </InfoCard>

          <NotesEditor clientId={client.id} initialNotes={client.notes ?? null} />
        </div>

        {/* Middle column: flags + sync logs */}
        <div className="space-y-4">
          <FlaggedItems flags={client.flaggedItems.map((f) => ({
            id: f.id,
            type: f.type,
            description: f.description,
            createdAt: f.createdAt.toISOString(),
          }))} />

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Sync History</h3>
            <div className="space-y-2">
              {client.syncLogs.length === 0 ? (
                <p className="text-xs text-gray-400">No sync history</p>
              ) : (
                client.syncLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2">
                    <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                      log.status === "SUCCESS" ? "bg-green-500" :
                      log.status === "ERROR" ? "bg-red-500" : "bg-yellow-500"
                    }`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 capitalize">{log.type}</p>
                      {log.errorMsg && (
                        <p className="text-xs text-red-500 truncate">{log.errorMsg}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        {log.startedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent reports */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Reports</h3>
            <div className="space-y-2">
              {client.reports.length === 0 ? (
                <p className="text-xs text-gray-400">No reports yet</p>
              ) : (
                client.reports.map((r) => (
                  <div key={r.id} className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">{r.period}</span>
                    <span className={`text-xs ${r.emailedAt ? "text-green-600" : "text-yellow-600"}`}>
                      {r.emailedAt ? "Sent" : "Pending"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Tax estimates */}
          {client.taxEstimates.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Tax Estimates</h3>
              <div className="space-y-2">
                {client.taxEstimates.slice(0, 4).map((est) => (
                  <div key={est.id} className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">
                      {est.year} Q{est.quarter}
                    </span>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-gray-800">
                        ${Number(est.quarterlyAmt).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-xs text-gray-400 ml-1">/ qtr</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: rules + messages */}
        <div className="space-y-4">
          <RulesManager
            clientId={client.id}
            rules={client.categorizationRules.map((r) => ({
              id: r.id,
              name: r.name,
              pattern: r.pattern,
              qboCategory: r.qboCategory,
              isRegex: r.isRegex,
              priority: r.priority,
            }))}
          />

          <MessagePanel
            clientId={client.id}
            messages={client.messages.map((m) => ({
              id: m.id,
              sender: m.sender,
              content: m.content,
              createdAt: m.createdAt.toISOString(),
            }))}
          />
        </div>
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-700 truncate ml-2 max-w-[60%] text-right">
        {value}
      </span>
    </div>
  );
}

function IntegrationRow({
  label,
  connected,
  detail,
}: {
  label: string;
  connected: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-gray-300"}`} />
        <span className="text-xs text-gray-700">{label}</span>
      </div>
      <span className="text-xs text-gray-400 truncate ml-2 max-w-[40%] text-right">
        {connected ? (detail ? `…${detail.slice(-8)}` : "Connected") : "Not connected"}
      </span>
    </div>
  );
}

