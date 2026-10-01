import fs from "node:fs";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  HeadBucketCommand,
  HeadObjectCommand,
  _Object,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env.js";

export interface PresignedUploadUrlResponse {
  uploadUrl: string;
  s3Key: string;
  bucket: string;
  expiresInSeconds: number;
}

export class S3StorageService {
  private client: S3Client;
  private bucket: string;
  private endpoint: string;

  constructor() {
    this.bucket = env.CLOUDFLARE_R2_BUCKET;
    this.endpoint = env.CLOUDFLARE_R2_ENDPOINT;

    // Normalize endpoint (ensure protocol is present and strip any trailing bucket or slash)
    let formattedEndpoint = this.endpoint;
    if (formattedEndpoint) {
      if (!formattedEndpoint.startsWith("http://") && !formattedEndpoint.startsWith("https://")) {
        formattedEndpoint = `https://${formattedEndpoint}`;
      }
      if (formattedEndpoint.endsWith(`/${this.bucket}`)) {
        formattedEndpoint = formattedEndpoint.slice(0, -(this.bucket.length + 1));
      }
      formattedEndpoint = formattedEndpoint.replace(/\/+$/, "");
    }

    this.client = new S3Client({
      region: env.CLOUDFLARE_R2_REGION || "auto",
      endpoint: formattedEndpoint,
      credentials: {
        accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
      // Cloudflare R2 and MinIO require path-style routing or custom endpoint routing
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  /**
   * Generates a cryptographically signed S3 PUT presigned URL for direct client-to-R2 upload
   * Bypasses backend server RAM and disk completely.
   */
  async generatePresignedUploadUrl(
    sessionId: string,
    filename: string,
    contentType: string = "video/mp4",
    expiresInSeconds: number = 3600
  ): Promise<PresignedUploadUrlResponse> {
    const cleanFilename = filename.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
    const ext = path.extname(cleanFilename) || ".mp4";
    const s3Key = `sessions/${sessionId}/master_${Date.now()}${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
      unhoistableHeaders: new Set(["content-type"]),
    });

    return {
      uploadUrl,
      s3Key,
      bucket: this.bucket,
      expiresInSeconds,
    };
  }

  /**
   * Generates a presigned GET download/streaming URL (useful for private R2 buckets)
   */
  async generatePresignedDownloadUrl(
    s3Key: string,
    expiresInSeconds: number = 7200
  ): Promise<string> {
    const cleanKey = s3Key.startsWith("/") ? s3Key.slice(1) : s3Key;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  /**
   * Retrieves an object stream directly from Cloudflare R2 with HTTP Range support.
   */
  async getObjectStream(s3Key: string, range?: string) {
    let cleanKey = s3Key.startsWith("/") ? s3Key.slice(1) : s3Key;
    if (cleanKey.startsWith(`${this.bucket}/`)) {
      cleanKey = cleanKey.slice(this.bucket.length + 1);
    }
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
      Range: range,
    });

    return this.client.send(command);
  }

  /**
   * Upload a local file to Cloudflare R2 / S3 storage
   */
  async uploadFile(
    s3Key: string,
    localFilePath: string,
    contentType: string = "video/mp4"
  ): Promise<string> {
    const fileStream = fs.createReadStream(localFilePath);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      Body: fileStream,
      ContentType: contentType,
    });

    await this.client.send(command);
    return s3Key;
  }

  /**
   * Upload a memory buffer or text to Cloudflare R2 / S3
   */
  async uploadBuffer(
    s3Key: string,
    buffer: Buffer | Uint8Array | string,
    contentType: string = "application/json"
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
    });

    await this.client.send(command);
    return s3Key;
  }

  /**
   * Delete a single asset by key from R2 / S3
   */
  async deleteObject(s3Key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      });
      await this.client.send(command);
      return true;
    } catch (err) {
      console.warn(`[S3StorageService] Failed to delete object '${s3Key}':`, err);
      return false;
    }
  }

  /**
   * Purge all assets under a specific prefix (e.g. `sessions/sess_123/` or `keyframes/sess_123/`)
   */
  async deletePrefix(prefix: string): Promise<number> {
    let deletedCount = 0;
    try {
      let isTruncated: boolean | undefined = true;
      let continuationToken: string | undefined = undefined;

      while (isTruncated) {
        const listCommand = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const listResult: ListObjectsV2CommandOutput = await this.client.send(listCommand);
        if (listResult.Contents && listResult.Contents.length > 0) {
          const objectsToDelete = listResult.Contents.filter((item: _Object) => Boolean(item.Key)).map(
            (item: _Object) => ({ Key: item.Key! })
          );

          if (objectsToDelete.length > 0) {
            const deleteCommand = new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: {
                Objects: objectsToDelete,
                Quiet: true,
              },
            });

            await this.client.send(deleteCommand);
            deletedCount += objectsToDelete.length;
            console.log(`[S3StorageService] Purged ${objectsToDelete.length} objects under prefix '${prefix}' from R2`);
          }
        }

        isTruncated = listResult.IsTruncated;
        continuationToken = listResult.NextContinuationToken;
      }
    } catch (err) {
      console.warn(`[S3StorageService] Error purging prefix '${prefix}' from R2:`, err);
    }
    return deletedCount;
  }

  /**
   * Check if an object exists in Cloudflare R2 / S3
   */
  async objectExists(s3Key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Health check / verify bucket existence & credentials
   */
  async checkBucketConnectivity(): Promise<boolean> {
    try {
      const command = new HeadBucketCommand({
        Bucket: this.bucket,
      });
      await this.client.send(command);
      return true;
    } catch (err) {
      console.warn(`[S3StorageService] Bucket connectivity check failed for '${this.bucket}':`, err);
      return false;
    }
  }

  /**
   * Returns standard endpoint URL for the asset
   */
  getAssetPublicUrl(s3Key: string): string {
    if (!s3Key) return "";
    let cleanKey = s3Key;
    if (cleanKey.includes("r2.cloudflarestorage.com") || cleanKey.includes(".s3.")) {
      try {
        const u = new URL(cleanKey);
        cleanKey = u.pathname.replace(/^\/+/, "");
        if (cleanKey.startsWith(`${this.bucket}/`)) {
          cleanKey = cleanKey.slice(this.bucket.length + 1);
        }
      } catch {}
    }
    if (cleanKey.startsWith("http://") || cleanKey.startsWith("https://")) {
      return cleanKey;
    }
    cleanKey = cleanKey.startsWith("/") ? cleanKey.slice(1) : cleanKey;
    if (cleanKey.startsWith("api/media/")) {
      return `/${cleanKey}`;
    }
    return `/api/media/${cleanKey}`;
  }
}

export const s3Service = new S3StorageService();
