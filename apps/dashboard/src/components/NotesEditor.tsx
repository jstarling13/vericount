"use client";

import { useState, useRef } from "react";

export function NotesEditor({
  clientId,
  initialNotes,
}: {
  clientId: string;
  initialNotes: string | null;
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Track the last successfully saved value — using the prop directly would mean
  // every blur after the first save triggers another PATCH (stale prop comparison).
  const savedRef = useRef(initialNotes ?? "");

  async function save() {
    if (notes === savedRef.current) return; // nothing changed since last save
    setState("saving");
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) {
        savedRef.current = notes; // advance the saved baseline
        setState("saved");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 3000);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Notes</h3>
        {state !== "idle" && (
          <span className={`text-xs ${
            state === "saving" ? "text-gray-400" :
            state === "saved"  ? "text-green-600" :
            "text-red-500"
          }`}>
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Error"}
          </span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={save}
        rows={4}
        placeholder="Internal notes about this client…"
        className="w-full text-xs text-gray-700 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#0f4c81]/30"
      />
    </div>
  );
}
