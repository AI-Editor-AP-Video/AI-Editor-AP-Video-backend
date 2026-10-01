import { z } from "zod";
import dotenv from "dotenv";
import path from "node:path";

// Load environment from local backend .env or root workspace .env
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),

  // Core Infrastructure (Required directly from environment)
  DATABASE_URL: z.string().min(1, "DATABASE_URL environment variable is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL environment variable is required"),
  AI_SERVICE_URL: z.string().min(1, "AI_SERVICE_URL environment variable is required"),
  
  // Cloudflare R2 Storage (Used for both Dev & Prod)
  CLOUDFLARE_R2_ENDPOINT: z.string().min(1, "CLOUDFLARE_R2_ENDPOINT is required"),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1, "CLOUDFLARE_R2_ACCESS_KEY_ID is required"),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1, "CLOUDFLARE_R2_SECRET_ACCESS_KEY is required"),
  CLOUDFLARE_R2_BUCKET: z.string().min(1, "CLOUDFLARE_R2_BUCKET is required"),
  CLOUDFLARE_R2_REGION: z.string().default("auto"),

  // Frontend URL & Authentication
  FRONTEND_URL: z.string().min(1, "FRONTEND_URL environment variable is required"),
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET environment variable is required"),
});

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  AI_SERVICE_URL: process.env.AI_SERVICE_URL,
  CLOUDFLARE_R2_ENDPOINT: process.env.CLOUDFLARE_R2_ENDPOINT,
  CLOUDFLARE_R2_ACCESS_KEY_ID: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  CLOUDFLARE_R2_BUCKET: process.env.CLOUDFLARE_R2_BUCKET,
  CLOUDFLARE_R2_REGION: process.env.CLOUDFLARE_R2_REGION || "auto",
  FRONTEND_URL: process.env.FRONTEND_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
});

export type EnvConfig = z.infer<typeof envSchema>;
