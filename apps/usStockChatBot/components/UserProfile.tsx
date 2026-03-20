import { UserButton, useUser } from "@clerk/nextjs";

export default function UserProfile() {
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return <div>Loading...</div>;
  }

  return (
    <div className="flex items-center gap-4">
      <span>Welcome, {user?.firstName || 'User'}!</span>
      <UserButton afterSignOutUrl="/"/>
    </div>
  );
} 