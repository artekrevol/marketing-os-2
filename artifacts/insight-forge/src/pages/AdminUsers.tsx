import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, ShieldOff, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";

type AppUser = {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  is_tekrevol: boolean;
  project_count: number;
};

export default function AdminUsers() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("list_app_users");
    if (error) {
      // Not an admin, or RPC failure
      setAuthorized(false);
    } else {
      setUsers((data as AppUser[]) || []);
      setAuthorized(true);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleAdmin = async (u: AppUser) => {
    setBusyId(u.user_id);
    try {
      if (u.is_admin) {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", u.user_id)
          .eq("role", "admin");
        if (error) throw error;
        toast.success(`Removed admin from ${u.email}`);
      } else {
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: u.user_id, role: "admin" });
        if (error) throw error;
        toast.success(`Granted admin to ${u.email}`);
      }
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed");
    } finally {
      setBusyId(null);
    }
  };

  if (authorized === false) return <Navigate to="/" replace />;

  return (
    <div className="max-w-5xl mx-auto px-10 py-10">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">Admin</p>
        <h1 className="font-serif text-3xl mt-1 flex items-center gap-2">
          <Users className="h-6 w-6 text-accent" /> Users & access
        </h1>
        <p className="text-sm text-ink-muted mt-2 max-w-2xl">
          Everyone who has signed in. Tekrevol Google accounts get access automatically. Admin role is required for non-tekrevol accounts and grants access to this page.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-ink-muted text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="notebook-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-[10px] uppercase tracking-widest text-ink-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Projects</th>
                <th className="text-left px-4 py-3 font-medium">Joined</th>
                <th className="text-left px-4 py-3 font-medium">Last sign-in</th>
                <th className="text-left px-4 py-3 font-medium">Admin</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-t border-rule">
                  <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3 text-ink-muted text-xs">
                    {u.is_tekrevol ? "Tekrevol" : "External"}
                  </td>
                  <td className="px-4 py-3">{u.project_count}</td>
                  <td className="px-4 py-3 text-ink-muted text-xs">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-ink-muted text-xs">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleAdmin(u)}
                      disabled={busyId === u.user_id}
                      className={`text-xs px-2.5 py-1.5 border border-rule rounded-sm inline-flex items-center gap-1.5 hover:bg-secondary disabled:opacity-50 ${u.is_admin ? "text-accent" : ""}`}
                    >
                      {busyId === u.user_id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : u.is_admin ? (
                        <><Shield className="h-3 w-3" /> Revoke</>
                      ) : (
                        <><ShieldOff className="h-3 w-3" /> Grant</>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-muted text-sm">No users yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}