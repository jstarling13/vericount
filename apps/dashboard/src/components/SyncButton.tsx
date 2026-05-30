"use client";

import { useState } from "react";

export function SyncButton({
  clientId,
  needsLogin = false,
}: {
  clientId: string;
  needsLogin?: boolean;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  if (needsLogin) {
    return (
      <span
        title="Client must reconnect their bank account before syncing"
        className="text-xs px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 font-medium cursor-not-allowed"
      >
        ⚠ Login Required
      </span>
    );
  }

  async function trigger() {
    setState("loading");
    try {
      const res = await fetch(`/api/clients/${clientId}/sync`, { method: "POST" });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 4000);
  }

  const label =
    state === "loading" ? "Syncing…" :
    state === "done"    ? "Queued ✓" :
    state === "error"   ? "Failed" :
    "Trigger Sync";

  return (
    <button
      onClick={trigger}
      disabled={state === "loading"}
      className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${
        state === "done"
          ? "bg-green-100 text-green-700"
          : state === "error"
          ? "bg-red-100 text-red-700"
          : "bg-[#0f4c81] text-white hover:bg-[#0d3f6e] disabled:opacity-60"
      }`}
    >
      {label}
    </button>
  );
}
