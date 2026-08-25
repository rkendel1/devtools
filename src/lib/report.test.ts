import { describe, expect, it } from 'vitest'
import { formatInvestigationReport } from './report'
import type { InvestigationRecord } from './types'

describe('formatInvestigationReport', () => {
  it('includes request details and every source line', () => {
    const record = {
      id: 'one',
      createdAt: 0,
      requestId: 'request',
      requestUrl: 'https://example.com/api',
      graph: {
        request: { method: 'GET', url: 'https://example.com/api', status: 500 },
        initiator: { source: 'app.js', line: 42 },
        response: { statusText: 'Server Error', schemaHint: { error: 'string' } },
        relatedEvents: [{ type: 'runtime.error', message: 'Failed', source: 'view.js', line: 9 }],
        comparison: { semanticDiff: ['id changed type from string to number'] },
        anomalies: ['Request failed.'],
        trace: [{ label: 'Request started', source: 'app.js', line: 42 }],
        redactionApplied: true,
      },
      result: {
        diagnosis: 'The server rejected the request.',
        confidence: 0.82,
        evidence: ['HTTP 500'],
        alternatives: ['Client parsing error'],
        nextActions: ['Inspect the response'],
      },
    } satisfies InvestigationRecord

    const report = formatInvestigationReport(record)
    expect(report).toContain('GET https://example.com/api')
    expect(report).toContain('app.js:42')
    expect(report).toContain('view.js:9')
    expect(report).toContain('Confidence: 82%')
  })
})
