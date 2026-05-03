import { useMemo } from "react";
import { Activity, Clock, AlignLeft } from "lucide-react";
import {
  computeWritingStats,
  readingTimeLabel,
  gradeBand,
  passiveBand,
} from "@/lib/writingMetrics";

interface Props {
  text: string;
  // Optional target word count (from outline); we show progress vs. it.
  targetWords?: number;
}

const toneClass: Record<string, string> = {
  verified: "text-verified",
  unverified: "text-unverified",
  danger: "text-destructive",
};

export default function WritingMetrics({ text, targetWords }: Props) {
  const stats = useMemo(() => computeWritingStats(text), [text]);
  const grade = gradeBand(stats.fleschGrade);
  const passiveTone = passiveBand(stats.passiveVoicePct);
  const wordPct = targetWords ? Math.min(150, Math.round((stats.words / targetWords) * 100)) : null;

  return (
    <div className="px-4 py-3 border-b border-rule">
      <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2 flex items-center gap-1.5">
        <Activity className="h-3 w-3" /> Writing health
      </p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Tile
          label="Words"
          value={stats.words.toLocaleString()}
          sub={
            wordPct !== null
              ? `${wordPct}% of ${targetWords}`
              : null
          }
          tone={
            wordPct === null
              ? undefined
              : wordPct >= 80 && wordPct <= 120
              ? "verified"
              : wordPct < 50 || wordPct > 140
              ? "danger"
              : "unverified"
          }
        />
        <Tile
          label="Grade"
          value={stats.fleschGrade > 0 ? stats.fleschGrade.toFixed(1) : "—"}
          sub={stats.words > 0 ? grade.label : null}
          tone={stats.words > 0 ? grade.tone : undefined}
        />
        <Tile
          label="Passive"
          value={`${Math.round(stats.passiveVoicePct)}%`}
          sub={`${stats.passiveVoiceCount} sent.`}
          tone={stats.words > 0 ? passiveTone : undefined}
        />
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {stats.words > 0 ? readingTimeLabel(stats.readingTimeSec) : "—"}
        </span>
        <span className="inline-flex items-center gap-1">
          <AlignLeft className="h-3 w-3" />
          {stats.sentences} sent · avg {stats.avgSentenceLen ? stats.avgSentenceLen.toFixed(1) : "0"}w
        </span>
      </div>

      {stats.longSentences.length > 0 && (
        <details className="mt-3 group">
          <summary className="text-[10px] uppercase tracking-widest text-ink-muted cursor-pointer hover:text-ink list-none flex items-center justify-between">
            <span>{stats.longSentences.length} long sentence{stats.longSentences.length === 1 ? "" : "s"}</span>
            <span className="text-[10px] group-open:rotate-90 transition-transform">›</span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {stats.longSentences.map((s, i) => (
              <li
                key={i}
                className="text-[11px] text-ink-muted leading-snug border-l-2 border-unverified/40 pl-2"
                title={s.text}
              >
                <span className="text-unverified font-mono mr-1">{s.words}w</span>
                {s.text.length > 90 ? s.text.slice(0, 90) + "…" : s.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      {stats.jargon.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-1.5">
            Jargon · {stats.jargon.reduce((a, b) => a + b.count, 0)}
          </p>
          <div className="flex flex-wrap gap-1">
            {stats.jargon.slice(0, 8).map((j) => (
              <span
                key={j.phrase}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-destructive/10 text-destructive border border-destructive/20"
                title={`Appears ${j.count}× — consider replacing with concrete language`}
              >
                {j.phrase}{j.count > 1 ? `·${j.count}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {stats.adverbCount > 0 && (
        <p className="mt-3 text-[11px] text-ink-muted">
          <span className={stats.adverbCount > Math.max(2, stats.words / 100) ? toneClass.unverified : ""}>
            {stats.adverbCount}
          </span>{" "}
          adverb{stats.adverbCount === 1 ? "" : "s"} (-ly)
        </p>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string | null;
  tone?: "verified" | "unverified" | "danger";
}) {
  const cls = tone ? toneClass[tone] : "text-ink";
  return (
    <div className="border border-rule rounded-sm p-2">
      <div className={`text-base font-serif leading-tight ${cls}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-ink-muted mt-0.5">{label}</div>
      {sub && <div className="text-[9px] text-ink-muted mt-0.5 truncate" title={sub}>{sub}</div>}
    </div>
  );
}
