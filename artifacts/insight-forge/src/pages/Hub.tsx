import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { NotebookPen, ShieldCheck, LogOut, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function Hub() {
  const nav = useNavigate();
  const [authState, setAuthState] = useState<"loading" | "in" | "out">("loading");
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setEmail((data.session.user?.email ?? "").toLowerCase());
        setAuthState("in");
      } else {
        setAuthState("out");
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session) {
        setEmail((session.user?.email ?? "").toLowerCase());
        setAuthState("in");
      } else {
        setAuthState("out");
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authState === "out") nav("/auth", { replace: true });
  }, [authState, nav]);

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
    nav("/auth", { replace: true });
  };

  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink-muted text-sm">
        Loading…
      </div>
    );
  }

  if (authState === "out") return null;

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <header className="px-10 py-6 border-b border-rule flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-ink flex items-center justify-center">
            <span className="text-[#FF3C00] font-bold text-sm leading-none">T</span>
          </div>
          <div>
            <span className="font-serif text-lg tracking-tight">TekRevol</span>
            <span className="ml-2 text-[11px] uppercase tracking-[0.15em] text-ink-muted">Content Platform</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-ink-muted font-mono hidden sm:block">{email}</span>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted mb-4">Select a module</p>
        <h1 className="font-serif text-4xl mb-12 text-center">Where do you want to go?</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-2xl">
          <a
            href="/projects"
            className="group relative border border-rule rounded-md bg-background p-8 hover:border-ink transition-all hover:shadow-sm"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded bg-ink flex items-center justify-center shrink-0">
                <NotebookPen className="h-4 w-4 text-paper" strokeWidth={1.75} />
              </div>
              <span className="font-serif text-xl">ContentForge</span>
            </div>
            <p className="text-sm text-ink-muted leading-relaxed mb-6">
              Research-led content drafting. Brief proposals, deep research, outline, draft, and review — all in one pipeline.
            </p>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent group-hover:gap-2.5 transition-all">
              Open ContentForge <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </a>

          <a
            href="/seo-os/"
            className="group relative border border-rule rounded-md bg-background p-8 hover:border-ink transition-all hover:shadow-sm"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded bg-ink flex items-center justify-center shrink-0">
                <ShieldCheck className="h-4 w-4 text-paper" strokeWidth={1.75} />
              </div>
              <span className="font-serif text-xl">SEO OS</span>
            </div>
            <p className="text-sm text-ink-muted leading-relaxed mb-6">
              Quality gate and SEO recovery. Review submitted drafts, run automated checks, track ranking recovery initiatives.
            </p>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent group-hover:gap-2.5 transition-all">
              Open SEO OS <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </a>
        </div>
      </main>

      <footer className="px-10 py-4 border-t border-rule text-center">
        <span className="text-[11px] text-ink-muted">TekRevol Internal Tools</span>
      </footer>
    </div>
  );
}
