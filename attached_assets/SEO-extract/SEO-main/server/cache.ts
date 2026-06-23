/**
 * Simple in-memory caching mechanism to improve API performance
 * This reduces database load for frequently accessed endpoints
 */

interface CacheItem<T> {
  value: T;
  expiry: number;
}

class ServerCache {
  private cache: Map<string, CacheItem<any>>;
  private readonly defaultTTL: number;

  constructor(defaultTTL = 60000) { // Default TTL: 1 minute
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get an item from the cache
   * @param key - Cache key
   * @returns The cached value or undefined if not found or expired
   */
  get<T>(key: string): T | undefined {
    const item = this.cache.get(key);
    
    if (!item) {
      return undefined;
    }
    
    // Check if item has expired
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    
    return item.value as T;
  }

  /**
   * Set a value in the cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time to live in milliseconds (optional)
   */
  set<T>(key: string, value: T, ttl = this.defaultTTL): void {
    const expiry = Date.now() + ttl;
    this.cache.set(key, { value, expiry });
  }

  /**
   * Check if a key exists in the cache
   * @param key - Cache key
   * @returns True if the key exists and hasn't expired
   */
  has(key: string): boolean {
    const item = this.cache.get(key);
    
    if (!item) {
      return false;
    }
    
    // Check if item has expired
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Delete an item from the cache
   * @param key - Cache key
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
   * Clear expired items from the cache
   * @returns Number of items cleared
   */
  clearExpired(): number {
    let cleared = 0;
    const now = Date.now();
    
    // Convert to array before iteration to avoid downlevelIteration error
    Array.from(this.cache.entries()).forEach(([key, item]) => {
      if (now > item.expiry) {
        this.cache.delete(key);
        cleared++;
      }
    });
    
    return cleared;
  }

  /**
   * Get the number of items in the cache
   * @returns Cache size
   */
  size(): number {
    this.clearExpired(); // Clean up expired items first
    return this.cache.size;
  }

  /**
   * Get all cache keys
   * @returns Array of cache keys
   */
  keys(): string[] {
    this.clearExpired(); // Clean up expired items first
    return Array.from(this.cache.keys());
  }
}

// Create a singleton instance
export const serverCache = new ServerCache();

/**
 * Cache decorator for async functions
 * @param ttl - Time to live in milliseconds
 * @returns A decorator function
 */
export function cached(ttl = 60000) {
  return function(
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args: any[]) {
      // Create a cache key based on the method name and arguments
      const cacheKey = `${propertyKey}:${JSON.stringify(args)}`;
      
      // Check if result is in cache
      if (serverCache.has(cacheKey)) {
        return serverCache.get(cacheKey);
      }
      
      // Call the original method
      const result = await originalMethod.apply(this, args);
      
      // Cache the result
      serverCache.set(cacheKey, result, ttl);
      
      return result;
    };
    
    return descriptor;
  };
}

/**
 * Express middleware to cache API responses
 * @param ttl - Time to live in milliseconds
 * @returns Express middleware function
 */
export function cacheMiddleware(ttl = 60000) {
  return (req: any, res: any, next: () => void) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    // Create a cache key based on the URL and query parameters
    const cacheKey = `${req.originalUrl || req.url}`;
    
    // Check if response is in cache
    if (serverCache.has(cacheKey)) {
      const cachedBody = serverCache.get(cacheKey);
      res.send(cachedBody);
      return;
    }
    
    // Store the original send function
    const originalSend = res.send;
    
    // Override the send function to cache the response
    res.send = function(body: any) {
      serverCache.set(cacheKey, body, ttl);
      return originalSend.call(this, body);
    };
    
    next();
  };
}

// Set up automatic cache cleanup every 5 minutes
setInterval(() => {
  const cleared = serverCache.clearExpired();
  if (cleared > 0) {
    console.log(`Cleared ${cleared} expired items from cache`);
  }
}, 300000);