# Edge Functions → Express Server Handoff

Source project: Lovable Cloud (Supabase) — being rebuilt as Express routes on Replit.
Generated: 2026-05-05.

This document covers every edge function under `supabase/functions/`. For each function you get: full source, request/response contract, frontend call sites, env vars, external API details (Anthropic prompts verbatim), DB I/O, auth, gotchas.

## Global notes (apply to every function)

- **Runtime today:** Deno (Supabase Edge Functions). Rebuild target: Node + Express.
- **Auth:** All functions deploy with `verify_jwt = false`. They run with the Supabase **service_role** key (full DB access, RLS bypassed). The frontend calls them via `supabase.functions.invoke(name, { body })`, which automatically forwards the user's JWT in the `Authorization` header — but **none of the functions read or validate it**. Auth/authorization is enforced at the DB layer through RLS (`can_access_app(auth.uid())`) when the *frontend* queries tables directly. When you rebuild on Express, you must add your own auth middleware — the original functions assume "if you can call me, you're allowed."
- **CORS headers** (used by all functions):
  ```ts
  {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  }
  ```
- **HTTP method:** All functions are `POST` with a JSON body. They also handle `OPTIONS` preflight returning the CORS headers.
- **Streaming:** No function uses streaming. All Anthropic calls are non-streaming (`/v1/messages` with full JSON response).
- **Environment variables (shared):**
  - `ANTHROPIC_API_KEY` — Anthropic API key (used by all AI functions).
  - `ORIGINALITY_API_KEY` — actually a **GoWinston AI** key (kept under the legacy secret name). Used by `final-stitch` only.
  - `SUPABASE_URL` — base URL of the Supabase project.
  - `SUPABASE_SERVICE_ROLE_KEY` — service role key. Every function uses this to construct the admin Supabase client.
  - `SUPABASE_ANON_KEY` — present in env but **not used** by any function.
- **Models in use:**
  - `claude-sonnet-4-5-20250929` (Sonnet 4.5)
  - `claude-haiku-4-5-20251001` (Haiku 4.5)
  - Anthropic `web_search_20250305` server-side tool (used in `propose-brief` and several research stages).
- **Background execution:** `propose-brief`, `research-generate`, and `research-retry-card` use Supabase's `EdgeRuntime.waitUntil()` to keep work running after the HTTP response is sent (so long Anthropic calls don't hit the 150s edge idle timeout). On Express, replace with a job queue (BullMQ, pg-boss) or a long-lived worker process — do **not** simply `setImmediate` and return; you'll lose work on crash/restart and lose visibility.
- **Prompt caching:** All Anthropic calls use the `cache_control: { type: "ephemeral", ttl: "1h" }` system-block mechanism. The cached prefix is the routed playbook (and for `draft-section`, also a per-project context block). The cache key is implicitly `(model, exact bytes of cached blocks in order)`. Anthropic's own infra handles it; you just send the system blocks. If you switch providers, you lose this benefit and costs roughly 2-4x.
- **Usage logging:** Every Anthropic call writes a row to `usage_logs` via `_shared/usage.ts` → `logUsage()`. Pricing table is hardcoded in `_shared/usage.ts`. See "Shared modules" section below.
- **Anthropic metadata.user_id:** Every call sets `metadata.user_id = "${pod}__${stage}__${substage}__${writer_id}"` so calls are filterable in the Anthropic console. See `_shared/anthropicMeta.ts`.
- **Tool use pattern:** Anthropic responses are forced via `tool_choice: { type: "tool", name: "..." }`. The function then plucks `data.content.find(b => b.type === "tool_use").input` as the structured output. If `propose-brief`'s tool use is missing because the model refused or hit web_search limits, it throws.
- **Gotcha — `propose-brief` returns 202:** the only function that returns 202 (queued). All others return 200 on success / 500 on error.

---

# Shared modules (referenced by multiple functions)

These live under `supabase/functions/_shared/` and are imported by the functions below. Port them once into your Express server (e.g. `src/lib/`).

## `_shared/cors.ts`

```typescript
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};```

