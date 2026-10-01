import { Worker, type Job, type Processor } from "bullmq";
import { getRedisOptions } from "../redis/redis.client.js";
import { QUEUE_NAMES, type QueueName } from "./queue.service.js";
import { wsHub } from "../websocket/ws-hub.js";

export interface WorkerConfig {
  concurrency?: number;
  limiter?: {
    max: number;
    duration: number;
  };
}

export class WorkerManager {
  private static instance: WorkerManager;
  private workers = new Map<QueueName, Worker>();

  private constructor() {}

  public static getInstance(): WorkerManager {
    if (!WorkerManager.instance) {
      WorkerManager.instance = new WorkerManager();
    }
    return WorkerManager.instance;
  }

  /**
   * Registers and starts a BullMQ Worker with automatic WebSocket telemetry and error tracking
   */
  public registerWorker<TData = any, TResult = any>(
    queueName: QueueName,
    processor: Processor<TData, TResult>,
    config: WorkerConfig = {}
  ): Worker<TData, TResult> {
    if (this.workers.has(queueName)) {
      return this.workers.get(queueName)! as Worker<TData, TResult>;
    }

    const worker = new Worker<TData, TResult>(queueName, processor, {
      connection: getRedisOptions() as any,
      concurrency: config.concurrency ?? 2, // Safe default concurrency for VM memory protection
      limiter: config.limiter,
      autorun: true,
    });

    // Global lifecycle telemetry event listeners
    worker.on("active", (job: Job<TData, any, string>) => {
      const sessionId = (job.data as any)?.sessionId || (job.data as any)?.session_id;
      console.log(`[Worker:${queueName}] Job ${job.id} started (${job.name})`);

      if (sessionId) {
        wsHub.broadcastToSession(sessionId, {
          type: "JOB_ACTIVE",
          queue: queueName,
          jobId: job.id,
          name: job.name,
          progress: 0,
          timestamp: new Date().toISOString(),
        });
      }
    });

    worker.on("progress", (job: Job<TData, any, string>, progress: any) => {
      const sessionId = (job.data as any)?.sessionId || (job.data as any)?.session_id;
      const progressPercent = typeof progress === "number" ? progress : (progress as any)?.percent ?? 50;
      const message = typeof progress === "object" ? (progress as any)?.message : `Processing ${job.name}`;

      if (sessionId) {
        wsHub.broadcastToSession(sessionId, {
          type: "JOB_PROGRESS",
          queue: queueName,
          jobId: job.id,
          progress: progressPercent,
          message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    worker.on("completed", (job: Job<TData, any, string>, result: TResult) => {
      const sessionId = (job.data as any)?.sessionId || (job.data as any)?.session_id;
      console.log(`[Worker:${queueName}] Job ${job.id} completed successfully`);

      if (sessionId) {
        wsHub.broadcastToSession(sessionId, {
          type: "JOB_COMPLETED",
          queue: queueName,
          jobId: job.id,
          progress: 100,
          result,
          timestamp: new Date().toISOString(),
        });
      }
    });

    worker.on("failed", (job: Job<TData, any, string> | undefined, err: Error) => {
      const sessionId = (job?.data as any)?.sessionId || (job?.data as any)?.session_id;
      console.error(`[Worker:${queueName}] Job ${job?.id} failed:`, err.message);

      if (sessionId && job) {
        wsHub.broadcastToSession(sessionId, {
          type: "JOB_FAILED",
          queue: queueName,
          jobId: job.id,
          error: err.message,
          attemptsMade: job.attemptsMade,
          timestamp: new Date().toISOString(),
        });
      }
    });

    worker.on("error", (err) => {
      console.warn(`[Worker:${queueName}] Worker internal error:`, err.message);
    });

    this.workers.set(queueName, worker as any);
    return worker;
  }

  /**
   * Gracefully close all background workers on application shutdown
   */
  public async closeAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [name, worker] of this.workers.entries()) {
      console.log(`[WorkerManager] Closing worker for '${name}'...`);
      promises.push(worker.close());
    }
    this.workers.clear();
    await Promise.all(promises);
  }
}

export const workerManager = WorkerManager.getInstance();
