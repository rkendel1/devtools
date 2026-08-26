/**
 * Replay FeltDB Integration: Persist ReplayRun evidence
 *
 * Converts ReplayRun observations into FeltDB nodes
 * Links replay back to original investigation
 * Maintains complete evidence chain for analysis
 */

import type { ReplayRun } from './replayContract'
import type { StoredEvidenceNode, StoredEvidenceEdge } from './evidenceGraph'

export interface ReplayEvidenceNode extends StoredEvidenceNode {
  kind: 'replay_run' | 'replay_observation'
  data: {
    replayRunId?: string
    observationType?: string
    description?: string
    success?: boolean
    investigationId?: string
  }
}

export interface ReplayEvidenceEdge extends StoredEvidenceEdge {
  kind: 'produced_by_replay' | 'replay_observed'
}

/**
 * Convert ReplayRun to FeltDB nodes and edges
 *
 * Structure:
 * Investigation
 *   ├─ ReplayFixture
 *   └─ ReplayRun (node)
 *       ├─ outcome (edge: produced by replay)
 *       └─ observations[] (edges: replay observed)
 */
export function createReplayEvidenceNodes(run: ReplayRun): {
  nodes: ReplayEvidenceNode[]
  edges: ReplayEvidenceEdge[]
} {
  const nodes: ReplayEvidenceNode[] = []
  const edges: ReplayEvidenceEdge[] = []

  // Root replay run node
  const replayRunNode: ReplayEvidenceNode = {
    id: run.id,
    investigationId: run.investigationId,
    kind: 'replay_run',
    label: `Replay #${run.id.split(':')[2]?.slice(0, 6) || 'unknown'}`,
    timestamp: run.startedAt,
    data: {
      replayRunId: run.id,
      description: `Replay execution: ${run.outcome.status}`,
      investigationId: run.investigationId,
      success: run.outcome.status === 'REPRODUCED',
    },
  }
  nodes.push(replayRunNode)

  // Create node for each observation
  for (const obs of run.observations) {
    const obsId = `obs:${run.id}:${obs.timestamp}`

    const obsNode: ReplayEvidenceNode = {
      id: obsId,
      investigationId: run.investigationId,
      kind: 'replay_observation',
      label: `${obs.type}: ${obs.description.substring(0, 40)}`,
      timestamp: obs.timestamp,
      data: {
        observationType: obs.type,
        description: obs.description,
        success: obs.success,
      },
    }
    nodes.push(obsNode)

    // Edge: replay run produced this observation
    edges.push({
      id: `${run.id}|produced_by_replay|${obsId}`,
      investigationId: run.investigationId,
      from: run.id,
      to: obsId,
      kind: 'produced_by_replay',
      confidence: obs.success ? 1 : 0.5,
      evidence: [run.id],
    })
  }

  // Link back to original investigation
  if (run.investigationId) {
    edges.push({
      id: `${run.investigationId}|replay_observed|${run.id}`,
      investigationId: run.investigationId,
      from: run.investigationId,
      to: run.id,
      kind: 'replay_observed',
      confidence: run.outcome.confidence,
      evidence: [run.investigationId, run.id],
    })
  }

  return { nodes, edges }
}

/**
 * Build replay summary for display
 */
export function buildReplaySummary(run: ReplayRun): {
  status: string
  confidence: number
  observationCount: number
  successCount: number
  failureCount: number
  observations: Array<{ type: string; description: string; success: boolean }>
} {
  const successCount = run.observations.filter((o) => o.success).length
  const failureCount = run.observations.length - successCount

  return {
    status: run.outcome.status,
    confidence: run.outcome.confidence,
    observationCount: run.observations.length,
    successCount,
    failureCount,
    observations: run.observations.map((o) => ({
      type: o.type,
      description: o.description,
      success: o.success,
    })),
  }
}

/**
 * Format replay status for display
 */
export function formatReplayStatus(status: string, confidence: number): {
  icon: string
  color: string
  text: string
} {
  const statusMap = {
    REPRODUCED: { icon: '✓', color: '#10b981', text: 'REPRODUCED' },
    PARTIAL: { icon: '~', color: '#f59e0b', text: 'PARTIAL' },
    NOT_REPRODUCED: { icon: '✗', color: '#ef4444', text: 'NOT REPRODUCED' },
    UNDETERMINED: { icon: '?', color: '#6b7280', text: 'UNDETERMINED' },
  }

  return statusMap[status as keyof typeof statusMap] || statusMap.UNDETERMINED
}