## `_shared/playbook.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** Fetch the latest playbook markdown. Returns empty string if none uploaded. */
export async function getActivePlaybook(supabase: ReturnType<typeof createClient>): Promise<{ content: string; version: number | null }> {
  const { data } = await supabase
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
  // Stage 1 sub-stages
  search_intent: [6, 11],
  benchmark_teardown: [7],
  competitor_teardown: [7],
  synergy_map: [11, 12],
  ai_citation_landscape: [9, 10],
  atomic_and_entities: [2, 10],
  angle_and_conversion: [5, 11],
  // Stage 0 — initial brief proposal (treat like final synthesis of stage 1)
  propose_brief: [2, 5, 6, 11],
  // Stage 2 outline
  outline: [2, 5, 6, 11],
  // Stage 3 drafting
  draft: [2, 10],
  // Interview mode
  interview: [2, 5],
  // Stage 4 synthesis
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

/** Map a substage to its cache group key (used in version tag). */
function cacheGroupFor(stage: RouteKey): string {
  if (STAGE1_SUBSTAGES.includes(stage)) return "stage1";
  return stage;
}

/** Get the section bundle for a cache group (superset for stage1). */
function sectionsForGroup(stage: RouteKey): number[] {
  if (STAGE1_SUBSTAGES.includes(stage)) {
    const union = new Set<number>();
    for (const s of STAGE1_SUBSTAGES) {
      for (const n of ROUTING_MAP[s]) union.add(n);
    }
    return Array.from(union);
  }
  return ROUTING_MAP[stage] || [];
}

/** Cheap token estimator: ~4 chars per token for English markdown. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Parse a playbook markdown document into numbered sections.
 * Recognises a flexible family of header styles to find section breaks:
 *   - "## 1. Title"               (markdown heading + number + period)
 *   - "## SECTION 1 — Title"      (em/en/hyphen dash, with optional SECTION prefix)
 *   - "## SECTION 1 | Title"      (pipe separator)
 *   - "1. Title" / "1) Title"     (plain numbered line)
 *   - "Section 1: Title"          (colon separator)
 *   - "## SECTION 6" alone, with the title on the NEXT non-empty line
 *     (common when designers split header across two lines)
 * Lines before the first detected section are dropped (preamble).
 */
export function parsePlaybookSections(markdown: string): PlaybookSection[] {
  if (!markdown || !markdown.trim()) return [];
  const lines = markdown.split(/\r?\n/);
  // Separator class: . ) : | — – -  (em dash, en dash, hyphen, plus traditional).
  // Two shapes:
  //   A) optional ##, optional SECTION, NUMBER, separator, TITLE on same line
  //   B) optional ##, SECTION NUMBER alone (title on a following line)
  // The negative lookahead `(?!\d)` after the separator prevents matching
  // sub-section headers like "### 1.2 Title" or decimals like "1.5 is..."
  // as if they were section #1.
  const sepClass = "[\\.\\)\\:\\|\\u2014\\u2013\\-]";
  const headerReSameLine = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?(?:section\\s+)?(\\d{1,2})\\s*${sepClass}(?!\\d)\\s*(.+?)\\s*$`,
    "i",
  );
  // SECTION prefix is REQUIRED for the title-on-next-line shape so we don't
  // match every "12" that happens to start a line.
  const headerReSplit = /^\s*(?:#{1,6}\s*)?section\s+(\d{1,2})\s*$/i;

  type Hit = { line: number; number: number; title: string };
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let num: number | null = null;
    let title = "";

    const mSame = line.match(headerReSameLine);
    if (mSame) {
      const n = parseInt(mSame[1], 10);
      const t = mSame[2].replace(/[*_`#]/g, "").trim();
      if (!Number.isNaN(n) && n >= 1 && n <= 30 && t.length > 0 && t.length <= 120) {
        num = n;
        title = t;
      }
    }

    if (num === null) {
      const mSplit = line.match(headerReSplit);
      if (mSplit) {
        const n = parseInt(mSplit[1], 10);
        if (!Number.isNaN(n) && n >= 1 && n <= 30) {
          // Look ahead for next non-empty line; strip leading ##/### markers.
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length) {
            const t = lines[j]
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
    // Fallback: single section containing the whole doc
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

  // Detect a preamble: the LAST non-numbered H2 (## ...) appearing before the
  // first numbered section, plus its body up to that section. This captures
  // a "HOW TO USE THIS PLAYBOOK" block while ignoring any document subtitle
  // / title-page H2 above it. The preamble becomes section_number = 0
  // ("Preamble") and is flagged always_include — operational meta-rules
  // ship with every routed bundle.
  const firstSectionLine = hits[0].line;
  const h2Re = /^\s*##\s+(?!#)(.+?)\s*$/;
  let preambleHeaderLine = -1;
  let preambleTitle = "";
  for (let i = 0; i < firstSectionLine; i++) {
    const m = lines[i].match(h2Re);
    if (!m) continue;
    // Skip if this line itself is a numbered-section header (defensive — it
    // would already have been caught above, but guards against weird edge
    // cases like "## 1 — Title" with leading whitespace differences).
    if (headerReSameLine.test(lines[i]) || headerReSplit.test(lines[i])) continue;
    preambleHeaderLine = i;
    preambleTitle = m[1].replace(/[*_`#]/g, "").trim();
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
        // Section 0 is human-maintenance docs, not AI context. Stored for
        // admin viewing/editing but excluded from prompts via NEVER_INCLUDE.
        always_include: false,
      });
    }
  }

  for (let h = 0; h < hits.length; h++) {
    const start = hits[h].line;
    const end = h + 1 < hits.length ? hits[h + 1].line : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    out.push({
      section_number: hits[h].number,
      section_title: hits[h].title,
      section_content: body,
      section_token_estimate: estimateTokens(body),
      always_include: ALWAYS_INCLUDE.includes(hits[h].number),
    });
  }
  // De-dupe by section_number, preferring the longest body (handles repeated TOC entries).
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
export async function getPlaybookSections(
  supabase: ReturnType<typeof createClient>,
): Promise<{ sections: PlaybookSection[]; version: number | null }> {
  // Latest version
  const { data: latest } = await supabase
    .from("playbook")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (latest as any)?.version ?? null;
  if (version === null) return { sections: [], version: null };

  const { data: rows } = await supabase
    .from("playbook_sections")
    .select("section_number, section_title, section_content, section_token_estimate, always_include")
    .eq("version", version)
    .order("section_number");
  const sections = ((rows as any[]) || []).map((r) => ({
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
 *
 * If sections haven't been parsed yet (e.g. older uploads), falls back to
 * the full markdown so behaviour is preserved.
 *
 * Returns a string ready to be wrapped by buildCachedSystem.
 */
export async function getRoutedPlaybook(
  supabase: ReturnType<typeof createClient>,
  stage: RouteKey,
): Promise<{ content: string; version: number | null; included: number[] }> {
  const { sections, version } = await getPlaybookSections(supabase);
  if (sections.length === 0) {
    // Fallback: full doc
    const full = await getActivePlaybook(supabase);
    return { content: full.content, version: full.version, included: [] };
  }

  const wanted = new Set<number>([...ALWAYS_INCLUDE, ...sectionsForGroup(stage)]);
  const picked = sections.filter(
    (s) =>
      !NEVER_INCLUDE.includes(s.section_number) &&
      (wanted.has(s.section_number) || s.always_include),
  );
  const ordered = picked.sort((a, b) => a.section_number - b.section_number);

  const body = ordered
    .map((s) => `## ${s.section_number}. ${s.section_title}\n\n${stripHeader(s.section_content)}`)
    .join("\n\n");

  return {
    content: body,
    version,
    included: ordered.map((s) => s.section_number),
  };
}

/** Drop a leading numbered header from a section body so we don't double-print it. */
function stripHeader(body: string): string {
  const lines = body.split(/\r?\n/);
  if (lines.length === 0) return body;
  // first non-empty line
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && /^\s*(?:#{1,6}\s*)?(?:section\s+)?\d{1,2}[\.\):]/i.test(lines[i])) {
    lines.splice(i, 1);
  }
  return lines.join("\n").trim();
}

/** Wrap playbook content into a system-prompt section. */
export function playbookBlock(content: string): string {
  if (!content || !content.trim()) {
    return "[No company playbook has been uploaded yet. Operate from generic best practices, but flag this gap in your output.]";
  }
  return `=== COMPANY PLAYBOOK (operating system — always honor) ===\n${content.trim()}\n=== END PLAYBOOK ===`;
}

/**
 * Build a structured Anthropic `system` array with the playbook as a cached
 * ephemeral block, followed by the stage-specific (non-cached) instructions.
 *
 * Caching is order-dependent: the cached block MUST come first. Bumping the
 * playbook version invalidates the cache automatically because the version
 * string is embedded at the top of the cached text. When `routeKey` is
 * provided, the cached block also includes the route key so different
 * stages keep distinct cache entries.
 */
export function buildCachedSystem(
  playbookContent: string,
  playbookVersion: number | null,
  stageInstructions: string,
  routeKey?: string,
): Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" } }> {
  // routeKey is collapsed to its cache group so all Stage 1 substages share
  // one cached prefix per model.
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
 * and a per-project context block (outline + brief + proofs). The second
 * cache breakpoint lets every section draft + every revision of the same
 * project hit the cache for the heavy shared context, while the per-section
 * stageInstructions stay uncached.
 *
 * The projectContext text MUST be deterministic for a given project state so
 * the cache key is stable across calls.
 */
export function buildCachedSystemWithProject(
  playbookContent: string,
  playbookVersion: number | null,
  projectContext: string,
  projectCacheTag: string,
  stageInstructions: string,
  routeKey?: string,
): Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" } }> {
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
  supabase: ReturnType<typeof createClient>,
  stage: RouteKey,
  projectContext: string,
  projectCacheTag: string,
  stageInstructions: string,
): Promise<{
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" } }>;
  version: number | null;
  included: number[];
}> {
  const routed = await getRoutedPlaybook(supabase, stage);
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
 * Convenience: fetch routed playbook + build the cached system array in one
 * call. Returns the array plus the included section numbers (for logging).
 */
export async function buildRoutedSystem(
  supabase: ReturnType<typeof createClient>,
  stage: RouteKey,
  stageInstructions: string,
): Promise<{
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" } }>;
  version: number | null;
  included: number[];
}> {
  const routed = await getRoutedPlaybook(supabase, stage);
  const system = buildCachedSystem(routed.content, routed.version, stageInstructions, stage);
  return { system, version: routed.version, included: routed.included };
}```

## `_shared/anthropicMeta.ts`

```typescript
/**
 * Builds the `metadata.user_id` string sent on every Anthropic call.
 *
 * Format: `${pod}__${stage}__${substage}__${writer_id}`
 *
 * This string is the only field Anthropic surfaces in Console > Logs,
 * so encode the calling feature inside it. The same string is also
 * persisted in `usage_logs.metadata_user_id` so our internal dashboard
 * and the Anthropic console agree.
 *
 * - Components are sanitized to `[a-z0-9_]` (lowercased, non-allowed chars
 *   become `_`) so the string is safe to filter on in the console.
 * - Missing components fall back to `unknown`.
 * - Result is capped at 256 chars (Anthropic's metadata.user_id limit).
 */
export function buildAnthropicUserId(parts: {
  pod?: string | null;
  stage: string;
  substage: string;
  writer_id?: string | null;
}): string {
  const norm = (s: string | null | undefined, fallback: string) => {
    const v = (s ?? "").toString().trim().toLowerCase();
    if (!v) return fallback;
    return v.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
  };
  const pod = norm(parts.pod, "admin");
  const stage = norm(parts.stage, "unknown");
  const substage = norm(parts.substage, "unknown");
  const writer = norm(parts.writer_id, "anon");
  const id = `${pod}__${stage}__${substage}__${writer}`;
  return id.length > 256 ? id.slice(0, 256) : id;
}

/** Convenience: build the full Anthropic metadata object. */
export function buildAnthropicMetadata(parts: {
  pod?: string | null;
  stage: string;
  substage: string;
  writer_id?: string | null;
}): { user_id: string } {
  return { user_id: buildAnthropicUserId(parts) };
}```

## `_shared/usage.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/**
 * Per-million-token pricing in USD. Update when Anthropic prices change.
 * Source: https://www.anthropic.com/pricing (Sonnet 4.5, Haiku 4.5).
 */
const PRICING: Record<string, { input: number; output: number; cache_write: number; cache_read: number }> = {
  // Sonnet 4.5
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.30 },
  // Haiku 4.5
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cache_write: 1.25, cache_read: 0.10 },
};

function priceFor(model: string) {
  return PRICING[model] || PRICING["claude-sonnet-4-5-20250929"];
}

export function estimateCost(model: string, usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): number {
  const p = priceFor(model);
  const cost =
    ((usage.input_tokens || 0) * p.input +
      (usage.output_tokens || 0) * p.output +
      (usage.cache_creation_input_tokens || 0) * p.cache_write +
      (usage.cache_read_input_tokens || 0) * p.cache_read) /
    1_000_000;
  return Number(cost.toFixed(6));
}

export async function logUsage(
  supabase: ReturnType<typeof createClient>,
  args: {
    project_id?: string | null;
    stage?: string | null;
    sub_stage?: string | null;
    model: string;
    metadata_user_id?: string | null;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    duration_ms?: number;
    ok?: boolean;
    error?: string | null;
  },
) {
  try {
    const u = args.usage || {};
    const cost = estimateCost(args.model, u);
    await supabase.from("usage_logs").insert({
      project_id: args.project_id || null,
      stage: args.stage || null,
      sub_stage: args.sub_stage || null,
      model: args.model,
      metadata_user_id: args.metadata_user_id || null,
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
      cache_read_input_tokens: u.cache_read_input_tokens || 0,
      estimated_cost_usd: cost,
      duration_ms: args.duration_ms ?? null,
      ok: args.ok !== false,
      error: args.error || null,
    });
  } catch (e) {
    console.warn("[usage] log failed:", e instanceof Error ? e.message : String(e));
  }
}```

## `_shared/researchStages.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildRoutedSystem } from "./playbook.ts";
import { logUsage } from "./usage.ts";
import { buildAnthropicUserId } from "./anthropicMeta.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-5-20250929";

/* ───────── URL fetch + cache (1h TTL) ───────── */

const ONE_HOUR_MS = 60 * 60 * 1000;

function stripHtml(html: string): { title: string; text: string } {
  let title = "";
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (m) title = m[1].trim();
  // remove script/style/nav/footer/svg
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // hard cap to keep prompts small
  if (cleaned.length > 18000) cleaned = cleaned.slice(0, 18000) + "…[truncated]";
  return { title, text: cleaned };
}

export async function getCachedPage(
  supabase: ReturnType<typeof createClient>,
  url: string,
): Promise<{ title: string; text: string } | null> {
  if (!url) return null;
  try {
    const { data: row } = await supabase
      .from("fetched_pages")
      .select("title, content, fetched_at")
      .eq("url", url)
      .maybeSingle();
    if (row && row.fetched_at && Date.now() - new Date(row.fetched_at as any).getTime() < ONE_HOUR_MS) {
      return { title: (row as any).title || "", text: (row as any).content || "" };
    }
    // fetch fresh
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    let html = "";
    try {
      const r = await fetch(url, {
        signal: ac.signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; ContentForgeBot/1.0)" },
      });
      if (r.ok) html = await r.text();
    } catch (e) {
      console.warn(`[fetch] failed ${url}: ${e}`);
    } finally {
      clearTimeout(t);
    }
    if (!html) return null;
    const parsed = stripHtml(html);
    await supabase.from("fetched_pages").upsert(
      {
        url,
        title: parsed.title,
        content: parsed.text,
        byte_size: parsed.text.length,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "url" } as any,
    );
    return parsed;
  } catch (e) {
    console.warn(`[cache] error for ${url}: ${e}`);
    return null;
  }
}

/* ───────── Anthropic call wrapper ───────── */

async function callAnthropic(args: {
  model: string;
  systemBlocks: any[];
  userText: string;
  tool: any;
  webSearchMaxUses?: number;
  timeoutMs: number;
  maxTokens?: number;
  metadataUserId?: string;
}): Promise<{ input: any; usage: any }> {
  const tools: any[] = [args.tool];
  if (args.webSearchMaxUses && args.webSearchMaxUses > 0) {
    tools.unshift({ type: "web_search_20250305", name: "web_search", max_uses: args.webSearchMaxUses });
  }
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), args.timeoutMs);
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: args.maxTokens ?? 4000,
        ...(args.metadataUserId ? { metadata: { user_id: args.metadataUserId } } : {}),
        system: args.systemBlocks,
        tools,
        tool_choice: { type: "tool", name: args.tool.name },
        messages: [{ role: "user", content: args.userText }],
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${txt.slice(0, 400)}`);
    }
    const data = await resp.json();
    const tu = (data.content || []).find((b: any) => b.type === "tool_use" && b.name === args.tool.name);
    if (!tu) {
      const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      throw new Error(`No tool_use returned. Raw: ${text.slice(0, 300)}`);
    }
    return { input: tu.input, usage: data.usage || {} };
  } finally {
    clearTimeout(to);
  }
}

/* ───────── Per-stage tool schemas ───────── */

const TOOLS = {
  search_intent: {
    name: "submit_search_intent",
    description: "Return search intent + keyword cluster facts.",
    input_schema: {
      type: "object",
      properties: {
        reader_goal: { type: "string" },
        awareness_stage: { type: "string" },
        required_belief: { type: "string" },
        notes: { type: "string" },
      },
      required: ["reader_goal", "awareness_stage", "required_belief"],
    },
  },
  benchmark_teardown: {
    name: "submit_benchmark_teardown",
    description: "Teardown of benchmark blog.",
    input_schema: {
      type: "object",
      properties: {
        opening_hook: { type: "string" },
        voice_signature: { type: "string" },
        structural_moves: { type: "array", items: { type: "string" } },
        proof_techniques: { type: "array", items: { type: "string" } },
        three_things_to_steal: { type: "array", items: { type: "string" } },
        two_things_to_skip: { type: "array", items: { type: "string" } },
        cited_passages: { type: "array", items: { type: "string" } },
      },
      required: ["opening_hook", "voice_signature"],
    },
  },
  competitor_teardown: {
    name: "submit_competitor_teardown",
    description: "Teardown of competitor service page.",
    input_schema: {
      type: "object",
      properties: {
        hero_claim: { type: "string" },
        trust_signals: { type: "array", items: { type: "string" } },
        architecture: { type: "array", items: { type: "string" } },
        pricing_transparency: { type: "string" },
        cta_strategy: { type: "string" },
        seo_moves: { type: "array", items: { type: "string" } },
        what_they_do_well: { type: "array", items: { type: "string" } },
        whats_exploitable: { type: "array", items: { type: "string" } },
      },
      required: ["hero_claim"],
    },
  },
  synergy_map: {
    name: "submit_synergy_map",
    description: "Synergy map vs company domain.",
    input_schema: {
      type: "object",
      properties: {
        existing_assets: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, url: { type: "string" }, why: { type: "string" } },
            required: ["title"],
          },
        },
        proprietary_data_points: { type: "array", items: { type: "string" } },
        leadership_pov: { type: "array", items: { type: "string" } },
        voice_patterns: { type: "array", items: { type: "string" } },
        ownable_angle: { type: "string" },
      },
      required: ["ownable_angle"],
    },
  },
  angle_and_conversion: {
    name: "submit_angle_and_conversion",
    description: "Angle inventory + conversion signal map + proof points.",
    input_schema: {
      type: "object",
      properties: {
        angle_inventory: {
          type: "object",
          properties: {
            overdone: { type: "array", items: { type: "string" } },
            open_territory: { type: "array", items: { type: "string" } },
            avoid_entirely: { type: "array", items: { type: "string" } },
          },
          required: ["overdone", "open_territory"],
        },
        conversion_signals: {
          type: "object",
          properties: {
            act_triggers: { type: "string" },
            required_belief: { type: "string" },
            mid_cta: { type: "string" },
            closing_cta: { type: "string" },
            discard_list: { type: "array", items: { type: "string" } },
          },
        },
        proof_points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string" },
              source_url: { type: "string" },
              source_publication: { type: "string" },
              publication_date: { type: "string" },
              verification_status: { type: "string", enum: ["verified", "unverified", "needs writer confirmation"] },
            },
            required: ["claim", "verification_status"],
          },
        },
      },
      required: ["angle_inventory", "conversion_signals", "proof_points"],
    },
  },
  ai_citation_landscape: {
    name: "submit_ai_citation_landscape",
    description: "How this topic surfaces in AI search.",
    input_schema: {
      type: "object",
      properties: {
        sample_buyer_prompts: { type: "array", items: { type: "string" } },
        top_cited_sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              publisher: { type: "string" },
              kind: { type: "string", enum: ["competitor", "aggregator", "authority", "owned_media", "other"] },
              why_cited: { type: "string" },
            },
            required: ["url", "publisher", "kind", "why_cited"],
          },
        },
        citation_gaps: { type: "array", items: { type: "string" } },
        suggested_authority_sources: {
          type: "array",
          items: {
            type: "object",
            properties: { publisher: { type: "string" }, url_or_topic: { type: "string" }, why: { type: "string" } },
            required: ["publisher", "why"],
          },
        },
      },
      required: ["sample_buyer_prompts", "citation_gaps"],
    },
  },
  atomic_and_entities: {
    name: "submit_atomic_and_entities",
    description: "Atomic question map + entity/data density requirements.",
    input_schema: {
      type: "object",
      properties: {
        atomic_question_map: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              liftable_paragraph: { type: "boolean" },
              suggested_location: { type: "string" },
              requires_citation: { type: "boolean" },
            },
            required: ["question", "liftable_paragraph", "suggested_location", "requires_citation"],
          },
        },
        entity_data_requirements: {
          type: "object",
          properties: {
            minimum_named_entities: {
              type: "object",
              properties: {
                clients: { type: "number" },
                dollar_amounts: { type: "number" },
                dates: { type: "number" },
                locations: { type: "number" },
                named_processes: { type: "number" },
                named_people: { type: "number" },
              },
            },
            required_authority_citations: { type: "number" },
            recommended_schema_types: {
              type: "array",
              items: {
                type: "string",
                enum: ["FAQPage", "HowTo", "Article", "BlogPosting", "LocalBusiness", "Organization", "Product", "Review"],
              },
            },
            originality_threshold: { type: "number" },
          },
        },
      },
      required: ["atomic_question_map", "entity_data_requirements"],
    },
  },
};

/* ───────── Stage runners ───────── */

export type StageKey =
  | "search_intent"
  | "benchmark_teardown"
  | "competitor_teardown"
  | "synergy_map"
  | "angle_and_conversion"
  | "ai_citation_landscape"
  | "atomic_and_entities";

export const STAGE_KEYS: StageKey[] = [
  "search_intent",
  "benchmark_teardown",
  "competitor_teardown",
  "synergy_map",
  "angle_and_conversion",
  "ai_citation_landscape",
  "atomic_and_entities",
];

export const STAGE_LABELS: Record<StageKey, string> = {
  search_intent: "Search intent + keyword cluster",
  benchmark_teardown: "Benchmark blog teardown",
  competitor_teardown: "Competitor page teardown",
  synergy_map: "Company synergy map",
  angle_and_conversion: "Angle inventory + proof points",
  ai_citation_landscape: "AI citation landscape",
  atomic_and_entities: "Atomic questions + entity density",
};

const STAGE_MODEL: Record<StageKey, string> = {
  search_intent: HAIKU,
  atomic_and_entities: HAIKU,
  benchmark_teardown: HAIKU,
  competitor_teardown: HAIKU,
  synergy_map: SONNET,
  ai_citation_landscape: SONNET,
  angle_and_conversion: SONNET,
};

const STAGE_TIMEOUT_MS: Record<StageKey, number> = {
  search_intent: 30_000,
  atomic_and_entities: 30_000,
  benchmark_teardown: 60_000,
  competitor_teardown: 60_000,
  synergy_map: 60_000,
  ai_citation_landscape: 60_000,
  angle_and_conversion: 60_000,
};

const STAGE_WEB_SEARCH: Record<StageKey, number> = {
  search_intent: 3,
  benchmark_teardown: 0, // we pre-fetch
  competitor_teardown: 0, // we pre-fetch
  synergy_map: 0, // we pre-fetch + can search if needed
  ai_citation_landscape: 3,
  angle_and_conversion: 3,
  atomic_and_entities: 0,
};

function projectContext(project: any): string {
  return `Project context:
- Topic: ${project.topic}
- Content type: ${project.content_type}
- Target ICPs: ${(project.icps || []).join(", ") || "(none)"}
- Funnel stage: ${project.funnel_stage || "(unspecified)"}
- Primary keyword: ${project.keyword || "(none)"}
- Benchmark URL: ${project.benchmark_url || "(none)"}
- Competitor URL: ${project.competitor_url || "(none)"}
- Company domain: ${project.company_domain}
- User notes: ${project.user_notes || "(none)"}`;
}

const COMMON_SEARCH_RULE =
  "HARD LIMIT: 3 web_search calls maximum. After 3 searches you MUST stop searching and call the submission tool with whatever you have. Prefer one authoritative source over multiple searches for the same fact.";

function pageBlock(label: string, page: { title: string; text: string } | null): string {
  if (!page) return `${label}: (could not fetch — work from URL alone)`;
  return `${label} (pre-fetched, title="${page.title}"):\n${page.text}`;
}

function buildStageInstructions(stage: StageKey, project: any, pages: {
  benchmark: { title: string; text: string } | null;
  competitor: { title: string; text: string } | null;
  company: { title: string; text: string } | null;
}): string {
  const ctx = projectContext(project);
  switch (stage) {
    case "search_intent":
      return `${ctx}

Determine the SEARCH INTENT for this piece. Identify the reader_goal (what the searcher is trying to do), awareness_stage (problem-aware / solution-aware / vendor-aware), and required_belief (what they must believe by the end). Be concrete and specific to this keyword and ICP. ${COMMON_SEARCH_RULE} Call submit_search_intent.`;

    case "benchmark_teardown":
      return `${ctx}

${pageBlock("BENCHMARK PAGE CONTENT", pages.benchmark)}

Tear down the benchmark blog above. Identify opening_hook, voice_signature, structural_moves, proof_techniques, 3 things_to_steal, 2 things_to_skip, and notable cited_passages. Work primarily from the pre-fetched content; only web_search if it is missing. Call submit_benchmark_teardown.`;

    case "competitor_teardown":
      return `${ctx}

${pageBlock("COMPETITOR PAGE CONTENT", pages.competitor)}

Tear down the competitor service/landing page above. Identify hero_claim, trust_signals, architecture (page sections in order), pricing_transparency, cta_strategy, seo_moves, what_they_do_well, and what's exploitable for ${project.company_domain}. Work primarily from the pre-fetched content. Call submit_competitor_teardown.`;

    case "synergy_map":
      return `${ctx}

${pageBlock("COMPANY HOMEPAGE CONTENT", pages.company)}

Build a synergy map for ${project.company_domain}. Identify existing_assets (real URLs on this domain that the new piece can link to), proprietary_data_points the company can mention, leadership_pov themes, voice_patterns, and the ownable_angle this article should claim. ${COMMON_SEARCH_RULE} Call submit_synergy_map.`;

    case "angle_and_conversion":
      return `${ctx}

Produce angle_inventory (overdone / open_territory / avoid_entirely angles for this topic), conversion_signals (act_triggers, required_belief, mid_cta, closing_cta, discard_list of clichés to avoid), and 6-12 proof_points with source_url, publication, publication_date, and verification_status. Never fabricate sources — mark unverifiable claims as 'needs writer confirmation'. Authority publishers preferred: Statista, Pew, Gartner, Forrester, McKinsey, BLS, Census, peer-reviewed, named industry sources. Avoid Wikipedia and AI-generated content. ${COMMON_SEARCH_RULE} Call submit_angle_and_conversion.`;

    case "ai_citation_landscape":
      return `${ctx}

Map the AI citation landscape for this topic. Run web searches that mimic real buyer prompts an ICP would type into ChatGPT/Claude/Perplexity/Gemini (e.g. "best X for Y", "X vs Y", "how much does X cost"). Identify sample_buyer_prompts (4-8), top_cited_sources currently surfaced (each MUST include the exact url you saw in the search results — never invent or guess URLs; if you cannot cite a real URL for a source, omit that source entirely), citation_gaps where ${project.company_domain} can insert proprietary data, and suggested_authority_sources (for these, url_or_topic may be a topic string like "Statista report on X" if no canonical URL exists). ${COMMON_SEARCH_RULE} Call submit_ai_citation_landscape.`;

    case "atomic_and_entities":
      return `${ctx}

Produce two things: (1) atomic_question_map of 8-15 atomic, liftable buyer questions this article must answer as standalone citation-ready paragraphs, each with suggested_location and requires_citation flag; (2) entity_data_requirements specifying minimum_named_entities (clients, dollar_amounts, dates, locations, named_processes, named_people), required_authority_citations, recommended_schema_types (JSON-LD), and originality_threshold (proprietary data points absent from top-10 SERP). Call submit_atomic_and_entities.`;
  }
}

