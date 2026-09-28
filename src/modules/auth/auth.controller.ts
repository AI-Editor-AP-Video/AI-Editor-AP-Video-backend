import type { FastifyInstance } from "fastify";
import { auth, authService } from "./auth.service.js";

export async function authRoutes(fastify: FastifyInstance) {
  // Direct Fastify Registration Endpoint
  fastify.post("/api/auth/register", async (req, reply) => {
    const body = (req.body as any) || {};
    if (!body.email || !body.password || !body.name) {
      return reply.status(400).send({ message: "Name, email, and password are required." });
    }
    const result = await authService.register(body);
    return reply.status(201).send(result);
  });

  // Direct Fastify Login Endpoint
  fastify.post("/api/auth/login", async (req, reply) => {
    const body = (req.body as any) || {};
    if (!body.email || !body.password) {
      return reply.status(400).send({ message: "Email and password are required." });
    }
    const result = await authService.login(body);
    return reply.status(200).send(result);
  });

  // Better-Auth Alias Sign-in
  fastify.post("/api/auth/sign-in/email", async (req, reply) => {
    const body = (req.body as any) || {};
    const result = await authService.login(body);
    return reply.status(200).send(result);
  });

  // Better-Auth Alias Sign-up
  fastify.post("/api/auth/sign-up/email", async (req, reply) => {
    const body = (req.body as any) || {};
    const result = await authService.register(body);
    return reply.status(201).send(result);
  });

  // Current User / Session Verification Endpoint
  fastify.get("/api/auth/me", async (req, reply) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, "") || (req.query as any)?.token;
    const user = await authService.getCurrentUser(token);
    return reply.status(200).send({ user });
  });

  // Better-Auth Alias Get-Session
  fastify.get("/api/auth/get-session", async (req, reply) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, "") || (req.query as any)?.token;
    const user = await authService.getCurrentUser(token);
    return reply.status(200).send({ user, session: { token } });
  });

  // Logout Endpoint
  fastify.post("/api/auth/logout", async (req, reply) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    await authService.logout(token);
    return reply.status(200).send({ success: true, message: "Logged out successfully" });
  });

  // Catch-all for Better-Auth SDK routes
  fastify.all("/api/auth/*", async (req, reply) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost:4000"}`);
      const request = new Request(url.toString(), {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: req.body ? JSON.stringify(req.body) : undefined,
      });

      const response = await auth.handler(request);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return response.text();
    } catch (err: any) {
      return reply.status(500).send({ message: err.message || "Auth handler error" });
    }
  });
}

