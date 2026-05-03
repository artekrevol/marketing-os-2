import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, ShieldOff, Loader2, Users, Save, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { recordAudit } from "@/lib/audit";
import type { Brand } from "@/lib/brands";

type RoleEnum = "admin" | "editor" | "writer" | "strategist" | "analyst";
type PodEnum = "content" | "technical" | "growth" | "";

type AppUser = {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  is_tekrevol: boolean;
  project_count: number;
  role: RoleEnum;
  pod: PodEnum | null;
  brand_access: string[];
};

const ROLES: RoleEnum[] = ["admin", "editor", "writer", "strategist", "analyst"];
const PODS: PodEnum[] = ["", "content", "technical", "growth"];

export default function AdminUsers() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ role: RoleEnum; pod: PodEnum; brand_access: string[] } | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: u, error }, { data: bs }] = await Promise.all([
      supabase.rpc("list_app_users_v2"),
      supabase.from("brands").select("*").order("name"),
    ]);
    if (error) {
      // Fall back to legacy v1 if v2 isn't applied yet (e.g. preview not migrated).
      const { data: legacy, error: e2 } = await supabase.rpc("list_app_users");
      if (e2) {
        setAuthorized(false);
      } else {
        setUsers(
          (legacy || []).map((r: any) => ({
            ...r,
            role: r.is_admin ? "admin" : "writer",
            pod: null,
            brand_access: [],
          })),
        );
        setBrands((bs as Brand[]) || []);
        setAuthorized(true);
      }
    } else {
      setUsers((u as AppUser[]) || []);
      setBrands((bs as Brand[]) || []);
      setAuthorized(true);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const startEdit = (u: AppUser) => {
    setEditingId(u.user_id);
    setDraft({
      role: u.role,
      pod: (u.pod || "") as PodEnum,
      brand_access: [...(u.brand_access || [])],
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (u: AppUser) => {
    if (!draft) return;
    const justification = window.prompt(`Why are you changing access for ${u.email}?`)?.trim();
    if (!justification) {
      toast.error("Justification is required.");
      return;
    }
    setBusyId(u.user_id);
    try {
      const { error } = await supabase
        .from("user_profiles")
        .upsert(
          {
            user_id: u.user_id,
            role: draft.role,
            pod: draft.pod || null,
            brand_access: draft.brand_access,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      if (error) throw error;

      // Mirror admin role into legacy user_roles so existing checks
      // (AppShell, list_app_users) keep working.
      if (draft.role === "admin" && !u.is_admin) {
        await supabase.from("user_roles").insert({ user_id: u.user_id, role: "admin" });
      } else if (draft.role !== "admin" && u.is_admin) {
        await supabase.from("user_roles").delete().eq("user_id", u.user_id).eq("role", "admin");
      }

      const audit = await recordAudit(
        "user.access_change",
        "user",
        u.user_id,
        justification,
        {
          email: u.email,
          before: { role: u.role, pod: u.pod, brand_access: u.brand_access },
          after: { role: draft.role, pod: draft.pod || null, brand_access: draft.brand_access },
        },
      );
      if (!audit.ok) toast.error("Audit log failed: " + audit.error);
      toast.success(`Updated ${u.email}`);
      cancelEdit();
      await load();
    } catch (err: any) {
      toast.error(err.message || "Save failed");
    } finally {
      setBusyId(null);
    }
  };

  const toggleBrand = (id: string) => {
    if (!draft) return;
    const has = draft.brand_access.includes(id);
    setDraft({
      ...draft,
      brand_access: has ? draft.brand_access.filter((x) => x !== id) : [...draft.brand_access, id],
    });
  };

  if (authorized === false) return <Navigate to="/" replace />;

  return (
    <div className="max-w-6xl mx-auto px-10 py-10">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">Admin</p>
        <h1 className="font-serif text-3xl mt-1 flex items-center gap-2">
          <Users className="h-6 w-6 text-accent" /> Users & access
        </h1>
        <p className="text-sm text-ink-muted mt-2 max-w-2xl">
          Assign role, pod, and brand access. Every change is written to the audit log with a
          required justification.
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
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Pod</th>
                <th className="text-left px-4 py-3 font-medium">Brand access</th>
                <th className="text-left px-4 py-3 font-medium">Projects</th>
                <th className="text-left px-4 py-3 font-medium">Last sign-in</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isEditing = editingId === u.user_id;
                const userBrands = (u.brand_access || [])
                  .map((id) => brands.find((b) => b.id === id)?.name || id.slice(0, 8))
                  .join(", ");
                return (
                  <tr key={u.user_id} className="border-t border-rule align-top">
                    <td className="px-4 py-3 font-mono text-xs">
                      {u.email}
                      {u.is_tekrevol && (
                        <span className="ml-2 text-[9px] uppercase tracking-widest text-ink-muted">tek</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing && draft ? (
                        <select
                          value={draft.role}
                          onChange={(e) => setDraft({ ...draft, role: e.target.value as RoleEnum })}
                          className="text-xs px-2 py-1 border border-rule rounded-sm bg-background"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`text-xs ${u.role === "admin" ? "text-accent font-medium" : ""}`}>
                          {u.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing && draft ? (
                        <select
                          value={draft.pod}
                          onChange={(e) => setDraft({ ...draft, pod: e.target.value as PodEnum })}
                          className="text-xs px-2 py-1 border border-rule rounded-sm bg-background"
                        >
                          {PODS.map((p) => (
                            <option key={p || "none"} value={p}>{p || "—"}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-ink-muted">{u.pod || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing && draft ? (
                        <div className="flex flex-wrap gap-1">
                          {brands.map((b) => {
                            const on = draft.brand_access.includes(b.id);
                            return (
                              <button
                                key={b.id}
                                onClick={() => toggleBrand(b.id)}
                                className={`text-[10px] px-2 py-0.5 rounded-sm border ${
                                  on
                                    ? "bg-ink text-paper border-ink"
                                    : "border-rule hover:border-ink"
                                }`}
                              >
                                {b.name}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-muted">{userBrands || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{u.project_count}</td>
                    <td className="px-4 py-3 text-ink-muted text-xs">
                      {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="inline-flex gap-1">
                          <button
                            onClick={cancelEdit}
                            className="text-xs px-2.5 py-1.5 border border-rule rounded-sm hover:bg-secondary"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveEdit(u)}
                            disabled={busyId === u.user_id}
                            className="text-xs px-2.5 py-1.5 bg-ink text-paper rounded-sm hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            {busyId === u.user_id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Save className="h-3 w-3" />
                            )}
                            Save
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(u)}
                          className="text-xs px-2.5 py-1.5 border border-rule rounded-sm inline-flex items-center gap-1.5 hover:bg-secondary"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-muted text-sm">No users yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
