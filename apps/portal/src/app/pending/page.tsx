import { UserButton } from "@clerk/nextjs";

export default function PendingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 max-w-md text-center">
        <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-[#0f4c81]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Account Setup in Progress</h1>
        <p className="text-gray-500 text-sm leading-relaxed">
          Your client account hasn&apos;t been set up yet. This usually means your onboarding
          form is still being processed. Please check your email for next steps, or reply
          to your welcome email if you need help.
        </p>
        <div className="mt-6">
          <UserButton />
        </div>
      </div>
    </div>
  );
}
