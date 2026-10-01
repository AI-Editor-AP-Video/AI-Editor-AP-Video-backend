import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { auth, authService } from "./auth.service.js";

/**
 * Converts a FastifyRequest into a standard Web API Request object for Better-Auth
 */
function toWebRequest(req: FastifyRequest): Request {
  const protocol = req.headers["x-forwarded-proto"] || (req.socket as any)?.encrypted ? "https" : "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:4000";
  const url = new URL(req.url, `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach((v) => headers.append(key, v));
      } else {
        headers.set(key, String(value));
      }
    }
  }

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && req.body !== undefined;
  const body = hasBody
    ? typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body)
    : undefined;

  return new Request(url.toString(), {
    method,
    headers,
    body,
  });
}

/**
 * Sends a Web API Response back through FastifyReply
 */
async function sendWebResponse(webRes: Response, reply: FastifyReply) {
  reply.status(webRes.status);

  // Forward response headers including Set-Cookie headers
  webRes.headers.forEach((value, key) => {
    // Handling multiple set-cookie headers
    if (key.toLowerCase() === "set-cookie") {
      const getSetCookie = (webRes.headers as any).getSetCookie;
      if (typeof getSetCookie === "function") {
        const cookies = getSetCookie.call(webRes.headers);
        if (cookies && cookies.length > 0) {
          reply.header("set-cookie", cookies);
          return;
        }
      }
    }
    reply.header(key, value);
  });

  const contentType = webRes.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await webRes.json();
    return reply.send(data);
  }

  const text = await webRes.text();
  return reply.send(text);
}

export async function authRoutes(fastify: FastifyInstance) {
  // 1. Direct REST Login Endpoint (Standardized format for frontend)
  fastify.post("/api/auth/login", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body as any) || {};
    const result = await authService.login(body);
    return reply.status(200).send(result);
  });

  // 2. Direct REST Register Endpoint
  fastify.post("/api/auth/register", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body as any) || {};
    const result = await authService.register(body);
    return reply.status(201).send(result);
  });

  // 3. Current User / Session Verification Endpoint
  fastify.get("/api/auth/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, "") || (req.query as any)?.token;
    const user = await authService.getCurrentUser(token, req.headers);
    return reply.status(200).send({ user });
  });

  // 4. Logout Endpoint
  fastify.post("/api/auth/logout", async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    await authService.logout(token, req.headers);
    return reply.status(200).send({ success: true, message: "Logged out successfully" });
  });

  // 5. Better-Auth Official SDK Handler (Handles all Better-Auth client routes: /api/auth/*)
  fastify.all("/api/auth/*", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const webReq = toWebRequest(req);
      const webRes = await auth.handler(webReq);
      return await sendWebResponse(webRes, reply);
    } catch (err: any) {
      req.log.error({ err }, "[Better-Auth] Handler encountered an error");
      return reply.status(err.status || 500).send({
        error: err.name || "AuthError",
        message: err.message || "Internal authentication error",
      });
    }
  });
}
