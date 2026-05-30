"use client";

import { useState } from "react";

export function ReportButton({ clientId }: { clientId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function trigger() {
    setState("loading");
    try {
      const res = await fetch(`/api/clients/${clientId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // previous month by default
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 5000);
  }

  const label =
    state === "loading" ? "Generating…" :
    state === "done"    ? "Queued" :
    state === "error"   ? "Failed" :
    "Generate Report";

  return (
    <button
      onClick={trigger}
      disabled={state === "loading"}
      className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${
        state === "done"
          ? "bg-green-100 text-green-700"
          : state === "error"
          ? "bg-red-100 text-red-700"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60"
      }`}
    >
      {label}
    </button>
  );
}
