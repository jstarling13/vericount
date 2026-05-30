// Pre-authentication landing page for QBO OAuth.
// Linked from the welcome email: /connect-qbo?clientId=xxx
// No Clerk auth required — client may not have a portal account yet.

import Link from "next/link";

interface Props {
  searchParams: Promise<{ clientId?: string; error?: string }>;
}

export default async function ConnectQBOPage({ searchParams }: Props) {
  const { clientId, error } = await searchParams;

  if (!clientId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <p className="text-red-600 text-sm">Invalid link — no client ID found.</p>
          <p className="text-gray-400 text-xs mt-2">
            Please use the link from your welcome email, or{" "}
            <a href="mailto:support@vericount.com" className="underline">
              contact support
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  const errorMessages: Record<string, string> = {
    qbo_denied: "You declined the QuickBooks authorization. Please try again.",
    qbo_missing_params: "Something went wrong with the redirect. Please try again.",
    qbo_token_failed: "Could not complete the QuickBooks connection. Please try again.",
    qbo_bad_state: "Invalid session. Please use the link from your welcome email.",
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-lg w-full">
        {/* Logo / header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#0f4c81] rounded-2xl mb-4">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Connect QuickBooks Online</h1>
          <p className="text-gray-500 text-sm mt-2">
            Vericount needs read/write access to your QBO company to keep your books.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          {/* Error alert */}
          {error && errorMessages[error] && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-sm text-red-700">{errorMessages[error]}</p>
            </div>
          )}

          {/* What access is requested */}
          <div className="mb-6 space-y-3">
            <p className="text-sm font-semibold text-gray-700">What Vericount can do with this access:</p>
            {[
              ["Read transactions", "Pull your bank transactions to categorize them"],
              ["Read reports", "Generate your monthly P&L and balance sheet"],
              ["Write transactions", "Post categorized expenses and deposits to your books"],
            ].map(([title, desc]) => (
              <div key={title} className="flex items-start gap-3">
                <svg className="w-5 h-5 text-green-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-gray-900">{title}</p>
                  <p className="text-xs text-gray-400">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Already have QBO — connect button */}
          <a
            href={`/api/qbo/connect?clientId=${clientId}`}
            className="block w-full bg-[#0f4c81] text-white text-center py-3 rounded-xl font-semibold text-sm hover:bg-[#0d3f6e] transition-colors"
          >
            Connect QuickBooks Online →
          </a>

          {/* No QBO yet */}
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center">
              Don&apos;t have a QuickBooks Online account yet?{" "}
              <a
                href="https://quickbooks.intuit.com/start/solo/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0f4c81] underline"
              >
                Start a free trial
              </a>
              , then come back to this page.
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          <Link href="/sign-in" className="underline">Sign in to your portal</Link>
          {" · "}
          Questions? Reply to your welcome email.
        </p>
      </div>
    </div>
  );
}
