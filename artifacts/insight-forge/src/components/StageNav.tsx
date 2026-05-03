import { NavLink } from "react-router-dom";

const STAGES = [
  { n: 0, label: "Brief", path: "brief" },
  { n: 1, label: "Research", path: "research" },
  { n: 2, label: "Outline", path: "outline" },
  { n: 3, label: "Draft", path: "draft" },
  { n: 4, label: "Review", path: "review" },
];

export default function StageNav({ projectId, current }: { projectId: string; current: number }) {
  return (
    <nav className="flex items-center gap-1 border-b border-rule px-8 bg-background">
      {STAGES.map((s) => (
        <NavLink
          key={s.n}
          to={`/project/${projectId}/${s.path}`}
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-3 text-sm border-b-2 -mb-px transition-colors ${
              isActive
                ? "border-accent text-ink font-medium"
                : current >= s.n
                ? "border-transparent text-ink-muted hover:text-ink"
                : "border-transparent text-ink-muted/50"
            }`
          }
        >
          <span className="font-mono text-[10px] tracking-widest">0{s.n}</span>
          <span>{s.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}