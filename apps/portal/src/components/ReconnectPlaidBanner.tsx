"use client";

import { useState, useCallback, useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";

export function ReconnectPlaidBanner({ clientId }: { clientId: string }) {
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
        setTimeout(() => window.location.reload(), 1500);
      } catch {
        setErrorMsg("Network error — please try again.");
        setStatus("error");
      }
    },
    onExit: () => {
      setLinkToken(null);
    },
  });

  const handleReconnect = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setStatus("idle");
    try {
      const res = await fetch(`/api/plaid/update-link-token?clientId=${clientId}`);
      if (!res.ok) {
        setErrorMsg("Could not initialize reconnect. Please try again.");
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

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  if (status === "success") {
    return (
      <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-green-800">Bank account reconnected successfully.</p>
        <p className="text-xs text-green-700 mt-0.5">Transactions will resume syncing tonight.</p>
      </div>
    );
  }

  return (
    <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-4">
      <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-800">Bank connection needs to be renewed</p>
        <p className="text-xs text-amber-700 mt-0.5">
          Your bank requires you to sign in again to continue syncing transactions.
        </p>
        {errorMsg && (
          <p className="text-xs text-red-600 mt-2 font-medium">{errorMsg}</p>
        )}
        <button
          onClick={handleReconnect}
          disabled={loading || status === "exchanging"}
          className="inline-block mt-3 bg-amber-600 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : status === "exchanging" ? "Saving…" : "Reconnect Bank Account →"}
        </button>
      </div>
    </div>
  );
}
