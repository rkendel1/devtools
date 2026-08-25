import { describe, expect, it } from 'vitest'
import { buildEvidenceGraph } from './evidenceEngine'
import type { NetworkRequestSnapshot } from './types'

function makeRequest(overrides: Partial<NetworkRequestSnapshot>): NetworkRequestSnapshot {
  return {
    id: 'r1',
    startedAt: 1000,
    endedAt: 1200,
    method: 'POST',
    url: '/api/orders',
    status: 422,
    statusText: 'Unprocessable Entity',
    requestHeaders: { authorization: '******' },
    responseHeaders: {},
    requestBody: '{"customerId":"4821"}',
    responseBody: '{"error":"invalid customerId"}',
    ...overrides,
  }
}

describe('buildEvidenceGraph', () => {
  it('detects semantic type diffs against successful peer', () => {
    const failed = makeRequest({})
    const successful = makeRequest({
      id: 'r0',
      status: 201,
      statusText: 'Created',
      requestBody: '{"customerId":4821}',
    })

    const graph = buildEvidenceGraph(failed, successful, [successful, failed], [])

    expect(graph.comparison?.semanticDiff).toContain('customerId changed type from number to string')
    expect(graph.redactionApplied).toBe(true)
  })

  it('flags duplicate request anomalies', () => {
    const request = makeRequest({ id: 'dup-current' })
    const all = Array.from({ length: 6 }).map((_, index) =>
      makeRequest({ id: `dup-${index}`, status: 200, statusText: 'OK' }),
    )

    const graph = buildEvidenceGraph(request, undefined, all, [])

    expect(graph.anomalies.some((item) => item.includes('requested'))).toBe(true)
  })

  it('creates a redacted evidence bundle honoring privacy controls', () => {
    const request = makeRequest({
      requestHeaders: { Authorization: 'Bearer secret', Accept: 'application/json' },
      responseBody: '{"token":"secret"}',
    })
    const graph = buildEvidenceGraph(request, undefined, [request], [], {
      sensitiveKeys: [], includeHeaders: true, includeBodies: false,
    }, { pageUrl: 'https://example.test' })

    expect(graph.bundle?.requestHeaders?.Authorization).toBe('[REDACTED]')
    expect(graph.bundle?.requestHeaders?.Accept).toBe('application/json')
    expect(graph.bundle?.responseBody).toBeUndefined()
    expect(graph.bundle?.environment?.pageUrl).toBe('https://example.test')
  })
})
