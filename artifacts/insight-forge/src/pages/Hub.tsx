import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/useAuth";
import {
  NotebookPen,
  ShieldCheck,
  LogOut,
  ArrowRight,
  FolderOpen,
  ClipboardCheck,
  TrendingUp,
  Building2,
  FileText,
  Settings,
  Microscope,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface DashboardSummary {
  stats: {
    brands: number;
    activeProjects: number;
    inReview: number;
    seoInitiatives: number;
  };
  recentActivity: {
    id: string;
    kind: "project" | "review" | "seo";
    label: string;
    detail: string;
    brandName: string;
    at: string;
  }[];
}

async function fetchSummary(): Promise<DashboardSummary> {
  const res = await fetch("/api/dashboard/summary", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load dashboard summary");
  return res.json() as Promise<DashboardSummary>;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
}) {
  return (
    <div className="notebook-card p-4">
      <div className="flex items-center gap-2 text-ink-muted text-[10px] uppercase tracking-widest mb-2">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {label}
      </div>
      <div className="font-serif text-3xl tabular-nums">{value}</div>
    </div>
  );
}

const ACTIVITY_ICON: Record<DashboardSummary["recentActivity"][number]["kind"], LucideIcon> = {
  project: FileText,
  review: ClipboardCheck,
  seo: TrendingUp,
};

const HIGHLIGHTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Microscope,
    title: "Research-led drafting",
    body: "Brief proposals, deep research, outline, and section drafting in one pipeline.",
  },
  {
    icon: ClipboardCheck,
    title: "Automated quality gate",
    body: "Originality, brand voice, and reading-level checks before anything ships.",
  },
  {
    icon: TrendingUp,
    title: "SEO recovery war room",
    body: "Baseline locking, nightly snapshots, and ranking-recovery initiative tracking.",
  },
  {
    icon: Layers,
    title: "Multi-brand by default",
    body: "Every project and metric is isolated per client brand, in one workspace.",
  },
];

