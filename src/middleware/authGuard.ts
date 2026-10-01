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

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/i, "") || (req.query as any)?.token;

  try {
    const user = await authService.getCurrentUser(token, req.headers);
    req.authUser = user;
  } catch (err: any) {
    throw new AppError(
      err.message || "Authentication required. Please sign in with a valid session.",
      401
    );
  }
}
