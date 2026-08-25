/**
 * useReplay: Hook for managing replay execution and state
 *
 * Orchestrates:
 * - Creating ReplayFixture from investigation
 * - Requesting replay via ReplayController
 * - Storing result in state
 * - Persisting to FeltDB (when available)
 */

import { useState, useCallback } from 'react'
import type { ReplayRun, ReplayFixture, OutcomeSignature } from '../lib/replayContract'
import { createReplayFixture } from '../lib/replayContract'
import { sendReplayRequest, onReplayStatus, onReplayError } from '../lib/replayController'

export interface UseReplayState {
  run: ReplayRun | null
  loading: boolean
  error: string | null
  phase: 'idle' | 'preparing' | 'running' | 'capturing' | 'complete' | 'error'
  status: string
}

export function useReplay() {
  const [state, setState] = useState<UseReplayState>({
    run: null,
    loading: false,
    error: null,
    phase: 'idle',
    status: '',
  })

  // Listen for status updates
  const unsubscribeStatus = onReplayStatus((id, phase, description) => {
    setState((prev) => ({
      ...prev,
      phase: phase as any,
      status: description,
    }))
  })

  // Listen for errors
  const unsubscribeError = onReplayError((id, error) => {
    setState((prev) => ({
      ...prev,
      error,
      phase: 'error',
      loading: false,
    }))
  })

  /**
   * Create replay fixture from investigation data
   */
  const createFixture = useCallback(
    (
      investigationId: string,
      targetRequestId: string,
      targetUrl: string,
      targetMethod: string,
      pageUrl: string,
      interactions?: any[],
      networkFixtures?: any[]
    ): ReplayFixture => {
      const fixture = createReplayFixture(investigationId, targetRequestId, targetUrl, targetMethod, pageUrl)

      if (interactions) {
        fixture.interactions = interactions
      }

      if (networkFixtures) {
        fixture.networkFixtures = networkFixtures
      }

      return fixture
    },
    []
  )

  /**
   * Execute replay
   */
  const executeReplay = useCallback(
    async (fixture: ReplayFixture, originalOutcome: OutcomeSignature): Promise<ReplayRun | null> => {
      setState({
        run: null,
        loading: true,
        error: null,
        phase: 'preparing',
        status: 'Preparing replay...',
      })

      try {
        const run = await sendReplayRequest(fixture, originalOutcome)

        setState({
          run,
          loading: false,
          error: null,
          phase: 'complete',
          status: 'Replay complete',
        })

        return run
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)

        setState({
          run: null,
          loading: false,
          error,
          phase: 'error',
          status: `Error: ${error}`,
        })

        return null
      }
    },
    []
  )

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setState({
      run: null,
      loading: false,
      error: null,
      phase: 'idle',
      status: '',
    })
  }, [])

  /**
   * Cleanup listeners
   */
  const cleanup = useCallback(() => {
    unsubscribeStatus()
    unsubscribeError()
  }, [unsubscribeStatus, unsubscribeError])

  return {
    ...state,
    createFixture,
    executeReplay,
    reset,
    cleanup,
  }
}
