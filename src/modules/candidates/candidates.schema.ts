import { z } from "zod";

export const ListCandidatesQuerySchema = z.object({
  session_id: z.string().optional(),
  discovery_run_id: z.string().optional(),
  min_score: z.coerce.number().optional().default(0.50),
  discourse_type: z.string().optional(),
  status: z.enum(["ALL", "PENDING", "APPROVED", "REJECTED", "EDITED"]).optional().default("ALL"),
  topic: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
});

export const TrimCandidateSchema = z.object({
  startTime: z.number().min(0, "Start time must be >= 0"),
  endTime: z.number().min(0, "End time must be >= 0"),
  reason: z.string().optional(),
});

export const ReAnalyzeCandidateSchema = z.object({
  customPrompt: z.string().optional(),
  focusArea: z.enum(["ALL", "GITA_SHLOKA", "STORY_METAPHOR", "ARGUMENT_LOGIC", "EMOTIONAL_TONE"]).default("ALL"),
});

export const ExportClipSchema = z.object({
  format: z.enum(["SHORTS_60S", "REEL_90S", "YOUTUBE_MID_5M", "CUSTOM"]).default("SHORTS_60S"),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  includeSubtitles: z.boolean().default(true),
  burnCaptions: z.boolean().default(true),
});

export type ListCandidatesQuery = z.infer<typeof ListCandidatesQuerySchema>;
export type TrimCandidateInput = z.infer<typeof TrimCandidateSchema>;
export type ReAnalyzeCandidateInput = z.infer<typeof ReAnalyzeCandidateSchema>;
export type ExportClipInput = z.infer<typeof ExportClipSchema>;
