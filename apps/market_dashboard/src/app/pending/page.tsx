import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";

export default async function PendingPage() {
  const session = await auth();

  // If already approved, send to dashboard
  if (session?.user?.role === "allowed" || session?.user?.role === "owner") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md shadow-xl text-center">
        <div className="text-4xl mb-4">⏳</div>
        <h1 className="text-2xl font-bold text-white mb-2">Access Pending</h1>
        <p className="text-gray-400 text-sm mb-2">
          You&apos;re signed in as{" "}
          <span className="text-white font-medium">{session?.user?.email}</span>
        </p>
        <p className="text-gray-400 text-sm mb-6">
          Your account is waiting for approval. The dashboard owner will grant
          you access shortly.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="text-sm text-gray-500 hover:text-gray-300 underline transition-colors"
          >
            Sign out and use a different account
          </button>
        </form>
      </div>
    </div>
  );
}
