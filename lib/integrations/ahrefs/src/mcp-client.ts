/**
 * AhrefsMCPClient — typed MCP client for Ahrefs SEO data tools.
 *
 * Transport: Streamable HTTP (NOT SSE — that transport is deprecated).
 * Endpoint:  https://api.ahrefs.com/mcp/mcp
 * Auth:      Authorization: Bearer $AHREFS_MCP_KEY
 *
 * Tool names confirmed via live tools/list call (2026-07-23):
 *   site-explorer-domain-rating   — DR for a domain (required: target, date)
 *   site-explorer-backlinks-stats — backlink count + refdomains (required: target, date)
 *   keywords-explorer-overview    — volume / difficulty / cpc (required: select, country)
 *
 * Response shapes verified against live Ahrefs MCP responses (see inline notes).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface MCPCallResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  unitsConsumed: number;
  latencyMs: number;
}

export interface DomainAuthorityData {
  dr: number;
  /** UR not returned by site-explorer-domain-rating; always 0 */
  ur: number;
  /** ref_domains_count not returned by site-explorer-domain-rating; always 0 */
  refDomainsCount: number;
  /** backlinks_count not returned by site-explorer-domain-rating; always 0 */
  backlinksCount: number;
}

export interface BacklinkSummaryData {
  totalBacklinks: number;
  referringDomains: number;
  /** Dofollow not broken out by site-explorer-backlinks-stats; always 0 */
  dofollowBacklinks: number;
  /** Top anchors not returned by site-explorer-backlinks-stats; always [] */
  topAnchors: Array<{ anchor: string; count: number }>;
}

export interface KeywordData {
  volume: number;
  keywordDifficulty: number;
  /** CPC in Ahrefs native unit (integer, typically cents) */
  cpc: number;
  parentTopic: string | null;
}

export interface SubscriptionUsage {
  unitsLimitWorkspace: number;
  unitsUsageWorkspace: number;
  usageResetDate: string;
  subscription: string;
}

export interface AhrefsMCPConfig {
  mcpKey: string;
  mcpUrl: string;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const MCP_ENDPOINT = "https://api.ahrefs.com/mcp/mcp";
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

/**
 * Ahrefs MCP tool names, confirmed live on 2026-07-23.
 * Update if Ahrefs renames tools in a future API version.
 */
export const AHREFS_TOOL_NAMES = {
  /** site-explorer-domain-rating: DR for a domain/URL */
  DOMAIN_RATING: "site-explorer-domain-rating",
  /** site-explorer-backlinks-stats: total backlinks + referring domains */
  BACKLINKS_STATS: "site-explorer-backlinks-stats",
  /** keywords-explorer-overview: volume / difficulty / cpc */
  KEYWORDS_OVERVIEW: "keywords-explorer-overview",
  /** subscription-info-limits-and-usage: workspace unit budget & usage */
  SUBSCRIPTION_INFO: "subscription-info-limits-and-usage",
} as const;

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

export class AhrefsMCPClient {
  private readonly config: AhrefsMCPConfig;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(config: AhrefsMCPConfig) {
    this.config = config;
  }

