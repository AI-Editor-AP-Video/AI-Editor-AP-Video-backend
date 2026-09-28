import type { FastifyRequest, FastifyReply } from "fastify";
import { authService } from "../modules/auth/auth.service.js";
import { AppError } from "./errorHandler.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: {
      id: string;
      name?: string | null;
      email: string;
      role: string;
      image?: string | null;
    };
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/i, "") || (req.query as any)?.token;

  if (!token) {
    throw new AppError("Authentication required. Please provide a valid Bearer token.", 401);
  }

  try {
    const user = await authService.getCurrentUser(token);
    req.authUser = user;
  } catch (err: any) {
    throw new AppError("Invalid or expired session. Please sign in again.", 401);
  }
}
