import type { FastifyCorsOptions } from "@fastify/cors";
import { env } from "./env.js";

/**
 * Extracts and normalizes the full list of allowed origins strictly from environment variables.
 * Zero hardcoded domain names or URLs.
 */
export function getAllowedOrigins(): string[] {
  const origins = new Set<string>();

  // 1. Primary frontend URL from environment
  if (env.FRONTEND_URL) {
    origins.add(env.FRONTEND_URL.trim().replace(/\/$/, ""));
  }

  // 2. Additional comma-separated origins from environment (ALLOWED_ORIGINS)
  if (env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean)
      .forEach((origin) => origins.add(origin));
  }

  return Array.from(origins);
}

/**
 * Validates whether an incoming request Origin is permitted based purely on environment config.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  // Allow requests without Origin header (e.g. mobile apps, cURL, server-to-server AI webhooks, Docker healthchecks)
  if (!origin) {
    return true;
  }

  const cleanOrigin = origin.trim().replace(/\/$/, "");
  const allowedOrigins = getAllowedOrigins();

  // If no origins explicitly defined, allow only if non-production
  if (allowedOrigins.length === 0) {
    return env.NODE_ENV !== "production";
  }

  // Exact match against environment allowed origins
  if (allowedOrigins.includes(cleanOrigin)) {
    return true;
  }

  // Wildcard pattern matching if explicitly supplied in environment (e.g., https://*.example.com)
  for (const allowed of allowedOrigins) {
    if (allowed.includes("*")) {
      const regexPattern = new RegExp(
        "^" + allowed.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
      );
      if (regexPattern.test(cleanOrigin)) {
        return true;
      }
    }
  }

  // In development mode, permit all origins for developer convenience
  if (env.NODE_ENV === "development") {
    return true;
  }

  return false;
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
  maxAge: 86400, // 24 hours preflight cache
  preflightContinue: false,
};
