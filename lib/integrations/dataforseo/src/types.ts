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
