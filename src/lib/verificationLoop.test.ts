import { describe, it, expect } from 'vitest'
import { compareInvestigations, formatVerificationSummary, getVerificationStatusColor, getVerificationStatusIcon } from './verificationLoop'
import type { InvestigationRecord } from './types'

function createRecord(status: number, errorCount: number): InvestigationRecord {
  return {
    id: `inv-${status}-${errorCount}`,
    createdAt: Date.now(),
    requestId: 'req-123',
    requestUrl: 'https://api.example.com/checkout',
    graph: {
      request: {
        method: 'POST',
        url: 'https://api.example.com/checkout',
        status,
      },
      response: {
        statusText: status >= 400 ? 'Error' : 'OK',
        schemaHint: {},
      },
      relatedEvents: Array(errorCount)
        .fill(null)
        .map((_, i) => ({
          type: 'runtime.error' as const,
          message: `Error ${i + 1}`,
          ts: Date.now(),
        })),
      anomalies: [],
      trace: [],
      redactionApplied: false,
    },
    result: {
      diagnosis: 'Test diagnosis',
      confidence: 0.9,
      evidence: [],
      alternatives: [],
      nextActions: [],
    },
  }
}

describe('verificationLoop', () => {
  describe('compareInvestigations', () => {
    it('should detect fixed status when error resolved', () => {
      const before = createRecord(422, 1)
      const after = createRecord(200, 0)

      const verification = compareInvestigations(before, after)

      expect(verification.status).toBe('fixed')
      expect(verification.changes.length).toBeGreaterThan(0)
    })

    it('should detect regressed status when new error appears', () => {
      const before = createRecord(200, 0)
      const after = createRecord(500, 1)

      const verification = compareInvestigations(before, after)

      expect(verification.status).toBe('regressed')
      expect(verification.changes.some((c) => c.type === 'new_error')).toBe(true)
    })

    it('should detect status change', () => {
      const before = createRecord(422, 1)
      const after = createRecord(400, 1)

      const verification = compareInvestigations(before, after)

      expect(verification.changes.some((c) => c.type === 'status')).toBe(true)
    })

    it('should detect missing errors', () => {
      const before = createRecord(422, 2)
      const after = createRecord(200, 0)

      const verification = compareInvestigations(before, after)

      expect(verification.changes.some((c) => c.type === 'missing_error')).toBe(true)
    })

    it('should handle unchanged behavior', () => {
      const before = createRecord(200, 0)
      const after = createRecord(200, 0)

      const verification = compareInvestigations(before, after)

      expect(verification.status).toBe('changed')
      expect(verification.changes.length).toBe(0)
    })
  })

  describe('getVerificationStatusColor', () => {
    it('should return green for fixed', () => {
      expect(getVerificationStatusColor('fixed')).toBe('#10b981')
    })

    it('should return red for regressed', () => {
      expect(getVerificationStatusColor('regressed')).toBe('#ef4444')
    })

    it('should return amber for changed', () => {
      expect(getVerificationStatusColor('changed')).toBe('#f59e0b')
    })
  })

  describe('getVerificationStatusIcon', () => {
    it('should return correct icons', () => {
      expect(getVerificationStatusIcon('fixed')).toBe('✓')
      expect(getVerificationStatusIcon('regressed')).toBe('✗')
      expect(getVerificationStatusIcon('changed')).toBe('~')
    })
  })

  describe('formatVerificationSummary', () => {
    it('should format verification results', () => {
      const before = createRecord(422, 1)
      const after = createRecord(200, 0)
      const verification = compareInvestigations(before, after)

      const summary = formatVerificationSummary(verification)

      expect(summary).toContain('Verification Results: FIXED')
      expect(summary).toContain('Changes Detected:')
    })
  })
})
