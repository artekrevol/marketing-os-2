import { Outlet, useParams, Navigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import StageNav from "@/components/StageNav";
import type { Project } from "@/lib/types";
import { DraftKeywordBadge } from "@/components/DraftKeywordBadge";
import { useActiveBrand } from "@/lib/brands";

export default function ProjectLayout() {
  const { id } = useParams();
  const { activeBrand, loading: brandLoading } = useActiveBrand();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id || !activeBrand) return;
    setLoading(true);
    setProject(null);
    const resp = await fetch(
      `/api/projects/${id}?brandId=${encodeURIComponent(activeBrand.id)}`,
      { credentials: "include" },
    );
    if (!resp.ok) {
      setLoading(false);
      return;
    }
    const data = (await resp.json()) as Project;
    // Keep the detail view aligned with the server-authorized brand context.
    if (data.brand_id !== activeBrand.id) {
      setLoading(false);
      return;
    }
    setProject(data);
    setLoading(false);
  }, [id, activeBrand]);

  useEffect(() => {
    if (!id || brandLoading || !activeBrand) return;
    let mounted = true;
    void load();
    const timer = setInterval(() => { if (mounted) void load(); }, 10000);
    return () => { mounted = false; clearInterval(timer); };
  }, [id, brandLoading, activeBrand, load]);

  if (brandLoading || loading) return <div className="p-12 text-ink-muted">Loading project…</div>;
  if (!project) return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col h-full">
      <header className="px-8 pt-6 pb-4 bg-background border-b border-rule">
        <p className="text-[10px] uppercase tracking-[0.2em] text-ink-muted">
          {project.content_type} · {project.funnel_stage || "intake"} · {project.pod || "no pod"}
        </p>
        <h1 className="font-serif text-2xl mt-1">{project.topic}</h1>
        {project.brand_id && (
          <div className="mt-2">
            <DraftKeywordBadge
              brandId={project.brand_id}
              projectId={project.id}
              fallbackKeyword={project.keyword ?? null}
            />
          </div>
        )}
      </header>
      <StageNav projectId={project.id} current={project.current_stage} />
      <div className="flex-1 min-h-0">
        <Outlet context={{ project, refresh: load }} />
      </div>
    </div>
  );
}
