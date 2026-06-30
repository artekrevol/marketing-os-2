import { db, playbookTable, playbookSectionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

/** Fetch the latest playbook markdown. Returns empty string if none uploaded. */
export async function getActivePlaybook(): Promise<{ content: string; version: number | null }> {
  const rows = await db
    .select({ contentMarkdown: playbookTable.contentMarkdown, version: playbookTable.version })
    .from(playbookTable)
    .orderBy(desc(playbookTable.version))
    .limit(1);
  if (!rows.length) return { content: "", version: null };
  return { content: rows[0]!.contentMarkdown || "", version: rows[0]!.version ?? null };
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
  const latestRows = await db
    .select({ version: playbookTable.version })
    .from(playbookTable)
    .orderBy(desc(playbookTable.version))
    .limit(1);
  const version = latestRows[0]?.version ?? null;
  if (version === null) return { sections: [], version: null };

  const rows = await db
    .select({
      sectionNumber: playbookSectionsTable.sectionNumber,
      sectionTitle: playbookSectionsTable.sectionTitle,
      sectionContent: playbookSectionsTable.sectionContent,
      sectionTokenEstimate: playbookSectionsTable.sectionTokenEstimate,
      alwaysInclude: playbookSectionsTable.alwaysInclude,
    })
    .from(playbookSectionsTable)
    .where(eq(playbookSectionsTable.version, version))
    .orderBy(playbookSectionsTable.sectionNumber);
  const sections = rows.map((r) => ({
    section_number: r.sectionNumber,
    section_title: r.sectionTitle || "",
    section_content: r.sectionContent || "",
    section_token_estimate: r.sectionTokenEstimate || 0,
    always_include: !!r.alwaysInclude,
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

/* ───────────────────────────────────────────────────────────────────
 * ContentForge Quality Fix (v2) — playbook-derived asset queries (§2.3)
 *
 * The dispatch lists getActivePlaybook / getBannedPhrases / getDiscardList /
 * getCredentialBlock under `lib/db/queries/assets.ts`, but parsing the
 * playbook markdown is content-ai's job and `lib/db` importing content-ai
 * would create a dependency cycle (content-ai already imports `@workspace/db`).
 * So these live here, beside parsePlaybookSections; the asset-corpus queries
 * (reviews / links / rules) live in lib/db/src/queries/assets.ts.
 *
 * The playbook table is currently GLOBAL (one active version, not brand-scoped
 * — see admin GET /api/admin/playbook). The optional `brandId` parameter is
 * accepted for signature parity with the dispatch and forward-compatibility,
 * but does not filter yet. Section-header matching is intentionally tolerant;
 * the exact headers are validated against playbook v2.5 when the Phase 5/6
 * validators that consume these are wired.
 * ─────────────────────────────────────────────────────────────────── */

/** Find the body of the first section whose title matches `re` (or null). */
function findSectionBody(sections: PlaybookSection[], re: RegExp): string | null {
  const hit = sections.find((s) => re.test(s.section_title));
  return hit ? hit.section_content : null;
}

/**
 * Extract phrase-like list items from a section body. Recognises markdown
 * bullets (-, *, •), numbered lists, and quoted lines; strips markdown,
 * surrounding quotes, and trailing rationale after an em-dash/colon. Falls
 * back to empty when nothing list-shaped is present.
 */
function extractListItems(body: string): string[] {
  if (!body) return [];
  const out: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^(?:[-*•]|\d{1,3}[.)])\s+(.*)$/);
    if (!m) continue;
    let item = m[1]!.trim();
    item = item.replace(/[*_`]/g, "");
    // strip a leading/trailing wrapping quote pair
    item = item.replace(/^["'“”‘’]+/, "").replace(/["'“”‘’]+$/, "");
    // drop trailing rationale ("phrase — why" / "phrase: why")
    item = item.replace(/\s*[—–:]\s+.*$/, "");
    item = item.trim();
    if (item) out.push(item);
  }
  // de-dupe, preserve order
  return Array.from(new Set(out));
}

/** Latest playbook markdown as a plain string (null when none uploaded). */
export async function getActivePlaybookContent(
  _brandId?: string,
): Promise<string | null> {
  const { content } = await getActivePlaybook();
  return content && content.trim() ? content : null;
}

/** Banned/forbidden phrases from the playbook (empty if none/section absent). */
export async function getBannedPhrases(_brandId?: string): Promise<string[]> {
  const content = await getActivePlaybookContent();
  if (!content) return [];
  const sections = parsePlaybookSections(content);
  const body = findSectionBody(
    sections,
    /banned\s*phrase|forbidden\s*phrase|do\s*not\s*use|phrases?\s*to\s*avoid|blacklist/i,
  );
  return body ? extractListItems(body) : [];
}

/** The discard list (words/clichés to strip) from the playbook. */
export async function getDiscardList(_brandId?: string): Promise<string[]> {
  const content = await getActivePlaybookContent();
  if (!content) return [];
  const sections = parsePlaybookSections(content);
  const body = findSectionBody(
    sections,
    /discard\s*list|kill\s*list|avoid\s*list|words?\s*to\s*avoid|clich[eé]/i,
  );
  return body ? extractListItems(body) : [];
}

/** The credential / proof-point block (raw section text, "" if absent). */
export async function getCredentialBlock(_brandId?: string): Promise<string> {
  const content = await getActivePlaybookContent();
  if (!content) return "";
  const sections = parsePlaybookSections(content);
  const body = findSectionBody(
    sections,
    /credential|proof\s*point|company\s*facts?|trust\s*signal|about\s*the\s*company/i,
  );
  return body ?? "";
}

/**
 * Named projects from the playbook's portfolio / case-study / named-project
 * section. Backs the case-study narrative validator (dispatch §6.6): a case
 * study's `project_name` must appear here OR in the reviews bank. Returns the
 * list of project names (deduped, [] if no portfolio section). Fails closed.
 */
export async function getPlaybookProjectNames(
  _brandId?: string,
): Promise<string[]> {
  const content = await getActivePlaybookContent();
  if (!content) return [];
  const sections = parsePlaybookSections(content);
  const body = findSectionBody(
    sections,
    /portfolio|named\s*projects?|case\s*stud|client\s*work|projects?\s*(we|we've)\s*(built|shipped|delivered)|our\s*work/i,
  );
  if (!body) return [];
  const items = extractListItems(body);
  // Portfolio list items often read "Project Name — one-line description" or
  // "Project Name: result". Take the leading name segment before the first
  // dash/colon so the validator matches the model's `project_name` cleanly.
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of items) {
    const name = raw.split(/\s+[—–-]\s+|:\s+/)[0]?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
