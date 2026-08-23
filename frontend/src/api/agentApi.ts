import type {
  AgentConversation,
  AgentOperationPlan,
  AgentRun,
  AgentScope,
  OrganizationProposal,
  OrganizationProposalKind,
  OrganizationRun,
  OrganizationRunOptions
} from "../types";
import type { ApiContext } from "./context";

export function createAgentApi(context: ApiContext) {
  const { request, appendAccessToken, getApiBase } = context;

  return {
    listAgentConversations: () =>
      request<AgentConversation[]>("/agent/conversations"),

    createAgentConversation: (payload: { title?: string; scope: AgentScope }) =>
      request<AgentConversation>("/agent/conversations", {
        method: "POST",
        body: JSON.stringify(payload)
      }),

    getAgentConversation: (id: number) =>
      request<AgentConversation>(`/agent/conversations/${id}`),

    updateAgentConversation: (
      id: number,
      payload: { title?: string; scope?: AgentScope }
    ) => request<AgentConversation>(`/agent/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

    deleteAgentConversation: (id: number) =>
      request<{ ok: boolean }>(`/agent/conversations/${id}`, { method: "DELETE" }),

    createAgentRun: (conversationId: number, content: string) =>
      request<AgentRun>(`/agent/conversations/${conversationId}/runs`, {
        method: "POST",
        body: JSON.stringify({ content })
      }),

    getAgentRun: (id: number) => request<AgentRun>(`/agent/runs/${id}`),

    cancelAgentRun: (id: number) =>
      request<AgentRun>(`/agent/runs/${id}/cancel`, { method: "POST" }),

    approveAgentOperationPlan: (id: number, fingerprint: string) =>
      request<AgentOperationPlan>(`/agent/operation-plans/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ fingerprint })
      }),

    rejectAgentOperationPlan: (id: number) =>
      request<AgentOperationPlan>(`/agent/operation-plans/${id}/reject`, {
        method: "POST"
      }),

    listOrganizationRuns: () => request<OrganizationRun[]>("/organization-runs"),

    createOrganizationRun: (scope: AgentScope, options: OrganizationRunOptions) =>
      request<OrganizationRun>("/organization-runs", {
        method: "POST",
        body: JSON.stringify({ scope, options })
      }),

    getOrganizationRun: (id: number) =>
      request<OrganizationRun>(`/organization-runs/${id}`),

    cancelOrganizationRun: (id: number) =>
      request<OrganizationRun>(`/organization-runs/${id}/cancel`, { method: "POST" }),

    retryOrganizationRun: (id: number) =>
      request<OrganizationRun>(`/organization-runs/${id}/retry`, { method: "POST" }),

    decideOrganizationProposal: (
      id: number,
      decision: "accepted" | "rejected" | "skipped",
      editedValue?: unknown,
      note?: string
    ) => request<OrganizationProposal>(`/organization-proposals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ decision, edited_value: editedValue, note })
    }),

    applyOrganizationRun: (id: number, categories: OrganizationProposalKind[]) =>
      request<OrganizationRun>(`/organization-runs/${id}/apply`, {
        method: "POST",
        body: JSON.stringify({ categories })
      }),

    agentConversationExportUrl: (id: number) =>
      appendAccessToken(`${getApiBase()}/agent/conversations/${id}/export`)
  };
}
