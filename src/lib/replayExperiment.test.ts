import { describe, it, expect } from 'vitest'
import {
  cloneFixture,
  applyMutation,
  classifyExperimentOutcome,
  buildExperimentResult,
  createExperimentId,
  type Mutation,
  type ExperimentConfig,
} from './replayExperiment'
import type { ReplayFixture, OutcomeSignature } from './replayContract'

describe('replayExperiment', () => {
  const mockFixture: ReplayFixture = {
    id: 'replay:inv-123:1234567890',
    investigationId: 'inv-123',
    targetRequestId: 'req-456',
    targetUrl: 'http://localhost:3000/api/checkout',
    targetMethod: 'POST',
    pageUrl: 'http://localhost:3000',
    interactions: [
      {
        type: 'click',
        selector: '#checkout-btn',
      },
    ],
    networkFixtures: [],
    variables: {
      currency: null,
    },
  }

  const mockBaseline = {
    id: 'replayrun:inv-123:1234567890',
    fixtureId: 'replay:inv-123:1234567890',
    investigationId: 'inv-123',
    startedAt: 1234567890,
    completedAt: 1234567990,
    durationMs: 100,
    observations: [],
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
        causalEvidence: [],
      },
      unsupportedCapabilities: [],
      notes: 'Baseline completed',
    },
    producedEvidence: {
      observationNodeIds: [],
      timestampRange: { start: 1234567890, end: 1234567990 },
    },
    matches: { status: true, errorCount: true, timing: true, behavior: true, overall: true },
  }

  describe('createExperimentId', () => {
    it('should create unique experiment IDs', () => {
      const id1 = createExperimentId()
      const id2 = createExperimentId()

      expect(id1).toMatch(/^exp:/)
      expect(id2).toMatch(/^exp:/)
      expect(id1).not.toBe(id2)
    })
  })

  describe('cloneFixture', () => {
    it('should create deep copy of fixture', () => {
      const cloned = cloneFixture(mockFixture)

      expect(cloned).toEqual(mockFixture)
      expect(cloned).not.toBe(mockFixture)
      expect(cloned.interactions).not.toBe(mockFixture.interactions)
      expect(cloned.variables).not.toBe(mockFixture.variables)
    })

    it('should handle fixtures without interactions', () => {
      const minimal: ReplayFixture = {
        id: 'replay:test',
        investigationId: 'inv-test',
        targetRequestId: 'req-test',
        targetUrl: 'http://example.com',
        targetMethod: 'GET',
        pageUrl: 'http://example.com',
      }

      const cloned = cloneFixture(minimal)
      expect(cloned.interactions).toEqual([])
    })
  })

  describe('applyMutation', () => {
    it('should apply variable mutation', () => {
      const mutation: Mutation = {
        type: 'variable',
        target: 'currency',
        originalValue: null,
        newValue: 'USD',
        description: 'Set currency',
      }

      const mutated = applyMutation(mockFixture, mutation)

      expect(mutated.variables?.currency).toBe('USD')
      expect(mutated.id).toBe(mockFixture.id)
    })

    it('should create variables object if missing', () => {
      const fixture: ReplayFixture = {
        ...mockFixture,
        variables: undefined,
      }

      const mutation: Mutation = {
        type: 'variable',
        target: 'newVar',
        originalValue: undefined,
        newValue: 'value',
        description: 'Add new variable',
      }

      const mutated = applyMutation(fixture, mutation)

      expect(mutated.variables?.newVar).toBe('value')
    })

    it('should apply timing mutation', () => {
      const fixture: ReplayFixture = {
        ...mockFixture,
        networkFixtures: [{ status: 200, delay: 100, responseBody: '' }],
      }

      const mutation: Mutation = {
        type: 'timing',
        target: 'timing:0',
        originalValue: 100,
        newValue: 5000,
        description: 'Add delay',
      }

      const mutated = applyMutation(fixture, mutation)

      expect(mutated.networkFixtures?.[0]?.delay).toBe(5000)
    })

    it('should apply network response mutation', () => {
      const fixture: ReplayFixture = {
        ...mockFixture,
        networkFixtures: [{ status: 422, delay: 100, responseBody: 'error' }],
      }

      const mutation: Mutation = {
        type: 'network_response',
        target: 'network:0:status',
        originalValue: 422,
        newValue: 200,
        description: 'Mock success',
      }

      const mutated = applyMutation(fixture, mutation)

      expect(mutated.networkFixtures?.[0]?.status).toBe(200)
    })
  })

  describe('classifyExperimentOutcome', () => {
    const baseline = mockBaseline.outcome.signature

    it('should classify as ISOLATES_CAUSE when status changes', () => {
      const experiment: OutcomeSignature = {
        ...baseline,
        status: 200,
      }

      const result = classifyExperimentOutcome(baseline, experiment, {} as Mutation)

      expect(result).toBe('ISOLATES_CAUSE')
    })

    it('should classify as ISOLATES_CAUSE when error count changes', () => {
      const experiment: OutcomeSignature = {
        ...baseline,
        errorCount: 0,
      }

      const result = classifyExperimentOutcome(baseline, experiment, {} as Mutation)

      expect(result).toBe('ISOLATES_CAUSE')
    })

    it('should classify as INCONCLUSIVE when fingerprint changes only', () => {
      const experiment: OutcomeSignature = {
        ...baseline,
        responseFingerprint: 'fp:different',
      }

      const result = classifyExperimentOutcome(baseline, experiment, {} as Mutation)

      expect(result).toBe('INCONCLUSIVE')
    })

    it('should classify as NOT_CAUSAL when nothing changes', () => {
      const experiment = baseline

      const result = classifyExperimentOutcome(baseline, experiment, {} as Mutation)

      expect(result).toBe('NOT_CAUSAL')
    })
  })

  describe('buildExperimentResult', () => {
    it('should build result for isolating cause (status)', () => {
      const config: ExperimentConfig = {
        experimentId: 'exp:123',
        replayId: mockBaseline.id,
        investigationId: 'inv-123',
        baselineRun: mockBaseline,
        mutation: {
          type: 'variable',
          target: 'currency',
          originalValue: null,
          newValue: 'USD',
          description: 'Set currency',
        },
        createdAt: Date.now(),
      }

      const experimentOutcome: OutcomeSignature = {
        ...mockBaseline.outcome.signature,
        status: 200,
      }

      const result = buildExperimentResult(config, experimentOutcome)

      expect(result.status).toBe('ISOLATES_CAUSE')
      expect(result.confidence).toBe(0.95)
      expect(result.isolatedVariable).toBe('currency')
      expect(result.reasoning).toContain('422')
      expect(result.reasoning).toContain('200')
    })

    it('should build result for isolating cause (error count)', () => {
      const config: ExperimentConfig = {
        experimentId: 'exp:123',
        replayId: mockBaseline.id,
        investigationId: 'inv-123',
        baselineRun: mockBaseline,
        mutation: {
          type: 'variable',
          target: 'currency',
          originalValue: null,
          newValue: 'USD',
          description: 'Set currency',
        },
        createdAt: Date.now(),
      }

      const experimentOutcome: OutcomeSignature = {
        ...mockBaseline.outcome.signature,
        status: 422,
        errorCount: 0,
      }

      const result = buildExperimentResult(config, experimentOutcome)

      expect(result.status).toBe('ISOLATES_CAUSE')
      expect(result.confidence).toBe(0.85)
      expect(result.isolatedVariable).toBe('currency')
    })

    it('should build result for inconclusive outcome', () => {
      const config: ExperimentConfig = {
        experimentId: 'exp:123',
        replayId: mockBaseline.id,
        investigationId: 'inv-123',
        baselineRun: mockBaseline,
        mutation: {
          type: 'variable',
          target: 'currency',
          originalValue: null,
          newValue: 'USD',
          description: 'Set currency',
        },
        createdAt: Date.now(),
      }

      const experimentOutcome: OutcomeSignature = {
        ...mockBaseline.outcome.signature,
        responseFingerprint: 'fp:different',
      }

      const result = buildExperimentResult(config, experimentOutcome)

      expect(result.status).toBe('INCONCLUSIVE')
      expect(result.confidence).toBe(0.5)
      expect(result.isolatedVariable).toBeUndefined()
    })

    it('should build result for not causal outcome', () => {
      const config: ExperimentConfig = {
        experimentId: 'exp:123',
        replayId: mockBaseline.id,
        investigationId: 'inv-123',
        baselineRun: mockBaseline,
        mutation: {
          type: 'variable',
          target: 'currency',
          originalValue: null,
          newValue: 'USD',
          description: 'Set currency',
        },
        createdAt: Date.now(),
      }

      const experimentOutcome = mockBaseline.outcome.signature

      const result = buildExperimentResult(config, experimentOutcome)

      expect(result.status).toBe('NOT_CAUSAL')
      expect(result.confidence).toBe(0.1)
      expect(result.isolatedVariable).toBeUndefined()
    })
  })
})
