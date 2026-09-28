import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5435/ap_editorial_db"),
  REDIS_URL: z.string().default("redis://localhost:6380/0"),
  AI_SERVICE_URL: z.string().default("http://localhost:8002"),
  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().default(9002),
  MINIO_USE_SSL: z.string().transform((v) => v === "true").default("false"),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin"),
  MINIO_BUCKET_NAME: z.string().default("ap-sessions"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().default("ap_editorial_dev_secret_key_32_chars"),
});

export const env = envSchema.parse(process.env);
export type EnvConfig = z.infer<typeof envSchema>;
