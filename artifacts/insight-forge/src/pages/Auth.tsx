import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { NotebookPen, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/useAuth";

export default function Auth() {
  const nav = useNavigate();
  const { reload } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      await reload();
      nav("/", { replace: true });
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <NotebookPen className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <span className="font-serif text-2xl tracking-tight">ContentForge</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1.5 uppercase tracking-wider">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full px-3 py-2 border border-rule rounded-sm bg-background text-sm focus:outline-none focus:border-ink transition-colors"
              placeholder="you@tekrevol.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-rule rounded-sm bg-background text-sm focus:outline-none focus:border-ink transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ink text-paper py-2 rounded-sm text-sm font-medium hover:bg-accent transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Sign in
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] text-ink-muted">
          TekRevol Internal Tools
        </p>
      </div>
    </div>
  );
}
