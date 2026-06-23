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
