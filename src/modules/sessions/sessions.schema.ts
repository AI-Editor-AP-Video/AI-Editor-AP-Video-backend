import { z } from "zod";

export const CreateSessionSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  videoPath: z.string().optional(),
  seriesCategory: z.string().optional(),
  durationSeconds: z.number().optional().default(0),
});

export const GenerateUploadUrlSchema = z.object({
  filename: z.string().min(1, "Filename is required"),
  contentType: z.string().optional().default("video/mp4"),
  fileSizeBytes: z.number().optional(),
});

export const ListSessionsQuerySchema = z.object({
  category: z.string().optional(),
  status: z.enum(["ALL", "PROCESSING", "EXTRACTED_READY", "DISCOVERY_DONE"]).optional().default("ALL"),
  search: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
});

export const InitiateMultipartSchema = z.object({
  sessionId: z.string().optional(),
  filename: z.string().min(1, "Filename is required"),
  contentType: z.string().optional().default("video/mp4"),
  fileSizeBytes: z.number().positive("File size must be positive"),
  chunkSizeBytes: z.number().optional().default(10 * 1024 * 1024), // 10MB chunk default
});

export const GetPartUrlsSchema = z.object({
  s3Key: z.string().min(1, "s3Key is required"),
  uploadId: z.string().min(1, "uploadId is required"),
  partNumbers: z.array(z.number().int().positive()).min(1, "At least one part number is required"),
});

export const CompleteMultipartSchema = z.object({
  s3Key: z.string().min(1, "s3Key is required"),
  uploadId: z.string().min(1, "uploadId is required"),
  parts: z.array(
    z.object({
      PartNumber: z.number().int().positive(),
      ETag: z.string().optional().default(""),
    })
  ).optional().default([]),
  sessionId: z.string().min(1, "sessionId is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  seriesCategory: z.string().optional(),
  durationSeconds: z.number().optional().default(0),
});

export const AbortMultipartSchema = z.object({
  s3Key: z.string().min(1, "s3Key is required"),
  uploadId: z.string().min(1, "uploadId is required"),
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type GenerateUploadUrlInput = z.infer<typeof GenerateUploadUrlSchema>;
export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;
export type InitiateMultipartInput = z.infer<typeof InitiateMultipartSchema>;
export type GetPartUrlsInput = z.infer<typeof GetPartUrlsSchema>;
export type CompleteMultipartInput = z.infer<typeof CompleteMultipartSchema>;
export type AbortMultipartInput = z.infer<typeof AbortMultipartSchema>;

