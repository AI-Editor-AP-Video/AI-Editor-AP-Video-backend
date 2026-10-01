import { Redis, type RedisOptions } from "ioredis";
import { env } from "../../config/env.js";

/**
 * Parses and builds production-hardened Redis connection options
 */
export function getRedisOptions(): RedisOptions {
  try {
    const url = new URL(env.REDIS_URL);
    const isTls = url.protocol === "rediss:";
    const db = url.pathname && url.pathname.length > 1 ? parseInt(url.pathname.slice(1), 10) : 0;

    return {
      host: url.hostname || "127.0.0.1",
      port: url.port ? parseInt(url.port, 10) : (isTls ? 6380 : 6379),
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      db: isNaN(db) ? 0 : db,
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      retryStrategy: (times) => {
        const delay = Math.min(times * 150, 5000);
        return delay;
      },
      reconnectOnError: (err) => {
        const targetErrors = ["READONLY", "ETIMEDOUT", "ECONNRESET"];
        return targetErrors.some((target) => err.message.includes(target));
      },
      keepAlive: 10000,
      ...(isTls
        ? {
            tls: {
              rejectUnauthorized: false,
            },
          }
        : {}),
    };
  } catch {
    // Fallback if REDIS_URL is a host string
    const isTls = env.REDIS_URL.startsWith("rediss://");
    return {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => Math.min(times * 150, 5000),
      keepAlive: 10000,
      ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
    };
  }
}

/**
 * Singleton Redis connection manager for shared backend infrastructure
 */
class RedisManager {
  private static instance: RedisManager;
  private defaultClient: Redis | null = null;
  private subscriberClient: Redis | null = null;

  private constructor() {}

  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  /**
   * Main Redis client for Caching, Hubs, and general commands
   */
  public getClient(): Redis {
    if (!this.defaultClient) {
      this.defaultClient = new Redis(getRedisOptions());

      this.defaultClient.on("error", (err) => {
        console.warn("[RedisManager] Default Redis connection warning:", err.message);
      });

      this.defaultClient.on("connect", () => {
        console.log("[RedisManager] Default Redis connected successfully");
      });
    }
    return this.defaultClient;
  }

  /**
   * Dedicated subscriber client for pub/sub (WebSockets & Telemetry)
   */
  public getSubscriber(): Redis {
    if (!this.subscriberClient) {
      this.subscriberClient = new Redis(getRedisOptions());

      this.subscriberClient.on("error", (err) => {
        console.warn("[RedisManager] Redis Subscriber warning:", err.message);
      });
    }
    return this.subscriberClient;
  }

  /**
   * Creates a dedicated connection for a BullMQ Worker/Queue
   */
  public createDedicatedConnection(label: string = "BullMQ"): Redis {
    const client = new Redis(getRedisOptions());
    client.on("error", (err) => {
      console.warn(`[RedisManager] ${label} connection warning:`, err.message);
    });
    return client;
  }

  /**
   * Gracefully close all open Redis connections on server shutdown
   */
  public async closeAll(): Promise<void> {
    const promises: Promise<any>[] = [];
    if (this.defaultClient) {
      promises.push(this.defaultClient.quit().catch(() => {}));
      this.defaultClient = null;
    }
    if (this.subscriberClient) {
      promises.push(this.subscriberClient.quit().catch(() => {}));
      this.subscriberClient = null;
    }
    await Promise.all(promises);
  }
}

export const redisManager = RedisManager.getInstance();
