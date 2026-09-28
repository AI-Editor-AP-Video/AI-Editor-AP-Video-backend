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

    // Replay full log history from Redis to the new connection
    try {
      if (this.redisClient) {
        const storedLogs = await this.redisClient.lrange(`session:${sessionId}:logs`, 0, -1);
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

  async clearSessionLogs(sessionId: string) {
    try {
      if (this.redisClient) {
        await this.redisClient.del(`session:${sessionId}:logs`);
        await this.redisClient.del(`session:${sessionId}:discovery_logs`);
        await this.redisClient.del(`session:${sessionId}:discovery_state`);
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
