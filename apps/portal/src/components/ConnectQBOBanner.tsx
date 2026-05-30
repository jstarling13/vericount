"use client";

export function ConnectQBOBanner({ clientId }: { clientId: string }) {
  return (
    <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-4">
      <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-800">Connect your QuickBooks Online account</p>
        <p className="text-xs text-amber-700 mt-0.5">
          Your bookkeeper needs access to QuickBooks to keep your books up to date and generate reports.
        </p>
        <a
          href={`/api/qbo/connect?clientId=${clientId}`}
          className="inline-block mt-3 bg-amber-600 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors"
        >
          Connect QuickBooks Online →
        </a>
      </div>
    </div>
  );
}
