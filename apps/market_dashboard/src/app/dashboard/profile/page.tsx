import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ProfileEditForm from "@/components/profile/ProfileEditForm";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <ProfileEditForm />;
}
