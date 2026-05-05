import { getSupabaseAdmin } from "./supabase-admin.js";

/** Fetch the latest playbook markdown. Returns empty string if none uploaded. */
export async function getActivePlaybook(): Promise<{ content: string; version: number | null }> {
  const { data } = await getSupabaseAdmin()
    .from("playbook")
    .select("content_markdown, version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { content: "", version: null };
  return { content: (data as any).content_markdown || "", version: (data as any).version ?? null };
}

/* ───────────────────────────────────────────────────────────────────
 * Phase 2: section-based playbook routing
 * ─────────────────────────────────────────────────────────────────── */

export type PlaybookSection = {
  section_number: number;
  section_title: string;
  section_content: string;
  section_token_estimate: number;
  always_include: boolean;
};

/** Stage keys used for routing. Matches sub_stage values in usage_logs. */
export type RouteKey =
  | "search_intent"
  | "benchmark_teardown"
  | "competitor_teardown"
  | "synergy_map"
  | "ai_citation_landscape"
  | "atomic_and_entities"
  | "angle_and_conversion"
  | "propose_brief"
  | "outline"
  | "draft"
  | "interview"
  | "final_synthesis";

/** Sections always included in every routed bundle (per Section 12 of the playbook). */
export const ALWAYS_INCLUDE: number[] = [1, 3, 8];

/** Sections that are parsed and stored but NEVER injected into AI prompts.
 *  0 = "Preamble" — human-facing maintenance docs for playbook editors,
 *  not operational rules for the AI. Stays queryable/editable in admin
 *  but is excluded from every routed bundle regardless of stage. */
export const NEVER_INCLUDE: number[] = [0];

/** Per-stage routing map (section numbers IN ADDITION TO ALWAYS_INCLUDE). */
export const ROUTING_MAP: Record<RouteKey, number[]> = {
  search_intent: [6, 11],
  benchmark_teardown: [7],
  competitor_teardown: [7],
  synergy_map: [11, 12],
  ai_citation_landscape: [9, 10],
  atomic_and_entities: [2, 10],
  angle_and_conversion: [5, 11],
  propose_brief: [2, 5, 6, 11],
  outline: [2, 5, 6, 11],
  draft: [2, 10],
  interview: [2, 5],
  final_synthesis: [5, 10],
};

/**
 * Cache groups: substages that should share a single cached playbook prefix.
 * All Stage 1 substages get the SUPERSET of their sections so Sonnet and
 * Haiku each hit one cache entry per Stage 1 run (instead of 7 fragments).
 */
const STAGE1_SUBSTAGES: RouteKey[] = [
  "search_intent",
  "benchmark_teardown",
  "competitor_teardown",
  "synergy_map",
  "ai_citation_landscape",
  "atomic_and_entities",
  "angle_and_conversion",
];

function cacheGroupFor(stage: RouteKey): string {
  if (STAGE1_SUBSTAGES.includes(stage)) return "stage1";
  return stage;
}

function sectionsForGroup(stage: RouteKey): number[] {
  if (STAGE1_SUBSTAGES.includes(stage)) {
    const union = new Set<number>();
    for (const s of STAGE1_SUBSTAGES) {
      for (const n of ROUTING_MAP[s]) union.add(n);
    }
    return Array.from(union);
  }
  return ROUTING_MAP[stage] ?? [];
}

/** Cheap token estimator: ~4 chars per token for English markdown. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Parse a playbook markdown document into numbered sections.
 * Recognises a flexible family of header styles to find section breaks.
 */
export function parsePlaybookSections(markdown: string): PlaybookSection[] {
  if (!markdown || !markdown.trim()) return [];
  const lines = markdown.split(/\r?\n/);
  const sepClass = "[\\.\\)\\:\\|\\u2014\\u2013\\-]";
  const headerReSameLine = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?(?:section\\s+)?(\\d{1,2})\\s*${sepClass}(?!\\d)\\s*(.+?)\\s*$`,
    "i",
  );
  const headerReSplit = /^\s*(?:#{1,6}\s*)?section\s+(\d{1,2})\s*$/i;

  type Hit = { line: number; number: number; title: string };
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let num: number | null = null;
    let title = "";

    const mSame = line.match(headerReSameLine);
    if (mSame) {
      const n = parseInt(mSame[1]!, 10);
      const t = mSame[2]!.replace(/[*_`#]/g, "").trim();
      if (!Number.isNaN(n) && n >= 1 && n <= 30 && t.length > 0 && t.length <= 120) {
        num = n;
        title = t;
      }
    }

    if (num === null) {
      const mSplit = line.match(headerReSplit);
      if (mSplit) {
        const n = parseInt(mSplit[1]!, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= 30) {
          let j = i + 1;
          while (j < lines.length && !lines[j]!.trim()) j++;
          if (j < lines.length) {
            const t = lines[j]!
              .replace(/^\s*#{1,6}\s*/, "")
              .replace(/[*_`#]/g, "")
              .trim();
            if (t.length > 0 && t.length <= 120) {
              num = n;
              title = t;
            }
          }
        }
      }
    }

    if (num === null) continue;
    hits.push({ line: i, number: num, title });
  }

  if (hits.length === 0) {
    return [
      {
        section_number: 1,
        section_title: "Playbook",
        section_content: markdown.trim(),
        section_token_estimate: estimateTokens(markdown),
        always_include: true,
      },
    ];
  }

  const firstSectionLine = hits[0]!.line;
  const h2Re = /^\s*##\s+(?!#)(.+?)\s*$/;
  let preambleHeaderLine = -1;
  let preambleTitle = "";
  for (let i = 0; i < firstSectionLine; i++) {
    const m = lines[i]!.match(h2Re);
    if (!m) continue;
    if (headerReSameLine.test(lines[i]!) || headerReSplit.test(lines[i]!)) continue;
    preambleHeaderLine = i;
    preambleTitle = m[1]!.replace(/[*_`#]/g, "").trim();
  }

  const out: PlaybookSection[] = [];
  if (preambleHeaderLine >= 0) {
    const body = lines.slice(preambleHeaderLine, firstSectionLine).join("\n").trim();
    if (body.length > 0) {
      out.push({
        section_number: 0,
        section_title: preambleTitle || "Preamble",
        section_content: body,
        section_token_estimate: estimateTokens(body),
        always_include: false,
      });
    }
  }

  for (let h = 0; h < hits.length; h++) {
    const start = hits[h]!.line;
    const end = h + 1 < hits.length ? hits[h + 1]!.line : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    out.push({
      section_number: hits[h]!.number,
      section_title: hits[h]!.title,
      section_content: body,
      section_token_estimate: estimateTokens(body),
      always_include: ALWAYS_INCLUDE.includes(hits[h]!.number),
    });
  }

  const byNum = new Map<number, PlaybookSection>();
  for (const s of out) {
    const cur = byNum.get(s.section_number);
    if (!cur || s.section_content.length > cur.section_content.length) {
      byNum.set(s.section_number, s);
    }
  }
  return Array.from(byNum.values()).sort((a, b) => a.section_number - b.section_number);
}

/** Fetch all sections for the latest playbook version. */
export async function getPlaybookSections(): Promise<{ sections: PlaybookSection[]; version: number | null }> {
  const { data: latest } = await getSupabaseAdmin()
    .from("playbook")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (latest as any)?.version ?? null;
  if (version === null) return { sections: [], version: null };

  const { data: rows } = await getSupabaseAdmin()
    .from("playbook_sections")
    .select("section_number, section_title, section_content, section_token_estimate, always_include")
    .eq("version", version)
    .order("section_number");
  const sections = ((rows as any[]) ?? []).map((r) => ({
    section_number: r.section_number,
    section_title: r.section_title || "",
    section_content: r.section_content || "",
    section_token_estimate: r.section_token_estimate || 0,
    always_include: !!r.always_include,
  }));
  return { sections, version };
}

/**
 * Build the routed playbook text for a given stage.
 * Falls back to the full markdown if sections haven't been parsed yet.
 */
export async function getRoutedPlaybook(
  stage: RouteKey,
): Promise<{ content: string; version: number | null; included: number[] }> {
  const { sections, version } = await getPlaybookSections();
  if (sections.length === 0) {
    const full = await getActivePlaybook();
    return { content: full.content, version: full.version, included: [] };
  }

  const wanted = new Set<number>([...ALWAYS_INCLUDE, ...sectionsForGroup(stage)]);
  const picked = sections.filter(
    (s) => !NEVER_INCLUDE.includes(s.section_number) && (wanted.has(s.section_number) || s.always_include),
  );
  const ordered = picked.sort((a, b) => a.section_number - b.section_number);

  const body = ordered
    .map((s) => `## ${s.section_number}. ${s.section_title}\n\n${stripHeader(s.section_content)}`)
    .join("\n\n");

  return { content: body, version, included: ordered.map((s) => s.section_number) };
}

function stripHeader(body: string): string {
  const lines = body.split(/\r?\n/);
  if (lines.length === 0) return body;
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  if (i < lines.length && /^\s*(?:#{1,6}\s*)?(?:section\s+)?\d{1,2}[\.\):]/i.test(lines[i]!)) {
    lines.splice(i, 1);
  }
  return lines.join("\n").trim();
}

export function playbookBlock(content: string): string {
  if (!content || !content.trim()) {
    return "[No company playbook has been uploaded yet. Operate from generic best practices, but flag this gap in your output.]";
  }
  return `=== COMPANY PLAYBOOK (operating system — always honor) ===\n${content.trim()}\n=== END PLAYBOOK ===`;
}

export type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" } };

/**
 * Build a structured Anthropic `system` array with the playbook as a cached
 * ephemeral block, followed by stage-specific (non-cached) instructions.
 * Caching is order-dependent: the cached block MUST come first.
 */
export function buildCachedSystem(
  playbookContent: string,
  playbookVersion: number | null,
  stageInstructions: string,
  routeKey?: string,
): SystemBlock[] {
  const groupKey = routeKey ? cacheGroupFor(routeKey as RouteKey) : undefined;
  const versionTag = `PLAYBOOK_VERSION: ${playbookVersion ?? "none"}${groupKey ? ` | ROUTE: ${groupKey}` : ""}`;
  const cachedText = `${versionTag}\n\n${playbookBlock(playbookContent)}`;
  return [
    { type: "text", text: cachedText, cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: stageInstructions },
  ];
}

/**
 * Phase 3: build a system array with TWO cached blocks — the routed playbook
 * and a per-project context block. The second cache breakpoint lets every
 * section draft + every revision of the same project hit the cache for the
 * heavy shared context, while per-section instructions stay uncached.
 */
export function buildCachedSystemWithProject(
  playbookContent: string,
  playbookVersion: number | null,
  projectContext: string,
  projectCacheTag: string,
  stageInstructions: string,
  routeKey?: string,
): SystemBlock[] {
  const groupKey = routeKey ? cacheGroupFor(routeKey as RouteKey) : undefined;
  const versionTag = `PLAYBOOK_VERSION: ${playbookVersion ?? "none"}${groupKey ? ` | ROUTE: ${groupKey}` : ""}`;
  const cachedPlaybook = `${versionTag}\n\n${playbookBlock(playbookContent)}`;
  const cachedProject = `PROJECT_CONTEXT_TAG: ${projectCacheTag}\n\n${projectContext}`;
  return [
    { type: "text", text: cachedPlaybook, cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: cachedProject, cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: stageInstructions },
  ];
}

/** Routed variant of buildCachedSystemWithProject. */
export async function buildRoutedSystemWithProject(
  stage: RouteKey,
  projectContext: string,
  projectCacheTag: string,
  stageInstructions: string,
): Promise<{ system: SystemBlock[]; version: number | null; included: number[] }> {
  const routed = await getRoutedPlaybook(stage);
  const system = buildCachedSystemWithProject(
    routed.content,
    routed.version,
    projectContext,
    projectCacheTag,
    stageInstructions,
    stage,
  );
  return { system, version: routed.version, included: routed.included };
}

/**
 * Convenience: fetch routed playbook + build the cached system array in one call.
 * Returns the array plus the included section numbers (for logging).
 */
export async function buildRoutedSystem(
  stage: RouteKey,
  stageInstructions: string,
): Promise<{ system: SystemBlock[]; version: number | null; included: number[] }> {
  const routed = await getRoutedPlaybook(stage);
  const system = buildCachedSystem(routed.content, routed.version, stageInstructions, stage);
  return { system, version: routed.version, included: routed.included };
}
