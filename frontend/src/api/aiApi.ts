import type {
  AITask,
  BatchOrganizationPayload,
  BatchOrganizationResult,
  BatchTaskResult,
  LLMConfigPayload,
  LLMModelDiscoveryPayload,
  LLMModelDiscoveryResult,
  LLMTestResult,
  Transcript,
  TranscriptSegmentEdit
} from "../types";
import type { ApiContext } from "./context";

export function createAiApi(context: ApiContext) {
  const { request, appendAccessToken, getApiBase } = context;

  return {
    transcribe: (audioId: number) => request<AITask>(`/audio-items/${audioId}/transcribe`, {
      method: "POST"
    }),
    analyze: (audioId: number) => request<AITask>(`/audio-items/${audioId}/analyze`, {
      method: "POST"
    }),
    batchTranscribe: (audioIds: number[]) => request<BatchTaskResult>(
      "/audio-items/batch/transcribe",
      { method: "POST", body: JSON.stringify({ audio_ids: audioIds }) }
    ),
    batchAnalyze: (audioIds: number[]) => request<BatchTaskResult>(
      "/audio-items/batch/analyze",
      { method: "POST", body: JSON.stringify({ audio_ids: audioIds }) }
    ),
    organizeAudioBatch: (payload: BatchOrganizationPayload) =>
      request<BatchOrganizationResult>("/audio-items/batch/organize", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    testLlm: (payload: LLMConfigPayload) => request<LLMTestResult>("/ai/test-llm", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
    discoverLlmModels: (payload: LLMModelDiscoveryPayload) =>
      request<LLMModelDiscoveryResult>("/ai/models", {
        method: "POST",
        body: JSON.stringify(payload)
      }),

    getTranscript: (audioId: number) =>
      request<Transcript>(`/audio-items/${audioId}/transcript`),
    listTranscriptRevisions: (audioId: number) =>
      request<Transcript["transcript"][]>(`/audio-items/${audioId}/transcript/revisions`),
    getTranscriptRevision: (audioId: number, revisionId: number) =>
      request<Transcript>(`/audio-items/${audioId}/transcript/revisions/${revisionId}`),
    updateTranscript: (audioId: number, fullText: string, expectedUpdatedAt: string) =>
      request<Transcript>(`/audio-items/${audioId}/transcript`, {
        method: "PATCH",
        body: JSON.stringify({ full_text: fullText, expected_updated_at: expectedUpdatedAt })
      }),
    updateTranscriptSegments: (
      audioId: number,
      segments: TranscriptSegmentEdit[],
      expectedUpdatedAt: string
    ) => request<Transcript>(`/audio-items/${audioId}/transcript/segments`, {
      method: "PATCH",
      body: JSON.stringify({ expected_updated_at: expectedUpdatedAt, segments })
    }),
    validateTranscript: (audioId: number) =>
      request<Transcript>(`/audio-items/${audioId}/transcript/validate`, { method: "POST" }),
    updateTranscriptIssue: (
      audioId: number,
      issueId: number,
      status: "open" | "resolved" | "dismissed",
      closedReason?: string
    ) => request<NonNullable<Transcript["issues"]>[number]>(
      `/audio-items/${audioId}/transcript/issues/${issueId}`,
      { method: "PATCH", body: JSON.stringify({ status, closed_reason: closedReason }) }
    ),
    createTranscriptChapter: (
      audioId: number,
      payload: {
        expected_revision_id: number;
        title: string;
        start_seconds: number;
        end_seconds: number;
      }
    ) => request<NonNullable<Transcript["chapters"]>[number]>(
      `/audio-items/${audioId}/transcript/chapters`,
      { method: "POST", body: JSON.stringify(payload) }
    ),
    updateTranscriptChapter: (
      audioId: number,
      chapterId: number,
      payload: { title?: string; start_seconds?: number; end_seconds?: number }
    ) => request<NonNullable<Transcript["chapters"]>[number]>(
      `/audio-items/${audioId}/transcript/chapters/${chapterId}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    ),
    deleteTranscriptChapter: (audioId: number, chapterId: number) =>
      request<{ ok: boolean }>(`/audio-items/${audioId}/transcript/chapters/${chapterId}`, {
        method: "DELETE"
      }),
    mergeTranscriptChapters: (audioId: number, chapterIds: number[], title?: string) =>
      request<NonNullable<Transcript["chapters"]>[number]>(
        `/audio-items/${audioId}/transcript/chapters/merge`,
        { method: "POST", body: JSON.stringify({ chapter_ids: chapterIds, title }) }
      ),
    transcriptExportUrl: (audioId: number, format: "txt" | "json" | "srt") =>
      appendAccessToken(
        `${getApiBase()}/audio-items/${audioId}/transcript/export?format=${encodeURIComponent(format)}`
      ),
    metadataExportUrl: (format: "json" | "csv") => appendAccessToken(
      `${getApiBase()}/export/metadata?format=${encodeURIComponent(format)}`
    ),

    listTasks: (params?: {
      status?: string;
      task_type?: string;
      audio_id?: number;
      limit?: number;
      offset?: number;
    }) => {
      const query = new URLSearchParams();
      if (params?.status) query.set("status", params.status);
      if (params?.task_type) query.set("task_type", params.task_type);
      if (params?.audio_id !== undefined) query.set("audio_id", String(params.audio_id));
      if (params?.limit !== undefined) query.set("limit", String(params.limit));
      if (params?.offset !== undefined) query.set("offset", String(params.offset));
      const suffix = query.toString();
      return request<AITask[]>(`/ai-tasks${suffix ? `?${suffix}` : ""}`);
    },
    retryTask: (taskId: number) => request<AITask>(`/ai-tasks/${taskId}/retry`, {
      method: "POST"
    }),
    cancelTask: (taskId: number) => request<AITask>(`/ai-tasks/${taskId}/cancel`, {
      method: "POST"
    })
  };
}