export async function runStage(args: {
  supabase: ReturnType<typeof createClient>;
  project: any;
  stage: StageKey;
  pages: {
    benchmark: { title: string; text: string } | null;
    competitor: { title: string; text: string } | null;
    company: { title: string; text: string } | null;
  };
}): Promise<{ ok: boolean; output?: any; error?: string }> {
  const { supabase, project, stage, pages } = args;

  // mark running
  await mergeSubStatus(supabase, project.id, { [stage]: { status: "running", error: null, updated_at: new Date().toISOString() } });

  const instructions = buildStageInstructions(stage, project, pages);
  const { system: systemBlocks, included } = await buildRoutedSystem(supabase, stage, instructions);
  console.log(`[stage:${stage}] routed playbook sections: [${included.join(",")}]`);

  const metadataUserId = buildAnthropicUserId({
    pod: project.pod,
    stage: "stage1",
    substage: stage,
    writer_id: project.writer_id,
  });

  try {
    const t0 = Date.now();
    const { input: output, usage } = await callAnthropic({
      model: STAGE_MODEL[stage],
      systemBlocks,
      userText: `Run the ${stage.replace(/_/g, " ")} task and call the tool.`,
      tool: (TOOLS as any)[stage],
      webSearchMaxUses: STAGE_WEB_SEARCH[stage],
      timeoutMs: STAGE_TIMEOUT_MS[stage],
      maxTokens: 4000,
      metadataUserId,
    });
    await logUsage(supabase, {
      project_id: project.id,
      stage: "research",
      sub_stage: stage,
      model: STAGE_MODEL[stage],
      metadata_user_id: metadataUserId,
      usage,
      duration_ms: Date.now() - t0,
      ok: true,
    });

    // persist stage column(s)
    const patch: any = {};
    if (stage === "search_intent") patch.search_intent = output;
    else if (stage === "benchmark_teardown") patch.benchmark_teardown = output;
    else if (stage === "competitor_teardown") patch.competitor_teardown = output;
    else if (stage === "synergy_map") patch.synergy_map = output;
    else if (stage === "ai_citation_landscape") patch.ai_citation_landscape = output;
    else if (stage === "atomic_and_entities") {
      patch.atomic_question_map = output.atomic_question_map || [];
      patch.entity_data_requirements = output.entity_data_requirements || {};
    } else if (stage === "angle_and_conversion") {
      patch.angle_inventory = output.angle_inventory || {};
      patch.conversion_signals = output.conversion_signals || {};
      // proof points
      const rows = (output.proof_points || []).map((p: any) => ({
        project_id: project.id,
        claim: p.claim,
        source_url: p.source_url || null,
        source_publication: p.source_publication || null,
        publication_date: p.publication_date || null,
        verification_status: p.verification_status || "unverified",
      }));
      await supabase.from("proof_points").delete().eq("project_id", project.id);
      if (rows.length) await supabase.from("proof_points").insert(rows);
      patch.proof_points_status = "done";
    }

    await supabase.from("research_briefs").update(patch).eq("project_id", project.id);
    await mergeSubStatus(supabase, project.id, { [stage]: { status: "done", error: null, updated_at: new Date().toISOString() } });
    return { ok: true, output };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[stage:${stage}] error: ${msg}`);
    await logUsage(supabase, {
      project_id: project.id,
      stage: "research",
      sub_stage: stage,
      model: STAGE_MODEL[stage],
      metadata_user_id: metadataUserId,
      ok: false,
      error: msg.slice(0, 300),
    });
    await mergeSubStatus(supabase, project.id, { [stage]: { status: "error", error: msg.slice(0, 300), updated_at: new Date().toISOString() } });
    if (stage === "angle_and_conversion") {
      await supabase.from("research_briefs").update({ proof_points_status: "error" }).eq("project_id", project.id);
    }
    return { ok: false, error: msg };
  }
}

async function mergeSubStatus(
  supabase: ReturnType<typeof createClient>,
  project_id: string,
  patch: Record<string, any>,
) {
  // read-modify-write; not perfect under high contention but parallel writes
  // here are bounded (7 stages, each writes once to its own key).
  const { data } = await supabase
    .from("research_briefs")
    .select("sub_status")
    .eq("project_id", project_id)
    .maybeSingle();
  const current = ((data as any)?.sub_status as Record<string, any>) || {};
  const next = { ...current, ...patch };
  await supabase.from("research_briefs").update({ sub_status: next }).eq("project_id", project_id);
}

export async function prefetchPages(
  supabase: ReturnType<typeof createClient>,
  project: any,
) {
  const companyUrl = project.company_domain
    ? (project.company_domain.startsWith("http") ? project.company_domain : `https://${project.company_domain}`)
    : "";
  const [benchmark, competitor, company] = await Promise.all([
    project.benchmark_url ? getCachedPage(supabase, project.benchmark_url) : Promise.resolve(null),
    project.competitor_url ? getCachedPage(supabase, project.competitor_url) : Promise.resolve(null),
    companyUrl ? getCachedPage(supabase, companyUrl) : Promise.resolve(null),
  ]);
  return { benchmark, competitor, company };
}```

---

# Function: `propose-brief`

**File path:** `supabase/functions/propose-brief/index.ts`

### Request contract
- **Method:** `POST`
- **Body:** `{ project_id: string (uuid) }`
- **Headers:** `content-type: application/json`. (No auth check inside the function — frontend includes its Supabase session JWT but it's ignored.)
- **No URL params or query strings.**

### Response contract
- **Success (202 Accepted):** `{ ok: true, status: "queued" }` — work continues in the background and writes results to `projects.ai_proposed_brief`. Frontend subscribes to realtime updates on the `projects` row to detect completion.
- **Error (400):** `{ error: string }` — when topic is empty or > 200 chars.
- **Error (500):** `{ error: string }` — when the project isn't found or env is missing. The background phase writes errors back to `projects.brief_error` and sets `status = 'brief_failed'` rather than returning HTTP errors (since the response has already been sent).

### Frontend call sites
- `src/pages/NewProject.tsx:76` — fired once after the user creates a project.
- `src/pages/BriefProposal.tsx:102` — manual retry.
- `src/pages/BriefProposal.tsx:160` — re-propose.

### Environment variables
- `ANTHROPIC_API_KEY` — Anthropic.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — admin DB client.

### External API calls
- **Anthropic** — `POST https://api.anthropic.com/v1/messages`
  - Model: `claude-sonnet-4-5-20250929`
  - `max_tokens: 8000`, no `temperature` set (Anthropic default = 1.0).
  - Tools: server-side `web_search_20250305` (`max_uses: 3`) + custom tool `submit_brief_proposal` (full JSON schema in source).
  - `tool_choice: { type: "auto" }` — model decides when to search vs submit.
  - Streaming: **no**.
  - System prompt: routed playbook bundle for `propose_brief` route key (sections 1, 2, 3, 5, 6, 8, 11) + the stage instructions (verbatim in source). Cached via `cache_control: ephemeral, ttl 1h`.
  - User message (verbatim): `"HARD LIMIT: 3 web_search calls maximum across this entire task. Use them strategically (one for keyword/SERP, one for benchmark discovery, one for competitor discovery). After 3 searches you MUST synthesize and call submit_brief_proposal with whatever you have. Do not exceed 3 searches."`
  - Up to 3 retries on 5xx/429 with linear backoff (1.5s × attempt). 290s `AbortController` per attempt.

### Database reads/writes (service_role — bypasses RLS)
- READ: `projects` (full row by id), `playbook` + `playbook_sections` (latest version, via `_shared/playbook.ts`).
- WRITE: `projects.status = 'brief_proposing'` (synchronously before returning); then in background sets `ai_proposed_brief`, `keyword_cluster`, `keyword`, `funnel_stage`, `icps`, `pod`, `benchmark_url`, `competitor_url`, `content_type`, `mode`, `playbook_version`, `status = 'brief_proposed'`. On failure: `status = 'brief_failed'`, `brief_error`.
- WRITE: `usage_logs` (one row).

### Auth
- No in-function auth check. Function trusts the caller. Frontend RLS gates project access via `can_access_app(auth.uid())` before invocation.

### Gotchas
- Returns **202** while work continues in background via `EdgeRuntime.waitUntil`. Frontend polls/subscribes to `projects.status` and `projects.ai_proposed_brief`.
- Topic length cap (200 chars) is re-validated server-side because HTML maxLength is bypassable.
- 3 web_search hard cap is both a prompt instruction *and* enforced via `max_uses: 3` on the tool.
- Total per-call budget can exceed 8000 output tokens because `web_search` server-tool tokens count against `input_tokens` separately.

---

# Function: `research-generate`

**File path:** `supabase/functions/research-generate/index.ts`

### Request contract
- **Method:** `POST`
- **Body:** `{ project_id: string }`

### Response contract
- **Success (200):** `{ ok: true, started: string[] }` — array of stage keys queued.
- **Error (500):** `{ error: string }`.

### Frontend call sites
- `src/pages/ResearchDashboard.tsx:95` — kicks off Stage 1 research.
- `src/pages/BriefProposal.tsx:231` — auto-runs after brief approval.

### Environment variables
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- (Indirectly: `ANTHROPIC_API_KEY` via `_shared/researchStages.ts`.)

### External API calls
- Indirect — fans out 7 parallel calls to Anthropic via `runStage()` in `_shared/researchStages.ts`. See "Shared modules" for full per-stage prompts, tool schemas, models (mix of Haiku/Sonnet), timeouts, and `web_search` allotments.

### Database reads/writes
- READ: `projects` (full row), `fetched_pages` (URL cache, 1h TTL — via `getCachedPage` in researchStages.ts), `playbook`/`playbook_sections`.
- WRITE: `research_briefs` (init row with `sub_status` set to "pending" for every stage; clears all stage output columns); `fetched_pages` upsert on cache miss; per-stage writes to `research_briefs.{search_intent, benchmark_teardown, competitor_teardown, synergy_map, ai_citation_landscape, atomic_question_map, entity_data_requirements, angle_inventory, conversion_signals}` and `proof_points` (delete-then-insert per project for the angle_and_conversion stage); `projects.status = 'research_ready' | 'research_partial'` at the end; `usage_logs` × 7.

### Auth
- No in-function check.

### Gotchas
- Pre-fetches benchmark/competitor/company HTML once (cached) and shares across all 7 stages so they don't each refetch.
- Uses `Promise.allSettled` — partial success is acceptable; the function still resolves.
- All 7 stages run **in parallel** in the background after the response returns. If you rebuild on Express without a real queue, you must keep the worker alive and bound concurrency (Anthropic rate limits).
- `mergeSubStatus` is a read-modify-write race condition under load. With 7 parallel stages each writing once it usually works, but if you scale further use a JSONB merge expression server-side instead.

---

# Function: `research-retry-card`

**File path:** `supabase/functions/research-retry-card/index.ts`

### Request contract
- **Method:** `POST`
- **Body:** `{ project_id: string, stage: StageKey }` where StageKey ∈ `["search_intent","benchmark_teardown","competitor_teardown","synergy_map","angle_and_conversion","ai_citation_landscape","atomic_and_entities"]`.

### Response contract
- **Success (200):** `{ ok: true, stage }`.
- **Error (500):** `{ error: string }`.

### Frontend call sites
- `src/pages/ResearchDashboard.tsx:167` — per-card "retry" button.

### Environment / external APIs / DB / auth
- Same as `research-generate` but runs exactly one stage. Pre-fetches pages first.

### Gotchas
- Backgrounded via `EdgeRuntime.waitUntil`. Returns immediately. Frontend watches `research_briefs.sub_status[stage]`.

---

# Function: `outline-generate`

**File path:** `supabase/functions/outline-generate/index.ts`

### Request contract
- **Method:** `POST`
- **Body:** `{ project_id: string }`

### Response contract
- **Success (200):** `{ ok: true, outline: <submit_outline tool input> }`. Persisted in `outlines` table.
- **Error (500):** `{ error: string }`.

### Frontend call sites
- `src/pages/ResearchDashboard.tsx:109` — clicked after research is approved.

### Environment variables
- `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### External API calls
- **Anthropic** — `POST /v1/messages`
  - Model: `claude-sonnet-4-5-20250929`
  - `max_tokens: 4000`. No temperature set.
  - Tool: `submit_outline` (full JSON schema in source) with forced `tool_choice`.
  - System: routed playbook for `outline` route (sections 1, 2, 3, 5, 6, 8, 11) cached for 1h + the stage instructions string in source.
  - User prompt (verbatim — variables interpolated from project + brief + starred proof points). The prompt body starts with `"Build an outline for a ${project.content_type} on \"${project.topic}\" (${project.funnel_stage}, keyword: ${project.keyword}).\\n\\nApproved research:\\n${JSON.stringify(brief, null, 2).slice(0, 8000)}\\n\\nStarred proof points:\\n${JSON.stringify(proofs || [], null, 2).slice(0, 4000)}\\n\\nProduce 6-9 sections..."` — see source for the full text.
  - Streaming: no.

### Database reads/writes
- READ: `projects`, `research_briefs`, `proof_points` (starred only), `playbook*`.
- WRITE: `outlines` (upsert on `project_id`), `projects.current_stage = 2, status = 'outlining'`, `usage_logs`.

### Auth
- No in-function check.

### Gotchas
- The user-message prompt JSON-stringifies `brief` and clamps to 8000 chars and proofs to 4000 chars. If briefs grow, content gets silently truncated.
- Outline must distribute every atomic question with `liftable_paragraph=true` across sections — this is enforced by prompt only, not by code.

---

# Function: `draft-section`

**File path:** `supabase/functions/draft-section/index.ts`

### Request contract
- **Method:** `POST`
- **Body:** `{ project_id: string, section_id: string, revision_instruction?: string }`
  - When `revision_instruction` is present, the function operates in **revise** mode against the existing draft for that section.
  - Otherwise it drafts the section from scratch.

### Response contract
- **Success (200):** `{ ok: true, draft: { ...submit_draft_input, ...submit_review_input } }` — merged draft + review-pass output.
- **Error (500):** `{ error: string }`.

### Frontend call sites
- `src/pages/DraftingInterface.tsx:135` — initial draft for a section.
- `src/pages/DraftingInterface.tsx:440` — revision (passes `revision_instruction`).
- (Inline-prose-editing toolbar also routes through `DraftingInterface`'s revision path.)

### Environment variables
- `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### External API calls
**Two Anthropic calls per invocation** (draft + review pass):

1. **Drafting call**
   - Model: `claude-sonnet-4-5-20250929`
   - `max_tokens: 4000`. No temperature.
   - Tool: `submit_draft` (forced).
   - System: 3 cached blocks via `buildRoutedSystemWithProject`:
     1. Routed playbook for `draft` route (sections 1, 2, 3, 8, 10) — 1h cache.
     2. Per-project context block (verbatim template in source, lines 219-247) — 1h cache, keyed by `project:${id}|outline:${updated_at}|brief:${updated_at}|proofs:${count}`.
     3. Per-section instructions (verbatim templates in source) — uncached. Two variants: revise mode (lines 253-272) and fresh-draft mode (lines 273-298).
   - User message: `"Revise per the instruction above. Call submit_draft."` OR `"Draft this section now. Call submit_draft."`.
   - Streaming: no.

2. **Review pass** (Haiku critic, runs in parallel with DB write)
   - Model: `claude-haiku-4-5-20251001`
   - `max_tokens: 1500`. No temperature.
   - Tool: `submit_review` (forced).
   - System prompt (verbatim, lines 470-476): `"You are a strict editorial critic. Read the draft section and score it. Return:\\n- review_questions: exactly 3 (one factual, one detail, one structural)\\n- voice_flags: phrases that sound generic or off-brand, with alternatives\\n- voice_match_score: 0-100\\n- entity_density_score: 0-100 (% of required_entities actually present)\\n- ai_citation_readiness_score: 0-100 composite\\n- ai_citation_flags: gaps in entities, citations, atomic chunks, or schema"`
   - User prompt (verbatim — see lines 478-493) interpolates section heading, required entities, required citations, atomic questions, and the just-generated draft content.

### Citation whitelisting (post-processing, server-side)
- Builds a host whitelist from `proof_points.source_url` + `ai_citation_landscape.top_cited_sources` + `ai_citation_landscape.suggested_authority_sources` + `projects.company_domain`.
- **Strips** any inline `[label](url)` whose host isn't on the whitelist (keeps the label text, drops the URL). This is the server-side floor — UI also validates.
- `citation_count` stored is the **post-strip** count of unique URLs (regex `/\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g`, dedup by URL).

### Database reads/writes
- READ: `projects`, `outlines`, `proof_points` (starred only), `research_briefs` (specific JSONB columns), `drafts` (existing for this section).
- WRITE: `drafts` upsert (composite key `project_id,section_id`); preserves `approved` flag across revisions; `voice_library` insert when in revision mode (stores original AI text → human-edited text); `projects.current_stage = 3, status = 'drafting'`; `usage_logs` × 2.

### Auth
- No in-function check.

### Gotchas
- **Two Anthropic calls per request** — costs add up. Haiku review costs ~10x less than re-asking Sonnet, hence the split.
- The `approved` field of an existing draft is intentionally preserved on revision so revising doesn't silently un-approve the section (otherwise the "ready to stitch" gate never opens).
- Citation count drift was a real bug — single source-of-truth regex is documented at the top of the file. Use the same regex on the frontend.
- Per-project cached context block dramatically reduces token cost for sequential sections of the same article (typically 6-9 sections + revisions all hit the same cached prefix within 1h).

---

# Function: `interview-step`

**File path:** `supabase/functions/interview-step/index.ts`

### Request contract
- **Method:** `POST`
- **Body:** `{ project_id: string, section_id: string, last_answer?: string }`

### Response contract
- **Success (200):** `{ reaction: string, next_question: string }` — both extracted from the model's plain-text response via regex.
- **Error (500):** `{ error: string }`.

### Frontend call sites
- `src/pages/DraftingInterface.tsx:1032` — interview-mode UX. NOTE: per `mem/constraints/interview-mode-hidden.md` the interview UI is currently hidden, but the function is still wired up.

### Environment variables
- `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### External API call
- Anthropic — `POST /v1/messages`
  - Model: `claude-sonnet-4-5-20250929`
  - `max_tokens: 800`. No temperature.
  - **No tool** — returns plain text. Function parses `REACTION:` and `NEXT_QUESTION:` markers via regex.
  - System: routed playbook for `interview` route (sections 1, 2, 3, 5, 8) cached + interview instructions (verbatim, line 23): `` `You are interviewing the writer to extract their voice and POV for the section "${section?.heading}" (job: ${section?.job}) of "${outline?.h1}". Ask ONE question at a time. Reactive, conversational. Build on prior answers. Use playbook ICP/voice context to ask sharper questions.` ``
  - User message (verbatim): `` `Prior Q&A:\n${prior.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n')}\n\nLast answer from writer: ${last_answer || "(none yet — ask the first question)"}\n\nReact briefly (1 sentence) to the last answer, then ask the next question. Return only:\nREACTION: ...\nNEXT_QUESTION: ...` ``
  - Streaming: no.

### Database reads/writes
- READ: `projects`, `outlines`, `interview_answers` (ordered by created_at).
- WRITE: `usage_logs` only. **Does NOT persist the new question or the user's last answer** — caller is responsible for inserting into `interview_answers`.

### Auth
- No in-function check.

### Gotchas
- Output parsing is regex-based; if the model deviates from the format, `next_question` falls back to `"Tell me more."` and `reaction` becomes empty string. Brittle.

---

# Function: `final-stitch`

**File path:** `supabase/functions/final-stitch/index.ts`

### Request contract
- **Method:** `POST`
- **Body:** `{ project_id: string }`

### Response contract
- **Success (200):** `{ ok: true, word_count, voice_match_score, originality_score, banned_phrase_count, citation_completeness, ai_citation_readiness_score, atomic_chunks_count, atomic_questions_count, schema_markup_recommendations }`.
- **Error (500):** `{ error: string }`.

### Frontend call sites
- `src/pages/DraftingInterface.tsx:395` — primary "Finalize" button.
- `src/pages/DraftReview.tsx:129` — re-stitch.

### Environment variables
- `ANTHROPIC_API_KEY` (declared but **not used in this function** — leftover).
- `ORIGINALITY_API_KEY` — actually a **GoWinston AI** API key (the secret name is legacy; comment in source confirms this).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### External API call
- **GoWinston AI** — `POST https://api.gowinston.ai/v2/ai-content-detection`
  - Headers: `Authorization: Bearer ${GOWINSTON_API_KEY}`, `Content-Type: application/json`.
  - Body: `{ text: stitched.slice(0, 30000), sentences: false, language: "en" }`.
  - Best-effort, non-blocking (failures logged, `originality_score` set to null).
  - Returns `{ score: 0-100 (human likelihood) }` — stored as `originality_score`.

No Anthropic calls here. This function is pure aggregation.

### Database reads/writes
- READ: `outlines` (sections order), `drafts` (all for project), `research_briefs` (atomic_question_map, entity_data_requirements, ai_citation_landscape).
- WRITE: `draft_scores` upsert (`project_id` conflict). Fields: voice_match_score (avg), originality_score, banned_phrase_count, word_count, citation_completeness, final_draft (full stitched markdown), ai_citation_readiness_score (avg), atomic_chunks_count (sum), atomic_questions_count, schema_markup_recommendations (deduped by type).
- WRITE: `projects.current_stage = 4, status = 'review'`.

### Auth
- No in-function check.

### Gotchas
- Banned phrase list is hardcoded in source (lines 11): `["in today's fast-paced world", "in conclusion", "leverage", "synergy", "delve", "navigate the landscape", "game-changer", "unlock the power"]`.
- Schema dedup keeps the **first** JSON-LD seen per `@type`. If two sections produce different FAQPage objects, only the first wins.
- Adds a fallback `BlogPosting` JSON-LD if no schema was emitted by any section.
- Citation completeness = `% of sections with citation_count > 0` (binary per section, not weighted by citation density).
- GoWinston is silently skipped if the API key is missing — no error surfaced.

---

# Function: `playbook-upload`

**File path:** `supabase/functions/playbook-upload/index.ts`

### Request contract
- **Method:** `POST`
- **Body:** `{ filename: string, mime_type: string, content_base64: string, uploaded_by?: string }`

### Response contract
- **Success (200):** `{ ok: true, playbook: <row>, sections_count: number }`.
- **Error (500):** `{ error: string }`.

### Frontend call sites
- `src/pages/AdminDashboard.tsx:84` — admin uploads new company playbook.

### Environment variables
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### External / library calls
- **`unpdf@0.12.1`** (npm via esm.sh) — for PDF text extraction.
- **`mammoth@1.8.0`** (via npm:) — for DOCX → markdown.
- No AI calls.

### Database reads/writes
- READ: `playbook` (latest version to compute next).
- WRITE: `playbook` (insert new row, version = max+1), `playbook_sections` (insert parsed sections via `parsePlaybookSections` from `_shared/playbook.ts`).

### Auth
- No in-function check. **Should be admin-gated** when ported (frontend assumes admin route, but function trusts caller).

### Gotchas
- Supports `.md`, `.markdown`, `.txt`, any `text/*`, `.pdf`, `.docx`. Other extensions throw.
- Section parser is fairly tolerant (multiple header styles); see `_shared/playbook.ts` `parsePlaybookSections`.
- Section 0 ("Preamble") is parsed and stored but excluded from prompts (NEVER_INCLUDE).

---

# Function: `playbook-reparse`

**File path:** `supabase/functions/playbook-reparse/index.ts`

### Request contract
- **Method:** `POST`
- **Body:** `{}` (no inputs).

### Response contract
- **Success (200):** `{ ok: true, version, sections_count, sections: [{n, title, tokens}] }`.
- **Failure (200 with ok:false):** `{ ok: false, version, sections_count: 0, error }` — when no sections detected.
- **Error (500):** `{ error: string }`.

### Frontend call sites
- `src/pages/AdminDashboard.tsx:115` — admin "re-parse" button after fixing the parser.

### Environment / external / auth
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. No external APIs. No in-function auth check.

### Database reads/writes
- READ: latest row from `playbook`.
- WRITE: deletes all `playbook_sections` for that version, then inserts the freshly parsed set.

### Gotchas
- Operates on the **latest** playbook version only. To reparse a historical version, you'd need to extend it.


---

# Full source — every edge function

Sources are below in the same order as the per-function sections above. Total ~2,800 lines including shared modules already inlined earlier in this document.

## `supabase/functions/propose-brief/index.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { buildRoutedSystem } from "../_shared/playbook.ts";
import { logUsage } from "../_shared/usage.ts";
import { buildAnthropicUserId } from "../_shared/anthropicMeta.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PROPOSE_TOOL = {
  name: "submit_brief_proposal",
  description: "Submit the structured Step-2 brief proposal.",
  input_schema: {
    type: "object",
    properties: {
      keyword_cluster: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            estimated_monthly_volume: { type: "number" },
            volume_is_estimated: { type: "boolean" },
            competition: { type: "string", enum: ["low", "medium", "high"] },
            is_primary: { type: "boolean" },
            reasoning: { type: "string" },
          },
          required: ["keyword", "competition", "is_primary"],
        },
      },
      primary_keyword_reasoning: { type: "string" },
      funnel_stage: { type: "string", enum: ["TOFU", "MOFU", "BOFU"] },
      funnel_reasoning: { type: "string" },
      icps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            label: { type: "string" },
            playbook_citation: { type: "string", description: "Quote or section name from the playbook that justifies this match." },
          },
          required: ["id", "label", "playbook_citation"],
        },
      },
      pod: { type: "string" },
      pod_reasoning: { type: "string" },
      benchmark_candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            publisher: { type: "string" },
            why: { type: "string" },
            rank: { type: "number" },
          },
          required: ["url", "publisher", "why", "rank"],
        },
      },
      competitor_candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            publisher: { type: "string" },
            serp_position: { type: "number" },
            why: { type: "string" },
            rank: { type: "number" },
          },
          required: ["url", "why", "rank"],
        },
      },
      content_type: { type: "string", enum: ["blog", "landing", "service", "case_study"] },
      mode: { type: "string", enum: ["composition", "interview"] },
      mode_reasoning: { type: "string" },
      ai_citation_landscape: {
        type: "object",
        description: "How this topic is currently surfaced in AI search (ChatGPT, Claude, Perplexity, Gemini, Google AI Overviews).",
        properties: {
          sample_buyer_prompts: {
            type: "array",
            description: "5 sample prompts a real ICP would type into an LLM.",
            items: { type: "string" },
          },
          top_cited_sources: {
            type: "array",
            description: "Top 5 sources currently cited or summarized for this topic across AI engines.",
            items: {
              type: "object",
              properties: {
                url: { type: "string" },
                publisher: { type: "string" },
                kind: { type: "string", enum: ["competitor", "aggregator", "authority", "owned_media", "other"] },
                why_cited: { type: "string" },
              },
              required: ["url", "publisher", "kind", "why_cited"],
            },
          },
          citation_gaps: {
            type: "array",
            description: "Authority sources missing, under-substantiated claims, where the company can insert itself.",
            items: { type: "string" },
          },
          suggested_authority_sources: {
            type: "array",
            description: "Authority publishers (Statista, Pew, Gartner, BLS, peer-reviewed, etc.) to cite to increase LLM citation probability.",
            items: {
              type: "object",
              properties: {
                publisher: { type: "string" },
                url_or_topic: { type: "string" },
                why: { type: "string" },
              },
              required: ["publisher", "why"],
            },
          },
        },
        required: ["sample_buyer_prompts", "top_cited_sources", "citation_gaps", "suggested_authority_sources"],
      },
      atomic_question_map: {
        type: "array",
        description: "8-15 specific questions a buyer at this funnel stage asks. Each must be liftable as a standalone paragraph.",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            liftable_paragraph: { type: "boolean", description: "Should be answered in a standalone, citation-ready paragraph." },
            suggested_location: { type: "string", description: "Where in the article (e.g. 'intro', 'section 3', 'FAQ block at end')." },
            requires_citation: { type: "boolean" },
          },
          required: ["question", "liftable_paragraph", "suggested_location", "requires_citation"],
        },
      },
      entity_data_requirements: {
        type: "object",
        properties: {
          minimum_named_entities: {
            type: "object",
            properties: {
              clients: { type: "number" },
              dollar_amounts: { type: "number" },
              dates: { type: "number" },
              locations: { type: "number" },
              named_processes: { type: "number" },
              named_people: { type: "number" },
            },
          },
          required_authority_citations: { type: "number", description: "Minimum citations to authority publishers." },
          recommended_schema_types: {
            type: "array",
            description: "JSON-LD schema types this article should ship with.",
            items: { type: "string", enum: ["FAQPage", "HowTo", "Article", "BlogPosting", "LocalBusiness", "Organization", "Product", "Review"] },
          },
          originality_threshold: { type: "number", description: "Minimum proprietary data points that don't appear in the top 10 SERP." },
        },
        required: ["minimum_named_entities", "required_authority_citations", "recommended_schema_types", "originality_threshold"],
      },
    },
    required: [
      "keyword_cluster",
      "funnel_stage",
      "icps",
      "pod",
      "benchmark_candidates",
      "competitor_candidates",
      "content_type",
      "mode",
      "ai_citation_landscape",
      "atomic_question_map",
      "entity_data_requirements",
    ],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { project_id } = await req.json();
    if (!project_id) throw new Error("project_id required");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .single();
    if (pErr || !project) throw new Error("project not found");

    // Server-side validation: topic length cap (mirrors client-side zod check
    // in NewProject.tsx). HTML maxLength is a UX hint and can be bypassed by
    // direct DB insert or paste-from-clipboard, so we re-check here before
    // burning Anthropic tokens on garbage input.
    const TOPIC_MAX = 200;
    const topicTrimmed = String(project.topic || "").trim();
    if (topicTrimmed.length === 0) {
      throw new Error("Project topic is empty.");
    }
    if (topicTrimmed.length > TOPIC_MAX) {
      const errMsg = `Project topic exceeds ${TOPIC_MAX} characters (got ${topicTrimmed.length}). Edit the topic and retry.`;
      await supabase
        .from("projects")
        .update({ status: "brief_failed", brief_error: errMsg } as any)
        .eq("id", project_id);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stageInstructions = `You are the intake research assistant for ${project.company_domain}'s content pipeline. Read the company playbook above fully before responding.

Topic the user wants to write about: ${project.topic}
User notes: ${project.user_notes || "(none)"}

Use web search to:
1. Identify the keyword cluster around this topic — 5-10 related keywords with estimated monthly search volume and competition level. Suggest one primary keyword (set is_primary=true) based on intent match and ranking opportunity.
2. Determine search intent and funnel stage (TOFU / MOFU / BOFU).
3. Match 1-4 ICPs from the playbook based on topic and keyword intent. Cite the exact playbook section or quote that justifies each match.
4. Recommend the best pod from the playbook based on topic alignment with pod specialties.
5. Find 3 high-quality benchmark blogs (editorial standards to emulate — Neil Patel, Backlinko, a16z, First Round Review, or specialist publishers in the topic's vertical) for this topic. Rank them 1-3.
6. Find the top 3 ranking competitor pages for the proposed primary keyword via live SERP. Include serp_position. Rank them 1-3 by current position.
7. Default content_type=blog and mode=composition unless the topic clearly suggests interview mode (thought leadership, founder POV).

Every proposal must include one-line reasoning. Cite playbook sections by name or quote, and cite web sources by URL. Never fabricate search volumes — if exact data isn't available, set volume_is_estimated=true and explain the basis in the reasoning field.

In addition to traditional SEO research, you must research the AI citation landscape for this topic. AI search engines (ChatGPT, Claude, Perplexity, Gemini, Google AI Overviews) reward different signals than Google.

Run web searches that mimic real buyer queries an ICP would type into an LLM. For a buyer researching ${project.topic}, examples include:
- "best [solution] for [their context]"
- "how much does [thing] cost"
- "${project.topic} vs [alternative]"
- "how to choose [solution]"
- "what to look for in [solution]"

For each query, identify:
- Which sources are currently cited or summarized
- Whether those sources are competitors, aggregators, or authority publishers
- Which claims are under-substantiated and could be improved with better sourcing
- Where ${project.company_domain} could insert itself with proprietary data, named clients, or original analysis

Then map the atomic questions this article must answer in liftable, citation-ready chunks. Atomic = a single paragraph that completely answers one question and reads correctly out of context. Aim for 8-15 atomic questions.

Then specify entity and data density requirements: minimum named entities (clients, dollar amounts, dates, locations, named processes, named people), required citations to authority publishers, and recommended JSON-LD schema markup types.

Authority publishers for citation purposes include: Statista, Pew Research, Gartner, Forrester, McKinsey, government data sources (BLS, Census, EU statistical offices), peer-reviewed research, industry-specific authoritative sources (HIMSS for healthcare, IDC for tech, Nielsen for media), and named company financial reports. Avoid suggesting low-authority aggregators like Wikipedia, generic blog roundups, or AI-generated content as citation sources.

Then call submit_brief_proposal with the complete structured output including ai_citation_landscape, atomic_question_map, and entity_data_requirements.`;

    const { system, version: playbookVersion, included } = await buildRoutedSystem(
      supabase,
      "propose_brief",
      stageInstructions,
    );
    console.log(`[propose-brief] routed playbook sections: [${included.join(",")}]`);

    const metadataUserId = buildAnthropicUserId({
      pod: project.pod,
      stage: "stage0",
      substage: "propose_brief",
      writer_id: project.writer_id,
    });

    const requestBody = JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8000,
      metadata: { user_id: metadataUserId },
      system,
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 3 },
        PROPOSE_TOOL,
      ],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content:
            "HARD LIMIT: 3 web_search calls maximum across this entire task. Use them strategically (one for keyword/SERP, one for benchmark discovery, one for competitor discovery). After 3 searches you MUST synthesize and call submit_brief_proposal with whatever you have. Do not exceed 3 searches.",
        },
      ],
    });

    const callAnthropic = async (_attempt: number): Promise<Response> => {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 290_000); // 290s client-side cap
      try {
        return await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: requestBody,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    // Run the long Anthropic call in the background so we don't hit the
    // 150s edge function idle timeout. Client subscribes to `projects`
    // realtime updates and reacts when ai_proposed_brief lands.
    const runInBackground = async () => {
      try {
        let resp: Response | null = null;
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            resp = await callAnthropic(attempt);
            if (resp.status >= 500 || resp.status === 429) {
              const txt = await resp.text();
              console.warn(`[propose-brief] attempt ${attempt} got ${resp.status}: ${txt.slice(0, 300)}`);
              lastErr = new Error(`Anthropic ${resp.status}`);
              resp = null;
            } else {
              break;
            }
          } catch (e) {
            lastErr = e;
            console.warn(`[propose-brief] attempt ${attempt} fetch error:`, e instanceof Error ? e.message : String(e));
          }
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }

        if (!resp) {
          throw new Error(
            `Anthropic request failed after retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
          );
        }
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`Anthropic ${resp.status}: ${txt.slice(0, 500)}`);
        }

        const data = await resp.json();
        await logUsage(supabase, {
          project_id,
          stage: "propose_brief",
          model: "claude-sonnet-4-5-20250929",
          metadata_user_id: metadataUserId,
          usage: data.usage,
          ok: true,
        });
        const toolUse = (data.content || []).find(
          (b: any) => b.type === "tool_use" && b.name === "submit_brief_proposal",
        );
        if (!toolUse) {
          const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
          throw new Error(`No proposal returned. Raw: ${text.slice(0, 500)}`);
        }
        const proposal = toolUse.input;

        const primary = (proposal.keyword_cluster || []).find((k: any) => k.is_primary);
        const benchmarkTop = (proposal.benchmark_candidates || []).sort((a: any, b: any) => a.rank - b.rank)[0];
        const competitorTop = (proposal.competitor_candidates || []).sort((a: any, b: any) => a.rank - b.rank)[0];

        await supabase.from("projects").update({
          ai_proposed_brief: proposal,
          keyword_cluster: proposal.keyword_cluster || [],
          keyword: primary?.keyword || project.keyword,
          funnel_stage: proposal.funnel_stage,
          icps: (proposal.icps || []).map((i: any) => i.id),
          pod: proposal.pod || project.pod,
          benchmark_url: benchmarkTop?.url || project.benchmark_url,
          competitor_url: competitorTop?.url || project.competitor_url,
          content_type: proposal.content_type || project.content_type,
          mode: proposal.mode || project.mode,
          playbook_version: playbookVersion,
          status: "brief_proposed",
        }).eq("id", project_id);
      } catch (e) {
        console.error("[propose-brief] background error:", e);
        const errMsg = e instanceof Error ? e.message : String(e);
        // Try the full update with brief_error first; fall back to status-only
        // if the column is missing in older deployments.
        const { error: updErr } = await supabase
          .from("projects")
          .update({ status: "brief_failed", brief_error: errMsg } as any)
          .eq("id", project_id);
        if (updErr) {
          console.error("[propose-brief] failed to write brief_error, falling back:", updErr.message);
          await supabase
            .from("projects")
            .update({ status: "brief_failed" })
            .eq("id", project_id);
        }
      }
    };

    // Mark project as proposing so the UI shows progress
    await supabase.from("projects").update({ status: "brief_proposing" }).eq("id", project_id);

    // @ts-ignore - EdgeRuntime is provided by Supabase edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(runInBackground());
    } else {
      // Fallback: fire and forget
      runInBackground();
    }

    return new Response(JSON.stringify({ ok: true, status: "queued" }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("propose-brief error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});```

## `supabase/functions/research-generate/index.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { runStage, prefetchPages, STAGE_KEYS, STAGE_LABELS } from "../_shared/researchStages.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { project_id } = await req.json();
    if (!project_id) throw new Error("project_id required");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .single();
    if (projErr || !project) throw new Error("project not found");

    // Initialize sub_status: every stage pending. Reset all stage columns to null on rerun.
    const initialSubStatus: Record<string, any> = {};
    for (const k of STAGE_KEYS) {
      initialSubStatus[k] = { status: "pending", label: STAGE_LABELS[k], error: null };
    }

    await supabase.from("research_briefs").upsert(
      {
        project_id,
        sub_status: initialSubStatus,
        proof_points_status: "pending",
        progress_error: null,
        progress_stage: 0,
        progress_status: [],
        // clear previous outputs so the UI shows fresh skeletons
        search_intent: null,
        benchmark_teardown: null,
        competitor_teardown: null,
        synergy_map: null,
        ai_citation_landscape: null,
        atomic_question_map: null,
        entity_data_requirements: null,
        angle_inventory: null,
        conversion_signals: null,
      },
      { onConflict: "project_id" } as any,
    );

    console.log(`[research-generate] project=${project_id} starting parallel stages`);

    // Pre-fetch URL content (cached 1h) BEFORE running stages so all parallel
    // stages share the same fetched text.
    const t0 = Date.now();
    const pages = await prefetchPages(supabase, project);
    console.log(`[research-generate] prefetch done in ${Date.now() - t0}ms`);

    // Fire-and-forget background runner so we can return quickly.
    const runAll = async () => {
      try {
        const results = await Promise.allSettled(
          STAGE_KEYS.map((stage) =>
            runStage({ supabase, project, stage, pages }),
          ),
        );
        const okCount = results.filter((r) => r.status === "fulfilled" && (r.value as any).ok).length;
        console.log(`[research-generate] project=${project_id} done: ${okCount}/${STAGE_KEYS.length} ok`);

        // Update project status if at least the core stages succeeded
        await supabase
          .from("projects")
          .update({
            status: okCount === STAGE_KEYS.length ? "research_ready" : "research_partial",
          })
          .eq("id", project_id);
      } catch (e) {
        console.error(`[research-generate] background runner crashed:`, e);
        await supabase
          .from("research_briefs")
          .update({ progress_error: e instanceof Error ? e.message : String(e) })
          .eq("project_id", project_id);
      }
    };

    // EdgeRuntime.waitUntil keeps the function alive after the response is sent.
    // Fallback to plain Promise if not available.
    // @ts-ignore - Deno deploy globals
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(runAll());
    } else {
      // best-effort
      runAll();
    }

    return new Response(JSON.stringify({ ok: true, started: STAGE_KEYS }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("research-generate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});```

## `supabase/functions/research-retry-card/index.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { runStage, prefetchPages, STAGE_KEYS, type StageKey } from "../_shared/researchStages.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { project_id, stage } = await req.json();
    if (!project_id) throw new Error("project_id required");
    if (!stage || !STAGE_KEYS.includes(stage as StageKey)) throw new Error(`invalid stage: ${stage}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .single();
    if (projErr || !project) throw new Error("project not found");

    const pages = await prefetchPages(supabase, project);

    const run = async () => {
      await runStage({ supabase, project, stage: stage as StageKey, pages });
    };

    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(run());
    } else {
      run();
    }

    return new Response(JSON.stringify({ ok: true, stage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("research-retry-card error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});```

## `supabase/functions/outline-generate/index.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { buildRoutedSystem } from "../_shared/playbook.ts";
import { logUsage } from "../_shared/usage.ts";
import { buildAnthropicUserId } from "../_shared/anthropicMeta.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const OUTLINE_TOOL = {
  name: "submit_outline",
  input_schema: {
    type: "object",
    properties: {
      h1: { type: "string" },
      meta_description: { type: "string" },
      tone_reminder: { type: "string" },
      cta_placement: { type: "string" },
      internal_links: { type: "array", items: { type: "string" } },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            heading: { type: "string" },
            level: { type: "string", enum: ["H2", "H3"] },
            job: { type: "string" },
            word_count: { type: "number" },
            proof_points: { type: "array", items: { type: "string" } },
            internal_links: { type: "array", items: { type: "string" } },
            why_it_converts: { type: "string" },
            atomic_questions: {
              type: "array",
              description: "Verbatim atomic questions from the brief that this section must answer as liftable paragraphs.",
              items: { type: "string" },
            },
            required_entities: {
              type: "array",
              description: "Named entities (clients, dollar amounts, dates, locations, processes, people) this section must include.",
              items: { type: "string" },
            },
            required_citations: {
              type: "array",
              description: "Authority publishers / sources this section must cite inline.",
              items: { type: "string" },
            },
            ai_citation_likelihood: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "Estimated likelihood that this section would be cited by an AI search engine, given its structure, entity density, and citation plan.",
            },
            schema_markup_types: {
              type: "array",
              description: "JSON-LD schema types this section's content supports (e.g. FAQPage for Q&A blocks, HowTo for steps).",
              items: { type: "string" },
            },
          },
          required: ["id", "heading", "level", "job", "word_count"],
        },
      },
    },
    required: ["h1", "meta_description", "sections"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { project_id } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: project } = await supabase.from("projects").select("*").eq("id", project_id).single();
    const { data: brief } = await supabase.from("research_briefs").select("*").eq("project_id", project_id).single();
    const { data: proofs } = await supabase.from("proof_points").select("*").eq("project_id", project_id).eq("starred", true);

    const outlineInstructions = `Honor the playbook for ICP language, banned phrases, and pillar alignment when shaping the outline.

You must also distribute the brief's atomic_question_map across sections — every atomic question with liftable_paragraph=true must be assigned to exactly one section as a standalone, citation-ready paragraph. Distribute the entity_data_requirements proportionally across sections so the article hits its minimums. Estimate ai_citation_likelihood for each section based on entity density, atomic-question coverage, and citation plan.`;
    const { system: routedSystem, included } = await buildRoutedSystem(supabase, "outline", outlineInstructions);
    console.log(`[outline-generate] routed playbook sections: [${included.join(",")}]`);

    const t0 = Date.now();
    const MODEL = "claude-sonnet-4-5-20250929";
    const metadataUserId = buildAnthropicUserId({
      pod: project.pod,
      stage: "stage2",
      substage: "outline",
      writer_id: project.writer_id,
    });
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        metadata: { user_id: metadataUserId },
        tools: [OUTLINE_TOOL],
        tool_choice: { type: "tool", name: "submit_outline" },
        system: routedSystem,
        messages: [
          {
            role: "user",
            content: `Build an outline for a ${project.content_type} on "${project.topic}" (${project.funnel_stage}, keyword: ${project.keyword}).

Approved research:
${JSON.stringify(brief, null, 2).slice(0, 8000)}

Starred proof points:
${JSON.stringify(proofs || [], null, 2).slice(0, 4000)}

Produce 6-9 sections. Each section gets:
- unique id (e.g. "s1"), heading, level (H2/H3), one-sentence job, target word count
- proof_points: ids the section should deploy
- internal_links
- why_it_converts: one line
- atomic_questions: verbatim questions from the brief's atomic_question_map this section must answer (each as a liftable paragraph)
- required_entities: which named entities (specific clients, dollar amounts, dates, locations, processes, people) this section must include — pull from synergy_map and entity_data_requirements
- required_citations: which authority publishers / URLs this section must inline-cite — pull from suggested_authority_sources and proof_points
- ai_citation_likelihood: high/medium/low
- schema_markup_types: JSON-LD types this section supports (FAQPage for Q&A blocks, HowTo for stepwise content, etc.)

Cover EVERY atomic question with liftable_paragraph=true at least once. Distribute entities and citations so the article hits the entity_data_requirements minimums. Also produce H1, meta description (<160 chars), tone reminder, and CTA placement notes.`,
          },
        ],
      }),
    });

    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    await logUsage(supabase, {
      project_id,
      stage: "outline",
      model: MODEL,
      metadata_user_id: metadataUserId,
      usage: data.usage,
      duration_ms: Date.now() - t0,
      ok: true,
    });
    const toolUse = (data.content || []).find((b: any) => b.type === "tool_use");
    if (!toolUse) throw new Error("No outline returned");
    const out = toolUse.input;

    await supabase.from("outlines").upsert(
      {
        project_id,
        h1: out.h1,
        meta_description: out.meta_description,
        sections: out.sections,
        cta_placement: out.cta_placement,
        internal_links: out.internal_links || [],
        tone_reminder: out.tone_reminder,
      },
      { onConflict: "project_id" } as any,
    );

    await supabase.from("projects").update({ current_stage: 2, status: "outlining" }).eq("id", project_id);

    return new Response(JSON.stringify({ ok: true, outline: out }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});```

## `supabase/functions/draft-section/index.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { buildRoutedSystemWithProject } from "../_shared/playbook.ts";
import { logUsage } from "../_shared/usage.ts";
import { buildAnthropicUserId } from "../_shared/anthropicMeta.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Count REAL inline citations in drafted prose. Source of truth = the rendered
 * Markdown link `[label](http(s)://url)`. Mirrors the regex used in DraftReview's
 * citations panel so the per-section count, the panel count, and the admin sum
 * never drift apart.
 */
