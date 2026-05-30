"use client";

import { useState } from "react";

interface Flag {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

export function FlaggedItems({ flags: initialFlags }: { flags: Flag[] }) {
  const [flags, setFlags] = useState(initialFlags);
  const [resolvingAll, setResolvingAll] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  async function resolve(flagId: string) {
    // Optimistic removal — restore on failure
    const removed = flags.find((f) => f.id === flagId);
    setFlags((prev) => prev.filter((f) => f.id !== flagId));
    setResolveError(null);
    try {
      const res = await fetch(`/api/flags/${flagId}/resolve`, { method: "POST" });
      if (!res.ok && removed) {
        // Restore the flag so bookkeeper knows it wasn't resolved
        setFlags((prev) => [...prev, removed].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ));
        setResolveError("Failed to resolve flag. Please try again.");
      }
    } catch {
      if (removed) {
        setFlags((prev) => [...prev, removed].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ));
      }
      setResolveError("Network error — please try again.");
    }
  }

  async function resolveAll() {
    setResolvingAll(true);
    setResolveError(null);
    const snapshot = [...flags];
    try {
      const results = await Promise.allSettled(
        snapshot.map((f) => fetch(`/api/flags/${f.id}/resolve`, { method: "POST" }))
      );
      const failed = snapshot.filter((_, i) => {
        const r = results[i];
        return r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok);
      });
      if (failed.length === 0) {
        setFlags([]);
      } else {
        // Keep only the ones that failed to resolve
        setFlags(failed);
        setResolveError(
          `${failed.length} flag${failed.length !== 1 ? "s" : ""} could not be resolved. Please try again.`
        );
      }
    } catch {
      setResolveError("Network error — please try again.");
    } finally {
      setResolvingAll(false);
    }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  if (flags.length === 0 && !resolveError) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Flagged Items</h3>
        <p className="text-xs text-gray-400">No open flags.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-red-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-red-700">
          Flagged Items {flags.length > 0 && `(${flags.length})`}
        </h3>
        {flags.length > 1 && (
          <button
            onClick={resolveAll}
            disabled={resolvingAll}
            className="text-xs text-gray-400 hover:text-green-600 disabled:opacity-50 transition-colors"
          >
            {resolvingAll ? "Resolving…" : "Resolve all"}
          </button>
        )}
      </div>

      {resolveError && (
        <p className="text-xs text-red-600 mb-2">{resolveError}</p>
      )}

      <div className="space-y-2">
        {flags.map((flag) => (
          <div
            key={flag.id}
            className="flex items-start justify-between gap-2 bg-red-50 rounded-lg px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-red-700 capitalize">
                  {flag.type.replace(/_/g, " ")}
                </p>
                <span className="text-[10px] text-red-400">{fmtDate(flag.createdAt)}</span>
              </div>
              <p className="text-xs text-red-600 mt-0.5 leading-relaxed">{flag.description}</p>
            </div>
            <button
              onClick={() => resolve(flag.id)}
              className="text-xs text-gray-400 hover:text-green-600 shrink-0 mt-0.5 transition-colors"
              title="Mark resolved"
            >
              ✓
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
