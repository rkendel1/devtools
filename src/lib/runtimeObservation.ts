import {
  type CorrelatedRuntimeEvent,
  type DevelopmentWorkspaceConnection,
} from '@feltdb/core/workspace'
import type { ConsoleEvent, NetworkRequestSnapshot } from './types'

export interface RuntimeObservationContext {
  pageUrl?: string
  userAgent?: string
  correlatedEvents?: ConsoleEvent[]
}

/**
 * Project a rich Chrome capture onto FeltDB's factual Runtime Observation
 * contract. Headers and bodies deliberately have no mapping here.
 */
export type RuntimeObservationInput = Parameters<DevelopmentWorkspaceConnection['recordRuntimeObservation']>[0]

export function toRuntimeObservationInput(
  request: NetworkRequestSnapshot,
  context: RuntimeObservationContext,
): RuntimeObservationInput {
  const completedAt = request.endedAt ?? request.startedAt + Math.max(0, request.timingMs ?? 0)
  return {
    method: request.method,
    url: request.url,
    status: request.status,
    startedAt: request.startedAt,
    completedAt,
    page: context.pageUrl,
    userAgent: context.userAgent,
    correlatedEvents: (context.correlatedEvents ?? [])
      .filter((event) => event.ts >= request.startedAt - 1_000 && event.ts <= completedAt + 15_000)
      .map(toCorrelatedRuntimeEvent),
    networkFailure: request.status === 0,
    responseCharacteristics: {
      ...(request.statusText ? { statusText: request.statusText } : {}),
      ...(request.mimeType ? { contentType: request.mimeType } : {}),
    },
  }
}

function toCorrelatedRuntimeEvent(event: ConsoleEvent): CorrelatedRuntimeEvent {
  return {
    kind: event.type === 'console.error' ? 'console_error' : 'runtime_error',
    message: event.message,
    timestamp: event.ts,
    stack: event.stack,
    source: event.source ? { file: event.source, line: event.line } : undefined,
  }
}
