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

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type GenerateUploadUrlInput = z.infer<typeof GenerateUploadUrlSchema>;
export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;
