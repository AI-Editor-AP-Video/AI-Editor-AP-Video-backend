import type { FastifyCorsOptions } from "@fastify/cors";
import { env } from "./env.js";

/**
 * Returns allowed origins from FRONTEND_URL environment variable.
 */
export function getAllowedOrigins(): string[] {
  if (!env.FRONTEND_URL) return [];
  return env.FRONTEND_URL.split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * Checks if the request origin is permitted.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  // Allow non-browser requests without Origin header (curl, healthchecks, internal AI webhooks)
  if (!origin) return true;

  if (env.NODE_ENV === "development") return true;

  const cleanOrigin = origin.trim().replace(/\/$/, "");
  const allowed = getAllowedOrigins();

  return allowed.length === 0 || allowed.includes(cleanOrigin);
}

export const corsConfig: FastifyCorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy violation: Origin '${origin}' is not authorized`), false);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Cookie",
    "Set-Cookie",
    "X-Session-Title",
    "X-Client-Version",
    "Range",
  ],
  exposedHeaders: [
    "Set-Cookie",
    "Authorization",
    "Content-Disposition",
    "Content-Range",
    "Accept-Ranges",
    "Content-Length",
  ],
  maxAge: 86400,
  preflightContinue: false,
};