  /** Lazily initialise and return the MCP Client. Reconnects if closed. */
  private async getClient(): Promise<Client> {
    if (this.client) return this.client;

    const url = new URL(this.config.mcpUrl || MCP_ENDPOINT);
    this.transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${this.config.mcpKey}`,
        },
      },
    });

    this.client = new Client(
      { name: "@workspace/ahrefs", version: "1.0.0" },
      { capabilities: {} },
    );

    await this.client.connect(this.transport);
    return this.client;
  }

  /**
   * Discover and return the list of tools exposed by the Ahrefs MCP server.
   * Used during Phase 2 smoke test to verify tool names.
   */
  async listTools(): Promise<Array<{ name: string; description: string }>> {
    const client = await this.getClient();
    const result = await client.listTools();
    return (result.tools ?? []).map(
      (t: { name: string; description?: string }) => ({
        name: t.name,
        description: t.description ?? "",
      }),
    );
  }

  /**
   * Get Domain Rating (DR) for a domain.
   *
   * Live response shape (2026-07-23):
   *   { "domain_rating": { "domain_rating": 93.0, "ahrefs_rank": 194 } }
   *
   * UR, refDomainsCount, backlinksCount are not returned by this endpoint
   * and will be 0 in the result. DR is the primary citation-vetting metric.
   */
  async callDomainAuthority(
    domain: string,
  ): Promise<MCPCallResult<DomainAuthorityData>> {
    return this.callWithRetry<DomainAuthorityData>(
      AHREFS_TOOL_NAMES.DOMAIN_RATING,
      { target: domain, date: todayISO() },
      (raw) => this.parseDomainAuthority(raw),
    );
  }

  /**
   * Get backlink profile summary for a domain or URL.
   *
   * Live response shape (2026-07-23):
   *   { "metrics": { "live": 79741, "all_time": 1021346,
   *                  "live_refdomains": 10711, "all_time_refdomains": 28083 } }
   *
   * dofollowBacklinks and topAnchors are not broken out by this endpoint.
   */
  async callBacklinkSummary(
    url: string,
  ): Promise<MCPCallResult<BacklinkSummaryData>> {
    return this.callWithRetry<BacklinkSummaryData>(
      AHREFS_TOOL_NAMES.BACKLINKS_STATS,
      { target: url, date: todayISO(), mode: "url" },
      (raw) => this.parseBacklinkSummary(raw),
    );
  }

  /**
   * Get search volume, keyword difficulty, and CPC for a keyword.
   *
   * Live response shape (2026-07-23):
   *   { "keywords": [{ "volume": 349000, "difficulty": 53, "cpc": 250,
   *                    "parent_topic": "mobile app development",
   *                    "keyword": "mobile app development" }] }
   *
   * CPC is in Ahrefs' native unit (integer). difficulty ≈ 0–100.
   */
  async callKeywordData(
    keyword: string,
    country = "us",
  ): Promise<MCPCallResult<KeywordData>> {
    return this.callWithRetry<KeywordData>(
      AHREFS_TOOL_NAMES.KEYWORDS_OVERVIEW,
      {
        keywords: keyword,
        country,
        select: "volume,difficulty,cpc,parent_topic,keyword",
      },
      (raw) => this.parseKeywordData(raw),
    );
  }

  /**
   * Retrieve current workspace subscription usage.
   * Used for budget monitoring in the admin surface (Phase 5).
   */
  async getSubscriptionUsage(): Promise<MCPCallResult<SubscriptionUsage>> {
    return this.callWithRetry<SubscriptionUsage>(
      AHREFS_TOOL_NAMES.SUBSCRIPTION_INFO,
      {},
      (raw) => this.parseSubscriptionUsage(raw),
    );
  }

  /** Close the MCP client connection gracefully. */
  async close(): Promise<void> {
    if (this.transport) {
      await this.transport.close().catch(() => {});
      this.transport = null;
      this.client = null;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Internal helpers                                                          */
  /* ------------------------------------------------------------------------ */

  private async callWithRetry<T>(
    toolName: string,
    args: Record<string, unknown>,
    parse: (raw: unknown) => T,
  ): Promise<MCPCallResult<T>> {
    const t0 = Date.now();
    let lastError = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        // Force reconnect on retry — transport may have gone stale
        await this.close();
      }

      try {
        const client = await this.getClient();
        const result = await client.callTool({ name: toolName, arguments: args });

        const latencyMs = Date.now() - t0;
        const content = result.content as Array<{
          type: string;
          text?: string;
        }>;
        const textBlock = content.find((c) => c.type === "text");

        if (!textBlock?.text) {
          lastError = "MCP response contained no text content block";
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(textBlock.text);
        } catch {
          lastError = `MCP response is not valid JSON: ${textBlock.text.slice(0, 200)}`;
          continue;
        }

        const data = parse(parsed);
        return {
          success: true,
          data,
          unitsConsumed: extractUnitsConsumed(parsed),
          latencyMs,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = msg;

        // Non-retriable: auth failures, invalid tool names, bad params
        if (
          msg.includes("401") ||
          msg.includes("403") ||
          msg.includes("Tool not found") ||
          msg.includes("Unknown tool") ||
          msg.includes("-32602") // invalid params — won't improve on retry
        ) {
          break;
        }
      }
    }

    return {
      success: false,
      error: lastError,
      unitsConsumed: 0,
      latencyMs: Date.now() - t0,
    };
  }

  /* ---------- response parsers — match live Ahrefs MCP shapes ---------- */

  private parseDomainAuthority(raw: unknown): DomainAuthorityData {
    // { "domain_rating": { "domain_rating": 93.0, "ahrefs_rank": 194 } }
    const d = raw as Record<string, unknown>;
    const inner = (d["domain_rating"] as Record<string, unknown>) ?? {};
    return {
      dr: toNumber(inner["domain_rating"] ?? 0),
      ur: 0, // not returned by site-explorer-domain-rating
      refDomainsCount: 0, // not returned by site-explorer-domain-rating
      backlinksCount: 0, // not returned by site-explorer-domain-rating
    };
  }

  private parseBacklinkSummary(raw: unknown): BacklinkSummaryData {
    // { "metrics": { "live": 79741, "all_time": 1021346,
    //                "live_refdomains": 10711, "all_time_refdomains": 28083 } }
    const d = raw as Record<string, unknown>;
    const metrics = (d["metrics"] as Record<string, unknown>) ?? {};
    return {
      totalBacklinks: toNumber(metrics["live"] ?? 0),
      referringDomains: toNumber(metrics["live_refdomains"] ?? 0),
      dofollowBacklinks: 0, // not broken out by site-explorer-backlinks-stats
      topAnchors: [], // requires separate site-explorer-anchors call
    };
  }

  private parseKeywordData(raw: unknown): KeywordData {
    // { "keywords": [{ "volume": 349000, "difficulty": 53, "cpc": 250,
    //                  "parent_topic": "mobile app development" }] }
    const d = raw as Record<string, unknown>;
    const keywords = Array.isArray(d["keywords"]) ? d["keywords"] : [];
    const kw = (keywords[0] as Record<string, unknown>) ?? {};
    return {
      volume: toNumber(kw["volume"] ?? 0),
      keywordDifficulty: toNumber(kw["difficulty"] ?? 0),
      cpc: toNumber(kw["cpc"] ?? 0),
      parentTopic:
        typeof kw["parent_topic"] === "string" ? kw["parent_topic"] : null,
    };
  }

  private parseSubscriptionUsage(raw: unknown): SubscriptionUsage {
    // { "limits_and_usage": { "subscription": "...", "units_limit_workspace": 400000,
    //                         "units_usage_workspace": 11413, "usage_reset_date": "..." } }
    const d = raw as Record<string, unknown>;
    const info = (d["limits_and_usage"] as Record<string, unknown>) ?? {};
    return {
      unitsLimitWorkspace: toNumber(info["units_limit_workspace"] ?? 400000),
      unitsUsageWorkspace: toNumber(info["units_usage_workspace"] ?? 0),
      usageResetDate: String(info["usage_reset_date"] ?? ""),
      subscription: String(info["subscription"] ?? ""),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton factory                                                           */
/* -------------------------------------------------------------------------- */

let _instance: AhrefsMCPClient | null = null;

/** Returns the process-level singleton AhrefsMCPClient. Lazily initialised. */
export function getAhrefsMCPClient(): AhrefsMCPClient {
  if (!_instance) {
    const mcpKey = process.env["AHREFS_MCP_KEY"];
    if (!mcpKey) throw new Error("AHREFS_MCP_KEY environment variable is not set");
    _instance = new AhrefsMCPClient({ mcpKey, mcpUrl: MCP_ENDPOINT });
  }
  return _instance;
}

/** Close and release the singleton. Call on SIGTERM. */
export async function closeAhrefsMCPClient(): Promise<void> {
  if (_instance) {
    await _instance.close();
    _instance = null;
  }
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                   */
/* -------------------------------------------------------------------------- */

function toNumber(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Today's date as YYYY-MM-DD (UTC), required by most Ahrefs MCP tools. */
function todayISO(): string {
  return new Date().toISOString().split("T")[0]!;
}

/**
 * Attempt to read Ahrefs' reported unit consumption from the response body.
 * Ahrefs may include `units_consumed` or similar; falls back to 0 if absent.
 */
function extractUnitsConsumed(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const d = raw as Record<string, unknown>;
  return toNumber(d["units_consumed"] ?? d["unitsConsumed"] ?? d["api_units"] ?? 0);
}
