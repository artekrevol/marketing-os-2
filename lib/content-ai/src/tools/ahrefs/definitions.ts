/**
 * Ahrefs tool definitions exposed to Anthropic during generation.
 * These define the tools Anthropic CAN call; our handler routes each
 * call through the cache helpers in cache.ts which talk to Ahrefs MCP.
 *
 * Tool names here are our INTERNAL names (what Anthropic sees).
 * The mapping to Ahrefs MCP tool names happens in the cache helpers.
 */

export const AHREFS_TOOL_DEFINITIONS = [
  {
    name: "get_domain_authority",
    description:
      "Get Domain Rating (DR) for a domain. Use this to verify citation authority before referencing a domain. Only cite domains with DR ≥ 80 per brand editorial rules. Accepts bare domains without protocol (e.g. 'statista.com', 'hbr.org').",
    input_schema: {
      type: "object" as const,
      properties: {
        domain: {
          type: "string",
          description:
            "The domain to look up. Do not include protocol, www prefix, or path (e.g. 'statista.com', not 'https://www.statista.com/page').",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "get_backlink_summary",
    description:
      "Get backlink profile summary for a specific URL. Returns total backlinks and referring domains. Use when evaluating whether to reference a competitor page or external resource.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description:
            "The full URL to analyze (e.g. 'https://example.com/page').",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "get_keyword_data",
    description:
      "Get search volume, keyword difficulty, and CPC for a keyword. Use when writing about a topic and needing to verify search demand or difficulty for a term not already provided in the brief.",
    input_schema: {
      type: "object" as const,
      properties: {
        keyword: {
          type: "string",
          description: "The keyword phrase to look up.",
        },
        country: {
          type: "string",
          description:
            "ISO 3166-1 alpha-2 country code (default: 'us').",
          default: "us",
        },
      },
      required: ["keyword"],
    },
  },
] as const;

/** Set of Ahrefs tool names — used to distinguish Ahrefs tool_use blocks from other tool calls. */
export const AHREFS_TOOL_NAME_SET: Set<string> = new Set(
  AHREFS_TOOL_DEFINITIONS.map((t) => t.name),
);

/**
 * System prompt instruction appended when Ahrefs tools are available.
 * Injected at the call site so it's byte-identical per prompt-cache rules.
 */
export const AHREFS_SYSTEM_ADDENDUM = `\n\nSEO TOOL ACCESS: You have access to three Ahrefs SEO tools during this generation:
- get_domain_authority(domain) — verify DR before citing. Only cite domains with DR ≥ 80.
- get_backlink_summary(url) — check backlink profile for a resource before referencing it.
- get_keyword_data(keyword, country) — get search volume and difficulty for a term not in the brief.

Budget: up to 5 total tool calls across this generation. Prioritize domain authority checks for external citations. Only call tools when the data materially affects the content. If a tool call fails or budget is exceeded, continue writing without that data.`;
