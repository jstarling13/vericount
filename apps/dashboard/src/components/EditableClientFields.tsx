"use client";

import { useState } from "react";

const STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "CHURNED"] as const;
const TIERS    = ["STARTER", "GROWTH", "PRO"] as const;

type Status = typeof STATUSES[number];
type Tier   = typeof TIERS[number];

const STATUS_COLORS: Record<Status, string> = {
  PENDING:   "bg-yellow-100 text-yellow-700",
  ACTIVE:    "bg-green-100 text-green-700",
  SUSPENDED: "bg-orange-100 text-orange-700",
  CHURNED:   "bg-red-100 text-red-700",
};

const TIER_COLORS: Record<Tier, string> = {
  STARTER: "bg-gray-100 text-gray-600",
  GROWTH:  "bg-blue-100 text-blue-700",
  PRO:     "bg-purple-100 text-purple-700",
};

const TIER_PRICES: Record<Tier, number> = { STARTER: 79, GROWTH: 149, PRO: 299 };

export function EditableClientFields({
  clientId,
  initialStatus,
  initialTier,
  stripeCustomerId,
}: {
  clientId: string;
  initialStatus: Status;
  initialTier: Tier;
  stripeCustomerId?: string | null;
}) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [tier, setTier]     = useState<Tier>(initialTier);
  const [saving, setSaving] = useState<"status" | "tier" | null>(null);
  const [error, setError]   = useState("");

  async function patch(field: "status" | "tier", value: string) {
    setSaving(field);
    setError("");
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch {
      setError(`Failed to update ${field}`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">Account</h3>

      {/* Status */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Status</span>
        <div className="flex items-center gap-2">
          {saving === "status" && <span className="text-xs text-gray-400">Saving…</span>}
          <select
            value={status}
            disabled={saving !== null}
            onChange={async (e) => {
              const v = e.target.value as Status;
              setStatus(v);
              await patch("status", v);
            }}
            className={`text-xs font-semibold px-2 py-0.5 rounded-full border-0 cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-[#0f4c81]/30 ${STATUS_COLORS[status]}`}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tier */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Tier</span>
        <div className="flex items-center gap-2">
          {saving === "tier" && <span className="text-xs text-gray-400">Saving…</span>}
          <select
            value={tier}
            disabled={saving !== null}
            onChange={async (e) => {
              const v = e.target.value as Tier;
              setTier(v);
              await patch("tier", v);
            }}
            className={`text-xs font-semibold px-2 py-0.5 rounded-full border-0 cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-[#0f4c81]/30 ${TIER_COLORS[tier]}`}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()} — ${TIER_PRICES[t]}/mo</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stripe link */}
      {stripeCustomerId && (
        <div className="flex items-center justify-between pt-1 border-t border-gray-100">
          <span className="text-xs text-gray-400">Stripe</span>
          <a
            href={`https://dashboard.stripe.com/customers/${stripeCustomerId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            View customer →
          </a>
        </div>
      )}

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
