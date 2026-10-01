import { workerManager } from "./worker.manager.js";
import { QUEUE_NAMES, queueService } from "./queue.service.js";
import {
  processExtractionJob,
  processDiscoveryJob,
  processRenderJob,
  processThumbnailJob,
  processPublishJob,
} from "../../workers/index.js";
import { redisManager } from "../redis/redis.client.js";

/**
 * Initializes all 5 dedicated BullMQ workers and queues on server startup
 */
export function initBackgroundWorkers() {
  console.log("⚡ [BullMQ] Bootstrapping 5 dedicated background worker processors...");

  // 1. Phase 1: Heavy Video Extraction & Whisper Vector Indexing (Concurrency: 2)
  workerManager.registerWorker(QUEUE_NAMES.EXTRACTION, processExtractionJob, {
    concurrency: 2,
  });

  // 2. Phase 2: Multi-Theme AI Candidate Discovery & Scoring (Concurrency: 3)
  workerManager.registerWorker(QUEUE_NAMES.DISCOVERY, processDiscoveryJob, {
    concurrency: 3,
  });

  // 3. Phase 3: 9:16 Vertical Video Re-framing & Subtitle Render (Concurrency: 2)
  workerManager.registerWorker(QUEUE_NAMES.RENDER, processRenderJob, {
    concurrency: 2,
  });

  // 4. Phase 4: High-CTR Keyframe & Hindi Typography Compositing (Concurrency: 4)
  workerManager.registerWorker(QUEUE_NAMES.THUMBNAIL, processThumbnailJob, {
    concurrency: 4,
  });

  // 5. Phase 5: Social Media Multi-Platform Publishing (Concurrency: 2)
  workerManager.registerWorker(QUEUE_NAMES.PUBLISH, processPublishJob, {
    concurrency: 2,
  });

  console.log("✅ [BullMQ] All 5 dedicated background workers active and listening on Redis queues.");
}

/**
 * Gracefully shuts down all BullMQ workers and Redis connections
 */
export async function shutdownBackgroundWorkers() {
  console.log("🛑 [BullMQ] Gracefully shutting down worker processes...");
  await workerManager.closeAll();
  await queueService.closeAll();
  await redisManager.closeAll();
  console.log("✅ [BullMQ] Worker processes and Redis connections closed.");
}
