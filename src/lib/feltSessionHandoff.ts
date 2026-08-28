export const FELT_SESSION_HANDOFF_COLLECTION = 'runtime_investigation_handoffs'

export type FeltSessionHandoff = {
  entityId?: string
  requestKey: string
  kind: 'runtime_investigation_handoff'
  schemaVersion: 1
  workspaceId: string
  investigationId: string
  target: { product: 'felt-session'; repositoryId: string; disposition: 'queued_task' }
  source: { product: 'feltdb-devtools'; clientId: string; localInvestigationId?: string }
  status: 'pending'
  createdAt: number
}

export function feltSessionRequestKey(investigationId: string, repositoryId: string): string {
  return `felt-session:${repositoryId}:${investigationId}`
}

export function createFeltSessionHandoff(input: {
  workspaceId: string
  investigationId: string
  repositoryId: string
  clientId: string
  localInvestigationId?: string
  createdAt?: number
}): FeltSessionHandoff {
  return {
    requestKey: feltSessionRequestKey(input.investigationId, input.repositoryId),
    kind: 'runtime_investigation_handoff',
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    investigationId: input.investigationId,
    target: { product: 'felt-session', repositoryId: input.repositoryId, disposition: 'queued_task' },
    source: {
      product: 'feltdb-devtools',
      clientId: input.clientId,
      ...(input.localInvestigationId ? { localInvestigationId: input.localInvestigationId } : {}),
    },
    status: 'pending',
    createdAt: input.createdAt ?? Date.now(),
  }
}
