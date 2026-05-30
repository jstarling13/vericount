import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#0f4c81]">Vericount</h1>
          <p className="text-gray-500 mt-1 text-sm">Client Portal</p>
        </div>
        <SignIn />
      </div>
    </div>
  );
}
