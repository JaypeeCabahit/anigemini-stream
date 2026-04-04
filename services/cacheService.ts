// LocalStorage-based caching service with expiration
interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiresIn: number;
}

class CacheService {
  // Bump the prefix when the API base or cached payload shape changes to force fresh data
  private prefix = 'aniweb_cache_v3_';

  // Default cache durations (in milliseconds)
  private durations = {
    anime: 30 * 60 * 1000,        // 30 minutes for anime data
    episodes: 60 * 60 * 1000,     // 1 hour for episodes
    search: 15 * 60 * 1000,       // 15 minutes for search results
    stream: 5 * 60 * 1000,        // 5 minutes for stream sources
  };

  set<T>(key: string, data: T, type: keyof typeof this.durations = 'anime'): void {
    const item: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      expiresIn: this.durations[type],
    };
    const serialized = JSON.stringify(item);
    try {
      localStorage.setItem(this.prefix + key, serialized);
    } catch {
      // Storage full — evict expired entries first, then retry
      this.clearExpired();
      try {
        localStorage.setItem(this.prefix + key, serialized);
      } catch {
        // Still full — evict oldest cache entries until it fits or nothing left
        this.evictOldest(serialized.length);
        try {
          localStorage.setItem(this.prefix + key, serialized);
        } catch {
          // Give up silently — cache miss is always safe
        }
      }
    }
  }

  private evictOldest(neededBytes: number): void {
    try {
      const entries: { key: string; timestamp: number }[] = [];
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(this.prefix)) continue;
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed: CacheItem<any> = JSON.parse(raw);
          entries.push({ key, timestamp: parsed.timestamp });
        } catch {
          localStorage.removeItem(key);
        }
      }
      // Sort oldest first
      entries.sort((a, b) => a.timestamp - b.timestamp);
      let freed = 0;
      for (const entry of entries) {
        const item = localStorage.getItem(entry.key);
        freed += item ? item.length : 0;
        localStorage.removeItem(entry.key);
        if (freed >= neededBytes) break;
      }
    } catch {
      // ignore
    }
  }

  get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(this.prefix + key);
      if (!item) return null;

      const cached: CacheItem<T> = JSON.parse(item);
      const now = Date.now();

      // Check if expired
      if (now - cached.timestamp > cached.expiresIn) {
        this.remove(key);
        return null;
      }

      return cached.data;
    } catch (error) {
      console.warn('Cache get failed:', error);
      return null;
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch (error) {
      console.warn('Cache remove failed:', error);
    }
  }

  clearExpired(): void {
    try {
      const now = Date.now();
      const keys = Object.keys(localStorage);

      keys.forEach(key => {
        if (!key.startsWith(this.prefix)) return;

        try {
          const item = localStorage.getItem(key);
          if (!item) return;

          const cached: CacheItem<any> = JSON.parse(item);
          if (now - cached.timestamp > cached.expiresIn) {
            localStorage.removeItem(key);
          }
        } catch {
          // Invalid item, remove it
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Cache cleanup failed:', error);
    }
  }

  clearAll(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.prefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Cache clear all failed:', error);
    }
  }

  // Get cache statistics
  getStats(): { count: number; size: number } {
    try {
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter(k => k.startsWith(this.prefix));

      let totalSize = 0;
      cacheKeys.forEach(key => {
        const item = localStorage.getItem(key);
        if (item) totalSize += item.length;
      });

      return {
        count: cacheKeys.length,
        size: totalSize,
      };
    } catch {
      return { count: 0, size: 0 };
    }
  }
}

export const cacheService = new CacheService();

// Wrapper for fetch with caching
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  cacheType: 'anime' | 'episodes' | 'search' | 'stream' = 'anime'
): Promise<T> {
  // Try cache first
  const cached = cacheService.get<T>(key);
  if (cached) {
    return cached;
  }

  // Fetch fresh data
  const data = await fetcher();

  // Don't cache empty results — backend may have been temporarily unavailable
  const isEmpty =
    data === null ||
    data === undefined ||
    (Array.isArray(data) && data.length === 0) ||
    (data && typeof data === 'object' && 'data' in (data as any) && Array.isArray((data as any).data) && (data as any).data.length === 0);

  if (!isEmpty) {
    cacheService.set(key, data, cacheType);
  }

  return data;
}
