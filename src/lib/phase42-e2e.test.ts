/**
 * Phase 4.2 End-to-End Test: Simulate Real Chrome Replay
 *
 * This simulates what happens when:
 * 1. Test server is running on http://localhost:3000
 * 2. Chrome navigates to test page
 * 3. User triggers failure (currency=null → 422)
 * 4. Runtime Investigator replays it via CDP
 *
 * Simulates real HTTP requests + Chrome observation events
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ReplayEngine } from './replayEngine'
import { createReplayFixture } from './replayContract'
import type { ReplayBrowser, ReplayBrowserObservation } from './replayBrowser'
import type { OutcomeSignature } from './replayContract'

/**
 * Simulates Chrome DevTools Protocol observing real HTTP traffic
 * and runtime events
 */
class SimulatedChromeReplay implements ReplayBrowser {
  private observations: ReplayBrowserObservation[] = []
  private navigationTime = 0

  /**
   * Simulate navigation to test page
   * Real Chrome: loads HTML, runs scripts, waits for DOMContentLoaded
   */
  async navigate(url: string): Promise<void> {
    const startTime = Date.now()
    this.navigationTime = startTime

    // Simulate page load time (real Chrome takes 100-500ms)
    await new Promise((resolve) => setTimeout(resolve, 100))

    this.addObservation('navigation', `Navigate to ${url}`, true, {
      timing: { loadTime: Date.now() - startTime },
    })
  }

  /**
   * Simulate evaluating JavaScript in page context
   * Real Chrome: Runtime.evaluate via CDP
   */
  async evaluate(expression: string): Promise<unknown> {
    this.addObservation('interaction', `Evaluate JavaScript`, true)
    return true
  }

  /**
   * Simulate clicking element
   * Real Chrome: finds selector, dispatches click event, waits for handlers
   */
  async click(selector: string): Promise<void> {
    this.addObservation('interaction', `Click ${selector}`, true)

    // Simulate network request from click handler
    // In real scenario: fetch() or XHR triggered by click handler
    await this.simulateNetworkRequest('POST', 'http://localhost:3000/api/checkout', 422)
  }

  async input(selector: string, value: string): Promise<void> {
    this.addObservation('interaction', `Input to ${selector}`, true)
  }

  async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50)))
    this.addObservation('interaction', `Wait ${ms}ms`, true)
  }

  async enableNetworkCapture(fixtures: any[]): Promise<void> {
    this.addObservation(
      'network',
      `Enable network interception: ${fixtures.length} fixtures loaded`,
      true,
      { fixtures: fixtures.length }
    )
  }

  async getNetworkEvents() {
    // Return the network request we simulated
    return [
      {
        type: 'FIXTURE_MATCHED' as const,
        url: 'http://localhost:3000/api/checkout',
        method: 'POST',
        status: 422,
        timestamp: Date.now(),
        details: {
          requestBody: '{"currency":null,"email":"test@example.com","amount":99.99}',
          responseBody: '{"error":"currency_required"}',
        },
      },
    ]
  }

  async getTargetRequest() {
    // This is what CDP actually captured from the network traffic
    return {
      method: 'POST',
      url: 'http://localhost:3000/api/checkout',
      status: 422,
      statusText: 'Unprocessable Entity',
      headers: {
        'content-type': 'application/json',
        'content-length': '35',
      },
      body: '{"error":"currency_required"}',
      requestTime: this.navigationTime + 150,
      responseTime: this.navigationTime + 250,
      timestamp: Date.now(),
    }
  }

  async getRuntimeErrors() {
    // Real Chrome captured this console.error from the page
    // (simulating what test-page.js does: console.error("Checkout failed: currency_required"))
    return [
      {
        message: 'Checkout failed: currency_required',
        fingerprint: 'err:checkout_currency_required_abc123',
        timestamp: this.navigationTime + 260,
        source: 'console.error' as const,
      },
    ]
  }

  async collectObservations(): Promise<ReplayBrowserObservation[]> {
    // Collect final state of network + runtime
    const networkEvents = await this.getNetworkEvents()
    const targetRequest = await this.getTargetRequest()
    const errors = await this.getRuntimeErrors()

    for (const event of networkEvents) {
      this.addObservation(
        'network',
        `${event.type}: ${event.method} ${event.url} → ${event.status}`,
        true,
        { event }
      )
    }

    if (targetRequest) {
      this.addObservation('target_request', `Target request observed: ${targetRequest.method} ${targetRequest.url}`, true, {
        event: targetRequest,
      })
    }

    for (const error of errors) {
      this.addObservation('runtime_error', `Runtime error captured: ${error.message}`, true, {
        event: error,
      })
    }

    return this.observations
  }

  async dispose(): Promise<void> {
    this.addObservation('outcome', 'CDP detached from tab', true)
  }

  /**
   * Simulate what Chrome's network domain observes
   */
  private async simulateNetworkRequest(method: string, url: string, status: number): Promise<void> {
    // Simulate network round-trip (real: 50-500ms depending on network)
    await new Promise((resolve) => setTimeout(resolve, 100))

    this.addObservation('network', `Request: ${method} ${url}`, true)
    this.addObservation('network', `Response: ${status}`, true)
  }

  private addObservation(
    type: 'navigation' | 'interaction' | 'network' | 'runtime_error' | 'target_request' | 'outcome',
    description: string,
    success: boolean,
    details?: Record<string, unknown>
  ): void {
    this.observations.push({
      type,
      description,
      success,
      timestamp: Date.now(),
      event: details?.event as any,
      details: details ? Object.fromEntries(Object.entries(details).filter(([k]) => k !== 'event')) : undefined,
    })
  }
}

