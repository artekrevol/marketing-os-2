import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

export default function Auth() {
  const [, setLoc] = useLocation();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setLoc("/quality-gate");
    });
  }, [setLoc]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Check your email to confirm sign-up.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setLoc("/quality-gate");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    if (error) {
      toast.error(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
      <div className="w-full max-w-sm border border-rule rounded-md bg-background p-8">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <span className="font-serif text-xl">SEO OS</span>
        </div>
        <p className="text-[11px] uppercase tracking-widest text-ink-muted mb-6">
          Quality Gate sign-in
        </p>

        <button
          onClick={google}
          disabled={loading}
          className="w-full bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-50 mb-3"
        >
          Continue with Google
        </button>

        <div className="text-center text-[11px] uppercase tracking-widest text-ink-muted mb-3">
          or
        </div>

        <form onSubmit={submit} className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@tekrevol.com"
            className="w-full px-3 py-2 border border-rule rounded-sm text-sm bg-background"
            autoComplete="email"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            className="w-full px-3 py-2 border border-rule rounded-sm text-sm bg-background"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full border border-rule px-4 py-2 rounded-sm text-sm font-medium hover:bg-secondary disabled:opacity-50"
          >
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
          className="mt-3 text-xs text-ink-muted hover:text-accent w-full text-center"
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
