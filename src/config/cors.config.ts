import type { FastifyCorsOptions } from "@fastify/cors";
import { env } from "./env.js";

// Helper to check if an origin matches any allowed wildcard/regex pattern
function isAllowedDomain(origin: string): boolean {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    // 1. Localhost and loopback interfaces for development
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".localhost")
    ) {
      return true;
    }

    // 2. Production Domain and Subdomains (e.g. apeditor.vikashkr.online, api-apeditor.vikashkr.online)
    if (hostname === "vikashkr.online" || hostname.endsWith(".vikashkr.online")) {
      return true;
    }

    // 3. Vercel Preview Deployments (e.g. *-ai-editor-ap-video.vercel.app)
    if (hostname === "vercel.app" || hostname.endsWith(".vercel.app")) {
      return true;
    }

    // 4. Cloudflare Pages Deployments
    if (hostname === "pages.dev" || hostname.endsWith(".pages.dev")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// Build explicit allowed origins list from environment
export function getAllowedOrigins(): string[] {
  const origins = new Set<string>();

  if (env.FRONTEND_URL) {
    origins.add(env.FRONTEND_URL.replace(/\/$/, ""));
  }

  // Standard development origins
  origins.add("http://localhost:3000");
  origins.add("http://localhost:3001");
  origins.add("http://localhost:5173");
  origins.add("http://127.0.0.1:3000");
  origins.add("http://127.0.0.1:3001");

  // Production domain default
  origins.add("https://apeditor.vikashkr.online");
  origins.add("https://api-apeditor.vikashkr.online");

  // Additional custom comma-separated origins from ALLOWED_ORIGINS env
  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean)
      .forEach((o) => origins.add(o));
  }

  return Array.from(origins);
}

export function isOriginAllowed(origin: string | undefined): boolean {
  // Allow requests without Origin header (e.g. mobile apps, curl, server-to-server, health checks)
  if (!origin) {
    return true;
  }

  const cleanOrigin = origin.replace(/\/$/, "");
  const explicitOrigins = getAllowedOrigins();

  if (explicitOrigins.includes(cleanOrigin)) {
    return true;
  }

  // Allow dynamic matching against trusted domain patterns
  if (isAllowedDomain(cleanOrigin)) {
    return true;
  }

  // In non-production environments, allow all origins for ease of testing
  if (env.NODE_ENV !== "production") {
    return true;
  }

  return false;
}

export const corsConfig: FastifyCorsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      // In CORS with credentials, echoing back true authorizes the request with Origin
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
