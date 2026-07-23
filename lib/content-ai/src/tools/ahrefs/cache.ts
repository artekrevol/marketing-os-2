/**
 * Phase 3 — Ahrefs cached tool helpers.
 *
 * Cache-first architecture:
 *   Redis (5-min hot cache) → Postgres (7-day for DR; no Postgres for backlinks/keywords)
 *   → Ahrefs MCP on cache miss
 *
 * Every call — hit or miss — is logged to `ahrefs_mcp_usage`.
 * Every MCP call also emits a `module_data_provenance` row.
 *
 * Sentinel UUID for entity_id when no projectId is available:
 *   entity_id is uuid NOT NULL in module_data_provenance, so we use
 *   '00000000-0000-0000-0000-000000000000' as the "system" sentinel.
 */
import { createHash } from "crypto";
import {
  db,
  domainAuthorityCacheTable,
  ahrefsMcpUsageTable,
  moduleDataProvenanceTable,
} from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { getRedisConnection } from "@workspace/jobs";
import {
  getAhrefsMCPClient,
  type DomainAuthorityData,
  type BacklinkSummaryData,
  type KeywordData,
} from "@workspace/ahrefs";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Fallback entity_id UUID when no projectId is available (uuid NOT NULL constraint). */
const SYSTEM_ENTITY_ID = "00000000-0000-0000-0000-000000000000";

/** Redis TTL for hot cache (seconds). */
const REDIS_TTL_SECONDS = 5 * 60; // 5 minutes

/** Postgres staleness threshold for domain authority (ms). */
const DR_POSTGRES_STALENESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Redis TTL for backlink summaries (seconds). */
const BACKLINKS_REDIS_TTL = 24 * 60 * 60; // 24 hours

/** Redis TTL for keyword data (seconds). */
const KEYWORD_REDIS_TTL = 7 * 24 * 60 * 60; // 7 days

/* -------------------------------------------------------------------------- */
/* Domain normalization                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Normalise a domain for use as a cache key. Handles:
 *   "https://www.statista.com/" → "statista.com"
 *   "Statista.com"             → "statista.com"
 *   "www.statista.com"         → "statista.com"
 */
export function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* 3.1 getDomainAuthority                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cache-first DR lookup. Redis → Postgres (7-day TTL) → Ahrefs MCP.
 *
 * Used by Anthropic tool `get_domain_authority` during draft-section /
 * final-stitch generation to verify citation authority (DR ≥ 80 rule).
 */
