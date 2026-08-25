import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ReplayEngine } from './replayEngine'
import { createReplayFixture } from './replayContract'
import type { ReplayBrowser, ReplayBrowserObservation } from './replayBrowser'
import type { OutcomeSignature } from './replayContract'

// Mock ReplayBrowser implementation
class MockReplayBrowser implements ReplayBrowser {
  private observations: ReplayBrowserObservation[] = []
  targetStatus = 200
  targetErrorCount = 0
  navigationSucceeded = true
  networkInterceptionSucceeded = true
  interactionsSucceeded = true

  async navigate(): Promise<void> {
    if (!this.navigationSucceeded) throw new Error('Navigation failed')
    this.observations.push({
      type: 'navigation',
      description: 'Navigated',
      success: true,
      timestamp: Date.now(),
    })
  }

  async evaluate(): Promise<unknown> {
    return true
  }

  async click(): Promise<void> {
    if (!this.interactionsSucceeded) throw new Error('Click failed')
    this.observations.push({
      type: 'interaction',
      description: 'Clicked',
      success: true,
      timestamp: Date.now(),
    })
  }

  async input(): Promise<void> {
    if (!this.interactionsSucceeded) throw new Error('Input failed')
    this.observations.push({
      type: 'interaction',
      description: 'Input',
      success: true,
      timestamp: Date.now(),
    })
  }

  async wait(): Promise<void> {
    this.observations.push({
      type: 'interaction',
      description: 'Wait',
      success: true,
      timestamp: Date.now(),
    })
  }

  async enableNetworkCapture(): Promise<void> {
    if (!this.networkInterceptionSucceeded) throw new Error('Network setup failed')
    this.observations.push({
      type: 'network',
      description: 'Network capture enabled',
      success: true,
      timestamp: Date.now(),
    })
  }

  async getNetworkEvents() {
    return []
  }

  async getTargetRequest() {
    return {
      method: 'POST',
      url: 'https://api.example.com/checkout',
      status: this.targetStatus,
      statusText: this.targetStatus === 422 ? 'Unprocessable Entity' : 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      requestTime: Date.now(),
      responseTime: Date.now() + 100,
      timestamp: Date.now(),
    }
  }

  async getRuntimeErrors() {
    if (this.targetErrorCount > 0) {
      return [
        {
          message: 'Test error',
          fingerprint: 'err:123',
          timestamp: Date.now(),
          source: 'runtime.error',
        },
      ]
    }
    return []
  }

  async collectObservations(): Promise<ReplayBrowserObservation[]> {
    // Add target request observation
    const targetEvent = await this.getTargetRequest()
    if (targetEvent) {
      this.observations.push({
        type: 'target_request',
        description: `Target request: ${targetEvent.method} ${targetEvent.url}`,
        success: true,
        timestamp: Date.now(),
        event: targetEvent,
      })
    }

    // Add runtime errors
    const errors = await this.getRuntimeErrors()
    for (const error of errors) {
      this.observations.push({
        type: 'runtime_error',
        description: `Runtime error: ${error.message}`,
        success: true,
        timestamp: Date.now(),
        event: error,
      })
    }

    return this.observations
  }

  async dispose(): Promise<void> {
    // Cleanup
  }
}

