import { auth } from "@clerk/nextjs";
import ChatInterface from "@/components/ChatInterface";

export default async function DashboardPage() {
  const { userId } = auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <main className="container mx-auto py-6">
        <ChatInterface />
      </main>
    </div>
  );
} 