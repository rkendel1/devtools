/**
 * useCounterfactual: Hook for running and managing experiments
 *
 * Orchestrates:
 * - Creating mutation from baseline
 * - Cloning and mutating fixture
 * - Re-running replay with mutated fixture
 * - Storing result in state
 * - Persisting to FeltDB
 */

import { useState, useCallback } from 'react'
import type { ReplayFixture, ReplayRun, OutcomeSignature } from '../lib/replayContract'
import type { ExperimentResult } from '../lib/replayExperiment'
import {
  createExperimentId,
  cloneFixture,
  applyMutation,
  buildExperimentResult,
  type Mutation,
  type ExperimentConfig,
} from '../lib/replayExperiment'
import { sendReplayRequest } from '../lib/replayController'

export interface UseCounterfactualState {
  results: ExperimentResult[]
  loading: boolean
  error: string | null
  activeExperiment: ExperimentConfig | null
}

export function useCounterfactual() {
  const [state, setState] = useState<UseCounterfactualState>({
    results: [],
    loading: false,
    error: null,
    activeExperiment: null,
  })

  const runExperiment = useCallback(
    async (
      baseline: ReplayRun,
      baselineFixture: ReplayFixture,
      originalOutcome: OutcomeSignature,
      mutation: Mutation
    ): Promise<ExperimentResult | null> => {
      const experimentId = createExperimentId()

      const config: ExperimentConfig = {
        experimentId,
        replayId: baseline.id,
        investigationId: baseline.investigationId,
        baselineRun: baseline,
        mutation,
        createdAt: Date.now(),
      }

      setState({
        results: state.results,
        loading: true,
        error: null,
        activeExperiment: config,
      })

      try {
        const mutatedFixture = cloneFixture(baselineFixture)
        applyMutation(mutatedFixture, mutation)

        const experimentRun = await sendReplayRequest(mutatedFixture, originalOutcome)

        if (!experimentRun) {
          throw new Error('Experiment replay failed')
        }

        const result = buildExperimentResult(config, experimentRun.outcome.signature)

        setState({
          results: [...state.results, result],
          loading: false,
          error: null,
          activeExperiment: null,
        })

        return result
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)

        setState({
          results: state.results,
          loading: false,
          error,
          activeExperiment: config,
        })

        return null
      }
    },
    [state.results]
  )

  const reset = useCallback(() => {
    setState({
      results: [],
      loading: false,
      error: null,
      activeExperiment: null,
    })
  }, [])

  return {
    ...state,
    runExperiment,
    reset,
  }
}
