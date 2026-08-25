/**
 * Replay Experiment: Counterfactual infrastructure
 *
 * Defines experiment structure and mutations for causal analysis:
 * - Clone original fixture
 * - Apply mutation (change one variable)
 * - Re-run replay
 * - Compare outcomes
 * - Classify result as "isolates cause" or "not causal"
 */

import type { ReplayFixture, ReplayRun, OutcomeSignature } from './replayContract'

export type MutationType = 'variable' | 'network_response' | 'timing' | 'interaction'

export interface Mutation {
  type: MutationType
  target: string
  originalValue: unknown
  newValue: unknown
  description: string
}

export interface ExperimentConfig {
  experimentId: string
  replayId: string
  investigationId: string
  baselineRun: ReplayRun
  mutation: Mutation
  createdAt: number
}

export interface ExperimentResult {
  experimentId: string
  replayId: string
  status: 'ISOLATES_CAUSE' | 'NOT_CAUSAL' | 'INCONCLUSIVE'
  baselineOutcome: OutcomeSignature
  experimentOutcome: OutcomeSignature
  isolatedVariable?: string
  reasoning: string
  confidence: number
}

export function createExperimentId(): string {
  return `exp:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function cloneFixture(fixture: ReplayFixture): ReplayFixture {
  return {
    ...fixture,
    interactions: fixture.interactions ? [...fixture.interactions] : [],
    networkFixtures: fixture.networkFixtures ? [...fixture.networkFixtures] : [],
    variables: fixture.variables ? { ...fixture.variables } : {},
  }
}

export function applyMutation(fixture: ReplayFixture, mutation: Mutation): ReplayFixture {
  const mutated = cloneFixture(fixture)

  if (mutation.type === 'variable') {
    if (!mutated.variables) {
      mutated.variables = {}
    }
    mutated.variables[mutation.target] = mutation.newValue
  }

  if (mutation.type === 'timing') {
    const requestIndex = parseInt(mutation.target.split(':')[1] || '0', 10)
    if (mutated.networkFixtures && mutated.networkFixtures[requestIndex]) {
      mutated.networkFixtures[requestIndex].delay = mutation.newValue as number
    }
  }

  if (mutation.type === 'network_response') {
    const requestIndex = parseInt(mutation.target.split(':')[1] || '0', 10)
    if (mutated.networkFixtures && mutated.networkFixtures[requestIndex]) {
      const [field] = mutation.target.split(':').slice(2)
      if (field === 'status') {
        mutated.networkFixtures[requestIndex].status = mutation.newValue as number
      }
      if (field === 'body') {
        mutated.networkFixtures[requestIndex].responseBody = mutation.newValue as string
      }
    }
  }

  return mutated
}

export function classifyExperimentOutcome(
  baseline: OutcomeSignature,
  experiment: OutcomeSignature,
  mutation: Mutation
): ExperimentResult['status'] {
  const statusChanged = baseline.status !== experiment.status
  const errorCountChanged = baseline.errorCount !== experiment.errorCount
  const fingerprintChanged = baseline.responseFingerprint !== experiment.responseFingerprint

  if (statusChanged || errorCountChanged) {
    return 'ISOLATES_CAUSE'
  }

  if (fingerprintChanged) {
    return 'INCONCLUSIVE'
  }

  return 'NOT_CAUSAL'
}

export function buildExperimentResult(
  config: ExperimentConfig,
  experimentOutcome: OutcomeSignature
): ExperimentResult {
  const status = classifyExperimentOutcome(
    config.baselineRun.outcome.signature,
    experimentOutcome,
    config.mutation
  )

  let reasoning = ''
  let confidence = 0

  if (status === 'ISOLATES_CAUSE') {
    const baseline = config.baselineRun.outcome.signature
    if (baseline.status !== experimentOutcome.status) {
      reasoning = `Changing ${config.mutation.target} from ${JSON.stringify(config.mutation.originalValue)} to ${JSON.stringify(config.mutation.newValue)} changed HTTP status from ${baseline.status} to ${experimentOutcome.status}`
      confidence = 0.95
    } else if (baseline.errorCount !== experimentOutcome.errorCount) {
      reasoning = `Changing ${config.mutation.target} changed error count from ${baseline.errorCount} to ${experimentOutcome.errorCount}`
      confidence = 0.85
    }
  }

  if (status === 'INCONCLUSIVE') {
    reasoning = `Changing ${config.mutation.target} affected response fingerprint but not status or error count. May indicate partial causality.`
    confidence = 0.5
  }

  if (status === 'NOT_CAUSAL') {
    reasoning = `Changing ${config.mutation.target} did not affect the error outcome.`
    confidence = 0.1
  }

  return {
    experimentId: config.experimentId,
    replayId: config.replayId,
    status,
    baselineOutcome: config.baselineRun.outcome.signature,
    experimentOutcome,
    isolatedVariable: status === 'ISOLATES_CAUSE' ? config.mutation.target : undefined,
    reasoning,
    confidence,
  }
}
