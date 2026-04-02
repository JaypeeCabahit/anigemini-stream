// LocalStorage-based caching service with expiration
interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiresIn: number;
}

class CacheService {
  private prefix = 'aniweb_cache_';

  // Default cache durations (in milliseconds)
  private durations = {
    anime: 30 * 60 * 1000,        // 30 minutes for anime data
    episodes: 60 * 60 * 1000,     // 1 hour for episodes
    search: 15 * 60 * 1000,       // 15 minutes for search results
    stream: 5 * 60 * 1000,        // 5 minutes for stream sources
  };

  set<T>(key: string, data: T, type: keyof typeof this.durations = 'anime'): void {
    try {
      const item: CacheItem<T> = {
        data,
        timestamp: Date.now(),
        expiresIn: this.durations[type],
      };
      localStorage.setItem(this.prefix + key, JSON.stringify(item));
    } catch (error) {
      console.warn('Cache set failed:', error);
      // If localStorage is full, clear old items
      this.clearExpired();
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

  // Cache it
  cacheService.set(key, data, cacheType);

  return data;
}
