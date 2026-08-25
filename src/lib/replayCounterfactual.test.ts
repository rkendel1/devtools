import { describe, it, expect } from 'vitest'
import {
  createCounterfactualEvidenceNodes,
  formatExperimentStatus,
  buildExperimentSummary,
} from './replayCounterfactual'
import type { ExperimentResult } from './replayExperiment'

describe('replayCounterfactual', () => {
  const mockExperimentResult: ExperimentResult = {
    experimentId: 'exp:123',
    replayId: 'replayrun:inv-123:1234567890',
    status: 'ISOLATES_CAUSE',
    baselineOutcome: {
      targetRequest: { method: 'POST', url: 'http://localhost:3000/api/checkout' },
      status: 422,
      statusText: 'Unprocessable Entity',
      responseFingerprint: 'fp:error',
      errorFingerprints: ['err:currency_required'],
      errorCount: 1,
      relevantRuntimeEvents: [],
      timing: { requestDuration: 100, totalTime: 100 },
      causalEvidence: [],
    },
    experimentOutcome: {
      targetRequest: { method: 'POST', url: 'http://localhost:3000/api/checkout' },
      status: 200,
      statusText: 'OK',
      responseFingerprint: 'fp:success',
      errorFingerprints: [],
      errorCount: 0,
      relevantRuntimeEvents: [],
      timing: { requestDuration: 100, totalTime: 100 },
      causalEvidence: [],
    },
    isolatedVariable: 'currency',
    reasoning: 'Changing currency from null to USD changed HTTP status from 422 to 200',
    confidence: 0.95,
  }

  describe('createCounterfactualEvidenceNodes', () => {
    it('should create experiment node', () => {
      const { nodes } = createCounterfactualEvidenceNodes(
        mockExperimentResult,
        'inv-123',
        'replayrun:inv-123:baseline'
      )

      const experimentNode = nodes.find((n) => n.kind === 'counterfactual_experiment')
      expect(experimentNode).toBeDefined()
      expect(experimentNode?.id).toBe(mockExperimentResult.experimentId)
      expect(experimentNode?.properties?.status).toBe('ISOLATES_CAUSE')
      expect(experimentNode?.properties?.confidence).toBe(0.95)
    })

    it('should create finding node for causal results', () => {
      const { nodes } = createCounterfactualEvidenceNodes(
        mockExperimentResult,
        'inv-123',
        'replayrun:inv-123:baseline'
      )

      const findingNode = nodes.find((n) => n.kind === 'causal_finding')
      expect(findingNode).toBeDefined()
      expect(findingNode?.properties?.variable).toBe('currency')
      expect(findingNode?.properties?.confidence).toBe(0.95)
    })

    it('should not create finding node for non-causal results', () => {
      const nonCausal: ExperimentResult = {
        ...mockExperimentResult,
        status: 'NOT_CAUSAL',
        isolatedVariable: undefined,
      }

      const { nodes } = createCounterfactualEvidenceNodes(nonCausal, 'inv-123', 'replay-baseline')

      const findingNode = nodes.find((n) => n.kind === 'causal_finding')
      expect(findingNode).toBeUndefined()
    })

    it('should link investigation to experiment', () => {
      const { edges } = createCounterfactualEvidenceNodes(
        mockExperimentResult,
        'inv-123',
        'replayrun:inv-123:baseline'
      )

      const invToExp = edges.find((e) => e.kind === 'investigated_by_experiment')
      expect(invToExp).toBeDefined()
      expect(invToExp?.from).toBe('inv-123')
      expect(invToExp?.to).toBe('exp:123')
    })

    it('should link replay to experiment', () => {
      const { edges } = createCounterfactualEvidenceNodes(
        mockExperimentResult,
        'inv-123',
        'replayrun:inv-123:baseline'
      )

      const replayToExp = edges.find((e) => e.kind === 'experimented_on')
      expect(replayToExp).toBeDefined()
      expect(replayToExp?.from).toBe('replayrun:inv-123:baseline')
      expect(replayToExp?.to).toBe('exp:123')
    })

    it('should link experiment to finding', () => {
      const { edges } = createCounterfactualEvidenceNodes(
        mockExperimentResult,
        'inv-123',
        'replayrun:inv-123:baseline'
      )

      const expToFinding = edges.find((e) => e.kind === 'produces_finding')
      expect(expToFinding).toBeDefined()
      expect(expToFinding?.from).toBe('exp:123')
    })
  })

  describe('formatExperimentStatus', () => {
    it('should format ISOLATES_CAUSE status', () => {
      const formatted = formatExperimentStatus('ISOLATES_CAUSE')
      expect(formatted.icon).toBe('🎯')
      expect(formatted.color).toBe('#10b981')
      expect(formatted.text).toBe('ISOLATES CAUSE')
    })

    it('should format INCONCLUSIVE status', () => {
      const formatted = formatExperimentStatus('INCONCLUSIVE')
      expect(formatted.icon).toBe('⚠')
      expect(formatted.color).toBe('#f59e0b')
      expect(formatted.text).toBe('INCONCLUSIVE')
    })

    it('should format NOT_CAUSAL status', () => {
      const formatted = formatExperimentStatus('NOT_CAUSAL')
      expect(formatted.icon).toBe('✗')
      expect(formatted.color).toBe('#ef4444')
      expect(formatted.text).toBe('NOT CAUSAL')
    })
  })

  describe('buildExperimentSummary', () => {
    it('should build summary with all fields', () => {
      const summary = buildExperimentSummary(mockExperimentResult)

      expect(summary.status).toBe('ISOLATES_CAUSE')
      expect(summary.confidence).toBe(0.95)
      expect(summary.variable).toBe('currency')
      expect(summary.reasoning).toContain('currency')
    })

    it('should handle non-causal results', () => {
      const nonCausal: ExperimentResult = {
        ...mockExperimentResult,
        status: 'NOT_CAUSAL',
        isolatedVariable: undefined,
      }

      const summary = buildExperimentSummary(nonCausal)

      expect(summary.status).toBe('NOT_CAUSAL')
      expect(summary.variable).toBeUndefined()
    })
  })
})
