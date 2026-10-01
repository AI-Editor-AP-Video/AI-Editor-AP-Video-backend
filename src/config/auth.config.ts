import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../infrastructure/db/prisma.js";
import { env } from "./env.js";
import { getAllowedOrigins } from "./cors.config.js";

const baseURL =
  process.env.BETTER_AUTH_URL ||
  (env.NODE_ENV === "production"
    ? "https://api-apeditor.vikashkr.online"
    : `http://localhost:${env.PORT}`);

/**
 * Production-Grade Better-Auth Instance
 * Configured with Prisma PostgreSQL adapter, Argon2/Scrypt secure password hashing,
 * 7-day sliding session expiration, and trusted origins.
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
