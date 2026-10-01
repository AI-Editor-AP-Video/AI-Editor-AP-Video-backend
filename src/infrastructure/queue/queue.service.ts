import { Queue, type JobsOptions } from "bullmq";
import { getRedisOptions } from "../redis/redis.client.js";

export type QueueName =
  | "extraction-jobs"
  | "discovery-jobs"
  | "render-jobs"
  | "thumbnail-jobs"
  | "publish-jobs";

export const QUEUE_NAMES = {
  EXTRACTION: "extraction-jobs" as QueueName,
  DISCOVERY: "discovery-jobs" as QueueName,
  RENDER: "render-jobs" as QueueName,
  THUMBNAIL: "thumbnail-jobs" as QueueName,
  PUBLISH: "publish-jobs" as QueueName,
};

/**
 * Standard Production Job Options
 * Includes automatic retry with exponential backoff and memory limits
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000, // 2s, 4s, 8s retry backoff on transient network / rate-limit failures
  },
  removeOnComplete: {
    count: 100, // Retain max 100 completed job metadata in Redis
    age: 3600,  // Auto-purge completed jobs after 1 hour
  },
  removeOnFail: {
    count: 200, // Retain max 200 failed job logs for debugging
    age: 86400, // Auto-purge failed jobs after 24 hours
  },
};

export class QueueService {
  private static instance: QueueService;
  private queues = new Map<QueueName, Queue>();

  private constructor() {}

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  /**
   * Retrieves or initializes a BullMQ Queue
   */
  public getQueue(name: QueueName): Queue {
    if (!this.queues.has(name)) {
      const queue = new Queue(name, {
        connection: getRedisOptions() as any,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });

      queue.on("error", (err) => {
        console.warn(`[QueueService] Queue '${name}' error:`, err.message);
      });

      this.queues.set(name, queue);
    }
    return this.queues.get(name)!;
  }

  /**
   * Unified, type-safe method to enqueue any background job in < 5ms
   */
  public async addJob<T = any>(
    queueName: QueueName,
    jobName: string,
    data: T,
    customOptions?: JobsOptions
  ) {
    const queue = this.getQueue(queueName);
    const job = await queue.add(jobName, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...customOptions,
    });

    return {
      jobId: job.id,
      name: job.name,
      queueName,
      status: "QUEUED",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check status of an existing job
   */
  public async getJobStatus(queueName: QueueName, jobId: string) {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = job.progress;

    return {
      id: job.id,
      name: job.name,
      state,
      progress,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
      timestamp: new Date(job.timestamp).toISOString(),
    };
  }

  /**
   * Gracefully close all open queue connections on server shutdown
   */
  public async closeAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const queue of this.queues.values()) {
      promises.push(queue.close());
    }
    this.queues.clear();
    await Promise.all(promises);
  }
}

export const queueService = QueueService.getInstance();
