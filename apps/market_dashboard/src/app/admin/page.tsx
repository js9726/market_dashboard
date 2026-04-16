"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

interface AppUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  createdAt: string;
}

const ROLE_COLORS: Record<string, string> = {
  owner:   "bg-purple-500/20 text-purple-300 border-purple-500/30",
  allowed: "bg-green-500/20 text-green-300 border-green-500/30",
  pending: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  denied:  "bg-red-500/20 text-red-300 border-red-500/30",
};

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  // Guard: only owner can view
  useEffect(() => {
    if (status === "loading") return;
    if (session?.user?.role !== "owner") router.replace("/dashboard");
  }, [session, status, router]);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then(setUsers)
      .finally(() => setLoading(false));
  }, []);

  async function setRole(userId: string, role: string) {
    setUpdating(userId);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    if (res.ok) {
      const updated = await res.json();
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? { ...u, role: updated.role } : u))
      );
    }
    setUpdating(null);
  }

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        Loading…
      </div>
    );
  }

  if (session?.user?.role !== "owner") return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">User Management</h1>
            <p className="text-slate-400 text-sm mt-1">
              Approve or deny access to the dashboard
            </p>
          </div>
          <button
            onClick={() => router.push("/dashboard")}
            className="text-slate-400 hover:text-white text-sm transition-colors"
          >
            ← Back to Dashboard
          </button>
        </div>

        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 border-b border-slate-800">
              <tr>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">User</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Role</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Joined</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {users.map((user) => (
                <tr key={user.id} className="bg-slate-900/30 hover:bg-slate-900/60 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {user.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={user.image}
                          alt={user.name ?? ""}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs text-slate-300">
                          {(user.name ?? user.email)[0].toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-white">{user.name ?? "—"}</div>
                        <div className="text-slate-400 text-xs">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${
                        ROLE_COLORS[user.role] ?? "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {user.id === session.user.id ? (
                      <span className="text-slate-600 text-xs">You</span>
                    ) : (
                      <div className="flex gap-2">
                        {user.role !== "allowed" && (
                          <button
                            onClick={() => setRole(user.id, "allowed")}
                            disabled={updating === user.id}
                            className="px-3 py-1 rounded-md text-xs font-medium bg-green-600 hover:bg-green-500 disabled:opacity-40 transition-colors"
                          >
                            Allow
                          </button>
                        )}
                        {user.role !== "denied" && (
                          <button
                            onClick={() => setRole(user.id, "denied")}
                            disabled={updating === user.id}
                            className="px-3 py-1 rounded-md text-xs font-medium bg-red-700 hover:bg-red-600 disabled:opacity-40 transition-colors"
                          >
                            Deny
                          </button>
                        )}
                        {user.role === "denied" && (
                          <button
                            onClick={() => setRole(user.id, "pending")}
                            disabled={updating === user.id}
                            className="px-3 py-1 rounded-md text-xs font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-40 transition-colors"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-slate-600 text-xs mt-4">
          Note: role changes take effect on the user&apos;s next sign-in (sessions last 24 hours).
        </p>
      </div>
    </div>
  );
}
