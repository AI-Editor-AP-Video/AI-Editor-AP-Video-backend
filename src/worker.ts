import { initBackgroundWorkers, shutdownBackgroundWorkers } from "./infrastructure/queue/bootstrap.js";
import { redisManager } from "./infrastructure/redis/redis.client.js";

/**
 * Dedicated Standalone BullMQ Worker Process
 * 
 * Resource Footprint:
 * - RAM: ~150MB - 350MB baseline (512MB-1GB ceiling)
 * - CPU: 0.5 - 1.0 vCPU
 * 
 * Runs all background queues independently from the Fastify HTTP API server.
 */
async function startStandaloneWorker() {
  console.log("=================================================");
  console.log("⚡ [BullMQ Worker] Starting Standalone Worker Process");
  console.log(`⚡ [BullMQ Worker] Node.js Version: ${process.version}`);
  console.log(`⚡ [BullMQ Worker] Process PID: ${process.pid}`);
  console.log("=================================================");

  try {
    // 1. Test Redis connectivity
    const redis = redisManager.getClient();
    await redis.ping();
    console.log("✅ [BullMQ Worker] Connected to Redis successfully.");

    // 2. Start all BullMQ workers
    initBackgroundWorkers();

    console.log("🚀 [BullMQ Worker] All queue processors active and waiting for jobs.");

    // 3. Graceful shutdown handler
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    for (const signal of signals) {
      process.on(signal, async () => {
        console.log(`\n🛑 [BullMQ Worker] Received ${signal}. Draining jobs and shutting down...`);
        try {
          await shutdownBackgroundWorkers();
          console.log("✅ [BullMQ Worker] Clean shutdown completed. Exiting.");
          process.exit(0);
        } catch (err: any) {
          console.error("❌ [BullMQ Worker] Error during graceful shutdown:", err.message);
          process.exit(1);
        }
      });
    }
  } catch (err: any) {
    console.error("❌ [BullMQ Worker] Fatal startup error:", err.message);
    process.exit(1);
  }
}

startStandaloneWorker();