function countInlineCitations(text: string): number {
  if (!text) return 0;
  const re = /\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g;
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    // De-dupe by URL — the same source cited twice in one section is one citation.
    seen.add(m[2]);
  }
  return seen.size;
}

/**
 * Normalize a URL for whitelist comparison: lowercase host, strip trailing
 * slash, ignore query/fragment for the host check. We compare both the
 * full URL and the host so writers can cite a deep link off a whitelisted
 * domain (e.g. statista.com/topics/123 when the brief listed statista.com).
 */
function normalizeUrl(u: string): { full: string; host: string } | null {
  try {
    const url = new URL(u.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.host.toLowerCase().replace(/^www\./, "");
    const full = `${url.protocol}//${host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
    return { full, host };
  } catch {
    return null;
  }
}

/**
 * Build the project's verified-source whitelist. A citation URL is allowed if
 * its host matches any of these hosts. We deliberately match by host (not
 * exact URL) because a writer can legitimately deep-link into a whitelisted
 * publication (e.g. a specific Statista page when only statista.com was in
 * the brief). Adding a host to the whitelist is an explicit signal from
 * Stage 1 research, proof points, or the project's own URLs.
 */
function buildCitationWhitelist(args: {
  proofs: any[] | null;
  brief: any;
  project: any;
}): { hosts: Set<string>; sources: Array<{ url: string; host: string; label: string }> } {
  const hosts = new Set<string>();
  const sources: Array<{ url: string; host: string; label: string }> = [];
  const add = (raw: string | null | undefined, label: string) => {
    if (!raw) return;
    const n = normalizeUrl(raw);
    if (!n) return;
    hosts.add(n.host);
    sources.push({ url: n.full, host: n.host, label });
  };
  for (const p of args.proofs || []) add(p?.source_url, p?.source_publication || "proof point");
  const landscape = args.brief?.ai_citation_landscape as any;
  for (const s of landscape?.top_cited_sources || []) add(s?.url, s?.publisher || "authority");
  for (const s of landscape?.suggested_authority_sources || []) add(s?.url_or_topic, s?.publisher || "authority");
  // Intentionally NOT including benchmark_url or competitor_url. Those are
  // research inputs (read for landscape analysis), not citation sources.
  // Citing a competitor inside our own article is off-brand by default; if
  // a writer needs that, it should be an explicit override, not silently
  // permitted.
  if (args.project?.company_domain) add(`https://${args.project.company_domain}`, "self");
  return { hosts, sources };
}

/**
 * Strip inline citations whose URL host isn't in the whitelist. The replacement
 * keeps the link text in place so prose still reads naturally — we just remove
 * the (fabricated) URL. This guarantees fake citations cannot be rendered or
 * counted downstream, regardless of what the model returned.
 */
function enforceCitationWhitelist(text: string, hosts: Set<string>): { text: string; stripped: number } {
  if (!text) return { text, stripped: 0 };
  let stripped = 0;
  const out = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g, (_m, label, url) => {
    const n = normalizeUrl(url);
    if (n && hosts.has(n.host)) return `[${label}](${url})`;
    stripped++;
    return label; // drop the URL, keep the prose
  });
  return { text: out, stripped };
}

const DRAFT_TOOL = {
  name: "submit_draft",
  input_schema: {
    type: "object",
    properties: {
      content: { type: "string", description: "The full prose for the section, with inline citations as [Source Name](url)." },
      citation_count: { type: "number" },
      atomic_chunks_count: { type: "number", description: "Number of standalone, liftable paragraphs that fully answer one atomic question and read correctly out of context." },
      schema_markup_recommendations: {
        type: "array",
        description: "JSON-LD schema this section supports, with the actual structured object.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["FAQPage", "HowTo", "Article", "BlogPosting", "LocalBusiness", "Organization", "Product", "Review"] },
            jsonld: { type: "object", description: "The JSON-LD object with @context and @type populated." },
          },
          required: ["type", "jsonld"],
        },
      },
    },
    required: ["content"],
  },
};

