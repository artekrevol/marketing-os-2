/**
 * Zod schemas for DataForSEO API response validation
 * Ensures API responses match expected structure before processing
 */

import { z } from 'zod';

/**
 * Schema for a single search result item from DataForSEO
 */
export const DataForSEOSearchItemSchema = z.object({
  type: z.string(),
  rank_group: z.number(),
  rank_absolute: z.number(),
  domain: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
});

/**
 * Schema for a DataForSEO task result
 */
export const DataForSEOTaskResultSchema = z.object({
  items: z.array(DataForSEOSearchItemSchema),
});

/**
 * Schema for a DataForSEO task
 */
export const DataForSEOTaskSchema = z.object({
  id: z.string(),
  status_code: z.number(),
  status_message: z.string(),
  result: z.array(DataForSEOTaskResultSchema).optional(),
});

/**
 * Schema for the complete DataForSEO API response
 */
export const DataForSEOSearchResponseSchema = z.object({
  status_code: z.number(),
  status_message: z.string(),
  tasks: z.array(DataForSEOTaskSchema),
});

/**
 * Validate and parse a DataForSEO API response
 * @param data - Raw response data from API
 * @returns Validated and parsed response
 * @throws ZodError if validation fails
 */
export function validateDataForSEOResponse(data: unknown) {
  return DataForSEOSearchResponseSchema.parse(data);
}

/**
 * Safely validate a DataForSEO API response with error handling
 * @param data - Raw response data from API
 * @returns Validation result with success flag
 */
export function safeValidateDataForSEOResponse(data: unknown): {
  success: boolean;
  data?: z.infer<typeof DataForSEOSearchResponseSchema>;
  error?: string;
} {
  try {
    const validated = validateDataForSEOResponse(data);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `DataForSEO response validation failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      };
    }
    return {
      success: false,
      error: `Unknown validation error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

