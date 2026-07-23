/**
 * Ahrefs tool execution handler.
 *
 * Receives a tool_use block from Anthropic, routes to the appropriate
 * Phase 3 cache helper, and returns a tool_result block.
 *
 * Failed calls and budget-exceeded calls still count against budget to
 * prevent runaway retry loops (matches dispatch spec).
 */
import { getDomainAuthority, getBacklinkSummary, getKeywordData } from "./cache.js";

export interface CallBudget {
  remaining: number;
  used: number;
}

export interface AhrefsToolUse {
  name: string;
  input: Record<string, unknown>;
  id: string;
}

export interface AhrefsToolResult {
  toolResultBlock: {
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: true;
  };
  budgetUsed: number;
}

/**
 * Execute a single Ahrefs tool_use block from Anthropic.
 * Returns a tool_result block to feed back into the message loop.
 */
export async function executeAhrefsTool(
  brandId: string,
  projectId: string,
  toolUse: AhrefsToolUse,
  callBudget: CallBudget,
): Promise<AhrefsToolResult> {
  const opts = { projectId };

  // ── Budget enforcement ────────────────────────────────────────────────
  if (callBudget.remaining <= 0) {
    return {
      toolResultBlock: {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: `Error: Ahrefs tool budget exceeded (${callBudget.used}/5 calls used). Continue generating without additional SEO data.`,
        is_error: true,
      },
      budgetUsed: 0,
    };
  }

  // ── Dispatch to cache helper ──────────────────────────────────────────
  try {
    let result: unknown;

    switch (toolUse.name) {
      case "get_domain_authority": {
        const domain = String(toolUse.input["domain"] ?? "");
        if (!domain) throw new Error("domain parameter is required");
        result = await getDomainAuthority(brandId, domain, opts);
        break;
      }
      case "get_backlink_summary": {
        const url = String(toolUse.input["url"] ?? "");
        if (!url) throw new Error("url parameter is required");
        result = await getBacklinkSummary(brandId, url, opts);
        break;
      }
      case "get_keyword_data": {
        const keyword = String(toolUse.input["keyword"] ?? "");
        const country = String(toolUse.input["country"] ?? "us");
        if (!keyword) throw new Error("keyword parameter is required");
        result = await getKeywordData(brandId, keyword, country, opts);
        break;
      }
      default:
        throw new Error(`Unknown Ahrefs tool: ${toolUse.name}`);
    }

    return {
      toolResultBlock: {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      },
      budgetUsed: 1,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolResultBlock: {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: `Error: ${message}. Continue without this SEO data.`,
        is_error: true,
      },
      budgetUsed: 1, // failed calls count — prevents budget-exhaustion via error loops
    };
  }
}