export default function Hub() {
  const nav = useNavigate();
  const { user, isLoaded, isSignedIn, signOut } = useAuth();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      nav("/auth", { replace: true });
    }
  }, [isLoaded, isSignedIn, nav]);

  const summaryQ = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: fetchSummary,
    enabled: isLoaded && isSignedIn,
  });

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink-muted text-sm">
        Loading…
      </div>
    );
  }

  if (!user) return null;

  const canEnterSeo =
    user.isAdmin || ["admin", "lead", "reviewer"].includes(user.role);

  const stats = summaryQ.data?.stats;
  const activity = summaryQ.data?.recentActivity ?? [];

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <header className="px-6 md:px-10 py-6 border-b border-rule flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-ink flex items-center justify-center">
            <span className="text-[#FF3C00] font-bold text-sm leading-none">T</span>
          </div>
          <div>
            <span className="font-serif text-lg tracking-tight">TekRevol</span>
            <span className="ml-2 text-[11px] uppercase tracking-[0.15em] text-ink-muted">
              Content Platform
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {user.isAdmin && (
            <a
              href="/admin"
              className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
            >
              <Settings className="h-3.5 w-3.5" /> Admin
            </a>
          )}
          <span className="text-xs text-ink-muted font-mono hidden sm:block">
            {user.email}
          </span>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 md:px-10 py-12">
        {/* Hero / platform overview */}
        <section className="mb-12">
          <p className="text-[11px] uppercase tracking-[0.2em] text-accent mb-3">
            Marketing Operating System
          </p>
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight leading-[1.05] max-w-3xl">
            One workspace for research-led content and SEO recovery.
          </h1>
          <p className="text-ink-muted mt-5 max-w-2xl leading-relaxed">
            TekRevol Content Platform unifies your editorial pipeline and
            search-quality operations. Draft with research depth in{" "}
            <span className="text-ink">ContentForge</span>, then protect and
            recover rankings in <span className="text-ink">SEO OS</span> — one
            login, every brand.
          </p>
        </section>

        {/* Live stats */}
        <section className="mb-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              icon={Building2}
              label="Brands"
              value={summaryQ.isLoading ? "—" : (stats?.brands ?? 0)}
            />
            <Stat
              icon={FolderOpen}
              label="Active projects"
              value={summaryQ.isLoading ? "—" : (stats?.activeProjects ?? 0)}
            />
            <Stat
              icon={ClipboardCheck}
              label="In review"
              value={summaryQ.isLoading ? "—" : (stats?.inReview ?? 0)}
            />
            <Stat
              icon={TrendingUp}
              label="SEO initiatives"
              value={summaryQ.isLoading ? "—" : (stats?.seoInitiatives ?? 0)}
            />
          </div>
        </section>

        {/* Modules */}
        <section className="mb-14">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="font-serif text-2xl">Your modules</h2>
            <p className="text-[11px] uppercase tracking-[0.15em] text-ink-muted">
              Select to enter
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
                Research-led content drafting. Brief proposals, deep research,
                outline, draft, and review — all in one pipeline.
              </p>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent group-hover:gap-2.5 transition-all">
                Open ContentForge <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </a>

            {canEnterSeo ? (
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
                  Quality gate and SEO recovery. Review submitted drafts, run
                  automated checks, track ranking recovery initiatives.
                </p>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent group-hover:gap-2.5 transition-all">
                  Open SEO OS <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </a>
            ) : (
              <div className="relative border border-rule border-dashed rounded-md bg-background/50 p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded bg-rule flex items-center justify-center shrink-0">
                    <ShieldCheck
                      className="h-4 w-4 text-ink-muted"
                      strokeWidth={1.75}
                    />
                  </div>
                  <span className="font-serif text-xl text-ink-muted">SEO OS</span>
                </div>
                <p className="text-sm text-ink-muted leading-relaxed">
                  Quality gate and SEO recovery. Access is limited to reviewer,
                  lead, and admin roles — ask an admin for access.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Capabilities + Recent activity */}
        <section className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3">
            <h2 className="font-serif text-2xl mb-5">What you can do</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {HIGHLIGHTS.map((h) => {
                const Icon = h.icon;
                return (
                  <div key={h.title} className="notebook-card p-5">
                    <Icon
                      className="h-5 w-5 text-accent mb-3"
                      strokeWidth={1.75}
                    />
                    <h3 className="font-serif text-base mb-1.5">{h.title}</h3>
                    <p className="text-[13px] text-ink-muted leading-relaxed">
                      {h.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2">
            <h2 className="font-serif text-2xl mb-5">Recent activity</h2>
            <div className="notebook-card divide-y divide-rule">
              {summaryQ.isLoading ? (
                <div className="p-5 text-sm text-ink-muted">Loading activity…</div>
              ) : activity.length === 0 ? (
                <div className="p-5 text-sm text-ink-muted">
                  No recent activity yet. Start a project in ContentForge to see
                  updates here.
                </div>
              ) : (
                activity.map((item) => {
                  const Icon = ACTIVITY_ICON[item.kind];
                  return (
                    <div key={item.id} className="flex items-start gap-3 p-4">
                      <div className="w-7 h-7 rounded bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                        <Icon
                          className="h-3.5 w-3.5 text-ink-muted"
                          strokeWidth={1.75}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-ink leading-snug">
                          {item.label}
                        </p>
                        <p className="text-[13px] text-ink-muted truncate">
                          {item.detail}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] uppercase tracking-widest text-ink-muted">
                            {item.brandName}
                          </span>
                          <span className="text-[10px] text-ink-muted">·</span>
                          <span className="text-[10px] text-ink-muted">
                            {timeAgo(item.at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="px-6 md:px-10 py-4 border-t border-rule text-center">
        <span className="text-[11px] text-ink-muted">TekRevol Internal Tools</span>
      </footer>
    </div>
  );
}
