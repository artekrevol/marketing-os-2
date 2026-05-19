import { useEffect, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { GripVertical, Trash2, Plus, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import type { Project, OutlineSection } from "@/lib/types";
import { emit } from "@/lib/events";

export default function OutlineEditor() {
  const { project } = useOutletContext<{ project: Project }>();
  const nav = useNavigate();
  const [outline, setOutline] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const resp = await fetch(`/api/projects/${project.id}/outlines`, { credentials: "include" });
      if (!mounted) return;
      const data = resp.ok ? await resp.json() : null;
      setOutline(data);
      setLoading(false);
    };
    load();
    const timer = setInterval(() => { if (mounted) void load(); }, 8000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [project.id]);

  const save = async (patch: any) => {
    setOutline((o: any) => ({ ...o, ...patch }));
    await fetch(`/api/projects/${project.id}/outlines`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
  };

  const updateSection = (id: string, patch: Partial<OutlineSection>) => {
    const next = outline.sections.map((s: OutlineSection) => (s.id === id ? { ...s, ...patch } : s));
    save({ sections: next });
  };

  const removeSection = (id: string) => {
    save({ sections: outline.sections.filter((s: OutlineSection) => s.id !== id) });
  };

  const addSection = () => {
    const id = `s${Date.now()}`;
    save({
      sections: [
        ...outline.sections,
        { id, heading: "New section", level: "H2", job: "", word_count: 200, proof_points: [], internal_links: [] },
      ],
    });
  };

  const onDrop = (overId: string) => {
    if (!dragId || dragId === overId) return;
    const list = [...outline.sections];
    const fromIdx = list.findIndex((s) => s.id === dragId);
    const toIdx = list.findIndex((s) => s.id === overId);
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    save({ sections: list });
    setDragId(null);
  };

  const lockOutline = async () => {
    setLocking(true);
    await fetch(`/api/projects/${project.id}/outlines`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ locked_at: new Date().toISOString() }),
    });
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ current_stage: 3, status: "drafting" }),
    });
    emit("outline.locked", "project", project.id, { sections: outline.sections.length }, project.brand_id ?? null);
    setLocking(false);
    toast.success("Outline locked. Starting draft.");
    nav(`/project/${project.id}/draft`);
  };

  if (loading) return <div className="p-12 text-ink-muted">Loading outline…</div>;
  if (!outline) {
    return (
      <div className="max-w-2xl mx-auto px-10 py-20 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent mx-auto mb-4" />
        <h2 className="font-serif text-2xl mb-2">Building outline…</h2>
        <p className="text-sm text-ink-muted">Claude is structuring sections from the approved research.</p>
      </div>
    );
  }

  const sections: OutlineSection[] = outline.sections || [];

  return (
    <div className="max-w-3xl mx-auto px-10 py-10">
      <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted mb-3">Stage 2 · Outline</p>

      <div className="notebook-card p-5 mb-6 space-y-4">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-ink-muted">H1</label>
          <input
            value={outline.h1 || ""}
            onChange={(e) => save({ h1: e.target.value })}
            className="w-full text-xl font-serif bg-transparent border-0 border-b border-transparent focus:border-rule focus:outline-none py-1"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-ink-muted">Meta description</label>
          <textarea
            value={outline.meta_description || ""}
            onChange={(e) => save({ meta_description: e.target.value })}
            className="w-full text-sm bg-transparent border-0 focus:outline-none resize-none"
            rows={2}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-rule">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-ink-muted">Tone reminder</label>
            <p className="text-sm text-ink-muted italic">{outline.tone_reminder}</p>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-ink-muted">CTA placement</label>
            <p className="text-sm text-ink-muted italic">{outline.cta_placement}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {sections.map((s, i) => (
          <div
            key={s.id}
            draggable
            onDragStart={() => setDragId(s.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(s.id)}
            className={`notebook-card p-4 ${dragId === s.id ? "opacity-50" : ""}`}
          >
            <div className="flex items-start gap-3">
              <GripVertical className="h-4 w-4 text-ink-muted mt-1.5 cursor-grab" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                  <select
                    value={s.level}
                    onChange={(e) => updateSection(s.id, { level: e.target.value as any })}
                    className="text-[10px] uppercase tracking-widest bg-transparent text-ink-muted focus:outline-none"
                  >
                    <option>H2</option>
                    <option>H3</option>
                  </select>
                  <input
                    value={s.heading}
                    onChange={(e) => updateSection(s.id, { heading: e.target.value })}
                    className="flex-1 font-serif text-base bg-transparent border-0 focus:outline-none"
                  />
                  <input
                    type="number"
                    value={s.word_count}
                    onChange={(e) => updateSection(s.id, { word_count: Number(e.target.value) })}
                    className="w-16 text-xs text-right bg-transparent border-0 focus:outline-none text-ink-muted"
                  /><span className="text-xs text-ink-muted">w</span>
                </div>
                <input
                  value={s.job}
                  onChange={(e) => updateSection(s.id, { job: e.target.value })}
                  placeholder="Job of this section in one sentence…"
                  className="w-full text-sm bg-transparent border-0 focus:outline-none text-ink-muted italic"
                />
                {s.why_it_converts && (
                  <p className="text-xs text-accent">→ {s.why_it_converts}</p>
                )}
                {(s.proof_points && s.proof_points.length > 0) && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {s.proof_points.map((pp, j) => (
                      <span key={j} className="citation-pill">{pp}</span>
                    ))}
                  </div>
                )}
                {(s.atomic_questions && s.atomic_questions.length > 0) && (
                  <div className="pt-2">
                    <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">Atomic questions ({s.atomic_questions.length})</p>
                    <ul className="space-y-0.5">
                      {s.atomic_questions.map((q, j) => (
                        <li key={j} className="text-xs text-ink leading-snug">· {q}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(s.required_entities && s.required_entities.length > 0) && (
                  <div className="pt-1.5">
                    <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">Required entities</p>
                    <div className="flex flex-wrap gap-1">
                      {s.required_entities.map((e, j) => (
                        <span key={j} className="text-[10px] px-1.5 py-0.5 border border-rule rounded-sm">{e}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(s.required_citations && s.required_citations.length > 0) && (
                  <div className="pt-1.5">
                    <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">Required citations</p>
                    <div className="flex flex-wrap gap-1">
                      {s.required_citations.map((c, j) => (
                        <span key={j} className="text-[10px] px-1.5 py-0.5 bg-secondary rounded-sm font-mono">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3 pt-1.5 text-[10px] uppercase tracking-widest">
                  {s.ai_citation_likelihood && (
                    <span className={
                      s.ai_citation_likelihood === "high" ? "text-verified" :
                      s.ai_citation_likelihood === "low" ? "text-destructive" : "text-unverified"
                    }>
                      AI cite: {s.ai_citation_likelihood}
                    </span>
                  )}
                  {s.schema_markup_types && s.schema_markup_types.length > 0 && (
                    <span className="text-ink-muted font-mono normal-case tracking-normal">
                      schema: {s.schema_markup_types.join(", ")}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => removeSection(s.id)} className="text-ink-muted hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addSection}
        className="w-full py-3 border border-dashed border-rule rounded-sm text-sm text-ink-muted hover:text-ink hover:border-ink transition-colors flex items-center justify-center gap-1"
      >
        <Plus className="h-4 w-4" /> Add section
      </button>

      <div className="mt-10 pt-6 border-t border-rule flex items-center justify-between">
        <p className="text-xs text-ink-muted">
          {sections.length} sections · {sections.reduce((n, s) => n + (s.word_count || 0), 0)} words target
        </p>
        <button
          onClick={lockOutline}
          disabled={locking}
          className="bg-ink text-paper px-5 py-2.5 rounded-sm text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50 inline-flex items-center gap-2"
        >
          <Lock className="h-3.5 w-3.5" />
          {locking ? "Locking…" : "Lock outline → draft"}
        </button>
      </div>
    </div>
  );
}