export async function getDomainAuthority(
  brandId: string,
  domain: string,
  opts: { projectId?: string | null } = {},
): Promise<DomainAuthorityData> {
  const normalizedDomain = normalizeDomain(domain);
  const redisKey = `ahrefs:dr:${brandId}:${normalizedDomain}`;
  const redis = getRedisConnection();

  // ── 1. Redis hot cache ──────────────────────────────────────────────────
  const cached = await redis.get(redisKey).catch(() => null);
  if (cached) {
    await logAhrefsUsage({
      brandId,
      toolName: "get_domain_authority",
      params: normalizedDomain,
      cacheHit: true,
      source: "redis",
      projectId: opts.projectId,
    });
    return JSON.parse(cached) as DomainAuthorityData;
  }

  // ── 2. Postgres cache (7-day staleness) ─────────────────────────────────
  const staleThreshold = new Date(Date.now() - DR_POSTGRES_STALENESS_MS);
  const rows = await db
    .select()
    .from(domainAuthorityCacheTable)
    .where(
      and(
        eq(domainAuthorityCacheTable.brandId, brandId),
        eq(domainAuthorityCacheTable.domain, normalizedDomain),
        gte(domainAuthorityCacheTable.lastMeasured, staleThreshold),
      ),
    )
    .limit(1);

  if (rows[0]) {
    const row = rows[0];
    const data: DomainAuthorityData = {
      dr: Number(row.dr ?? 0),
      ur: Number(row.ur ?? 0),
      refDomainsCount: row.refDomainsCount ?? 0,
      backlinksCount: row.backlinksCount ?? 0,
    };
    // Refresh Redis from Postgres hit
    await redis.setex(redisKey, REDIS_TTL_SECONDS, JSON.stringify(data)).catch(() => {});
    await logAhrefsUsage({
      brandId,
      toolName: "get_domain_authority",
      params: normalizedDomain,
      cacheHit: true,
      source: "postgres",
      projectId: opts.projectId,
    });
    return data;
  }

  // ── 3. Cache miss — call Ahrefs MCP ─────────────────────────────────────
  const client = getAhrefsMCPClient();
  const mcpResult = await client.callDomainAuthority(normalizedDomain);

  await logAhrefsUsage({
    brandId,
    toolName: "get_domain_authority",
    params: normalizedDomain,
    cacheHit: false,
    source: "mcp",
    unitsConsumed: mcpResult.unitsConsumed,
    error: mcpResult.success ? undefined : mcpResult.error,
    projectId: opts.projectId,
  });

  if (!mcpResult.success || !mcpResult.data) {
    throw new Error(`Ahrefs DR lookup failed for "${normalizedDomain}": ${mcpResult.error}`);
  }

  const data = mcpResult.data;

  // ── 4. Persist to Postgres cache ─────────────────────────────────────────
  await db
    .insert(domainAuthorityCacheTable)
    .values({
      brandId,
      domain: normalizedDomain,
      dr: String(data.dr),
      ur: data.ur > 0 ? String(data.ur) : null,
      refDomainsCount: data.refDomainsCount > 0 ? data.refDomainsCount : null,
      backlinksCount: data.backlinksCount > 0 ? data.backlinksCount : null,
      lastMeasured: new Date(),
      sourceProvider: "ahrefs_mcp",
      sourceMetadata: { latencyMs: mcpResult.latencyMs } as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [domainAuthorityCacheTable.brandId, domainAuthorityCacheTable.domain],
      set: {
        dr: String(data.dr),
        ur: data.ur > 0 ? String(data.ur) : null,
        refDomainsCount: data.refDomainsCount > 0 ? data.refDomainsCount : null,
        backlinksCount: data.backlinksCount > 0 ? data.backlinksCount : null,
        lastMeasured: new Date(),
        updatedAt: new Date(),
        sourceMetadata: { latencyMs: mcpResult.latencyMs } as Record<string, unknown>,
      },
    })
    .catch((err) => {
      console.warn("[ahrefs] domain_authority_cache insert failed:", err?.message);
    });

  // ── 5. Warm Redis ──────────────────────────────────────────────────────
  await redis.setex(redisKey, REDIS_TTL_SECONDS, JSON.stringify(data)).catch(() => {});

  return data;
}

/* -------------------------------------------------------------------------- */
/* 3.2 getBacklinkSummary                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cache-first backlink summary. Redis only (24-hour TTL) — backlink counts
 * change fast enough that Postgres persistence is not worth the extra writes.
 */
export async function getBacklinkSummary(
  brandId: string,
  url: string,
  opts: { projectId?: string | null } = {},
): Promise<BacklinkSummaryData> {
  const normalizedUrl = normalizeUrl(url);
  const redisKey = `ahrefs:bl:${brandId}:${hashShort(normalizedUrl)}`;
  const redis = getRedisConnection();

  // ── 1. Redis hot cache ──────────────────────────────────────────────────
  const cached = await redis.get(redisKey).catch(() => null);
  if (cached) {
    await logAhrefsUsage({
      brandId,
      toolName: "get_backlink_summary",
      params: normalizedUrl,
      cacheHit: true,
      source: "redis",
      projectId: opts.projectId,
    });
    return JSON.parse(cached) as BacklinkSummaryData;
  }

  // ── 2. Cache miss — call Ahrefs MCP ─────────────────────────────────────
  const client = getAhrefsMCPClient();
  const mcpResult = await client.callBacklinkSummary(normalizedUrl);

  await logAhrefsUsage({
    brandId,
    toolName: "get_backlink_summary",
    params: normalizedUrl,
    cacheHit: false,
    source: "mcp",
    unitsConsumed: mcpResult.unitsConsumed,
    error: mcpResult.success ? undefined : mcpResult.error,
    projectId: opts.projectId,
  });

  if (!mcpResult.success || !mcpResult.data) {
    throw new Error(`Ahrefs backlink summary failed for "${normalizedUrl}": ${mcpResult.error}`);
  }

  const data = mcpResult.data;

  // ── 3. Warm Redis (24h TTL) ────────────────────────────────────────────
  await redis.setex(redisKey, BACKLINKS_REDIS_TTL, JSON.stringify(data)).catch(() => {});

  return data;
}

/* -------------------------------------------------------------------------- */
/* 3.3 getKeywordData                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Cache-first keyword data. Redis only (7-day TTL).
 * Cache key includes country to avoid cross-country collisions.
 */
