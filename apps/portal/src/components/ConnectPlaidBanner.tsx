"use client";

import { useState, useCallback, useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";

export function ConnectPlaidBanner({ clientId }: { clientId: string }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "exchanging" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess: async (publicToken) => {
      setStatus("exchanging");
      try {
        const res = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicToken, clientId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          setErrorMsg(body.error ?? "Failed to save bank connection. Please try again.");
          setStatus("error");
          return;
        }
        setStatus("success");
        // Reload after a brief moment so the dashboard reflects the new connection
        setTimeout(() => window.location.reload(), 1500);
      } catch {
        setErrorMsg("Network error — please try again.");
        setStatus("error");
      }
    },
    onExit: () => {
      // Reset link token so user can retry without a stale token
      setLinkToken(null);
    },
  });

  const handleConnect = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setStatus("idle");
    try {
      const res = await fetch(`/api/plaid/create-link-token?clientId=${clientId}`);
      if (!res.ok) {
        setErrorMsg("Could not initialize bank connection. Please try again.");
        return;
      }
      const { linkToken: token } = await res.json() as { linkToken: string };
      setLinkToken(token);
    } catch {
      setErrorMsg("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  // Auto-open Plaid Link once we have a token (must be in useEffect, not render path)
  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  if (status === "success") {
    return (
      <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-green-800">Bank account connected successfully.</p>
        <p className="text-xs text-green-700 mt-0.5">Transactions will sync tonight.</p>
      </div>
    );
  }

  return (
    <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-start gap-4">
      <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-blue-800">Connect your bank account</p>
        <p className="text-xs text-blue-700 mt-0.5">
          Link your business bank account so transactions sync automatically every night.
        </p>
        {errorMsg && (
          <p className="text-xs text-red-600 mt-2 font-medium">{errorMsg}</p>
        )}
        <button
          onClick={handleConnect}
          disabled={loading || status === "exchanging"}
          className="inline-block mt-3 bg-blue-600 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : status === "exchanging" ? "Saving…" : "Connect Bank Account →"}
        </button>
      </div>
    </div>
  );
}
