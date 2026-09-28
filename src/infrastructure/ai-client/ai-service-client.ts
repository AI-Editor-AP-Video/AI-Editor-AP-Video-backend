import { env } from "../../config/env.js";

export interface ExtractionTriggerResponse {
  status: "ACCEPTED" | "FAILED";
  session_id: string;
  message: string;
}

export interface DiscoveryTriggerResponse {
  status: "ACCEPTED" | "FAILED";
  run_id: string;
  session_id: string;
  message: string;
}

export class AIServiceClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = env.AI_SERVICE_URL;
  }

  /**
   * Phase 1: Trigger one-time heavy media extraction & vector indexing in Python service
   */
  async triggerExtraction(
    sessionId: string,
    videoPath: string,
    title?: string
  ): Promise<ExtractionTriggerResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/ai/process-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          video_path: videoPath,
          title,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI Microservice HTTP ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (err: any) {
      console.error("AI Engine extraction dispatch failed:", err);
      throw new Error(`Failed to dispatch extraction to AI Engine (${this.baseUrl}): ${err.message || err}`);
    }
  }

  /**
   * Phase 2: Trigger repeatable multi-run AI Editorial Discovery on frozen session memory
   */
  async triggerDiscovery(
    sessionId: string,
    runId: string,
    mode: string = "COMPREHENSIVE",
    focusOptions: string[] = ["qa", "gita"],
    customPrompt?: string,
    formatPreset?: string,
    targetLanguage?: string,
    minDuration?: number,
    maxDuration?: number,
    maxCandidates?: number
  ): Promise<DiscoveryTriggerResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/ai/run-discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          run_id: runId,
          mode,
          focus_options: focusOptions,
          custom_prompt: customPrompt,
          format_preset: formatPreset || "YOUTUBE_SHORTS",
          target_language: targetLanguage,
          min_duration: minDuration,
          max_duration: maxDuration,
          max_candidates: maxCandidates,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI Discovery endpoint returned HTTP ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (err: any) {
      console.error("AI Service discovery trigger failed:", err);
      throw new Error(`Failed to dispatch discovery to AI Engine (${this.baseUrl}): ${err.message || err}`);
    }
  }

  async checkHealth(): Promise<{ status: string; service: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return await res.json();
    } catch {
      return { status: "DEGRADED", service: "python-ai-engine" };
    }
  }

  /**
   * Feature 2: Trigger automated 9:16 vertical re-framing & subtitle burn-in
   */
  async renderVerticalClip(params: {
    candidateId: string;
    sessionId: string;
    videoPath?: string | null;
    startTime: number;
    endTime: number;
    burnSubtitles?: boolean;
    aspectRatio?: string;
  }): Promise<{
    status: string;
    candidate_id: string;
    output_path: string;
    output_url: string;
    duration_seconds: number;
    crop_x: number;
    subtitles_burned: boolean;
  }> {
    const res = await fetch(`${this.baseUrl}/api/ai/render-vertical-clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: params.candidateId,
        session_id: params.sessionId,
        video_path: params.videoPath || undefined,
        start_time: params.startTime,
        end_time: params.endTime,
        burn_subtitles: params.burnSubtitles ?? true,
        aspect_ratio: params.aspectRatio ?? "9:16",
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AI vertical render failed: ${err}`);
    }
    return res.json();
  }

  /**
   * Feature 3: Trigger High-CTR thumbnail candidate frame selection & headline compositing
   */
  async generateThumbnail(params: {
    candidateId: string;
    sessionId: string;
    videoPath?: string | null;
    startTime: number;
    endTime: number;
    headline: string;
    channelTag?: string;
  }): Promise<{
    status: string;
    candidate_id: string;
    thumbnail_path: string;
    thumbnail_url: string;
    ctr_score: number;
    selected_timestamp: number;
    metrics: any;
  }> {
    const res = await fetch(`${this.baseUrl}/api/ai/generate-thumbnail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_id: params.candidateId,
        session_id: params.sessionId,
        video_path: params.videoPath || undefined,
        start_time: params.startTime,
        end_time: params.endTime,
        headline: params.headline,
        channel_tag: params.channelTag ?? "आचार्य प्रशांत",
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AI thumbnail generation failed: ${err}`);
    }
    return res.json();
  }
}

export const aiServiceClient = new AIServiceClient();
