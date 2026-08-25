/**
 * Replay Counterfactual: FeltDB integration for experiments
 *
 * Converts experiment results into evidence graph nodes and edges:
 * - Experiment node (links baseline replay to mutated replay)
 * - Finding node (isolates causal variable)
 * - Evidence edges connecting investigation → baseline → experiment → finding
 */

import type { ExperimentResult } from './replayExperiment'
import type { FeltNode, FeltEdge } from './feltRepository'

export interface CounterfactualEvidence {
  nodes: FeltNode[]
  edges: FeltEdge[]
}

export function createCounterfactualEvidenceNodes(
  result: ExperimentResult,
  investigationId: string,
  baselineReplayId: string
): CounterfactualEvidence {
  const nodes: FeltNode[] = []
  const edges: FeltEdge[] = []

  // Experiment node
  nodes.push({
    id: result.experimentId,
    kind: 'counterfactual_experiment',
    label: `Experiment: ${result.mutation?.target || 'unknown'}`,
    properties: {
      status: result.status,
      confidence: result.confidence,
      reasoning: result.reasoning,
      baselineStatus: result.baselineOutcome.status,
      experimentStatus: result.experimentOutcome.status,
      isolatedVariable: result.isolatedVariable,
    },
    timestamp: Date.now(),
  })

  // Link investigation to experiment
  edges.push({
    id: `edge:${investigationId}:${result.experimentId}`,
    kind: 'investigated_by_experiment',
    from: investigationId,
    to: result.experimentId,
    properties: {
      confidence: result.confidence,
    },
  })

  // Link baseline replay to experiment
  edges.push({
    id: `edge:${baselineReplayId}:${result.experimentId}`,
    kind: 'experimented_on',
    from: baselineReplayId,
    to: result.experimentId,
    properties: {
      status: result.status,
    },
  })

  // Finding node if causal
  if (result.status === 'ISOLATES_CAUSE' && result.isolatedVariable) {
    nodes.push({
      id: `finding:${result.experimentId}`,
      kind: 'causal_finding',
      label: `${result.isolatedVariable} is necessary and sufficient`,
      properties: {
        variable: result.isolatedVariable,
        confidence: result.confidence,
        baselineStatus: result.baselineOutcome.status,
        fixedStatus: result.experimentOutcome.status,
      },
      timestamp: Date.now(),
    })

    edges.push({
      id: `edge:${result.experimentId}:finding:${result.experimentId}`,
      kind: 'produces_finding',
      from: result.experimentId,
      to: `finding:${result.experimentId}`,
      properties: {
        confidence: result.confidence,
      },
    })
  }

  return { nodes, edges }
}

export function formatExperimentStatus(
  status: ExperimentResult['status']
): { icon: string; color: string; text: string } {
  const formats: Record<ExperimentResult['status'], { icon: string; color: string; text: string }> = {
    ISOLATES_CAUSE: { icon: '🎯', color: '#10b981', text: 'ISOLATES CAUSE' },
    INCONCLUSIVE: { icon: '⚠', color: '#f59e0b', text: 'INCONCLUSIVE' },
    NOT_CAUSAL: { icon: '✗', color: '#ef4444', text: 'NOT CAUSAL' },
  }

  return formats[status] || formats.INCONCLUSIVE
}

export function buildExperimentSummary(
  result: ExperimentResult
): {
  status: ExperimentResult['status']
  confidence: number
  variable: string | undefined
  reasoning: string
} {
  return {
    status: result.status,
    confidence: result.confidence,
    variable: result.isolatedVariable,
    reasoning: result.reasoning,
  }
}