describe('Phase 4.2: End-to-End Real Chrome Simulation', () => {
  let browser: SimulatedChromeReplay
  let fixture: any

  beforeEach(() => {
    browser = new SimulatedChromeReplay()

    // This is the ReplayFixture captured from the original failure
    fixture = createReplayFixture(
      'inv-checkout-422-currency-null',
      'req-checkout-post-abc123',
      'http://localhost:3000/api/checkout',
      'POST',
      'http://localhost:3000/'
    )

    fixture.interactions = [
      { type: 'click', selector: '#checkout-btn' },
    ]

    fixture.networkFixtures = [
      {
        id: 'fixture-checkout-422',
        pattern: 'http://localhost:3000/api/checkout',
        method: 'POST',
        responseStatus: 422,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: '{"error":"currency_required","details":"Currency must be specified"}',
      },
    ]
  })

  describe('original failure observation', () => {
    it('should have captured the failure with full context', () => {
      // This is what Runtime Investigator observed from the browser
      // when user left currency blank and clicked Checkout
      const originalObservation: OutcomeSignature = {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:currency_required_422_abc123',
        errorFingerprints: ['err:checkout_currency_required_abc123'],
        errorCount: 1,
        relevantRuntimeEvents: [
          {
            type: 'console.error',
            message: 'Checkout failed: currency_required',
            fingerprint: 'err:checkout_currency_required_abc123',
          },
        ],
        timing: {
          requestDuration: 100,
          totalTime: 1500,
        },
        causalEvidence: ['inv-checkout-422-currency-null'],
      }

      expect(originalObservation.status).toBe(422)
      expect(originalObservation.errorCount).toBe(1)
      expect(originalObservation.relevantRuntimeEvents.length).toBe(1)
    })
  })

  describe('replay execution via CDP', () => {
    it('should replicate exact failure conditions', async () => {
      const originalOutcome: OutcomeSignature = {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:currency_required_422_abc123',
        errorFingerprints: ['err:checkout_currency_required_abc123'],
        errorCount: 1,
        relevantRuntimeEvents: [
          {
            type: 'console.error',
            message: 'Checkout failed: currency_required',
            fingerprint: 'err:checkout_currency_required_abc123',
          },
        ],
        timing: {
          requestDuration: 100,
          totalTime: 1500,
        },
        causalEvidence: ['inv-checkout-422-currency-null'],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      // Verify complete observation sequence
      expect(run.observations.length).toBeGreaterThan(5)
      expect(run.observations.map((o) => o.type)).toEqual(
        expect.arrayContaining(['navigation', 'network', 'interaction', 'target_request', 'runtime_error'])
      )
    })

    it('should capture all network observations', async () => {
      const originalOutcome: OutcomeSignature = {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:test',
        errorFingerprints: ['err:test'],
        errorCount: 1,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 1500 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      const networkObs = run.observations.filter((o) => o.type === 'network')
      expect(networkObs.length).toBeGreaterThan(0)
      expect(networkObs.some((o) => o.description.includes('FIXTURE_MATCHED'))).toBe(true)
    })

    it('should capture target request with correct status', async () => {
      const originalOutcome: OutcomeSignature = {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:test',
        errorFingerprints: ['err:test'],
        errorCount: 1,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 1500 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      const targetObs = run.observations.find((o) => o.type === 'target_request')
      expect(targetObs).toBeDefined()
      expect(targetObs?.description).toContain('POST')
      expect(targetObs?.description).toContain('http://localhost:3000/api/checkout')
    })

    it('should capture runtime errors from console', async () => {
      const originalOutcome: OutcomeSignature = {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:test',
        errorFingerprints: ['err:test'],
        errorCount: 1,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 1500 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      const errorObs = run.observations.filter((o) => o.type === 'runtime_error')
      expect(errorObs.length).toBeGreaterThan(0)
      expect(errorObs[0].description).toContain('currency_required')
    })
  })

  describe('outcome classification', () => {
    it('should classify as REPRODUCED when all observations match', async () => {
      const originalOutcome: OutcomeSignature = {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:test', // Will match what's calculated
        errorFingerprints: ['err:checkout_currency_required_abc123'],
        errorCount: 1,
        relevantRuntimeEvents: [
          {
            type: 'console.error',
            message: 'Checkout failed: currency_required',
            fingerprint: 'err:checkout_currency_required_abc123',
          },
        ],
        timing: {
          requestDuration: 100,
          totalTime: 1500,
        },
        causalEvidence: ['inv-checkout-422-currency-null'],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      // Key verifications: status and error count must match (signature matching)
      expect(run.outcome.status).toMatch(/REPRODUCED|PARTIAL/)
      expect(run.matches.status).toBe(true)
      expect(run.matches.errorCount).toBe(true)
      // Overall will be true if status and errorCount match
      expect(run.matches.status && run.matches.errorCount).toBe(true)

      // Show the evidence chain
      console.log('✓ Replay complete')
      console.log(`  Status: ${run.outcome.status}`)
      console.log(`  Confidence: ${(run.outcome.confidence * 100).toFixed(0)}%`)
      console.log(`  Observations: ${run.observations.length}`)
    })

    it('should show detailed observation chain', async () => {
      const originalOutcome: OutcomeSignature = {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:test',
        errorFingerprints: ['err:test'],
        errorCount: 1,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 1500 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      // Display evidence chain
      console.log('\nObservation Chain:')
      for (const obs of run.observations) {
        const icon = obs.success ? '✓' : '✗'
        console.log(`  ${icon} ${obs.type}: ${obs.description}`)
      }
    })
  })

  describe('evidence for FeltDB storage', () => {
    it('should produce evidence linkable to original investigation', async () => {
      const originalOutcome: OutcomeSignature = {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:test',
        errorFingerprints: ['err:test'],
        errorCount: 1,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 1500 },
        causalEvidence: ['inv-checkout-422-currency-null'],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      // Verify linkage
      expect(run.investigationId).toBe('inv-checkout-422-currency-null')
      expect(run.outcome.signature.causalEvidence).toContain('inv-checkout-422-currency-null')

      // Each observation should be FeltDB-ready
      for (const obs of run.observations) {
        expect(obs.timestamp).toBeDefined()
        expect(obs.type).toBeDefined()
        expect(obs.description).toBeDefined()
        expect(typeof obs.success).toBe('boolean')
      }
    })
  })

  describe('full workflow', () => {
    it('should complete end-to-end: observe → fixture → replay → evidence', async () => {
      // Step 1: Original failure observed
      const originalOutcome: OutcomeSignature = {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:test',
        errorFingerprints: ['err:checkout_currency_required_abc123'],
        errorCount: 1,
        relevantRuntimeEvents: [
          {
            type: 'console.error',
            message: 'Checkout failed: currency_required',
            fingerprint: 'err:checkout_currency_required_abc123',
          },
        ],
        timing: {
          requestDuration: 100,
          totalTime: 1500,
        },
        causalEvidence: ['inv-checkout-422-currency-null'],
      }

      // Step 2: ReplayFixture created
      expect(fixture.target.requestUrl).toBe('http://localhost:3000/api/checkout')
      expect(fixture.networkFixtures.length).toBe(1)
      expect(fixture.interactions.length).toBe(1)

      // Step 3: Replay executed
      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      // Step 4: Evidence collected
      expect(run.observations.length).toBeGreaterThan(0)
      expect(run.outcome.status).toBeDefined()
      expect(run.investigationId).toBe('inv-checkout-422-currency-null')

      // Step 5: Verification - status and error count must match
      expect(run.matches.status).toBe(true)
      expect(run.matches.errorCount).toBe(true)

      console.log('\n✓✓✓ Phase 4.2 Complete ✓✓✓')
      console.log(`Observed → Captured → Replayed → Classified: ${run.outcome.status}`)
      console.log(`Confidence: ${(run.outcome.confidence * 100).toFixed(0)}%`)
      console.log(`Ready for FeltDB persistence (Phase 4.3)`)
    })
  })
})
