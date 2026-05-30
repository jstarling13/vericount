"use client";

import { useState } from "react";
import { QBO_CATEGORIES } from "@vericount/shared";

interface Rule {
  id: string;
  name: string;
  pattern: string;
  qboCategory: string;
  isRegex: boolean;
  priority: number;
}

export function RulesManager({
  clientId,
  rules: initialRules,
}: {
  clientId: string;
  rules: Rule[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [reapplying, setReapplying] = useState(false);
  const [reapplyResult, setReapplyResult] = useState<{ updated: number; stillUncategorized: number } | null>(null);
  const [reapplyError, setReapplyError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", pattern: "", qboCategory: QBO_CATEGORIES[0] as string, isRegex: false, priority: 0,
  });

  async function addRule() {
    setSaving(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setAddError(body.error ?? "Failed to save rule. Please try again.");
        return;
      }
      const { rule } = await res.json() as { rule: Rule };
      setRules((prev) => [rule, ...prev]);
      setAdding(false);
      setForm({ name: "", pattern: "", qboCategory: QBO_CATEGORIES[0] as string, isRegex: false, priority: 0 });
    } catch {
      setAddError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(ruleId: string) {
    // Optimistic removal — restore on failure
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    try {
      const res = await fetch(`/api/clients/${clientId}/rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) {
        // Restore the removed rule by re-fetching the list
        const refreshed = await fetch(`/api/clients/${clientId}/rules`);
        if (refreshed.ok) {
          const { rules: fresh } = await refreshed.json() as { rules: Rule[] };
          setRules(fresh);
        }
      }
    } catch {
      // Network error — re-fetch to restore consistent state
      const refreshed = await fetch(`/api/clients/${clientId}/rules`).catch(() => null);
      if (refreshed?.ok) {
        const { rules: fresh } = await refreshed.json() as { rules: Rule[] };
        setRules(fresh);
      }
    }
  }

  async function reapplyRules() {
    setReapplying(true);
    setReapplyResult(null);
    setReapplyError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/rules/reapply`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setReapplyError(body.error ?? "Re-apply failed. Please try again.");
        return;
      }
      const data = await res.json() as { updated: number; stillUncategorized: number };
      setReapplyResult(data);
    } catch {
      setReapplyError("Network error — please try again.");
    } finally {
      setReapplying(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Categorization Rules</h3>
        <div className="flex items-center gap-3">
          {rules.length > 0 && (
            <button
              onClick={reapplyRules}
              disabled={reapplying}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
              title="Re-apply all rules to uncategorized transactions"
            >
              {reapplying ? "Applying…" : "Re-apply"}
            </button>
          )}
          <button
            onClick={() => { setAdding((v) => !v); setAddError(null); }}
            className="text-xs text-blue-600 hover:underline"
          >
            {adding ? "Cancel" : "+ Add rule"}
          </button>
        </div>
      </div>

      {reapplyResult && (
        <div className="mb-2 text-xs bg-green-50 text-green-700 rounded-lg px-3 py-2">
          ✓ Categorized {reapplyResult.updated} transaction{reapplyResult.updated !== 1 ? "s" : ""}.
          {reapplyResult.stillUncategorized > 0 && (
            <span className="text-gray-500"> ({reapplyResult.stillUncategorized} still need review)</span>
          )}
        </div>
      )}

      {reapplyError && (
        <div className="mb-2 text-xs bg-red-50 text-red-600 rounded-lg px-3 py-2">
          {reapplyError}
        </div>
      )}

      {adding && (
        <div className="mb-3 bg-gray-50 rounded-lg p-3 space-y-2">
          <input
            placeholder="Rule name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none"
          />
          <input
            placeholder="Pattern (keyword or regex)"
            value={form.pattern}
            onChange={(e) => setForm({ ...form, pattern: e.target.value })}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none"
          />
          <select
            value={form.qboCategory}
            onChange={(e) => setForm({ ...form, qboCategory: e.target.value })}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none"
          >
            {QBO_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={form.isRegex}
                onChange={(e) => setForm({ ...form, isRegex: e.target.checked })}
              />
              Regex
            </label>
            <input
              type="number"
              placeholder="Priority"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
              className="w-20 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none"
            />
          </div>
          {addError && (
            <p className="text-xs text-red-600">{addError}</p>
          )}
          <button
            onClick={addRule}
            disabled={saving || !form.name || !form.pattern}
            className="w-full text-xs bg-[#0f4c81] text-white py-2 rounded-lg hover:bg-[#0d3f6e] disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving…" : "Save rule"}
          </button>
        </div>
      )}

      <div className="space-y-1.5 max-h-52 overflow-y-auto">
        {rules.length === 0 ? (
          <p className="text-xs text-gray-400">No rules yet. Add rules to auto-categorize this client's transactions.</p>
        ) : (
          rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-700">{rule.name}</p>
                <p className="text-xs text-gray-400">
                  <span className={`font-mono ${rule.isRegex ? "text-purple-600" : ""}`}>
                    {rule.pattern}
                  </span>
                  {" → "}
                  <span className="text-blue-600">{rule.qboCategory}</span>
                </p>
              </div>
              <button
                onClick={() => deleteRule(rule.id)}
                className="text-xs text-gray-300 hover:text-red-500 shrink-0 transition-colors"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
