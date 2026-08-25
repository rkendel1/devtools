import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { feltRepository } from './feltRepository'
import type { InvestigationRecord } from './types'

function investigation(id: string, createdAt = Date.now(), pinned = false): InvestigationRecord {
  return {
    id, createdAt, lastSeenAt: createdAt, pinned, requestId: `request-${id}`, requestUrl: 'https://example.test/api/42', fingerprint: 'GET https://example.test/api/:id|500',
    graph: {
      request: { method: 'GET', url: 'https://example.test/api/42', status: 500 },
      initiator: { source: 'app.js', line: 12 }, response: { statusText: 'Error', schemaHint: {} },
      relatedEvents: [{ type: 'runtime.error', message: 'boom', source: 'app.js', line: 14 }],
      comparison: { semanticDiff: [] }, anomalies: [], trace: [], redactionApplied: false,
    },
    result: { diagnosis: 'Backend failed', confidence: 0.9, evidence: ['HTTP 500'], alternatives: [], nextActions: [] },
  }
}

describe('FeltRepository', () => {
  it('migrates investigations and persists a traversable evidence graph', async () => {
    const record = investigation(`felt-test-${crypto.randomUUID()}`)
    const history = await feltRepository.initializeHistory([record])
    expect(history.some((item) => item.id === record.id)).toBe(true)

    const graph = await feltRepository.getNeighborhood(record.id, 4)
    expect(graph.nodes.some((node) => node.kind === 'request')).toBe(true)
    expect(graph.edges.some((edge) => edge.kind === 'THREW_AT')).toBe(true)
    expect(feltRepository.runtime()?.storage).toBe('indexeddb')

    await feltRepository.persistRequests(7, [{
      id: 'captured-request', startedAt: 1, method: 'POST', url: 'https://example.test/api', status: 401,
      statusText: 'Unauthorized', requestHeaders: { Authorization: 'Bearer secret' }, responseHeaders: {},
      requestBody: '{"token":"secret"}',
    }], { sensitiveKeys: [], includeHeaders: true, includeBodies: true })
    await feltRepository.persistRuntimeEvents(7, [{ type: 'runtime.error', message: 'boom', ts: 2 }], { sensitiveKeys: [], includeHeaders: true, includeBodies: true })
    expect(await feltRepository.captureStats(7)).toEqual({ requests: 1, runtimeEvents: 1 })
  })

  it('purges evidence older than one day while retaining pinned investigations', async () => {
    const now = Date.now()
    const current = investigation(`current-${crypto.randomUUID()}`, now)
    const expired = investigation(`expired-${crypto.randomUUID()}`, now - 25 * 60 * 60 * 1000)
    const pinned = investigation(`pinned-${crypto.randomUUID()}`, now - 25 * 60 * 60 * 1000, true)
    await feltRepository.syncHistory([current, expired, pinned])
    await feltRepository.runMaintenance(true, now)
    const history = await feltRepository.initializeHistory([])
    expect(history.some((item) => item.id === expired.id)).toBe(false)
    expect(history.some((item) => item.id === pinned.id)).toBe(true)

    await feltRepository.persistRequests(9, [{
      id: 'expired-request', startedAt: now - 25 * 60 * 60 * 1000, method: 'GET', url: '/old', status: 200,
      statusText: 'OK', requestHeaders: {}, responseHeaders: {},
    }], { sensitiveKeys: [], includeHeaders: true, includeBodies: true })
    await feltRepository.runMaintenance(true, now)
    expect((await feltRepository.captureStats(9)).requests).toBe(0)
  })
})