const REVIEW_TOOL = {
  name: "submit_review",
  input_schema: {
    type: "object",
    properties: {
      review_questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["factual", "detail", "structural"] },
            question: { type: "string" },
          },
          required: ["kind", "question"],
        },
      },
      voice_flags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            phrase: { type: "string" },
            reason: { type: "string" },
            alternative: { type: "string" },
          },
        },
      },
      voice_match_score: { type: "number" },
      entity_density_score: { type: "number", description: "0-100. Percentage of required_entities for this section that were actually included." },
      ai_citation_readiness_score: {
        type: "number",
        description: "0-100. Composite of entity density, citation coverage of required_citations, atomic chunk count vs atomic_questions assigned, and schema-markup readiness.",
      },
      ai_citation_flags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["missing_entity", "missing_citation", "weak_atomic_chunk", "no_schema"] },
            detail: { type: "string" },
          },
          required: ["kind", "detail"],
        },
      },
    },
    required: ["review_questions"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { project_id, section_id, revision_instruction } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const [
      { data: project },
      { data: outline },
      { data: proofs },
      { data: brief },
      { data: existing },
    ] = await Promise.all([
      supabase.from("projects").select("*").eq("id", project_id).single(),
      supabase.from("outlines").select("*").eq("project_id", project_id).single(),
      supabase.from("proof_points").select("*").eq("project_id", project_id).eq("starred", true),
      supabase
        .from("research_briefs")
        .select("synergy_map, conversion_signals, ai_citation_landscape, atomic_question_map, entity_data_requirements, updated_at")
        .eq("project_id", project_id)
        .single(),
      supabase.from("drafts").select("*").eq("project_id", project_id).eq("section_id", section_id).maybeSingle(),
    ]);

    const section = (outline?.sections as any[]).find((s: any) => s.id === section_id);
    if (!section) throw new Error("section not in outline");
    const totalSections = (outline?.sections as any[]).length;
    const sectionIndex = (outline?.sections as any[]).findIndex((s: any) => s.id === section_id) + 1;

    const atomicForSection: string[] = (section as any).atomic_questions || [];
    const requiredEntities: string[] = (section as any).required_entities || [];
    const requiredCitations: string[] = (section as any).required_citations || [];
    const sectionSchemas: string[] = (section as any).schema_markup_types || [];
    const suggestedAuthorities = (brief?.ai_citation_landscape as any)?.suggested_authority_sources || [];

    // Project-scoped citation whitelist. Built once per draft call from the
    // already-fetched proofs + brief + project URLs (no extra DB round trip).
    const whitelist = buildCitationWhitelist({ proofs, brief, project });
    const whitelistBlock = whitelist.sources.length
      ? whitelist.sources
          .slice(0, 25)
          .map((s) => `- ${s.label}: ${s.url}`)
          .join("\n")
      : "(no verified sources for this project — do not invent any citations)";

    /* ── Per-project cached context: shared across every section + every revision ── */
    const projectContext = `=== PROJECT CONTEXT (shared across all sections) ===
Content type: ${project.content_type}
Title (H1): ${outline?.h1}
Total sections: ${totalSections}
Company domain: ${project.company_domain}

Synergy angle (${project.company_domain}'s ownable POV):
${(brief?.synergy_map as any)?.ownable_angle || "n/a"}

Tone reminder: ${outline?.tone_reminder}
CTA guidance: ${outline?.cta_placement}
Conversion belief required: ${(brief?.conversion_signals as any)?.required_belief || ""}

Starred proof points (weave EVERY relevant one in with inline citation):
${JSON.stringify(proofs || [], null, 2)}

Suggested authority publishers (use when relevant):
${suggestedAuthorities.slice(0, 8).map((s: any) => `- ${s.publisher} (${s.url_or_topic || ""})`).join("\n")}

VERIFIED CITATION WHITELIST (the ONLY URLs you may cite inline):
${whitelistBlock}

CITATION RULES — non-negotiable:
- Inline citations MUST use the form [Publisher Name](https://real-url) where the URL is on the whitelist above (matching by host is OK, so deep links into a whitelisted domain are allowed).
- NEVER invent, guess, or hallucinate URLs. If a claim has no whitelisted source, write the claim WITHOUT a citation rather than inventing one.
- Do not cite Wikipedia or AI-generated content even if it appears in the whitelist.

Banned phrases (do not use): "in today's fast-paced world", "in conclusion", "leverage", "synergy", "delve", "navigate the landscape", "game-changer", "unlock the power".
=== END PROJECT CONTEXT ===`;

    // Stable cache tag — invalidates only when underlying project state changes.
    const projectCacheTag = `project:${project_id}|outline:${outline?.updated_at || ""}|brief:${(brief as any)?.updated_at || ""}|proofs:${(proofs || []).length}`;

    /* ── Per-section, uncached instructions ── */
    const stageInstructions = revision_instruction
      ? `You are revising Section ${sectionIndex} of ${totalSections} ("${section.heading}").

Writer's revision instruction (FOLLOW THIS LITERALLY — this is the user's primary intent):
"""
${revision_instruction}
"""

Current draft:
"""
${existing?.content || ""}
"""

REVISION RULES:
1. The writer's instruction above is the PRIMARY directive. Apply it fully and visibly — do not return content that looks identical to the current draft.
2. If the instruction asks for bullet points, convert relevant prose into actual markdown bullets ("- item").
3. If the instruction asks for a reference link or citation, add a real inline citation in the form [Publisher](https://real-url) using one of the suggested authority publishers above or a starred proof point. Never invent URLs.
4. If the instruction asks for examples, statistics, or specifics, pull them from the starred proof points or suggested authorities in the project context.
5. Preserve the section's heading, target word count (±20%), and any inline citations that are still relevant.
6. Return the FULL revised section content via submit_draft (not a diff).` 
      : `You are drafting Section ${sectionIndex} of ${totalSections} ("${section.heading}"). ${section.word_count}-word target. Job: ${section.job}.

=== AI CITATION REQUIREMENTS FOR THIS SECTION ===

Atomic questions this section MUST answer as standalone, liftable paragraphs (each paragraph reads correctly out of context, completely answers one question):
${atomicForSection.length ? atomicForSection.map((q, i) => `${i + 1}. ${q}`).join("\n") : "(none assigned — still aim for at least one liftable Q&A-style paragraph if topical)"}

Required named entities this section must include (clients, dollar amounts, dates, locations, named processes, named people):
${requiredEntities.length ? requiredEntities.map((e) => `- ${e}`).join("\n") : "(none specified — still aim for concrete proper nouns over generics)"}

Required authority citations this section must inline-cite as [Publisher](url):
${requiredCitations.length ? requiredCitations.map((c) => `- ${c}`).join("\n") : "(none specified)"}

Schema markup types this section supports: ${sectionSchemas.join(", ") || "(none assigned)"}

RULES:
1. Structure AT LEAST ONE paragraph as a standalone liftable answer to one of the atomic questions above. That paragraph must read correctly out of context.
2. Include EVERY required named entity by name (not generic placeholders).
3. Inline-cite every required authority source with a real URL.
4. If a schema_markup_type is FAQPage, format the relevant Q&A as a clear question heading + answer paragraph and emit the JSON-LD in schema_markup_recommendations. If HowTo, emit ordered steps + JSON-LD.

Produce real prose. Do not produce a brief. Then call submit_draft with:
- content: the full prose for this section, with inline [Publisher](url) citations
- citation_count: number of inline citations
- atomic_chunks_count: number of standalone liftable paragraphs
- schema_markup_recommendations: JSON-LD for any schema this section supports`;

    const userMessage = revision_instruction
      ? `Revise per the instruction above. Call submit_draft.`
      : `Draft this section now. Call submit_draft.`;

    const { system, included } = await buildRoutedSystemWithProject(
      supabase,
      "draft",
      projectContext,
      projectCacheTag,
      stageInstructions,
    );
    console.log(`[draft-section] routed playbook sections: [${included.join(",")}], cache tag: ${projectCacheTag}`);

    const t0 = Date.now();
    const MODEL = "claude-sonnet-4-5-20250929";
    const draftSubstage = revision_instruction
      ? `revise_section_${sectionIndex}`
      : `draft_section_${sectionIndex}`;
    const metadataUserId = buildAnthropicUserId({
      pod: project.pod,
      stage: "stage3",
      substage: draftSubstage,
      writer_id: project.writer_id,
    });
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        metadata: { user_id: metadataUserId },
        system,
        tools: [DRAFT_TOOL],
        tool_choice: { type: "tool", name: "submit_draft" },
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    await logUsage(supabase, {
      project_id,
      stage: "draft",
      sub_stage: section_id,
      model: MODEL,
      metadata_user_id: metadataUserId,
      usage: data.usage,
      duration_ms: Date.now() - t0,
      ok: true,
    });
    const toolUse = (data.content || []).find((b: any) => b.type === "tool_use");
    if (!toolUse) throw new Error("No draft returned");
    const out = toolUse.input;

    // Enforce the project URL whitelist server-side. Any inline citation
    // whose host is not on the whitelist is treated as hallucinated and its
    // URL is stripped (the link text remains so prose still reads). This is
    // the floor — UI render-side validation is a second layer on top.
    const enforced = enforceCitationWhitelist(out.content || "", whitelist.hosts);
    if (enforced.stripped > 0) {
      console.log(
        `[draft-section] stripped ${enforced.stripped} non-whitelisted citation(s) from section ${section_id}`,
      );
    }
    out.content = enforced.text;

    // Count REAL inline citations (Markdown [text](http(s)://...)) from the
    // post-enforcement content. After stripping, every remaining citation is
    // guaranteed to be on the whitelist, so the count is the verified count.
    const realCitationCount = countInlineCitations(out.content || "");

    /* ── Phase 3: review pass on Haiku ── runs in parallel with the DB write ── */
    const reviewPromise = runReviewPass(supabase, {
      project_id,
      section_id,
      sectionIndex,
      pod: project.pod,
      writer_id: project.writer_id,
      content: out.content,
      requiredEntities,
      requiredCitations,
      atomicForSection,
      sectionHeading: section.heading,
    }).catch((e) => {
      console.error("[draft-section] review pass failed", e);
      return null;
    });

    const review = await reviewPromise;

    await supabase.from("drafts").upsert(
      {
        project_id,
        section_id,
        section_heading: section.heading,
        content: out.content,
        review_questions: review?.review_questions || [],
        voice_flags: review?.voice_flags || [],
        voice_match_score: review?.voice_match_score ?? 75,
        citation_count: realCitationCount,
        atomic_chunks_count: out.atomic_chunks_count ?? 0,
        entity_density_score: review?.entity_density_score ?? null,
        ai_citation_readiness_score: review?.ai_citation_readiness_score ?? null,
        schema_markup_recommendations: out.schema_markup_recommendations || [],
        revision_count: existing ? (existing.revision_count || 0) + 1 : 0,
        // Preserve approval state across revisions so that revising an already-approved
        // section does NOT silently un-approve it. Without this, the column default
        // (false) wins on every upsert and `allDone` never flips → stitch button
        // never appears.
        approved: existing?.approved ?? false,
      },
      { onConflict: "project_id,section_id" } as any,
    );

    if (revision_instruction && existing?.content) {
      await supabase.from("voice_library").insert({
        project_id,
        original_ai_text: existing.content,
        edited_human_text: out.content,
        edit_type: "revision",
      });
    }

    await supabase.from("projects").update({ current_stage: 3, status: "drafting" }).eq("id", project_id);

    return new Response(JSON.stringify({ ok: true, draft: { ...out, ...(review || {}) } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/* ───────────────────────────────────────────────────────────────────
 * Phase 3: review pass — Haiku 4.5 critic that scores the draft and
 * generates review questions + voice flags. No playbook needed; the
 * tiny critique prompt makes this ~10x cheaper than re-asking Sonnet.
 * ─────────────────────────────────────────────────────────────────── */
async function runReviewPass(
  supabase: ReturnType<typeof createClient>,
  args: {
    project_id: string;
    section_id: string;
    sectionIndex: number;
    pod?: string | null;
    writer_id?: string | null;
    content: string;
    requiredEntities: string[];
    requiredCitations: string[];
    atomicForSection: string[];
    sectionHeading: string;
  },
) {
  const REVIEW_MODEL = "claude-haiku-4-5-20251001";
  const t0 = Date.now();
  const metadataUserId = buildAnthropicUserId({
    pod: args.pod,
    stage: "stage3",
    substage: `review_section_${args.sectionIndex}`,
    writer_id: args.writer_id,
  });

  const system = `You are a strict editorial critic. Read the draft section and score it. Return:
- review_questions: exactly 3 (one factual, one detail, one structural)
- voice_flags: phrases that sound generic or off-brand, with alternatives
- voice_match_score: 0-100
- entity_density_score: 0-100 (% of required_entities actually present)
- ai_citation_readiness_score: 0-100 composite
- ai_citation_flags: gaps in entities, citations, atomic chunks, or schema`;

  const user = `Section: "${args.sectionHeading}"

Required entities (check inclusion):
${args.requiredEntities.length ? args.requiredEntities.map((e) => `- ${e}`).join("\n") : "(none)"}

Required citations:
${args.requiredCitations.length ? args.requiredCitations.map((c) => `- ${c}`).join("\n") : "(none)"}

Atomic questions the section is supposed to answer:
${args.atomicForSection.length ? args.atomicForSection.map((q, i) => `${i + 1}. ${q}`).join("\n") : "(none)"}

=== DRAFT ===
${args.content}
=== END DRAFT ===

Call submit_review.`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: REVIEW_MODEL,
      max_tokens: 1500,
      metadata: { user_id: metadataUserId },
      system,
      tools: [REVIEW_TOOL],
      tool_choice: { type: "tool", name: "submit_review" },
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!resp.ok) {
    await logUsage(supabase, {
      project_id: args.project_id,
      stage: "draft",
      sub_stage: `${args.section_id}:review`,
      model: REVIEW_MODEL,
      metadata_user_id: metadataUserId,
      duration_ms: Date.now() - t0,
      ok: false,
      error: `Anthropic ${resp.status}`,
    });
    throw new Error(`review pass ${resp.status}`);
  }
  const data = await resp.json();
  await logUsage(supabase, {
    project_id: args.project_id,
    stage: "draft",
    sub_stage: `${args.section_id}:review`,
    model: REVIEW_MODEL,
    metadata_user_id: metadataUserId,
    usage: data.usage,
    duration_ms: Date.now() - t0,
    ok: true,
  });
  const toolUse = (data.content || []).find((b: any) => b.type === "tool_use");
  return toolUse?.input || null;
}```

## `supabase/functions/interview-step/index.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { buildRoutedSystem } from "../_shared/playbook.ts";
import { logUsage } from "../_shared/usage.ts";
import { buildAnthropicUserId } from "../_shared/anthropicMeta.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { project_id, section_id, last_answer } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: project } = await supabase.from("projects").select("*").eq("id", project_id).single();
    const { data: outline } = await supabase.from("outlines").select("sections, h1").eq("project_id", project_id).single();
    const section = (outline?.sections as any[]).find((s: any) => s.id === section_id);
    const { data: prior } = await supabase.from("interview_answers").select("*").eq("project_id", project_id).order("created_at");

    const interviewInstructions = `You are interviewing the writer to extract their voice and POV for the section "${section?.heading}" (job: ${section?.job}) of "${outline?.h1}". Ask ONE question at a time. Reactive, conversational. Build on prior answers. Use playbook ICP/voice context to ask sharper questions.`;
    const { system: routedSystem, included } = await buildRoutedSystem(supabase, "interview", interviewInstructions);
    console.log(`[interview-step] routed playbook sections: [${included.join(",")}]`);

    const t0 = Date.now();
    const MODEL = "claude-sonnet-4-5-20250929";
    const metadataUserId = buildAnthropicUserId({
      pod: project.pod,
      stage: "stage3",
      substage: `interview_${section_id || "unknown"}`,
      writer_id: project.writer_id,
    });
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        metadata: { user_id: metadataUserId },
        system: routedSystem,
        messages: [
          {
            role: "user",
            content: `Prior Q&A:\n${(prior || []).map((p: any) => `Q: ${p.question}\nA: ${p.answer}`).join("\n\n")}\n\nLast answer from writer: ${last_answer || "(none yet — ask the first question)"}\n\nReact briefly (1 sentence) to the last answer, then ask the next question. Return only:\nREACTION: ...\nNEXT_QUESTION: ...`,
          },
        ],
      }),
    });
    const data = await resp.json();
    await logUsage(supabase, {
      project_id,
      stage: "interview",
      sub_stage: section_id,
      model: MODEL,
      metadata_user_id: metadataUserId,
      usage: data.usage,
      duration_ms: Date.now() - t0,
      ok: resp.ok,
    });
    const text = (data.content || []).find((b: any) => b.type === "text")?.text || "";
    const reaction = text.match(/REACTION:\s*(.+?)(?=NEXT_QUESTION:|$)/s)?.[1]?.trim() || "";
    const next_question = text.match(/NEXT_QUESTION:\s*(.+)/s)?.[1]?.trim() || "Tell me more.";

    return new Response(JSON.stringify({ reaction, next_question }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});```

## `supabase/functions/final-stitch/index.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
// GoWinston AI key (stored under the ORIGINALITY_API_KEY secret name as a drop-in replacement)
const GOWINSTON_API_KEY = Deno.env.get("ORIGINALITY_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BANNED = ["in today's fast-paced world", "in conclusion", "leverage", "synergy", "delve", "navigate the landscape", "game-changer", "unlock the power"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { project_id } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: outline } = await supabase.from("outlines").select("*").eq("project_id", project_id).single();
    const { data: drafts } = await supabase.from("drafts").select("*").eq("project_id", project_id);
    const { data: brief } = await supabase
      .from("research_briefs")
      .select("atomic_question_map, entity_data_requirements, ai_citation_landscape")
      .eq("project_id", project_id)
      .maybeSingle();

    const sectionsOrder = (outline?.sections as any[]).map((s: any) => s.id);
    const ordered = sectionsOrder
      .map((id) => drafts?.find((d: any) => d.section_id === id))
      .filter(Boolean) as any[];

    let stitched = `# ${outline?.h1}\n\n`;
    for (const d of ordered) {
      stitched += `## ${d.section_heading}\n\n${d.content}\n\n`;
    }

    // word count
    const word_count = stitched.split(/\s+/).filter(Boolean).length;

    // banned phrase count
    const lower = stitched.toLowerCase();
    const banned_phrase_count = BANNED.reduce((n, p) => n + (lower.split(p).length - 1), 0);

    // citation completeness: drafts with citation_count > 0 / total drafts
    const withCites = ordered.filter((d) => (d.citation_count || 0) > 0).length;
    const citation_completeness = ordered.length ? Math.round((withCites / ordered.length) * 100) : 0;

    // average voice match
    const voice_match_score =
      ordered.length
        ? Math.round(ordered.reduce((s, d) => s + (Number(d.voice_match_score) || 0), 0) / ordered.length)
        : 0;

    // AI citation aggregates
    const ai_citation_readiness_score = ordered.length
      ? Math.round(
          ordered.reduce((s, d) => s + (Number(d.ai_citation_readiness_score) || 0), 0) / ordered.length,
        )
      : 0;
    const atomic_chunks_count = ordered.reduce((n, d) => n + (Number(d.atomic_chunks_count) || 0), 0);
    const atomic_questions_count = Array.isArray(brief?.atomic_question_map)
      ? (brief!.atomic_question_map as any[]).filter((q) => q.liftable_paragraph).length
      : 0;

    // Merge schema recommendations across sections (dedupe by type, keep first jsonld for that type).
    const schemaSet = new Map<string, any>();
    for (const d of ordered) {
      const recs = (d.schema_markup_recommendations as any[]) || [];
      for (const r of recs) {
        if (r?.type && r?.jsonld && !schemaSet.has(r.type)) {
          schemaSet.set(r.type, r.jsonld);
        }
      }
    }
    // Add Article/BlogPosting fallback if missing
    if (!schemaSet.has("Article") && !schemaSet.has("BlogPosting")) {
      schemaSet.set("BlogPosting", {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: outline?.h1 || "",
        description: outline?.meta_description || "",
        wordCount: word_count,
      });
    }
    const schema_markup_recommendations = Array.from(schemaSet.entries()).map(([type, jsonld]) => ({ type, jsonld }));

    // GoWinston AI detection (best-effort; non-blocking).
    // Docs: https://gowinston.ai — POST https://api.gowinston.ai/v2/ai-content-detection
    // Returns a `score` 0–100 representing the likelihood the text is human-written.
    // We store that as `originality_score` (higher = more original/human).
    let originality_score: number | null = null;
    if (GOWINSTON_API_KEY) {
      try {
        const o = await fetch("https://api.gowinston.ai/v2/ai-content-detection", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${GOWINSTON_API_KEY}`,
          },
          body: JSON.stringify({
            text: stitched.slice(0, 30000),
            sentences: false,
            language: "en",
          }),
        });
        if (o.ok) {
          const j = await o.json();
          // GoWinston returns { score: <0-100 human likelihood>, ... }
          originality_score =
            typeof j?.score === "number"
              ? Math.round(j.score)
              : j?.score?.human ?? j?.human_score ?? null;
        } else {
          console.warn("gowinston non-ok", o.status, await o.text());
        }
      } catch (e) {
        console.warn("gowinston call failed", e);
      }
    }

    await supabase.from("draft_scores").upsert(
      {
        project_id,
        voice_match_score,
        originality_score,
        banned_phrase_count,
        word_count,
        citation_completeness,
        final_draft: stitched,
        ai_citation_readiness_score,
        atomic_chunks_count,
        atomic_questions_count,
        schema_markup_recommendations,
      },
      { onConflict: "project_id" } as any,
    );

    await supabase.from("projects").update({ current_stage: 4, status: "review" }).eq("id", project_id);

    return new Response(
      JSON.stringify({
        ok: true,
        word_count,
        voice_match_score,
        originality_score,
        banned_phrase_count,
        citation_completeness,
        ai_citation_readiness_score,
        atomic_chunks_count,
        atomic_questions_count,
        schema_markup_recommendations,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});```

## `supabase/functions/playbook-upload/index.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { parsePlaybookSections, ALWAYS_INCLUDE } from "../_shared/playbook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Accepts a JSON body: { filename, mime_type, content_base64, uploaded_by? }
 * Parses MD / PDF / DOCX into plain markdown text and stores a new playbook version.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { filename, mime_type, content_base64, uploaded_by } = await req.json();
    if (!filename || !content_base64) throw new Error("filename and content_base64 are required");

    const bytes = Uint8Array.from(atob(content_base64), (c) => c.charCodeAt(0));
    const lower = (filename as string).toLowerCase();

    let markdown = "";
    if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt") || (mime_type || "").startsWith("text/")) {
      markdown = new TextDecoder().decode(bytes);
    } else if (lower.endsWith(".pdf") || mime_type === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("https://esm.sh/unpdf@0.12.1");
      const doc = await getDocumentProxy(bytes);
      const { text } = await extractText(doc, { mergePages: true });
      markdown = Array.isArray(text) ? text.join("\n\n") : String(text);
    } else if (lower.endsWith(".docx") || mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const mammoth = await import("npm:mammoth@1.8.0");
      const result = await mammoth.convertToMarkdown({ buffer: bytes });
      markdown = result.value || "";
    } else {
      throw new Error(`Unsupported file type: ${filename}`);
    }

    markdown = (markdown || "").trim();
    if (!markdown) throw new Error("Extracted playbook is empty.");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: latest } = await supabase
      .from("playbook")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((latest as any)?.version ?? 0) + 1;

    const { data, error } = await supabase
      .from("playbook")
      .insert({
        content_markdown: markdown,
        version: nextVersion,
        source_filename: filename,
        uploaded_by: uploaded_by || null,
      })
      .select()
      .single();
    if (error) throw error;

    // Parse + persist numbered sections for routing.
    const sections = parsePlaybookSections(markdown);
    if (sections.length > 0) {
      const rows = sections.map((s) => ({
        version: nextVersion,
        section_number: s.section_number,
        section_title: s.section_title,
        section_content: s.section_content,
        section_token_estimate: s.section_token_estimate,
        always_include: ALWAYS_INCLUDE.includes(s.section_number) || s.always_include,
      }));
      const { error: secErr } = await supabase.from("playbook_sections").insert(rows);
      if (secErr) console.warn("[playbook-upload] section insert error:", secErr.message);
    } else {
      console.warn("[playbook-upload] no sections detected — routing will fall back to full doc");
    }

    return new Response(JSON.stringify({ ok: true, playbook: data, sections_count: sections.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("playbook-upload error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});```

## `supabase/functions/playbook-reparse/index.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { parsePlaybookSections, ALWAYS_INCLUDE } from "../_shared/playbook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Re-parse the latest uploaded playbook into playbook_sections without
 * requiring a re-upload. Used to backfill sections for older versions
 * after Phase 2 routing shipped.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: latest } = await supabase
      .from("playbook")
      .select("version, content_markdown")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) throw new Error("no playbook uploaded yet");
    const version = (latest as any).version as number;
    const markdown = ((latest as any).content_markdown as string) || "";

    const sections = parsePlaybookSections(markdown);
    if (sections.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, version, sections_count: 0, error: "no sections detected" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Replace any existing rows for this version
    await supabase.from("playbook_sections").delete().eq("version", version);
    const rows = sections.map((s) => ({
      version,
      section_number: s.section_number,
      section_title: s.section_title,
      section_content: s.section_content,
      section_token_estimate: s.section_token_estimate,
      always_include: ALWAYS_INCLUDE.includes(s.section_number) || s.always_include,
    }));
    const { error } = await supabase.from("playbook_sections").insert(rows);
    if (error) throw error;

    return new Response(
      JSON.stringify({
        ok: true,
        version,
        sections_count: sections.length,
        sections: sections.map((s) => ({
          n: s.section_number,
          title: s.section_title,
          tokens: s.section_token_estimate,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("playbook-reparse error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});```

---

# Rebuild checklist for the Express server

1. **Port `_shared/` modules first** — they're framework-agnostic except for the Deno `fetch` (drop-in on Node 20+) and `@supabase/supabase-js` (works on Node).
2. **Replace `Deno.serve` + `Deno.env.get`** with Express handlers + `process.env`.
3. **Replace `EdgeRuntime.waitUntil`** with a real job queue. Recommended: BullMQ (Redis) or pg-boss (Postgres). Don't use `setImmediate` — process restarts will lose work mid-research.
4. **Add auth middleware in front of every route.** Verify the caller's JWT against your Supabase JWKS endpoint (`https://<project>.supabase.co/auth/v1/.well-known/jwks.json`) and check `app_role`. The original functions trust callers because RLS protected the data layer; if you're now running over a public API, you must validate.
5. **Service-role key handling:** your Express server holds full DB access. Treat that key the way you'd treat an AWS root key — never log, never expose, rotate on incident.
6. **Anthropic prompt caching:** keep the system blocks **byte-identical** in the same order between calls; otherwise the cache breaks. The helpers in `_shared/playbook.ts` already do this — preserve them.
7. **Replicate the `usage_logs` insert path.** Pricing table in `_shared/usage.ts` is current as of 2026-05; update when Anthropic changes prices.
8. **GoWinston/Originality.ai:** secret named `ORIGINALITY_API_KEY` is actually a GoWinston key. The endpoint is `https://api.gowinston.ai/v2/ai-content-detection`.
9. **CORS:** mirror the headers above, especially the `x-supabase-client-*` allow-headers if the frontend continues to use `supabase.functions.invoke()` against your new endpoints (set up `functions.invoke` to point at your Express base URL via the Supabase client config).
10. **Realtime dependency:** `propose-brief` and `research-generate` rely on the frontend subscribing to `projects` and `research_briefs` realtime updates to know when background work finishes. If you migrate the DB too, ensure realtime is enabled on those tables in your new Supabase project.

# Things to flag / would re-design from scratch

- **`research-generate` `mergeSubStatus` is a read-modify-write race** on `research_briefs.sub_status`. Replace with a Postgres function that does `jsonb_set` server-side, or split each stage's status into its own column.
- **Citation count regex is duplicated** between `draft-section/index.ts` (countInlineCitations) and the frontend `DraftReview` panel. Extract into a shared util when porting so they can never drift again.
- **`interview-step` returns plain text + regex parsing.** Convert to a tool call (`submit_interview_step` with `reaction` + `next_question` properties) for robustness.
- **`final-stitch` schema dedup keeps "first" arbitrarily.** Decide whether to merge or last-write-wins explicitly.
- **`propose-brief` ignores `temperature`.** Default is 1.0 — fine for creative research but lock it (e.g. 0.7) once outputs are stable so reruns are more reproducible.
- **No retries on `outline-generate`, `draft-section`, `final-stitch`, `interview-step`.** Only `propose-brief` retries on 5xx/429. Add retry middleware in the Express port.
- **`playbook-upload` and `playbook-reparse` have no auth.** They rely on the admin-only frontend. In Express, hard-gate them to `has_role('admin')`.
- **Section 0 ("Preamble") parsing exists but is intentionally excluded** via `NEVER_INCLUDE = [0]`. Don't "fix" this — it's by design.

