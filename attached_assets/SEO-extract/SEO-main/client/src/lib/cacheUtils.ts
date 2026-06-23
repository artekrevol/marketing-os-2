/**
 * API cache utility for storing and managing API response data
 * This reduces redundant API calls and improves performance
 */

interface CacheOptions {
  ttl?: number;  // Time to live in milliseconds
}

interface CacheItem<T> {
  data: T;
  timestamp: number;
}

class APICache {
  private cache: Map<string, CacheItem<any>>;
  private defaultTTL: number;

  constructor(defaultTTL = 60000) { // Default TTL of 1 minute
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
  }

  /**
   * Set an item in the cache
   * @param key The cache key
   * @param data The data to cache
   * @param options Cache options
   */
  set<T>(key: string, data: T, options?: CacheOptions): void {
    const ttl = options?.ttl ?? this.defaultTTL;
    const timestamp = Date.now() + ttl;
    this.cache.set(key, { data, timestamp });
  }

  /**
   * Get an item from the cache
   * @param key The cache key
   * @param options Cache options
   * @returns The cached data or null if not found or expired
   */
  get<T>(key: string, options?: CacheOptions): T | null {
    const item = this.cache.get(key);
    
    // If item doesn't exist or has expired, return null
    if (!item || Date.now() > item.timestamp) {
      if (item) this.delete(key); // Clean up expired item
      return null;
    }
    
    return item.data as T;
  }

  /**
   * Delete an item from the cache
   * @param key The cache key
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all items from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get a list of all keys in the cache
   * @returns Array of cache keys
   */
  keys(): string[] {
    // Clean up expired items first
    this.cleanExpired();
    return Array.from(this.cache.keys());
  }

  /**
   * Get the current size of the cache
   * @returns Number of items in the cache
   */
  size(): number {
    // Clean up expired items first
    this.cleanExpired();
    return this.cache.size;
  }

  /**
   * Remove all expired items from the cache
   */
  private cleanExpired(): void {
    const now = Date.now();
    Array.from(this.cache.entries()).forEach(([key, item]) => {
      if (now > item.timestamp) {
        this.cache.delete(key);
      }
    });
  }
}

// Create a singleton instance
export const apiCache = new APICache();

/**
 * Wrapper for fetch that uses cache
 * @param url The URL to fetch
 * @param options Fetch options
 * @param cacheOptions Cache options
 * @returns The fetch response
 */
export async function cachedFetch<T>(
  url: string, 
  options?: RequestInit, 
  cacheOptions?: CacheOptions
): Promise<T> {
  const cacheKey = `${url}`;
  
  // Check cache first
  const cachedData = apiCache.get<T>(cacheKey, cacheOptions);
  if (cachedData) {
    return cachedData;
  }
  
  // If not in cache, fetch data
  const response = await fetch(url, options);
  
  // Handle response
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Cache the result
  apiCache.set<T>(cacheKey, data, cacheOptions);
  
  return data;
}

// Cleanup expired cache items every minute
setInterval(() => {
  apiCache['cleanExpired']();
}, 60000);