describe('ReplayEngine', () => {
  let browser: MockReplayBrowser
  let fixture: any

  beforeEach(() => {
    browser = new MockReplayBrowser()
    fixture = createReplayFixture('inv-123', 'req-456', 'https://api.example.com/checkout', 'POST', 'https://app.example.com/checkout')
  })

  describe('execute', () => {
    it('should execute replay and return run result', async () => {
      const originalOutcome: OutcomeSignature = {
        targetRequest: { method: 'POST', url: 'https://api.example.com/checkout' },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:123',
        errorFingerprints: ['err:123'],
        errorCount: 1,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 2000 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      expect(run.investigationId).toBe('inv-123')
      expect(run.fixtureId).toBe(fixture.id)
      expect(run.outcome.status).toBeDefined()
      expect(run.observations.length).toBeGreaterThan(0)
    })

    it('should detect REPRODUCED outcome when signatures match', async () => {
      browser.targetStatus = 422
      browser.targetErrorCount = 1

      // Calculate expected fingerprint (same method: fp:123)
      const expectedFp = 'fp:123'
      const expectedErrorFp = 'err:123'

      const originalOutcome: OutcomeSignature = {
        targetRequest: { method: 'POST', url: 'https://api.example.com/checkout' },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: expectedFp,
        errorFingerprints: [expectedErrorFp],
        errorCount: 1,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 2000 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      // Status and error count match, so should be REPRODUCED or PARTIAL
      expect(run.outcome.status).toMatch(/REPRODUCED|PARTIAL/)
      expect(run.matches.status).toBe(true)
      expect(run.matches.errorCount).toBe(true)
    })

    it('should detect NOT_REPRODUCED when status differs', async () => {
      browser.targetStatus = 200

      const originalOutcome: OutcomeSignature = {
        targetRequest: { method: 'POST', url: 'https://api.example.com/checkout' },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:123',
        errorFingerprints: ['err:123'],
        errorCount: 1,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 2000 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      expect(run.outcome.status).toBe('NOT_REPRODUCED')
      expect(run.matches.overall).toBe(false)
    })

    it('should handle navigation failure gracefully', async () => {
      browser.navigationSucceeded = false

      const originalOutcome: OutcomeSignature = {
        targetRequest: { method: 'POST', url: 'https://api.example.com/checkout' },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:123',
        errorFingerprints: [],
        errorCount: 0,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 2000 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      expect(run.outcome.status).toBe('UNDETERMINED')
      expect(run.observations.some((o) => !o.success)).toBe(true)
    })

    it('should record observations for each step', async () => {
      fixture.interactions = [
        { type: 'click', selector: '#submit' },
        { type: 'wait', delayMs: 500 },
      ]

      const originalOutcome: OutcomeSignature = {
        targetRequest: { method: 'POST', url: 'https://api.example.com/checkout' },
        status: 200,
        statusText: 'OK',
        responseFingerprint: 'fp:123',
        errorFingerprints: [],
        errorCount: 0,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 2000 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      const types = run.observations.map((o) => o.type)
      expect(types).toContain('navigation')
      expect(types).toContain('network')
      expect(types).toContain('interaction')
    })

    it('should calculate confidence based on successful observations', async () => {
      const originalOutcome: OutcomeSignature = {
        targetRequest: { method: 'POST', url: 'https://api.example.com/checkout' },
        status: 422,
        statusText: 'Unprocessable Entity',
        responseFingerprint: 'fp:123',
        errorFingerprints: [],
        errorCount: 0,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 2000 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      expect(run.outcome.confidence).toBeGreaterThan(0)
      expect(run.outcome.confidence).toBeLessThanOrEqual(1)
    })
  })

  describe('interaction execution', () => {
    it('should execute click interaction', async () => {
      fixture.interactions = [{ type: 'click', selector: '#submit' }]

      const originalOutcome: OutcomeSignature = {
        targetRequest: { method: 'POST', url: 'https://api.example.com/checkout' },
        status: 200,
        statusText: 'OK',
        responseFingerprint: 'fp:123',
        errorFingerprints: [],
        errorCount: 0,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 2000 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      const clickObs = run.observations.find((o) => o.type === 'interaction' && o.description.includes('Click'))
      expect(clickObs).toBeDefined()
      expect(clickObs?.success).toBe(true)
    })

    it('should execute input interaction', async () => {
      fixture.interactions = [{ type: 'input', selector: '#email', value: 'test@example.com' }]

      const originalOutcome: OutcomeSignature = {
        targetRequest: { method: 'POST', url: 'https://api.example.com/checkout' },
        status: 200,
        statusText: 'OK',
        responseFingerprint: 'fp:123',
        errorFingerprints: [],
        errorCount: 0,
        relevantRuntimeEvents: [],
        timing: { requestDuration: 100, totalTime: 2000 },
        causalEvidence: [],
      }

      const engine = new ReplayEngine(fixture, browser)
      const run = await engine.execute(originalOutcome)

      const inputObs = run.observations.find((o) => o.type === 'interaction' && o.description.includes('Input'))
      expect(inputObs).toBeDefined()
      expect(inputObs?.success).toBe(true)
    })
  })
})
