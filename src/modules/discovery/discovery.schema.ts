import { z } from "zod";

export const LaunchDiscoverySchema = z.object({
  mode: z.enum(["COMPREHENSIVE", "FOCUSED", "CUSTOM"]).default("COMPREHENSIVE"),
  focusOptions: z.array(z.string()).default(["qa", "gita"]),
  customPrompt: z.string().optional(),
  formatPreset: z.string().optional().default("YOUTUBE_SHORTS"),
  targetLanguage: z.string().optional(),
  minDuration: z.number().optional(),
  maxDuration: z.number().optional(),
  maxCandidates: z.number().optional(),
  includeSurroundingContext: z.boolean().optional().default(true),
  checkExistingContent: z.boolean().optional().default(false),
});

export type LaunchDiscoveryInput = z.infer<typeof LaunchDiscoverySchema>;