export async function getKeywordData(
  brandId: string,
  keyword: string,
  country = "us",
  opts: { projectId?: string | null } = {},
): Promise<KeywordData> {
  const normalizedKeyword = keyword.trim().toLowerCase();
  const normalizedCountry = country.trim().toLowerCase();
  const redisKey = `ahrefs:kw:${brandId}:${normalizedCountry}:${hashShort(normalizedKeyword)}`;
  const redis = getRedisConnection();

  // ── 1. Redis hot cache ──────────────────────────────────────────────────
  const cached = await redis.get(redisKey).catch(() => null);
  if (cached) {
    await logAhrefsUsage({
      brandId,
      toolName: "get_keyword_data",
      params: `${normalizedKeyword}::${normalizedCountry}`,
      cacheHit: true,
      source: "redis",
      projectId: opts.projectId,
    });
    return JSON.parse(cached) as KeywordData;
  }

  // ── 2. Cache miss — call Ahrefs MCP ─────────────────────────────────────
  const client = getAhrefsMCPClient();
  const mcpResult = await client.callKeywordData(normalizedKeyword, normalizedCountry);

  await logAhrefsUsage({
    brandId,
    toolName: "get_keyword_data",
    params: `${normalizedKeyword}::${normalizedCountry}`,
    cacheHit: false,
    source: "mcp",
    unitsConsumed: mcpResult.unitsConsumed,
    error: mcpResult.success ? undefined : mcpResult.error,
    projectId: opts.projectId,
  });

  if (!mcpResult.success || !mcpResult.data) {
    throw new Error(`Ahrefs keyword data failed for "${normalizedKeyword}": ${mcpResult.error}`);
  }

  const data = mcpResult.data;

  // ── 3. Warm Redis (7-day TTL) ─────────────────────────────────────────
  await redis.setex(redisKey, KEYWORD_REDIS_TTL, JSON.stringify(data)).catch(() => {});

  return data;
}

/* -------------------------------------------------------------------------- */
/* 3.4 logAhrefsUsage — common usage + provenance logger                      */
/* -------------------------------------------------------------------------- */

interface AhrefsUsageLog {
  brandId: string;
  toolName: string;
  params: string;
  cacheHit: boolean;
  source?: "redis" | "postgres" | "mcp";
  unitsConsumed?: number;
  error?: string;
  projectId?: string | null;
}

export async function logAhrefsUsage(args: AhrefsUsageLog): Promise<void> {
  const { brandId, toolName, params, cacheHit, source, unitsConsumed = 0, error, projectId } = args;

  // ── 1. Write to ahrefs_mcp_usage ─────────────────────────────────────
  const usageInsert = db
    .insert(ahrefsMcpUsageTable)
    .values({
      brandId,
      toolName,
      paramsHash: hashParams(params),
      cacheHit,
      unitsConsumed,
      responseStatus: error ? "error" : "success",
      errorMessage: error ?? null,
      projectId: projectId ?? null,
      metadata: { source: source ?? null } as Record<string, unknown>,
    })
    .catch((err) => {
      console.warn("[ahrefs] ahrefs_mcp_usage insert failed:", err?.message);
    });

  // ── 2. Emit module_data_provenance row ────────────────────────────────
  // entity_id is uuid NOT NULL — use projectId if valid UUID, else sentinel.
  const entityId = isUuid(projectId) ? projectId! : SYSTEM_ENTITY_ID;
  const provenanceInsert = db
    .insert(moduleDataProvenanceTable)
    .values({
      brandId,
      entityType: "ahrefs_mcp_call",
      entityId,
      sourceModule: "content-ai",
      generationMethod: toolName,
      metadata: {
        cacheHit,
        source: source ?? null,
        unitsConsumed,
        ...(error ? { error } : {}),
      } as Record<string, unknown>,
    })
    .catch((err) => {
      console.warn("[ahrefs] module_data_provenance insert failed:", err?.message);
    });

  await Promise.all([usageInsert, provenanceInsert]);
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                   */
/* -------------------------------------------------------------------------- */

/** SHA-256 hex of a string — used as params_hash in ahrefs_mcp_usage. */
function hashParams(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Short 16-char prefix of SHA-256 for Redis key space efficiency. */
function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Normalize a URL for use as a cache key — lowercase host, strip trailing slash. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    // Lowercase host, preserve path, strip trailing slash
    return `${u.protocol}//${u.hostname}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

/** Returns true if value looks like a valid UUID (any version). */
function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
