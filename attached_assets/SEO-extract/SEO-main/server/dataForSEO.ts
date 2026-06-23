import axios from 'axios';
import { Keyword, Location } from '@shared/schema';
import { getDataForSEOLocationCode } from './locationCodesUtil';
import { safeValidateDataForSEOResponse } from './dataForSEOSchemas';

/**
 * Interface for DataForSEO API response
 */
interface DataForSEOSearchItem {
  type: string;
  rank_group: number;
  rank_absolute: number;
  domain: string;
  title: string;
  url: string;
}

interface DataForSEOTask {
  id: string;
  status_code: number;
  status_message: string;
  result: Array<{
    items: DataForSEOSearchItem[];
  }>;
}

interface DataForSEOSearchResponse {
  status_code: number;
  status_message: string;
  tasks: DataForSEOTask[];
}

export interface SearchResult {
  position: number;
  url: string | null;
  resultType: 'organic' | 'other_organic' | 'local_pack';
  title?: string;
  domain?: string;
}

export interface CompetitorResult {
  domain: string;
  url: string;
  title: string;
  position: number;
}

/**
 * Search using DataForSEO API for the keyword and check ranking of target domains
 * Returns an array of search results, including the target domain position, competitors, and other results by type
 */
export const searchWithDataForSEO = async (
  keyword: Keyword,
  targetDomain: string,
  location?: Location
): Promise<{
  results: SearchResult[];
  competitors: CompetitorResult[];
}> => {
  try {
    // Try to get credentials from both possible environment variable names
    const apiLogin = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
    const apiPassword = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;

    if (!apiLogin || !apiPassword) {
      throw new Error('DataForSEO API credentials not found');
    }

    // Basic auth for DataForSEO
    const auth = Buffer.from(`${apiLogin}:${apiPassword}`).toString('base64');

    // Get the DataForSEO location code
    let locationCode = "2840"; // Default to United States

    // If the location has a specific DataForSEO location code stored in the database, use it
    if (location && location.dataForSEOLocationCode) {
      console.log(`Using database-defined location code for ${location.name}: ${location.dataForSEOLocationCode}`);
      locationCode = location.dataForSEOLocationCode;
    }
    // Otherwise fall back to the utility function
    else if (location) {
      const dataForSEOCode = getDataForSEOLocationCode(location);
      if (dataForSEOCode) {
        locationCode = dataForSEOCode;
      } else {
        console.log(`No specific location code found for ${location.name}, using default code ${locationCode}`);
      }
    }

    // Prepare the API payload with the location code following DataForSEO API specifications
    // Based on https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/
    const payload = {
      "language_code": "en",
      "location_code": parseInt(locationCode),
      "keyword": keyword.keyword, // Do not encode, DataForSEO handles this
      "calculate_rectangles": false,
      "device": "desktop",
      "os": "windows",
      "depth": 100
    };

    console.log(`Searching for "${keyword.keyword}" using location code ${locationCode} (${location?.name || 'Default'}) via DataForSEO`);

    console.log(`Sending request to DataForSEO API for keyword "${keyword.keyword}"`);

    let data: DataForSEOSearchResponse;
    try {
      const response = await axios.post(
        'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
        [payload],
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 second timeout
        }
      );

      console.log(`Received response from DataForSEO API for keyword "${keyword.keyword}"`);
      
      // Validate API response structure
      const validation = safeValidateDataForSEOResponse(response.data);
      if (!validation.success) {
        console.error(`DataForSEO API response validation failed for keyword "${keyword.keyword}":`, validation.error);
        throw new Error(`Invalid API response structure: ${validation.error}`);
      }
      
      data = validation.data!;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`DataForSEO API request failed for keyword "${keyword.keyword}": 
          Status: ${error.response?.status || 'unknown'}, 
          Message: ${error.message}, 
          Response: ${JSON.stringify(error.response?.data || {}).substring(0, 200)}...`);
      } else {
        console.error(`Unknown error making DataForSEO API request for keyword "${keyword.keyword}": ${error}`);
      }
      throw new Error(`DataForSEO API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Check API response
    if (data.status_code !== 20000) {
      console.error(`DataForSEO API error code: ${data.status_code}, message: ${data.status_message}`);
      throw new Error(`DataForSEO API error: ${data.status_message}`);
    }

    // Make sure we have at least one task
    const task = data.tasks[0];
    if (!task) {
      throw new Error('No tasks returned from DataForSEO API');
    }

    // Check task status
    if (task.status_code !== 20000) {
      console.error(`DataForSEO task error code: ${task.status_code}, message: ${task.status_message}`);
      throw new Error(`Task error: ${task.status_message}`);
    }

    if (!task.result?.[0]?.items?.length) {
      console.log(`No search results found for "${keyword.keyword}"`);
      const emptyResult: SearchResult = { position: -1, url: null, resultType: 'organic' };
      return {
        results: [emptyResult],
        competitors: []
      };
    }

    console.log(`Found ${task.result[0].items.length} results for "${keyword.keyword}"`);

    // Process all results and categorize them
    const allResults: SearchResult[] = [];
    let mainOrganicResult: SearchResult | null = null;
    let foundTarget = false;

    // Categorize all items from the raw results for proper position calculation
    const allItems = task.result[0].items;

    // Identify ads - these typically have special URLs
    const adItems = allItems.filter(item =>
      item.url?.includes('/aclk?') ||  // Google ad click URLs
      item.url?.includes('googleadservices.com') ||  // Google Ads services domain
      item.url?.startsWith('https://www.google.com/ads/') // Direct Google ad links
    );

    // Identify all local pack results, both explicitly labeled and those with maps URLs
    const localPackItems = allItems.filter(item =>
      item.type === 'local_pack' ||
      // Also include organic items that are actually maps results
      (item.type === 'organic' &&
        (item.url?.includes('google.com/maps') ||
          item.url?.includes('maps.google.com') ||
          (item.title?.includes('Maps') && item.domain?.includes('google.com'))))
    );

    // Get true organic items by filtering out ads and local pack results
    const organicItems = allItems.filter(item => {
      // Must be organic type
      if (item.type !== 'organic') return false;

      // Exclude ads
      if (item.url?.includes('/aclk?') ||
        item.url?.includes('googleadservices.com') ||
        item.url?.startsWith('https://www.google.com/ads/')) {
        return false;
      }

      // Exclude maps/local results that are miscategorized as organic
      if (item.url?.includes('google.com/maps') ||
        item.url?.includes('maps.google.com') ||
        (item.title?.includes('Maps') && item.domain?.includes('google.com'))) {
        return false;
      }

      return true;
    });

    // Log all types found for debugging purposes
    const uniqueTypes = Array.from(new Set(allItems.map(item => item.type)));
    console.log(`Found result types: ${uniqueTypes.join(', ')}`);

    console.log(`Found ${organicItems.length} true organic results out of ${allItems.length} total results`);
    console.log(`Found ${localPackItems.length} local pack results`);
    console.log(`Excluded ${adItems.length} ad results from organic rankings`);

    /**
     * CRITICAL POSITION CALCULATION LOGIC
     * 
     * Problem: DataForSEO returns rank_absolute which includes ads and local pack results.
     * We need to calculate true organic positions that exclude ads and local pack.
     * 
     * Solution:
     * 1. Filter out ads and local pack results to get only organic items
     * 2. Sort all items by rank_absolute to maintain original order
     * 3. Assign sequential organic positions (1, 2, 3...) only to organic items
     * 4. Create a mapping: rank_absolute -> true organic position
     * 
     * Example:
     *   rank_absolute 1: ad (excluded) -> no organic position
     *   rank_absolute 2: local_pack (excluded) -> no organic position
     *   rank_absolute 3: organic -> organic position 1
     *   rank_absolute 4: organic -> organic position 2
     *   rank_absolute 5: organic -> organic position 3
     * 
     * This ensures:
     * - Organic positions are sequential (no gaps)
     * - Ads are never included in organic positions
     * - Local pack positions are separate (1-3 for local pack)
     * - Position -1 means "not ranked" (target domain not found)
     */

    // Sort all items by their original rank order
    const sortedItems = [...allItems].sort((a, b) => a.rank_absolute - b.rank_absolute);

    // Create a mapping from original absolute position to true organic position
    // This corrects for the presence of ads and local pack entries
    const organicPositions: Record<number, number> = {};
    let trueOrganicPosition = 1;

    // Go through the sorted items and assign true organic positions only to organic results
    for (const item of sortedItems) {
      // Only assign organic position if this item is in our filtered organicItems list
      // This ensures ads and local pack are never included
      if (organicItems.some(organic => organic.rank_absolute === item.rank_absolute)) {
        organicPositions[item.rank_absolute] = trueOrganicPosition++;
      }
    }

    console.log('Organic position mapping:', organicPositions);

    // Log item types by rank to help debug where local packs appear
    console.log('Item types by rank:');
    sortedItems
      .slice(0, 10) // Just show the first 10 for brevity
      .forEach(item => {
        console.log(`Rank ${item.rank_absolute}: ${item.type} - ${item.domain} - True Position: ${organicPositions[item.rank_absolute] || 'N/A'}`);
      });

    // Sort organicItems by position first to ensure we find the highest ranked match
    const sortedOrganicItems = [...organicItems].sort((a, b) => {
      const posA = organicPositions[a.rank_absolute] || 9999;
      const posB = organicPositions[b.rank_absolute] || 9999;
      return posA - posB; // Sort by position, lowest number (highest rank) first
    });

    // Process organic results in order of rank (highest first)
    for (const item of sortedOrganicItems) {
      try {
        const itemDomain = item.domain.toLowerCase();
        const itemUrl = item.url;
        const itemTitle = item.title;

        // Get the target URL from the keyword, or use the default target domain
        const specificUrl = keyword.targetUrl?.toLowerCase();

        let isMatch = false;

        // First check: exact domain match - more lenient to catch all variations
        if (itemDomain.includes(targetDomain.toLowerCase())) {
          isMatch = true;
        }
        // Second check: specific URL match if provided
        else if (specificUrl) {
          // Remove protocol and www for comparison
          const cleanSpecificUrl = specificUrl
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '');
          const cleanItemUrl = itemUrl
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '');

          if (cleanItemUrl.startsWith(cleanSpecificUrl) ||
            cleanSpecificUrl.startsWith(cleanItemUrl)) {
            isMatch = true;
          }
        }

        // Only save matching results (Tekrevol domains)
        if (isMatch) {
          // Get the true organic position (excluding ads and local pack)
          // This position is calculated by counting only organic results in sequential order
          const truePosition = organicPositions[item.rank_absolute];

          // CRITICAL: Only use truePosition if it exists
          // If truePosition is undefined, it means this item was not in organicItems
          // (it might be an ad or local pack that slipped through), so we should not use rank_absolute
          // as a fallback because rank_absolute includes ads and would give incorrect positions
          if (truePosition === undefined) {
            console.warn(`WARNING: Target domain found but not in organic items mapping. rank_absolute: ${item.rank_absolute}. This may indicate a filtering issue.`);
            // Skip this result - it shouldn't happen if filtering is correct
            continue;
          }

          const position = truePosition;

          console.log(`Found target at position ${position} (true organic position, excluding ads/local pack) / ${item.rank_absolute} (API absolute rank): ${itemUrl}`);

          // Create the result object
          const result: SearchResult = {
            position: position, // Use true organic position with fallback to absolute
            url: itemUrl,
            resultType: 'organic', // Always mark as main organic for dashboard
            title: itemTitle,
            domain: itemDomain
          };

          // First matching result becomes the main one
          if (!foundTarget) {
            mainOrganicResult = result;
            foundTarget = true;
            // Only add the highest ranking match to results
            allResults.push(result);
            break; // Exit the loop after finding the highest ranked match
          }
        }

      } catch (error) {
        console.error('Error processing organic search result:', error);
        continue;
      }
    }

    // Process local pack results
    // Sort localPackItems to find the highest ranking (lowest number) first
    const sortedLocalPackItems = [...localPackItems].sort((a, b) => a.rank_absolute - b.rank_absolute);
    let foundLocalPack = false;

    for (const item of sortedLocalPackItems) {
      try {
        // Local pack items have different structure, extract what we can
        const itemDomain = item.domain || '';
        const itemUrl = item.url || '';
        const itemTitle = item.title || '';

        // More lenient matching for local pack items as they often have different URLs
        // Try to match by domain, URL, or title containing brand name
        if (itemDomain.toLowerCase().includes(targetDomain.toLowerCase()) ||
          itemUrl.toLowerCase().includes(targetDomain.toLowerCase()) ||
          (itemTitle && itemTitle.toLowerCase().includes(targetDomain.split('.')[0].toLowerCase()))) {

          // The position in local pack should be 1, 2, or 3 (A, B, C positions)
          // Determine the local_pack sub-position if possible
          let localPosition = 1; // Default to position 1

          // Try to extract a position from the rank_group
          if (item.rank_group && item.rank_group > 0 && item.rank_group <= 3) {
            localPosition = item.rank_group;
          }
          // If no group available, use the item's position within the local pack items
          else {
            // Find this item's index in sorted local pack items
            const itemIndex = sortedLocalPackItems.findIndex(
              lp => lp.rank_absolute === item.rank_absolute
            );
            if (itemIndex >= 0 && itemIndex < 3) {
              localPosition = itemIndex + 1;
            }
          }

          // Create the result object
          const result: SearchResult = {
            position: localPosition, // Use the local pack position
            url: itemUrl,
            resultType: 'local_pack',
            title: itemTitle,
            domain: itemDomain
          };

          // Add this result to our collection
          allResults.push(result);
          console.log(`Found target at position ${localPosition} (local_pack, absolute rank: ${item.rank_absolute}): ${itemUrl}`);

          foundLocalPack = true;
          break; // Take only the highest ranking local pack match
        }

      } catch (error) {
        console.error('Error processing local pack result:', error);
        continue;
      }
    }

    // If we found local pack results in the search, but none matched our target,
    // add a result indicating we're not in the local pack (position -1)
    if (localPackItems.length > 0 && !foundLocalPack) {
      console.log(`Local pack found but target domain "${targetDomain}" not present`);
      const localPackAbsentResult: SearchResult = {
        position: -1,
        url: null,
        resultType: 'local_pack'
      };
      allResults.push(localPackAbsentResult);
    }

    // If we didn't find the target domain in the results
    if (!foundTarget) {
      console.log(`Target domain "${targetDomain}" not found in top ${task.result[0].items.length} results`);
      // Add a placeholder for the main organic result
      const emptyResult: SearchResult = {
        position: -1,
        url: null,
        resultType: 'organic'
      };
      allResults.unshift(emptyResult);
    }

    // Collect top competitor data from organic results
    // Skip any results that match the target domain
    const competitors: CompetitorResult[] = [];

    // Use the sorted organicItems to gather competitor data
    for (const item of sortedOrganicItems.slice(0, 10)) { // Get top 10 results
      try {
        const itemDomain = item.domain.toLowerCase();

        // Skip items matching the target domain
        if (itemDomain.includes(targetDomain.toLowerCase())) {
          continue;
        }

        // Get the true organic position (excluding ads and local pack)
        // CRITICAL: Do NOT fallback to rank_absolute as it includes ads
        // If organicPositions doesn't have this rank_absolute, it means the item
        // was filtered out (likely an ad), so we should skip it
        const truePosition = organicPositions[item.rank_absolute];
        if (truePosition === undefined) {
          // This competitor was filtered out (likely an ad), skip it
          continue;
        }

        // Create the competitor object
        const competitor: CompetitorResult = {
          domain: itemDomain,
          url: item.url,
          title: item.title,
          position: truePosition
        };

        competitors.push(competitor);

        // Limit to top 10 competitors
        if (competitors.length >= 10) {
          break;
        }
      } catch (error) {
        console.error('Error processing competitor data:', error);
        continue;
      }
    }

    console.log(`Found ${competitors.length} competitor results for "${keyword.keyword}"`);

    return {
      results: allResults,
      competitors
    };

  } catch (error) {
    console.error('Error searching with DataForSEO:', error);
    throw error;
  }
};