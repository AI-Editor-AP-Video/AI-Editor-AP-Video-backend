import { Redis } from "ioredis";
import { env } from "../../config/env.js";

interface MemoryCacheEntry {
  value: any;
  expiresAt: number;
}

/**
 * Production-Grade Multi-Tier Cache Service
 * Primary: High-speed Redis (Shared across cluster)
 * L1: In-memory LRU fallback & micro-cache for sub-millisecond local reads
 */
export class CacheService {
  private redis: Redis | null = null;
  private memoryCache = new Map<string, MemoryCacheEntry>();
  private isRedisConnected = false;

  constructor() {
    this.initRedis();
    // Background garbage collector for expired in-memory cache keys every 60s
    setInterval(() => this.cleanupMemoryCache(), 60000).unref();
  }

  private initRedis() {
    try {
      if (!env.REDIS_URL) return;

      this.redis = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 2,
        enableReadyCheck: false,
        lazyConnect: true,
        retryStrategy: (times) => Math.min(times * 100, 3000),
      });

      this.redis.connect().then(() => {
        this.isRedisConnected = true;
      }).catch((err) => {
        this.isRedisConnected = false;
        console.warn("[CacheService] Redis connect warning (falling back to in-memory):", err.message);
      });

      this.redis.on("error", () => {
        this.isRedisConnected = false;
      });

      this.redis.on("connect", () => {
        this.isRedisConnected = true;
      });
    } catch (err: any) {
      this.isRedisConnected = false;
      console.warn("[CacheService] Redis initialization warning:", err.message);
    }
  }

  private cleanupMemoryCache() {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.expiresAt > 0 && entry.expiresAt < now) {
        this.memoryCache.delete(key);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    // 1. Check L1 in-memory cache first (sub-millisecond)
    const memEntry = this.memoryCache.get(key);
    if (memEntry) {
      if (memEntry.expiresAt === 0 || memEntry.expiresAt > Date.now()) {
        return memEntry.value as T;
      }
      this.memoryCache.delete(key);
    }

    // 2. Check Redis if available
    if (this.isRedisConnected && this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          // Populate L1 cache for 10s to avoid repeated Redis roundtrips
          this.memoryCache.set(key, { value: parsed, expiresAt: Date.now() + 10000 });
          return parsed as T;
        }
      } catch {
        // Silently fallback to null on Redis network glitch
      }
    }

    return null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 60): Promise<void> {
    // Set L1 in-memory
    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0;
    this.memoryCache.set(key, { value, expiresAt });

    // Set Redis
    if (this.isRedisConnected && this.redis) {
      try {
        const stringified = JSON.stringify(value);
        if (ttlSeconds > 0) {
          await this.redis.set(key, stringified, "EX", ttlSeconds);
        } else {
          await this.redis.set(key, stringified);
        }
      } catch {
        // Fallback gracefully to memory
      }
    }
  }

  async del(key: string): Promise<void> {
    this.memoryCache.delete(key);
    if (this.isRedisConnected && this.redis) {
      try {
        await this.redis.del(key);
      } catch {
        // Ignore
      }
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    // Delete matching in-memory keys
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    for (const key of this.memoryCache.keys()) {
      if (regex.test(key)) {
        this.memoryCache.delete(key);
      }
    }

    // Delete matching Redis keys
    if (this.isRedisConnected && this.redis) {
      try {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Helper: Get cached value or compute and store it
   */
  async getOrSet<T>(key: string, producer: () => Promise<T>, ttlSeconds: number = 60): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
    const fresh = await producer();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }
}

export const cacheService = new CacheService();
