import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../infrastructure/db/prisma.js";
import { env } from "./env.js";
import { getAllowedOrigins } from "./cors.config.js";

const baseURL =
  env.BETTER_AUTH_URL ||
  (env.NODE_ENV === "production" ? env.FRONTEND_URL : `http://localhost:${env.PORT}`);

/**
 * Production-Grade Better-Auth Instance
 * Configured purely from environment variables without hardcoded URLs or domains.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL,
  basePath: "/api/auth",
  trustedOrigins: getAllowedOrigins(),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    maxPasswordLength: 128,
    requireEmailVerification: false,
    autoSignIn: true,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "EDITOR",
        required: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days active session duration
    updateAge: 60 * 60 * 24, // Sliding refresh once every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes memory cache for high-frequency requests
    },
  },
  advanced: {
    defaultCookieAttributes: {
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    },
  },
});

export type Auth = typeof auth;
