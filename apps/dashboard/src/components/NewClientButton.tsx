"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TIERS = [
  { value: "STARTER", label: "Starter — $79/mo" },
  { value: "GROWTH",  label: "Growth — $149/mo" },
  { value: "PRO",     label: "Pro — $299/mo" },
] as const;

type Tier = typeof TIERS[number]["value"];

interface FormState {
  name: string;
  email: string;
  businessName: string;
  tier: Tier;
}

export function NewClientButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    businessName: "",
    tier: "STARTER",
  });

  function reset() {
    setForm({ name: "", email: "", businessName: "", tier: "STARTER" });
    setError("");
    setWarnings([]);
    setSubmitting(false);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setWarnings([]);

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json() as {
        client?: { id: string; name: string };
        error?: string;
        warnings?: string[];
      };

      if (!res.ok) {
        setError(data.error ?? "Failed to create client");
        setSubmitting(false);
        return;
      }

      if (data.warnings?.length) {
        setWarnings(data.warnings);
        // Keep modal open briefly to show warnings, then navigate
        setTimeout(() => {
          close();
          router.push(`/clients/${data.client!.id}`);
          router.refresh();
        }, 3000);
      } else {
        close();
        router.push(`/clients/${data.client!.id}`);
        router.refresh();
      }
    } catch {
      setError("Network error — please try again");
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs bg-[#0f4c81] text-white px-3 py-1.5 rounded-lg font-medium hover:bg-[#0d3f6e] transition-colors"
      >
        + New client
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={close}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 z-10">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-gray-900">New Client</h2>
              <button
                onClick={close}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Full name</label>
                <input
                  required
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Jane Smith"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#0f4c81]/30 focus:border-[#0f4c81]"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="jane@example.com"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#0f4c81]/30 focus:border-[#0f4c81]"
                />
              </div>

              {/* Business name */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Business name</label>
                <input
                  required
                  type="text"
                  value={form.businessName}
                  onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
                  placeholder="Smith Consulting LLC"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#0f4c81]/30 focus:border-[#0f4c81]"
                />
              </div>

              {/* Tier */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Plan</label>
                <select
                  value={form.tier}
                  onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value as Tier }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#0f4c81]/30 focus:border-[#0f4c81] bg-white"
                >
                  {TIERS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Error */}
              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              {/* Warnings (partial success) */}
              {warnings.length > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 space-y-1">
                  <p className="font-semibold">Client created — some integrations need attention:</p>
                  {warnings.map((w, i) => (
                    <p key={i}>• {w}</p>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-[#0f4c81] text-white text-sm font-medium py-2 rounded-lg hover:bg-[#0d3f6e] transition-colors disabled:opacity-50"
                >
                  {submitting ? "Creating…" : "Create client"}
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
                >
                  Cancel
                </button>
              </div>

              <p className="text-[11px] text-gray-400 leading-relaxed">
                This will create a Stripe subscription, send a DocuSign engagement letter, create a Slack channel, and send a welcome email.
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
