import { useEffect, useState } from "react";
import { Loader2, Users, Save, Pencil, UserPlus, X } from "lucide-react";
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
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState<{
    email: string;
    password: string;
    display_name: string;
    role: RoleEnum;
    pod: PodEnum;
    brand_access: string[];
  }>({ email: "", password: "", display_name: "", role: "writer", pod: "", brand_access: [] });

  const openCreate = () => {
    setNewUser({ email: "", password: "", display_name: "", role: "writer", pod: "", brand_access: [] });
    setCreateOpen(true);
  };
  const closeCreate = () => {
    if (creating) return;
    setCreateOpen(false);
  };
  const toggleNewBrand = (id: string) => {
    setNewUser((u) => ({
      ...u,
      brand_access: u.brand_access.includes(id)
        ? u.brand_access.filter((x) => x !== id)
        : [...u.brand_access, id],
    }));
  };
  const createUser = async () => {
    const email = newUser.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email.");
      return;
    }
    if (newUser.password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setCreating(true);
    try {
      // Audit-first, same pattern as access-change edits.
      const audit = await recordAudit("user.create", "user", email, `Created account for ${email}`, {
        email,
        role: newUser.role,
        pod: newUser.pod || null,
        brand_access: newUser.brand_access,
      });
      if (!audit.ok) {
        toast.error("Audit log failed; create aborted: " + audit.error);
        setCreating(false);
        return;
      }
      const resp = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password: newUser.password,
          display_name: newUser.display_name.trim() || null,
          role: newUser.role,
          pod: newUser.pod || null,
          brand_access: newUser.brand_access,
        }),
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${resp.status}`);
      }
      toast.success(`Created ${email}`);
      setCreateOpen(false);
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Create failed";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const load = async () => {
    setLoading(true);
    const [usersResp, brandsResp] = await Promise.all([
      fetch("/api/admin/users", { credentials: "include" }),
      fetch("/api/brands", { credentials: "include" }),
    ]);
    if (usersResp.status === 403) {
      setAuthorized(false);
      setLoading(false);
      return;
    }
    setUsers(usersResp.ok ? await usersResp.json() : []);
    setBrands(brandsResp.ok ? await brandsResp.json() : []);
    setAuthorized(usersResp.ok);
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
      // Audit-first: abort the access change if the audit row cannot be written.
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
      if (!audit.ok) {
        toast.error("Audit log failed; change aborted: " + audit.error);
        setBusyId(null);
        return;
      }

      const resp = await fetch(`/api/admin/users/${u.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role: draft.role, pod: draft.pod || null, brand_access: draft.brand_access }),
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${resp.status}`);
      }

      toast.success(`Updated ${u.email}`);
      cancelEdit();
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
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
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">Admin</p>
          <h1 className="font-serif text-3xl mt-1 flex items-center gap-2">
            <Users className="h-6 w-6 text-accent" /> Users & access
          </h1>
          <p className="text-sm text-ink-muted mt-2 max-w-2xl">
            Assign role, pod, and brand access. Every change is written to the audit log with a
            required justification.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="shrink-0 text-xs px-3 py-2 bg-ink text-paper rounded-sm hover:bg-accent inline-flex items-center gap-1.5"
        >
          <UserPlus className="h-3.5 w-3.5" /> Add user
        </button>
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

      {createOpen && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4"
          onClick={closeCreate}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-background border border-rule rounded-sm shadow-xl w-full max-w-lg"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-rule">
              <p className="text-sm font-medium flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-accent" /> Add user
              </p>
              <button
                onClick={closeCreate}
                disabled={creating}
                className="p-1 hover:bg-secondary rounded-sm disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-ink-muted">Email</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="person@example.com"
                  autoComplete="off"
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-rule rounded-sm bg-background"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-ink-muted">
                  Temporary password
                </label>
                <input
                  type="text"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="At least 8 characters — share securely"
                  autoComplete="new-password"
                  className="mt-1 w-full px-2 py-1.5 text-sm font-mono border border-rule rounded-sm bg-background"
                />
                <p className="mt-1 text-[10px] text-ink-muted">
                  Ask the user to change it on first sign-in.
                </p>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-ink-muted">
                  Display name (optional)
                </label>
                <input
                  type="text"
                  value={newUser.display_name}
                  onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
                  className="mt-1 w-full px-2 py-1.5 text-sm border border-rule rounded-sm bg-background"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-ink-muted">Role</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as RoleEnum })}
                    className="mt-1 w-full px-2 py-1.5 text-sm border border-rule rounded-sm bg-background"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-ink-muted">Pod</label>
                  <select
                    value={newUser.pod}
                    onChange={(e) => setNewUser({ ...newUser, pod: e.target.value as PodEnum })}
                    className="mt-1 w-full px-2 py-1.5 text-sm border border-rule rounded-sm bg-background"
                  >
                    {PODS.map((p) => (
                      <option key={p || "none"} value={p}>{p || "—"}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-ink-muted">
                  Brand access
                </label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {brands.length === 0 ? (
                    <span className="text-xs text-ink-muted">No brands available.</span>
                  ) : (
                    brands.map((b) => {
                      const on = newUser.brand_access.includes(b.id);
                      return (
                        <button
                          key={b.id}
                          onClick={() => toggleNewBrand(b.id)}
                          className={`text-[10px] px-2 py-0.5 rounded-sm border ${
                            on
                              ? "bg-ink text-paper border-ink"
                              : "border-rule hover:border-ink"
                          }`}
                        >
                          {b.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-rule">
              <button
                onClick={closeCreate}
                disabled={creating}
                className="text-xs px-3 py-1.5 border border-rule rounded-sm hover:bg-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={createUser}
                disabled={creating}
                className="text-xs px-3 py-1.5 bg-ink text-paper rounded-sm hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {creating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <UserPlus className="h-3 w-3" />
                )}
                Create user
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
