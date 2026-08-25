import { describe, it, expect } from 'vitest'
import { generatePlaywrightTest, generateVerificationTest, sanitizeTestName } from './testGeneration'
import type { InvestigationRecord } from './types'

function createMockRecord(): InvestigationRecord {
  return {
    id: 'inv-test-001',
    createdAt: Date.now(),
    requestId: 'req-123',
    requestUrl: 'https://api.example.com/checkout',
    graph: {
      request: {
        method: 'POST',
        url: 'https://api.example.com/checkout',
        status: 422,
      },
      response: {
        statusText: 'Unprocessable Entity',
        schemaHint: {},
      },
      relatedEvents: [],
      anomalies: [],
      trace: [],
      redactionApplied: false,
      initiator: {
        source: 'checkout.tsx',
        line: 184,
      },
    },
    result: {
      diagnosis: 'Cart state not loaded when checkout initiated',
      confidence: 0.94,
      evidence: ['Cart endpoint returned empty', 'Checkout called immediately after page load'],
      alternatives: [],
      nextActions: ['Check cart loading timing'],
    },
  }
}

describe('testGeneration', () => {
  describe('generatePlaywrightTest', () => {
    it('should generate a valid playwright test', () => {
      const record = createMockRecord()
      const test = generatePlaywrightTest(record)

      expect(test.language).toBe('playwright')
      expect(test.type).toBe('reproduction')
      expect(test.code).toContain('test(')
      expect(test.code).toContain('async ({ page })')
      expect(test.code).toContain('await page.goto')
      expect(test.code).toContain('TODO')
    })

    it('should include source location', () => {
      const record = createMockRecord()
      const test = generatePlaywrightTest(record)

      expect(test.code).toContain('checkout.tsx:184')
    })

    it('should extract base URL', () => {
      const record = createMockRecord()
      const test = generatePlaywrightTest(record)

      expect(test.code).toContain('https://api.example.com')
    })
  })

  describe('generateVerificationTest', () => {
    it('should generate a verification test', () => {
      const record = createMockRecord()
      const test = generateVerificationTest(record)

      expect(test.language).toBe('playwright')
      expect(test.type).toBe('verification')
      expect(test.code).toContain('verify fix')
    })
  })

  describe('sanitizeTestName', () => {
    it('should convert diagnosis to valid test name', () => {
      expect(sanitizeTestName('Cart state not loaded when checkout initiated')).toBe(
        'cart_state_not_loaded_when_checkout_initi'
      )
    })

    it('should handle special characters', () => {
      expect(sanitizeTestName("Request failed: 500 Server Error!")).toBe('request_failed_500_server_error')
    })

    it('should handle lowercase', () => {
      expect(sanitizeTestName('ALL CAPS')).toBe('all_caps')
    })
  })
})
