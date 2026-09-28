import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildApp } from "../src/server.js";

let appPromise: ReturnType<typeof buildApp> | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!appPromise) {
    appPromise = buildApp();
  }
  const app = await appPromise;
  await app.ready();
  app.server.emit("request", req, res);
}
