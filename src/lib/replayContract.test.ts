import { describe, it, expect } from 'vitest'
import {
  createReplayFixture,
  classifyOutcome,
  createResponseFingerprint,
  createErrorFingerprint,
  type OutcomeSignature,
} from './replayContract'

describe('replayContract', () => {
  describe('createReplayFixture', () => {
    it('should create a valid replay fixture', () => {
      const fixture = createReplayFixture('inv-123', 'req-456', 'https://api.example.com/checkout', 'POST', 'https://app.example.com/checkout')

      expect(fixture.investigationId).toBe('inv-123')
      expect(fixture.target.requestId).toBe('req-456')
      expect(fixture.target.requestUrl).toBe('https://api.example.com/checkout')
      expect(fixture.target.requestMethod).toBe('POST')
      expect(fixture.initialState.url).toBe('https://app.example.com/checkout')
      expect(fixture.interactions).toEqual([])
      expect(fixture.networkFixtures).toEqual([])
    })

    it('should set capability flags', () => {
      const fixture = createReplayFixture('inv-1', 'req-1', 'https://api.example.com/test', 'GET', 'https://app.example.com')

      expect(fixture.capabilities.navigation).toBe(true)
      expect(fixture.capabilities.clicks).toBe(true)
      expect(fixture.capabilities.networkInterception).toBe(true)
      expect(fixture.capabilities.localStorage).toBe(false)
    })
  })

  describe('createResponseFingerprint', () => {
    it('should create consistent fingerprints for same response', () => {
      const fp1 = createResponseFingerprint(200, { 'content-type': 'application/json' }, '{"data": 1}')
      const fp2 = createResponseFingerprint(200, { 'content-type': 'application/json' }, '{"data": 1}')

      expect(fp1).toBe(fp2)
    })

    it('should create different fingerprints for different status', () => {
      const fp1 = createResponseFingerprint(200, {}, '')
      const fp2 = createResponseFingerprint(422, {}, '')

      expect(fp1).not.toBe(fp2)
    })

    it('should handle null body', () => {
      const fp = createResponseFingerprint(204, {}, null)
      expect(fp).toMatch(/^fp:/)
    })
  })

  describe('createErrorFingerprint', () => {
    it('should create consistent fingerprints for same error', () => {
      const fp1 = createErrorFingerprint('TypeError: Cannot read property x')
      const fp2 = createErrorFingerprint('TypeError: Cannot read property x')

      expect(fp1).toBe(fp2)
    })

    it('should create different fingerprints for different errors', () => {
      const fp1 = createErrorFingerprint('Error A')
      const fp2 = createErrorFingerprint('Error B')

      expect(fp1).not.toBe(fp2)
    })
  })

  describe('classifyOutcome', () => {
    function createOutcome(status: number, errorCount: number, fingerprint: string): OutcomeSignature {
      return {
        targetRequest: { method: 'POST', url: 'https://api.example.com/checkout' },
        status,
        statusText: status >= 400 ? 'Error' : 'OK',
        responseFingerprint: fingerprint,
        errorFingerprints: Array(errorCount).fill('err:123'),
        errorCount,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 1000, totalTime: 2000 },
        causalEvidence: [],
      }
    }

    it('should classify as REPRODUCED when outcomes match', () => {
      const original = createOutcome(422, 1, 'fp:abc123')
      const replay = createOutcome(422, 1, 'fp:abc123')

      const result = classifyOutcome(original, replay)
      expect(result).toBe('REPRODUCED')
    })

    it('should classify as PARTIAL when status/errors match but response differs', () => {
      const original = createOutcome(422, 1, 'fp:abc123')
      const replay = createOutcome(422, 1, 'fp:different')

      const result = classifyOutcome(original, replay)
      expect(result).toBe('PARTIAL')
    })

    it('should classify as NOT_REPRODUCED when status differs', () => {
      const original = createOutcome(422, 1, 'fp:abc123')
      const replay = createOutcome(200, 0, 'fp:different')

      const result = classifyOutcome(original, replay)
      expect(result).toBe('NOT_REPRODUCED')
    })

    it('should classify as NOT_REPRODUCED when error count differs', () => {
      const original = createOutcome(422, 2, 'fp:abc123')
      const replay = createOutcome(422, 1, 'fp:abc123')

      const result = classifyOutcome(original, replay)
      expect(result).toBe('NOT_REPRODUCED')
    })
  })
})
