import { currentUser } from "@clerk/nextjs";
import Link from "next/link";

export default async function Home() {
  const user = await currentUser();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <h1 className="text-4xl font-bold mb-8">Stock Analysis Chatbot</h1>
      {user ? (
        <Link
          href="/dashboard"
          className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600"
        >
          Go to Dashboard
        </Link>
      ) : (
        <div className="space-x-4">
          <Link
            href="/sign-in"
            className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600"
          >
            Sign Up
          </Link>
        </div>
      )}
    </div>
  );
} 