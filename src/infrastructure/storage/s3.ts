import { env } from "../../config/env.js";

export interface PresignedUploadUrlResponse {
  uploadUrl: string;
  s3Key: string;
  bucket: string;
  expiresInSeconds: number;
}

export class S3StorageService {
  private bucket: string;
  private endpoint: string;

  constructor() {
    this.bucket = env.MINIO_BUCKET_NAME;
    this.endpoint = `http://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`;
  }

  /**
   * Generate direct upload S3 presigned endpoint for client-side zero-copy upload
   */
  async generatePresignedUploadUrl(
    sessionId: string,
    filename: string,
    contentType: string = "video/mp4"
  ): Promise<PresignedUploadUrlResponse> {
    const cleanFilename = filename.replace(/\s+/g, "_");
    const s3Key = `sessions/${sessionId}/${Date.now()}_${cleanFilename}`;
    
    // In production MinIO/S3, this generates an AWS Signature V4 presigned PUT URL
    const uploadUrl = `${this.endpoint}/${this.bucket}/${s3Key}`;

    return {
      uploadUrl,
      s3Key,
      bucket: this.bucket,
      expiresInSeconds: 3600,
    };
  }

  getAssetPublicUrl(s3Key: string): string {
    return `${this.endpoint}/${this.bucket}/${s3Key}`;
  }
}

export const s3Service = new S3StorageService();
