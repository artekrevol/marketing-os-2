import { z } from "zod";

export const SerpItemSchema = z.object({
  type: z.string(),
  rank_group: z.number().int().nullable().optional(),
  rank_absolute: z.number().int().nullable().optional(),
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type SerpItem = z.infer<typeof SerpItemSchema>;

export const SerpResultSchema = z.object({
  keyword: z.string(),
  language_code: z.string().nullable().optional(),
  location_code: z.number().int().nullable().optional(),
  total_count: z.number().int().nullable().optional(),
  items: z.array(SerpItemSchema).default([]),
});

export const SerpResponseSchema = z.object({
  status_code: z.number().int(),
  status_message: z.string(),
  cost: z.number().nonnegative().default(0),
  tasks_count: z.number().int().default(0),
  tasks_error: z.number().int().default(0),
  tasks: z
    .array(
      z.object({
        id: z.string(),
        status_code: z.number().int(),
        status_message: z.string(),
        cost: z.number().nonnegative().default(0),
        result: z.array(SerpResultSchema).nullable().default([]),
      }),
    )
    .default([]),
});
export type SerpResponse = z.infer<typeof SerpResponseSchema>;

export interface SerpRequest {
  keyword: string;
  locationCode?: number; // default 2840 (US)
  languageCode?: string; // default 'en'
  depth?: number; // default 10
}

/**
 * Generic DataForSEO response envelope. Every v3 endpoint wraps its
 * payload in this shape: a top-level status + cost, then per-task
 * status + cost, then a nullable `result` array of endpoint-specific
 * items. Pass the result-item schema to specialise it.
 */
const dfsEnvelope = <T extends z.ZodTypeAny>(resultItem: T) =>
  z.object({
    status_code: z.number().int(),
    status_message: z.string(),
    cost: z.number().nonnegative().default(0),
    tasks_count: z.number().int().default(0),
    tasks_error: z.number().int().default(0),
    tasks: z
      .array(
        z.object({
          id: z.string(),
          status_code: z.number().int(),
          status_message: z.string(),
          cost: z.number().nonnegative().default(0),
          result: z.array(resultItem).nullable().default([]),
        }),
      )
      .default([]),
  });

/* ------------------------------------------------------------------ *
 * SERP — Google Organic Live Advanced
 * /serp/google/organic/live/advanced
 * Same envelope/result shape as the regular endpoint (reuses
 * SerpResponseSchema); the advanced endpoint returns richer item
 * metadata (rank_group/rank_absolute) already covered by SerpItem.
 * ------------------------------------------------------------------ */
export interface SerpAdvancedRequest {
  keyword: string;
  locationCode?: number; // default 2840 (US)
  languageCode?: string; // default 'en'
  depth?: number; // default 100
  device?: "desktop" | "mobile";
  os?: string;
}

/* ------------------------------------------------------------------ *
 * Keywords Data — Google Ads Search Volume
 * /keywords_data/google_ads/search_volume/live
 * Also reused for Keyword Ideas (keywords_for_keywords) which returns
 * the same per-keyword metric item shape.
 * ------------------------------------------------------------------ */
export const KeywordMetricItemSchema = z.object({
  keyword: z.string(),
  location_code: z.number().int().nullable().optional(),
  language_code: z.string().nullable().optional(),
  search_volume: z.number().int().nullable().optional(),
  cpc: z.number().nullable().optional(),
  competition: z.number().nullable().optional(),
  competition_level: z.string().nullable().optional(),
  competition_index: z.number().nullable().optional(),
});
export type KeywordMetricItem = z.infer<typeof KeywordMetricItemSchema>;

export const SearchVolumeResponseSchema = dfsEnvelope(KeywordMetricItemSchema);
export type SearchVolumeResponse = z.infer<typeof SearchVolumeResponseSchema>;

export interface SearchVolumeRequest {
  keywords: string[];
  locationCode?: number;
  languageCode?: string;
}

/* ------------------------------------------------------------------ *
 * Keyword Ideas — Google Ads Keywords-for-Keywords (LSI expansion)
 * /keywords_data/google_ads/keywords_for_keywords/live
 * ------------------------------------------------------------------ */
export const KeywordIdeasResponseSchema = dfsEnvelope(KeywordMetricItemSchema);
export type KeywordIdeasResponse = z.infer<typeof KeywordIdeasResponseSchema>;

export interface KeywordIdeasRequest {
  keywords: string[];
  locationCode?: number;
  languageCode?: string;
  limit?: number;
}

/* ------------------------------------------------------------------ *
 * DataForSEO Labs — Ranked Keywords (competitor insights)
 * /dataforseo_labs/google/ranked_keywords/live
 * Nested labs structure; kept lenient — only the fields competitor
 * insight computation needs are typed.
 * ------------------------------------------------------------------ */
export const RankedKeywordItemSchema = z.object({
  keyword_data: z
    .object({
      keyword: z.string().nullable().optional(),
      keyword_info: z
        .object({
          search_volume: z.number().int().nullable().optional(),
          cpc: z.number().nullable().optional(),
          competition: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  ranked_serp_element: z
    .object({
      serp_item: z
        .object({
          rank_group: z.number().int().nullable().optional(),
          rank_absolute: z.number().int().nullable().optional(),
          url: z.string().nullable().optional(),
          domain: z.string().nullable().optional(),
          title: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});
export type RankedKeywordItem = z.infer<typeof RankedKeywordItemSchema>;

export const RankedKeywordsResultSchema = z.object({
  target: z.string().nullable().optional(),
  total_count: z.number().int().nullable().optional(),
  items: z.array(RankedKeywordItemSchema).nullable().default([]),
});

export const RankedKeywordsResponseSchema = dfsEnvelope(RankedKeywordsResultSchema);
export type RankedKeywordsResponse = z.infer<typeof RankedKeywordsResponseSchema>;

export interface RankedKeywordsRequest {
  target: string; // domain or subdomain
  locationCode?: number;
  languageCode?: string;
  limit?: number;
}

/* ------------------------------------------------------------------ *
 * OnPage — Instant Pages (external citation grounding)
 * /on_page/instant_pages
 * ------------------------------------------------------------------ */
export const OnPageItemSchema = z
  .object({
    url: z.string().nullable().optional(),
    status_code: z.number().int().nullable().optional(),
    meta: z
      .object({
        title: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        content: z
          .object({
            plain_text_word_count: z.number().int().nullable().optional(),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();
export type OnPageItem = z.infer<typeof OnPageItemSchema>;

export const OnPageResultSchema = z.object({
  crawl_progress: z.string().nullable().optional(),
  items: z.array(OnPageItemSchema).nullable().default([]),
});

export const OnPageResponseSchema = dfsEnvelope(OnPageResultSchema);
export type OnPageResponse = z.infer<typeof OnPageResponseSchema>;

export interface OnPageInstantRequest {
  url: string;
  enableJavascript?: boolean;
}

/* ------------------------------------------------------------------ *
 * DataForSEO Labs — Related Keywords
 * /dataforseo_labs/google/related_keywords/live
 * Returns semantically related keywords for a seed term, with full
 * keyword metrics. The `depth` field reflects how many hops away from
 * the seed the keyword was found (1 = direct, 2 = related-of-related).
 * ------------------------------------------------------------------ */
export const RelatedKeywordItemSchema = z.object({
  keyword_data: z
    .object({
      keyword: z.string().nullable().optional(),
      keyword_info: z
        .object({
          search_volume: z.number().int().nullable().optional(),
          cpc: z.number().nullable().optional(),
          competition: z.number().nullable().optional(),
          keyword_difficulty: z.number().int().nullable().optional(),
        })
        .nullable()
        .optional(),
      impressions_info: z
        .object({
          ad_position_min: z.number().nullable().optional(),
          cpc_min: z.number().nullable().optional(),
          daily_impressions_max: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  depth: z.number().int().nullable().optional(),
  related_keywords: z.array(z.string()).nullable().optional(),
});
export type RelatedKeywordItem = z.infer<typeof RelatedKeywordItemSchema>;

export const RelatedKeywordsResultSchema = z.object({
  seed_keyword: z.string().nullable().optional(),
  location_code: z.number().int().nullable().optional(),
  language_code: z.string().nullable().optional(),
  total_count: z.number().int().nullable().optional(),
  items_count: z.number().int().nullable().optional(),
  items: z.array(RelatedKeywordItemSchema).nullable().default([]),
});

export const RelatedKeywordsResponseSchema = dfsEnvelope(RelatedKeywordsResultSchema);
export type RelatedKeywordsResponse = z.infer<typeof RelatedKeywordsResponseSchema>;

export interface RelatedKeywordsRequest {
  keyword: string;
  locationCode?: number;   // default 2840 (US)
  languageCode?: string;   // default 'en'
  /** Max keywords returned per seed. DataForSEO cap is 1000. Default 500. */
  limit?: number;
  /** How many levels of "related-of-related" to expand. Default 1. */
  depth?: number;
  /** Optional dispatch context label for cost attribution (≤120 chars). */
  dispatchContext?: string;
}

/* ------------------------------------------------------------------ *
 * DataForSEO Labs — Competitors for Domain
 * /dataforseo_labs/google/competitors_for_domain/live
 * Returns domains that rank for many of the same keywords as the
 * target domain. Used for weekly competitor discovery (Phase 3 Step D).
 * ------------------------------------------------------------------ */
export const CompetitorDomainItemSchema = z.object({
  domain: z.string().nullable().optional(),
  avg_position: z.number().nullable().optional(),
  /** Number of keywords this competitor shares with the target domain. */
  intersections: z.number().int().nullable().optional(),
  full_domain_metrics: z
    .object({
      organic: z
        .object({
          etv: z.number().nullable().optional(),
          count: z.number().int().nullable().optional(),
          is_new: z.number().int().nullable().optional(),
          is_up: z.number().int().nullable().optional(),
          is_down: z.number().int().nullable().optional(),
          is_lost: z.number().int().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});
export type CompetitorDomainItem = z.infer<typeof CompetitorDomainItemSchema>;

export const CompetitorsForDomainResultSchema = z.object({
  target: z.string().nullable().optional(),
  location_code: z.number().int().nullable().optional(),
  language_code: z.string().nullable().optional(),
  total_count: z.number().int().nullable().optional(),
  items_count: z.number().int().nullable().optional(),
  items: z.array(CompetitorDomainItemSchema).nullable().default([]),
});

export const CompetitorsForDomainResponseSchema = dfsEnvelope(
  CompetitorsForDomainResultSchema,
);
export type CompetitorsForDomainResponse = z.infer<
  typeof CompetitorsForDomainResponseSchema
>;

export interface CompetitorsForDomainRequest {
  target: string;          // domain or subdomain
  locationCode?: number;
  languageCode?: string;
  /** Max competitors returned. DataForSEO cap is 1000. Default 100. */
  limit?: number;
  /** Optional dispatch context label for cost attribution (≤120 chars). */
  dispatchContext?: string;
}

/* ------------------------------------------------------------------ *
 * DataForSEO Labs — Bulk Keyword Difficulty
 * /dataforseo_labs/google/bulk_keyword_difficulty/live
 * Batch keyword difficulty scores. Accepts up to 1000 keywords per
 * request. Used after related-keyword expansion to filter high-KD
 * candidates before DB insert.
 * ------------------------------------------------------------------ */
export const BulkKeywordDifficultyItemSchema = z.object({
  keyword: z.string(),
  keyword_difficulty: z.number().int().nullable().optional(),
});
export type BulkKeywordDifficultyItem = z.infer<
  typeof BulkKeywordDifficultyItemSchema
>;

export const BulkKeywordDifficultyResultSchema = z.object({
  location_code: z.number().int().nullable().optional(),
  language_code: z.string().nullable().optional(),
  items_count: z.number().int().nullable().optional(),
  items: z.array(BulkKeywordDifficultyItemSchema).nullable().default([]),
});

export const BulkKeywordDifficultyResponseSchema = dfsEnvelope(
  BulkKeywordDifficultyResultSchema,
);
export type BulkKeywordDifficultyResponse = z.infer<
  typeof BulkKeywordDifficultyResponseSchema
>;

export interface BulkKeywordDifficultyRequest {
  keywords: string[];
  locationCode?: number;
  languageCode?: string;
  /** Optional dispatch context label for cost attribution (≤120 chars). */
  dispatchContext?: string;
}

/* ------------------------------------------------------------------ *
 * SERP — Standard Queue (task_post / tasks_ready / task_get/regular)
 * Cheaper async alternative to live/advanced for bulk rank tracking.
 *
 * Pricing: $0.0006/SERP vs $0.00155/SERP for live/advanced (~61% saving).
 * Turnaround: ~1 min average (vs ~6s live). Fine for scheduled crawls.
 *
 * Flow:
 *   1. POST keywords → /serp/google/organic/task_post  (billed here)
 *   2. Poll          → /serp/google/organic/tasks_ready (free)
 *   3. GET results   → /serp/google/organic/task_get/regular/{id} (free)
 * ------------------------------------------------------------------ */

/** Input record for a single keyword in a task_post batch (up to 100/call). */
export interface SerpBulkTaskRequest {
  keyword: string;
  locationCode?: number;   // default 2840 (US)
  languageCode?: string;   // default 'en'
  /** Number of results to return. Billed per 10-result page. Default 60. */
  depth?: number;
  /**
   * Caller-supplied correlation label (≤255 chars) echoed back in the
   * task_post response and tasks_ready items.  Use the keyword's DB uuid
   * so results can be joined back to the originating Keyword row without
   * relying on response ordering.
   */
  tag?: string;
}

/**
 * task_post response.  Each tasks[i] contains the task UUID assigned by
 * DataForSEO and echoes the keyword / tag from the request via data{}.
 * result is always null here — actual SERP data comes from task_get.
 */
export const SerpTaskPostResponseSchema = z.object({
  status_code: z.number().int(),
  status_message: z.string(),
  cost: z.number().nonnegative().default(0),
  tasks_count: z.number().int().default(0),
  tasks_error: z.number().int().default(0),
  tasks: z
    .array(
      z.object({
        id: z.string(),
        status_code: z.number().int(),
        status_message: z.string(),
        cost: z.number().nonnegative().default(0),
        /** Echo of the request fields — keyword + tag for correlation. */
        data: z
          .object({
            keyword: z.string().nullable().optional(),
            tag: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
        result: z.unknown().nullable().optional(),
      }),
    )
    .default([]),
});
export type SerpTaskPostResponse = z.infer<typeof SerpTaskPostResponseSchema>;

/**
 * A single item returned by tasks_ready: a completed task ID plus the
 * endpoint paths needed to retrieve results (we use endpoint_regular).
 */
export const SerpTaskReadyItemSchema = z.object({
  id: z.string(),
  se: z.string().nullable().optional(),
  se_type: z.string().nullable().optional(),
  date_posted: z.string().nullable().optional(),
  /** Echoed correlation tag from the original task_post request. */
  tag: z.string().nullable().optional(),
  /** Path for task_get/regular (includes /v3 prefix). */
  endpoint_regular: z.string().nullable().optional(),
  endpoint_advanced: z.string().nullable().optional(),
  endpoint_html: z.string().nullable().optional(),
});
export type SerpTaskReadyItem = z.infer<typeof SerpTaskReadyItemSchema>;

/**
 * tasks_ready response.  tasks[0].result is the list of completed tasks
 * that haven't been retrieved yet.  DataForSEO removes a task from this
 * list once task_get is called for it.
 */
export const SerpTasksReadyResponseSchema = z.object({
  status_code: z.number().int(),
  status_message: z.string(),
  cost: z.number().nonnegative().default(0),
  tasks_count: z.number().int().default(0),
  tasks_error: z.number().int().default(0),
  tasks: z
    .array(
      z.object({
        id: z.string(),
        status_code: z.number().int(),
        status_message: z.string(),
        cost: z.number().nonnegative().default(0),
        result_count: z.number().int().nullable().optional(),
        result: z.array(SerpTaskReadyItemSchema).nullable().default([]),
      }),
    )
    .default([]),
});
export type SerpTasksReadyResponse = z.infer<typeof SerpTasksReadyResponseSchema>;
