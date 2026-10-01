import type { WebSocket } from "ws";
import { redisManager } from "../redis/redis.client.js";

export interface TelemetryEvent {
  sessionId: string;
  type: "EXTRACTION_PROGRESS" | "DISCOVERY_PROGRESS" | "STATUS_UPDATE" | "JOB_PROGRESS" | "JOB_COMPLETED" | "JOB_FAILED";
  step?: string;
  progress: number;
  message: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export class WebSocketHub {
  private connections: Map<string, Set<WebSocket>> = new Map();

  constructor() {
    try {
      const subscriber = redisManager.getSubscriber();

      const handleMessage = (_channel: string, message: string) => {
        try {
          const parsed = JSON.parse(message);
          const sessionId = parsed.session_id || parsed.sessionId;
          if (sessionId) {
            this.broadcastToSession(sessionId, parsed);
          }
        } catch {
          // parse error
        }
      };

      subscriber.on("message", (channel, message) => {
        handleMessage(channel, message);
      });

      subscriber.on("pmessage", (_pattern, channel, message) => {
        handleMessage(channel, message);
      });

      subscriber.psubscribe("session:*:progress", "session:*:discovery", "session:*").catch(() => {});

      // Keepalive heartbeat to prevent cloud/browser idle timeouts
      setInterval(() => {
        for (const [, clientSet] of this.connections.entries()) {
          for (const client of clientSet) {
            if (client.readyState === 1) { // OPEN
              try {
                client.ping();
              } catch {
                // ignore
              }
            }
          }
        }
      }, 15000).unref();
    } catch (err: any) {
      console.warn("[WebSocketHub] Redis pub/sub initialization warning:", err.message);
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
      const client = redisManager.getClient();
      const storedLogs = await client.lrange(`session:${sessionId}:logs`, -200, -1);
      for (const logStr of storedLogs) {
        if (socket.readyState === 1) {
          socket.send(logStr);
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
      const client = redisManager.getClient();
      const pipeline = client.pipeline();
      pipeline.expire(`session:${sessionId}:logs`, ttlSeconds);
      pipeline.expire(`session:${sessionId}:discovery_logs`, ttlSeconds);
      pipeline.expire(`session:${sessionId}:discovery_state`, ttlSeconds);
      pipeline.expire(`session:${sessionId}:state`, ttlSeconds);
      await pipeline.exec();
    } catch {
      // ignore
    }
  }

  async clearSessionLogs(sessionId: string) {
    try {
      const client = redisManager.getClient();
      const pipeline = client.pipeline();
      pipeline.del(`session:${sessionId}:logs`);
      pipeline.del(`session:${sessionId}:discovery_logs`);
      pipeline.del(`session:${sessionId}:discovery_state`);
      pipeline.del(`session:${sessionId}:state`);
      await pipeline.exec();
    } catch {
      // ignore
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
        try {
          client.send(payload);
        } catch {
          // ignore
        }
      }
    }
  }
}

export const wsHub = new WebSocketHub();
