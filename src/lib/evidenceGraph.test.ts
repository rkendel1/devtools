import { describe, expect, it } from 'vitest'
import { boundedNeighborhood, investigationRootId, normalizeEvidenceGraph } from './evidenceGraph'
import type { InvestigationRecord } from './types'

const record = {
  id: 'i1', createdAt: 1, requestId: 'r1', requestUrl: '/api/1', fingerprint: 'GET /api/:id',
  graph: {
    request: { method: 'GET', url: '/api/1', status: 500 }, initiator: { source: 'app.js', line: 5 },
    response: { statusText: 'Error', schemaHint: {} }, relatedEvents: [{ type: 'runtime.error', message: 'boom', source: 'app.js', line: 8 }],
    comparison: { semanticDiff: [] }, anomalies: [], trace: [], redactionApplied: false,
  },
  result: { diagnosis: 'Failed', confidence: 0.9, evidence: [], alternatives: [], nextActions: [] },
} satisfies InvestigationRecord

describe('evidence graph', () => {
  it('normalizes records and returns a bounded neighborhood', () => {
    const graph = normalizeEvidenceGraph(record)
    expect(graph.edges.some((edge) => edge.kind === 'THREW_AT')).toBe(true)
    const neighborhood = boundedNeighborhood(investigationRootId(record.id), graph.nodes, graph.edges, 3)
    expect(neighborhood.nodes.some((node) => node.kind === 'runtime-event')).toBe(true)
  })
})
