import { Outlet, useParams, Navigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import StageNav from "@/components/StageNav";
import type { Project } from "@/lib/types";

export default function ProjectLayout() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const resp = await fetch(`/api/projects/${id}`, { credentials: "include" });
    if (!resp.ok) { setLoading(false); return; }
    const data = (await resp.json()) as Project;
    setProject(data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    void load();
    const timer = setInterval(() => { if (mounted) void load(); }, 10000);
    return () => { mounted = false; clearInterval(timer); };
  }, [id, load]);

  if (loading) return <div className="p-12 text-ink-muted">Loading project…</div>;
  if (!project) return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col h-full">
      <header className="px-8 pt-6 pb-4 bg-background border-b border-rule">
        <p className="text-[10px] uppercase tracking-[0.2em] text-ink-muted">
          {project.content_type} · {project.funnel_stage || "intake"} · {project.pod || "no pod"}
        </p>
        <h1 className="font-serif text-2xl mt-1">{project.topic}</h1>
      </header>
      <StageNav projectId={project.id} current={project.current_stage} />
      <div className="flex-1 min-h-0">
        <Outlet context={{ project, refresh: load }} />
      </div>
    </div>
  );
}
