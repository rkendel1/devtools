import { describe, it, expect } from 'vitest'
import { createReplayEvidenceNodes, buildReplaySummary, formatReplayStatus } from './replayFeltDB'
import type { ReplayRun } from './replayContract'

describe('replayFeltDB', () => {
  const mockReplayRun: ReplayRun = {
    id: 'replayrun:inv-123:1234567890',
    fixtureId: 'replay:inv-123:1234567890',
    investigationId: 'inv-123',
    startedAt: 1234567890,
    completedAt: 1234567990,
    durationMs: 100,
    observations: [
      {
        timestamp: 1234567890,
        type: 'navigation',
        description: 'Navigate to http://localhost:3000/',
        success: true,
      },
      {
        timestamp: 1234567900,
        type: 'interaction',
        description: 'Click #checkout-btn',
        success: true,
      },
      {
        timestamp: 1234567950,
        type: 'target_request',
        description: 'Target request observed: POST http://localhost:3000/api/checkout',
        success: true,
      },
      {
        timestamp: 1234567960,
        type: 'runtime_error',
        description: 'Runtime error: currency_required',
        success: true,
      },
    ],
    outcome: {
      status: 'REPRODUCED',
      confidence: 0.9,
      signature: {
        targetRequest: { method: 'POST', url: 'http://localhost:3000/api/checkout' },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:test',
        errorFingerprints: ['err:test'],
        errorCount: 1,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 100 },
        causalEvidence: ['inv-123'],
      },
      unsupportedCapabilities: [],
      notes: 'Replay completed successfully',
    },
    producedEvidence: {
      observationNodeIds: [],
      timestampRange: { start: 1234567890, end: 1234567990 },
    },
    matches: {
      status: true,
      errorCount: true,
      timing: true,
      behavior: true,
      overall: true,
    },
  }

  describe('createReplayEvidenceNodes', () => {
    it('should create replay run node', () => {
      const { nodes } = createReplayEvidenceNodes(mockReplayRun)

      const replayNode = nodes.find((n) => n.kind === 'replay_run')
      expect(replayNode).toBeDefined()
      expect(replayNode?.id).toBe(mockReplayRun.id)
      expect(replayNode?.label).toContain('Replay')
    })

    it('should create observation nodes for each observation', () => {
      const { nodes } = createReplayEvidenceNodes(mockReplayRun)

      const obsNodes = nodes.filter((n) => n.kind === 'replay_observation')
      expect(obsNodes).toHaveLength(mockReplayRun.observations.length)
    })

    it('should link replay run to observations', () => {
      const { edges } = createReplayEvidenceNodes(mockReplayRun)

      const replayToObsEdges = edges.filter((e) => e.kind === 'produced_by_replay')
      expect(replayToObsEdges.length).toBeGreaterThan(0)
      expect(replayToObsEdges.every((e) => e.from === mockReplayRun.id)).toBe(true)
    })

    it('should link investigation to replay', () => {
      const { edges } = createReplayEvidenceNodes(mockReplayRun)

      const invToReplayEdges = edges.filter(
        (e) => e.kind === 'replay_observed' && e.from === mockReplayRun.investigationId
      )
      expect(invToReplayEdges.length).toBeGreaterThan(0)
      expect(invToReplayEdges[0].to).toBe(mockReplayRun.id)
    })

    it('should set correct confidence on investigation link', () => {
      const { edges } = createReplayEvidenceNodes(mockReplayRun)

      const invToReplayEdge = edges.find((e) => e.kind === 'replay_observed')
      expect(invToReplayEdge?.confidence).toBe(mockReplayRun.outcome.confidence)
    })
  })

  describe('buildReplaySummary', () => {
    it('should build summary with correct counts', () => {
      const summary = buildReplaySummary(mockReplayRun)

      expect(summary.status).toBe('REPRODUCED')
      expect(summary.confidence).toBe(0.9)
      expect(summary.observationCount).toBe(4)
      expect(summary.successCount).toBe(4)
      expect(summary.failureCount).toBe(0)
    })

    it('should include all observations', () => {
      const summary = buildReplaySummary(mockReplayRun)

      expect(summary.observations).toHaveLength(mockReplayRun.observations.length)
      expect(summary.observations[0].type).toBe('navigation')
      expect(summary.observations[1].type).toBe('interaction')
    })

    it('should handle failed observations', () => {
      const runWithFailure: ReplayRun = {
        ...mockReplayRun,
        observations: [
          ...mockReplayRun.observations,
          {
            timestamp: 1234568000,
            type: 'network',
            description: 'Failed to setup network',
            success: false,
          },
        ],
      }

      const summary = buildReplaySummary(runWithFailure)
      expect(summary.observationCount).toBe(5)
      expect(summary.successCount).toBe(4)
      expect(summary.failureCount).toBe(1)
    })
  })

  describe('formatReplayStatus', () => {
    it('should format REPRODUCED status', () => {
      const formatted = formatReplayStatus('REPRODUCED', 0.9)
      expect(formatted.icon).toBe('✓')
      expect(formatted.color).toBe('#10b981')
      expect(formatted.text).toBe('REPRODUCED')
    })

    it('should format PARTIAL status', () => {
      const formatted = formatReplayStatus('PARTIAL', 0.7)
      expect(formatted.icon).toBe('~')
      expect(formatted.color).toBe('#f59e0b')
      expect(formatted.text).toBe('PARTIAL')
    })

    it('should format NOT_REPRODUCED status', () => {
      const formatted = formatReplayStatus('NOT_REPRODUCED', 0.2)
      expect(formatted.icon).toBe('✗')
      expect(formatted.color).toBe('#ef4444')
      expect(formatted.text).toBe('NOT REPRODUCED')
    })

    it('should format UNDETERMINED status', () => {
      const formatted = formatReplayStatus('UNDETERMINED', 0)
      expect(formatted.icon).toBe('?')
      expect(formatted.color).toBe('#6b7280')
    })

    it('should handle unknown status', () => {
      const formatted = formatReplayStatus('UNKNOWN', 0.5)
      expect(formatted).toEqual(formatReplayStatus('UNDETERMINED', 0.5))
    })
  })
})
