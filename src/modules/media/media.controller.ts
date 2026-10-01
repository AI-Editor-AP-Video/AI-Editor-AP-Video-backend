import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import path from "node:path";
import fs from "node:fs";
import { s3Service } from "../../infrastructure/storage/s3.js";

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".json":
      return "application/json";
    case ".vtt":
      return "text/vtt";
    default:
      return "application/octet-stream";
  }
}

async function handleMediaStream(req: FastifyRequest, reply: FastifyReply) {
  const rawWildcard = (req.params as Record<string, string>)["*"] || "";
  if (!rawWildcard) {
    reply.status(400);
    return { error: "BAD_REQUEST", message: "Media asset path is required" };
  }

  // Sanitize path
  let cleanKey = decodeURIComponent(rawWildcard).replace(/^\/+/, "");

  // If the bucket name was accidentally included as a prefix, strip it
  if (cleanKey.startsWith("ap-editor-video-production/")) {
    cleanKey = cleanKey.slice("ap-editor-video-production/".length);
  }

  // 1. Check if the file exists locally in uploads directory
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const localCandidate = path.join(uploadsDir, cleanKey);

  if (fs.existsSync(localCandidate) && fs.statSync(localCandidate).isFile()) {
    const stat = fs.statSync(localCandidate);
    const fileSize = stat.size;
    const mime = getMimeType(localCandidate);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(localCandidate, { start, end });

      reply.status(206);
      reply.headers({
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
      });
      return reply.send(fileStream);
    } else {
      reply.status(200);
      reply.headers({
        "Content-Length": fileSize,
        "Accept-Ranges": "bytes",
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
      });
      return reply.send(fs.createReadStream(localCandidate));
    }
  }

  // 2. Stream directly from Cloudflare R2
  try {
    const rangeHeader = req.headers.range;
    const response = await s3Service.getObjectStream(cleanKey, rangeHeader);

    if (!response || !response.Body) {
      reply.status(404);
      return { error: "NOT_FOUND", message: `Media asset '${cleanKey}' not found in R2 storage` };
    }

    const mime = response.ContentType || getMimeType(cleanKey);
    const isImage = mime.startsWith("image/");

    if (response.ContentRange) {
      reply.status(206);
      reply.header("Content-Range", response.ContentRange);
    } else {
      reply.status(200);
    }

    reply.header("Accept-Ranges", "bytes");
    if (response.ContentLength !== undefined) {
      reply.header("Content-Length", response.ContentLength);
    }
    reply.header("Content-Type", mime);
    reply.header(
      "Cache-Control",
      isImage ? "public, max-age=31536000, immutable" : "public, max-age=86400"
    );

    return reply.send(response.Body as any);
  } catch (err: any) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      reply.status(404);
      return { error: "NOT_FOUND", message: `Asset '${cleanKey}' not found in R2 storage` };
    }

    req.log.error({ err, key: cleanKey }, "Error streaming media asset from R2");
    reply.status(500);
    return { error: "STORAGE_ERROR", message: "Failed to stream media asset" };
  }
}

export async function mediaRoutes(fastify: FastifyInstance) {
  // Mount both /api/media/* and /media/* for maximum compatibility
  fastify.get("/api/media/*", handleMediaStream);
  fastify.get("/media/*", handleMediaStream);
}
