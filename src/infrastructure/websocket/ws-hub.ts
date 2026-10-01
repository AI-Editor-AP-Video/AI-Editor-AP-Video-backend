import { Redis } from "ioredis";
import type { WebSocket } from "ws";
import { env } from "../../config/env.js";

export interface TelemetryEvent {
  sessionId: string;
  type: "EXTRACTION_PROGRESS" | "DISCOVERY_PROGRESS" | "STATUS_UPDATE";
  step?: string;
  progress: number;
  message: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export class WebSocketHub {
  private connections: Map<string, Set<WebSocket>> = new Map();
  private redisSubscriber: Redis | null = null;
  private redisClient: Redis | null = null;

  constructor() {
    try {
      this.redisClient = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: () => 5000,
      });

      this.redisSubscriber = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: () => 5000,
      });

      const handleMessage = (channel: string, message: string) => {
        try {
          const parsed = JSON.parse(message);
          const sessionId = parsed.session_id || parsed.sessionId;
          if (sessionId) {
            this.broadcastToSession(sessionId, parsed);
          }
        } catch (err) {
          console.error("Redis message parse error:", err);
        }
      };

      this.redisSubscriber.on("message", (channel, message) => {
        handleMessage(channel, message);
      });

      this.redisSubscriber.on("pmessage", (_pattern, channel, message) => {
        handleMessage(channel, message);
      });

      this.redisSubscriber.psubscribe("session:*:progress", "session:*:discovery", "session:*");

      // Keepalive heartbeat to prevent cloud/browser idle timeouts
      setInterval(() => {
        for (const [sessionId, clientSet] of this.connections.entries()) {
          for (const client of clientSet) {
            if (client.readyState === 1) { // OPEN
              try {
                client.ping();
              } catch {
                // ignore ping error
              }
            }
          }
        }
      }, 15000);
    } catch (err) {
      console.warn("Redis pub/sub initialization skipped:", err);
    }
  }

  async registerConnection(sessionId: string, socket: WebSocket) {
    if (!this.connections.has(sessionId)) {
      this.connections.set(sessionId, new Set());
    }
    this.connections.get(sessionId)!.add(socket);

    socket.on("close", () => {
      this.removeConnection(sessionId, socket);
    });

    // Replay recent log history from Redis to the new connection (capped at last 200 events)
    try {
      if (this.redisClient) {
        const storedLogs = await this.redisClient.lrange(`session:${sessionId}:logs`, -200, -1);
        for (const logStr of storedLogs) {
          if (socket.readyState === 1) {
            socket.send(logStr);
          }
        }
      }
    } catch {
      // ignore replay error
    }
  }

  /**
   * Set TTL on all ephemeral Redis keys for a session so memory is automatically reclaimed.
   */
  async expireSessionKeys(sessionId: string, ttlSeconds: number = 7200) {
    try {
      if (this.redisClient) {
        const pipeline = this.redisClient.pipeline();
        pipeline.expire(`session:${sessionId}:logs`, ttlSeconds);
        pipeline.expire(`session:${sessionId}:discovery_logs`, ttlSeconds);
        pipeline.expire(`session:${sessionId}:discovery_state`, ttlSeconds);
        pipeline.expire(`session:${sessionId}:state`, ttlSeconds);
        await pipeline.exec();
      }
    } catch (err) {
      console.warn("Failed to set expiry on session keys in Redis:", err);
    }
  }

  async clearSessionLogs(sessionId: string) {
    try {
      if (this.redisClient) {
        const pipeline = this.redisClient.pipeline();
        pipeline.del(`session:${sessionId}:logs`);
        pipeline.del(`session:${sessionId}:discovery_logs`);
        pipeline.del(`session:${sessionId}:discovery_state`);
        pipeline.del(`session:${sessionId}:state`);
        await pipeline.exec();
      }
    } catch (err) {
      console.warn("Failed to clear session logs in Redis:", err);
    }
  }

  removeConnection(sessionId: string, socket: WebSocket) {
    const clients = this.connections.get(sessionId);
    if (clients) {
      clients.delete(socket);
      if (clients.size === 0) {
        this.connections.delete(sessionId);
      }
    }
  }

  broadcastToSession(sessionId: string, data: any) {
    const clients = this.connections.get(sessionId);
    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === 1) { // OPEN
        client.send(payload);
      }
    }
  }
}

export const wsHub = new WebSocketHub();
