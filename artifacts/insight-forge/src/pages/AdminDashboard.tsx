import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ArrowRight, Upload, BookOpen, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { aiClient } from "@/lib/ai-client";
import { useAuth } from "@/lib/useAuth";

export default function AdminDashboard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [voice, setVoice] = useState<any[]>([]);
  const [playbook, setPlaybook] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [showPlaybook, setShowPlaybook] = useState(false);
  const [sections, setSections] = useState<any[]>([]);
  const [reparsing, setReparsing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState({ pod: "", stage: "", status: "" });

  const loadPlaybook = async () => {
    const resp = await fetch("/api/admin/playbook", { credentials: "include" });
    const data = resp.ok ? await resp.json() : null;
    setPlaybook(data);
    setSections(data?.sections || []);
  };

  useEffect(() => {
    const load = async () => {
      const resp = await fetch("/api/admin/dashboard", { credentials: "include" });
      if (resp.ok) {
        const body = await resp.json();
        setRows(body.rows || []);
        setVoice(body.voice || []);
      }
    };
    void load();
    void loadPlaybook();
  }, []);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10MB).");
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      // chunk-safe base64
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
      }
      const content_base64 = btoa(binary);
      // Capture who uploaded (email — durable identifier; auth.user().id would also work
      // but email is what the admin card surfaces and what writers will recognise).
      const uploaded_by = user?.email || null;
      const { data, error } = await aiClient.playbookUpload(file.name, file.type, content_base64, uploaded_by);
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const version = (data as any).playbook.version;
      const count = (data as any).sections_count ?? 0;
      // Guardrail: if the parser fell back to ≤1 section the routed playbook
      // collapses to "send the whole document" on every Anthropic call, which
      // silently destroys cache hit rates. Surface this loudly instead of a
      // green success toast.
      if (count <= 1) {
        toast.error(
          `Playbook v${version} uploaded but only ${count} section detected — routing will use the FULL document. Check that headers match a supported style (e.g. "## SECTION 1 — Title" or "## 1. Title").`,
          { duration: 12000 },
        );
      } else {
        toast.success(`Playbook v${version} uploaded — ${count} sections detected.`);
      }
      await loadPlaybook();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const onReparse = async () => {
    setReparsing(true);
    try {
      const { data, error } = await aiClient.playbookReparse();
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const count = (data as any).sections_count ?? 0;
      if (count <= 1) {
        toast.error(
          `Re-parse detected only ${count} section — routing will use the FULL document. Header format may not match a supported style.`,
          { duration: 12000 },
        );
      } else {
        toast.success(`Parsed ${count} sections.`);
      }
      await loadPlaybook();
    } catch (e: any) {
      toast.error(e.message || "Re-parse failed");
    } finally {
      setReparsing(false);
    }
  };

  const filtered = useMemo(() => rows.filter((r) =>
    (!filter.pod || r.pod === filter.pod) &&
    (!filter.stage || String(r.current_stage) === filter.stage) &&
    (!filter.status || r.status === filter.status)
  ), [rows, filter]);

  const exportCsv = () => {
    const headers = ["topic", "pod", "writer", "stage", "status", "minutes", "voice_match", "originality", "citations", "banned_phrases"];
    const lines = [headers.join(",")];
    filtered.forEach((r) => {
      lines.push([
        JSON.stringify(r.topic),
        r.pod || "",
        r.writer_id || "",
        r.current_stage,
        r.status,
        r.minutes,
        r.scores?.voice_match_score ?? "",
        r.scores?.originality_score ?? "",
        r.citations,
        r.scores?.banned_phrase_count ?? "",
      ].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "contentforge-export.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const pods = Array.from(new Set(rows.map((r) => r.pod).filter(Boolean)));
  const statuses = Array.from(new Set(rows.map((r) => r.status)));

  return (
    <div className="max-w-6xl mx-auto px-10 py-10">
      {/* COMPANY PLAYBOOK */}
      <section className="mb-12">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">Operating system</p>
            <h2 className="font-serif text-2xl mt-1 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-accent" /> Company playbook
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".md,.markdown,.txt,.pdf,.docx,application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="text-xs px-3 py-2 border border-rule rounded-sm hover:bg-secondary inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {uploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</> : <><Upload className="h-3.5 w-3.5" /> {playbook ? "Upload new version" : "Upload playbook"}</>}
            </button>
          </div>
        </div>
        <p className="text-xs text-ink-muted mb-4 max-w-2xl">
          Markdown, PDF, or .docx. Should contain ICP definitions, brand voice rules, banned phrases, pod specialties, pricing
          anchors, client roster, geographic priorities, and content pillars. Every AI call injects this as system context.
        </p>

        {playbook ? (
          <div className="notebook-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-verified" />
                <div>
                  <p className="text-sm font-medium">
                    Playbook is active · v{playbook.version} · updated {formatRelative(playbook.uploaded_at)}
                    {playbook.uploaded_by ? <span className="text-ink-muted font-normal"> · by {playbook.uploaded_by}</span> : null}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest text-ink-muted mt-0.5">
                    {playbook.source_filename || "uploaded text"} ·{" "}
                    {new Date(playbook.uploaded_at).toLocaleString()} ·{" "}
                    {(playbook.content_markdown || "").length.toLocaleString()} chars
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPlaybook((v) => !v)}
                className="text-xs text-accent hover:underline"
              >
                {showPlaybook ? "Hide" : "Preview"}
              </button>
            </div>
            {showPlaybook && (
              <pre className="mt-3 p-4 bg-secondary rounded-sm text-xs leading-relaxed whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">
                {playbook.content_markdown}
              </pre>
            )}

            {/* Section routing panel — Phase 2 */}
            <div className="mt-5 pt-4 border-t border-rule">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-ink-muted">Section routing</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {sections.length > 0
                      ? `${sections.length} sections parsed · ${sections.reduce((n, s) => n + (s.section_token_estimate || 0), 0).toLocaleString()} tokens total`
                      : "Not yet parsed — click Re-parse to enable section-based routing."}
                  </p>
                </div>
                <button
                  onClick={onReparse}
                  disabled={reparsing}
                  className="text-xs px-3 py-1.5 border border-rule rounded-sm hover:bg-secondary inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {reparsing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Re-parse sections
                </button>
              </div>
              {sections.length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {sections.map((s) => (
                    <div key={s.section_number} className="text-xs flex items-center justify-between py-0.5">
                      <span className="truncate">
                        <span className="font-mono text-ink-muted mr-2">{s.section_number}.</span>
                        {s.section_title}
                        {s.always_include && <span className="ml-2 text-[10px] uppercase tracking-widest text-accent">always</span>}
                      </span>
                      <span className="text-ink-muted font-mono">{(s.section_token_estimate || 0).toLocaleString()}t</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="notebook-card p-6 text-center">
            <p className="text-sm text-ink-muted italic">
              No playbook uploaded yet. The AI will operate on generic best practices until one is added.
            </p>
          </div>
        )}
      </section>

      <div className="flex items-end justify-between mb-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">Admin</p>
          <h1 className="font-serif text-3xl mt-1">Production overview</h1>
        </div>
        <button onClick={exportCsv} className="text-xs px-3 py-2 border border-rule rounded-sm hover:bg-secondary inline-flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <select value={filter.pod} onChange={(e) => setFilter((f) => ({ ...f, pod: e.target.value }))} className="text-xs px-2 py-1.5 border border-rule rounded-sm bg-background">
          <option value="">All pods</option>
          {pods.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={filter.stage} onChange={(e) => setFilter((f) => ({ ...f, stage: e.target.value }))} className="text-xs px-2 py-1.5 border border-rule rounded-sm bg-background">
          <option value="">All stages</option>
          {[1, 2, 3, 4].map((s) => <option key={s} value={s}>Stage {s}</option>)}
        </select>
        <select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))} className="text-xs px-2 py-1.5 border border-rule rounded-sm bg-background">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="notebook-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-[10px] uppercase tracking-widest text-ink-muted">
            <tr>
              <Th>Topic</Th><Th>Pod / Writer</Th><Th>Stage</Th><Th>Status</Th><Th>Time</Th><Th>Voice</Th><Th>Originality</Th><Th>Citations</Th><Th>Banned</Th><Th>{" "}</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-rule">
                <Td><div className="max-w-xs truncate">{r.topic}</div></Td>
                <Td className="text-ink-muted">{r.pod || "—"} / {r.writer_id || "—"}</Td>
                <Td><span className="font-mono text-xs">S{r.current_stage}</span></Td>
                <Td className="text-ink-muted">{r.status.replace(/_/g, " ")}</Td>
                <Td className="text-ink-muted">{r.minutes}m</Td>
                <Td>{r.scores?.voice_match_score ?? "—"}</Td>
                <Td>{r.scores?.originality_score ?? "—"}</Td>
                <Td>{r.citations}</Td>
                <Td className={r.scores?.banned_phrase_count > 0 ? "text-destructive" : ""}>{r.scores?.banned_phrase_count ?? "—"}</Td>
                <Td><Link to={`/project/${r.id}/research`} className="text-accent hover:underline inline-flex items-center gap-1">Open <ArrowRight className="h-3 w-3" /></Link></Td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-ink-muted text-sm">No projects match filters.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="font-serif text-2xl mt-12 mb-4">Voice library</h2>
      <p className="text-xs text-ink-muted mb-4">Latest 20 diffs between AI drafts and writer-edited text — used to fine-tune voice over time.</p>
      <div className="space-y-3">
        {voice.map((v) => (
          <div key={v.id} className="notebook-card p-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">AI</p>
              <p className="text-sm leading-relaxed line-clamp-3">{v.original_ai_text}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-accent mb-1">Edited</p>
              <p className="text-sm leading-relaxed line-clamp-3">{v.edited_human_text}</p>
            </div>
          </div>
        ))}
        {voice.length === 0 && <p className="text-sm text-ink-muted italic">No edits captured yet.</p>}
      </div>
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => <th className="text-left px-4 py-3 font-medium">{children}</th>;
const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <td className={`px-4 py-3 ${className}`}>{children}</td>;

/** Human-readable relative time (e.g. "3d ago", "just now"). */
function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}