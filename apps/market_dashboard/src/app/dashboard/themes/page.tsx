import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ThemeRadar from "@/components/market-desk/ThemeRadar";

export default async function ThemesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return <ThemeRadar />;
}
