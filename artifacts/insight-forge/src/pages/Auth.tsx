import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { NotebookPen } from "lucide-react";
import { toast } from "sonner";

export default function Auth() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"google" | "password">("google");
  const [pwMode, setPwMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav("/", { replace: true });
    });
  }, [nav]);

  const signInGoogle = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
      extraParams: { hd: "tekrevol.com", prompt: "select_account" },
    });
    if (result.error) {
      toast.error(result.error.message || "Sign-in failed");
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    nav("/", { replace: true });
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      if (pwMode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. Signing in…");
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      nav("/", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
      <div className="w-full max-w-sm border border-rule rounded-sm bg-background p-8">
        <div className="flex items-center gap-2 mb-6">
          <NotebookPen className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <span className="font-serif text-2xl tracking-tight">ContentForge</span>
        </div>
        <h1 className="font-serif text-xl mb-2">Sign in</h1>
        <p className="text-sm text-ink-muted mb-6">
          Team members sign in with <span className="font-mono">@tekrevol.com</span> Google. Admins can use email & password.
        </p>

        <div className="flex border border-rule rounded-sm overflow-hidden mb-5 text-xs">
          <button
            onClick={() => setMode("google")}
            className={`flex-1 py-2 ${mode === "google" ? "bg-ink text-paper" : "hover:bg-secondary"}`}
          >Google</button>
          <button
            onClick={() => setMode("password")}
            className={`flex-1 py-2 ${mode === "password" ? "bg-ink text-paper" : "hover:bg-secondary"}`}
          >Email & password</button>
        </div>

        {mode === "google" ? (
          <>
            <button
              onClick={signInGoogle}
              disabled={loading}
              className="w-full bg-ink text-paper px-4 py-2.5 rounded-sm text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
            >
              {loading ? "Redirecting…" : "Continue with Google"}
            </button>
            <p className="text-[11px] text-ink-muted mt-4 italic">
              Non-tekrevol Google accounts will be blocked.
            </p>
          </>
        ) : (
          <form onSubmit={submitPassword} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@contentforge.local"
              className="w-full px-3 py-2 border border-rule rounded-sm bg-background text-sm font-mono"
            />
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 8 chars)"
              className="w-full px-3 py-2 border border-rule rounded-sm bg-background text-sm"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-ink text-paper px-4 py-2.5 rounded-sm text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
            >
              {loading ? "…" : pwMode === "signin" ? "Sign in" : "Create admin account & sign in"}
            </button>
            <button
              type="button"
              onClick={() => setPwMode((m) => (m === "signin" ? "signup" : "signin"))}
              className="w-full text-[11px] text-ink-muted hover:text-ink"
            >
              {pwMode === "signin" ? "First time? Create the admin account" : "Have an account? Sign in"}
            </button>
            <p className="text-[11px] text-ink-muted italic">
              The first account created with <span className="font-mono">admin@contentforge.local</span> becomes admin automatically.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
