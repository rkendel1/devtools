import { describe, it, expect } from 'vitest'
import { classifyEvidenceLayer, buildCausalChain, layerIcon, confidenceColor } from './evidenceLayers'
import type { StoredEvidenceNode, StoredEvidenceEdge } from './evidenceGraph'

describe('evidenceLayers', () => {
  describe('classifyEvidenceLayer', () => {
    it('should classify 100% confidence as observed', () => {
      const edge: StoredEvidenceEdge = {
        id: 'test',
        investigationId: 'inv1',
        from: 'n1',
        to: 'n2',
        kind: 'INITIATED_BY',
        confidence: 1,
        evidence: [],
      }
      expect(classifyEvidenceLayer(edge)).toBe('observed')
    })

    it('should classify 0.7-0.99 confidence as inferred', () => {
      const edge: StoredEvidenceEdge = {
        id: 'test',
        investigationId: 'inv1',
        from: 'n1',
        to: 'n2',
        kind: 'INITIATED_BY',
        confidence: 0.85,
        evidence: [],
      }
      expect(classifyEvidenceLayer(edge)).toBe('inferred')
    })

    it('should classify <0.7 confidence as hypothesis', () => {
      const edge: StoredEvidenceEdge = {
        id: 'test',
        investigationId: 'inv1',
        from: 'n1',
        to: 'n2',
        kind: 'INITIATED_BY',
        confidence: 0.6,
        evidence: [],
      }
      expect(classifyEvidenceLayer(edge)).toBe('hypothesis')
    })
  })

  describe('layerIcon', () => {
    it('should return correct icons', () => {
      expect(layerIcon('observed')).toBe('●')
      expect(layerIcon('inferred')).toBe('◐')
      expect(layerIcon('hypothesis')).toBe('◯')
    })
  })

  describe('confidenceColor', () => {
    it('should return green for high confidence', () => {
      expect(confidenceColor(0.95)).toBe('#10b981')
    })

    it('should return amber for medium confidence', () => {
      expect(confidenceColor(0.8)).toBe('#f59e0b')
    })

    it('should return red for low confidence', () => {
      expect(confidenceColor(0.6)).toBe('#ef4444')
    })
  })

  describe('buildCausalChain', () => {
    it('should build chain from root node', () => {
      const root: StoredEvidenceNode = {
        id: 'root',
        investigationId: 'inv1',
        kind: 'investigation',
        label: 'Request failed',
        timestamp: Date.now(),
        data: {},
      }

      const node2: StoredEvidenceNode = {
        id: 'n2',
        investigationId: 'inv1',
        kind: 'response',
        label: '500 Error',
        timestamp: Date.now(),
        data: { status: 500 },
      }

      const nodes = new Map([
        ['root', root],
        ['n2', node2],
      ])

      const edges: StoredEvidenceEdge[] = [
        {
          id: 'e1',
          investigationId: 'inv1',
          from: 'root',
          to: 'n2',
          kind: 'OBSERVED_DURING',
          confidence: 1,
          evidence: ['user reported'],
        },
      ]

      const chain = buildCausalChain(root, edges, nodes)

      expect(chain.steps.length).toBe(1)
      expect(chain.steps[0].nodeId).toBe('n2')
      expect(chain.steps[0].claim.layer).toBe('observed')
      expect(chain.steps[0].claim.confidence).toBe(1)
      expect(chain.confidence).toBe(1)
    })

    it('should handle multiple causal steps', () => {
      const root: StoredEvidenceNode = {
        id: 'root',
        investigationId: 'inv1',
        kind: 'investigation',
        label: 'Checkout failed',
        timestamp: Date.now(),
        data: {},
      }

      const request: StoredEvidenceNode = {
        id: 'req',
        investigationId: 'inv1',
        kind: 'request',
        label: 'POST /checkout',
        timestamp: Date.now(),
        data: { method: 'POST' },
      }

      const response: StoredEvidenceNode = {
        id: 'resp',
        investigationId: 'inv1',
        kind: 'response',
        label: '422 Validation Error',
        timestamp: Date.now(),
        data: { status: 422 },
      }

      const nodes = new Map([
        ['root', root],
        ['req', request],
        ['resp', response],
      ])

      const edges: StoredEvidenceEdge[] = [
        {
          id: 'e1',
          investigationId: 'inv1',
          from: 'root',
          to: 'req',
          kind: 'OBSERVED_DURING',
          confidence: 1,
          evidence: ['selected'],
        },
        {
          id: 'e2',
          investigationId: 'inv1',
          from: 'req',
          to: 'resp',
          kind: 'RETURNED',
          confidence: 1,
          evidence: ['http 422'],
        },
      ]

      const chain = buildCausalChain(root, edges, nodes)

      expect(chain.steps.length).toBeGreaterThan(0)
      expect(chain.steps[0].nodeId).toBe('req')
    })
  })
})
