import { Link } from "react-router-dom";
import { ArrowRight, NotebookPen, FileSearch, ListOrdered, PenLine, BadgeCheck } from "lucide-react";

const Index = () => {
  return (
    <div className="max-w-3xl mx-auto px-10 py-20">
      <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted mb-6">Internal tool · v1</p>
      <h1 className="font-serif text-5xl leading-tight mb-6">
        A research-led drafting<br />assistant. Not a generator.
      </h1>
      <p className="text-lg text-ink-muted leading-relaxed max-w-2xl mb-10">
        ContentForge extracts proprietary angles from a benchmark blog, a competitor service page,
        and your own published content — then drafts in your voice with full citation tracking.
        The writer refines. Never starts from blank.
      </p>

      <Link
        to="/new"
        className="inline-flex items-center gap-2 bg-ink text-paper px-5 py-3 rounded-sm text-sm font-medium hover:bg-accent transition-colors"
      >
        Start a new project <ArrowRight className="h-4 w-4" />
      </Link>

      <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-px bg-rule border border-rule rounded-md overflow-hidden">
        {[
          { icon: FileSearch, t: "01 — Research", d: "Web-search powered teardowns of benchmark, competitor, and your own domain. Seven structured cards. Every claim cited." },
          { icon: ListOrdered, t: "02 — Outline", d: "AI-proposed sections with jobs, word counts, and proof-point assignments. Drag, edit, lock." },
          { icon: PenLine, t: "03 — Draft", d: "Composition or interview mode. Inline citations, voice flags, surgical revision questions per section." },
          { icon: BadgeCheck, t: "04 — Review", d: "Final stitch with voice-match score, Originality.ai check, citation completeness, and exports." },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="bg-background p-6">
            <Icon className="h-5 w-5 text-accent mb-3" strokeWidth={1.5} />
            <h3 className="font-serif text-lg mb-1.5">{t}</h3>
            <p className="text-sm text-ink-muted leading-relaxed">{d}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Index;
