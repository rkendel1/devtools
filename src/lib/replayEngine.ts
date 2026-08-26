/**
 * Replay Engine: Execute a ReplayFixture against a ReplayBrowser abstraction
 *
 * Platform-agnostic. Consumes ReplayBrowser interface.
 * Orchestrates: navigate → network setup → interactions → outcome capture
 * Produces evidence event sequence (each event can become FeltDB node)
 */

import type { ReplayFixture, ReplayRun, ReplayObservation, OutcomeSignature } from './replayContract'
import { classifyOutcome, createErrorFingerprint } from './replayContract'
import type { ReplayBrowser, ReplayBrowserObservation } from './replayBrowser'

export interface ReplayEngineOptions {
  timeout?: number
}

export class ReplayEngine {
  private fixture: ReplayFixture
  private browser: ReplayBrowser
  private observations: ReplayObservation[] = []
  private options: ReplayEngineOptions

  constructor(fixture: ReplayFixture, browser: ReplayBrowser, options: ReplayEngineOptions = {}) {
    this.fixture = fixture
    this.browser = browser
    this.options = { timeout: 30000, ...options }
  }

  async execute(originalOutcome: OutcomeSignature): Promise<ReplayRun> {
    const startTime = Date.now()

    try {
      // Step 1: Navigate to page
      await this.navigate()

      // Step 2: Set up network fixtures
      await this.setupNetworkInterception()

      // Step 3: Execute interactions
      for (const interaction of this.fixture.interactions) {
        await this.executeInteraction(interaction)
      }

      // Step 4: Capture browser observations (network, runtime errors, target request)
      await this.captureObservations()

      // Step 5: Build outcome signature from captured events
      const replayOutcome = this.buildOutcomeSignature()

      // Step 6: Classify
      const status = classifyOutcome(originalOutcome, replayOutcome)

      return this.buildReplayRun(startTime, status, replayOutcome, originalOutcome)
    } catch (error) {
      return this.buildFailedRun(startTime, error)
    } finally {
      await this.browser.dispose()
    }
  }

  private async navigate(): Promise<void> {
    try {
      await this.browser.navigate(this.fixture.initialState.url)
      this.addObservation('navigation', `Navigate ${this.fixture.initialState.url}`, true)
    } catch (error) {
      this.addObservation('navigation', `Navigate ${this.fixture.initialState.url}`, false, {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async setupNetworkInterception(): Promise<void> {
    if (this.fixture.networkFixtures.length === 0) {
      this.addObservation('network', 'No network fixtures to install', true)
      return
    }

    try {
      await this.browser.enableNetworkCapture(this.fixture.networkFixtures)
      this.addObservation('network', `Install ${this.fixture.networkFixtures.length} fixtures`, true)
    } catch (error) {
      this.addObservation('network', `Install network fixtures`, false, {
        count: this.fixture.networkFixtures.length,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async executeInteraction(interaction: any): Promise<void> {
    try {
      if (interaction.type === 'navigate') {
        await this.browser.navigate(interaction.url)
        this.addObservation('interaction', `Navigate ${interaction.url}`, true)
      } else if (interaction.type === 'click') {
        await this.browser.click(interaction.selector)
        this.addObservation('interaction', `Click ${interaction.selector}`, true)
      } else if (interaction.type === 'input') {
        await this.browser.input(interaction.selector, interaction.value)
        this.addObservation('interaction', `Input "${interaction.value}" to ${interaction.selector}`, true)
      } else if (interaction.type === 'wait') {
        await this.browser.wait(interaction.delayMs)
        this.addObservation('interaction', `Wait ${interaction.delayMs}ms`, true)
      }
    } catch (error) {
      const desc =
        interaction.type === 'navigate'
          ? `Navigate ${interaction.url}`
          : interaction.type === 'click'
            ? `Click ${interaction.selector}`
            : interaction.type === 'input'
              ? `Input to ${interaction.selector}`
              : `Wait ${interaction.delayMs}ms`

      this.addObservation('interaction', desc, false, {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async captureObservations(): Promise<void> {
    const browserObservations = await this.browser.collectObservations()

    for (const obs of browserObservations) {
      this.addObservation(obs.type as any, obs.description, obs.success, {
        event: obs.event,
        ...obs.details,
      })
    }
  }

  private buildOutcomeSignature(): OutcomeSignature {
    type CapturedEvent = {
      method?: string; url?: string; status?: number; statusText?: string
      headers?: Record<string, string>; requestTime?: number; responseTime?: number
      source?: 'console.error' | 'runtime.error'; message?: string; fingerprint?: string
    }
    const eventOf = (observation: ReplayObservation): CapturedEvent =>
      (observation.details?.event ?? {}) as CapturedEvent
    // Extract target request observation
    const targetObservation = this.observations.find(
      (o) =>
        (o.type === 'event' || o.type === 'target_request') &&
        eventOf(o).method === this.fixture.target.requestMethod &&
        eventOf(o).url === this.fixture.target.requestUrl
    )

    const targetRequest = targetObservation?.details?.event as any

    // Collect runtime errors
    const errorObservations = this.observations.filter(
      (o) => (o.type === 'event' || o.type === 'runtime_error') && eventOf(o).fingerprint
    )
    const errorFingerprints = errorObservations.map((o) => eventOf(o).fingerprint || '')

    const status = targetRequest?.status || 0
    const statusText = targetRequest?.statusText || 'UNKNOWN'

    // Build fingerprint from response
    let responseFingerprint = ''
    if (targetRequest) {
      const parts = [status.toString(), Object.keys(targetRequest?.headers || {}).join(',')]
      let hash = 0
      for (const part of parts) {
        for (let i = 0; i < part.length; i++) {
          const char = part.charCodeAt(i)
          hash = (hash << 5) - hash + char
          hash = hash & hash
        }
      }
      responseFingerprint = `fp:${Math.abs(hash)}`
    }

    const timing = targetRequest
      ? {
          requestDuration: targetRequest.responseTime - targetRequest.requestTime,
          totalTime: Date.now() - (this.observations[0]?.timestamp || Date.now()),
        }
      : {
          requestDuration: 0,
          totalTime: Date.now() - (this.observations[0]?.timestamp || Date.now()),
        }

    return {
      targetRequest: {
        method: this.fixture.target.requestMethod,
        url: this.fixture.target.requestUrl,
      },
      status,
      statusText,
      responseFingerprint,
      errorFingerprints,
      errorCount: errorFingerprints.length,
      relevantRuntimeEvents: errorObservations.map((o) => ({
        type: eventOf(o).source || 'console.error',
        message: eventOf(o).message || '',
        fingerprint: eventOf(o).fingerprint || '',
      })),
      timing,
      causalEvidence: this.fixture.evidenceRefs.investigationNodeId ? [this.fixture.evidenceRefs.investigationNodeId] : [],
    }
  }

  private addObservation(type: string, description: string, success: boolean, details?: unknown): void {
    this.observations.push({
      timestamp: Date.now(),
      type: type as any,
      description,
      success,
      details: details ? (details as Record<string, unknown>) : undefined,
    })
  }

  private buildReplayRun(
    startTime: number,
    status: string,
    replayOutcome: OutcomeSignature,
    originalOutcome: OutcomeSignature
  ): ReplayRun {
    const completedAt = Date.now()

    return {
      id: `replayrun:${this.fixture.id}:${completedAt}`,
      fixtureId: this.fixture.id,
      investigationId: this.fixture.investigationId,
      startedAt: startTime,
      completedAt,
      durationMs: completedAt - startTime,
      observations: this.observations,
      outcome: {
        status: status as any,
        confidence: this.calculateConfidence(),
        signature: replayOutcome,
        unsupportedCapabilities: this.detectUnsupportedCapabilities(),
        notes: this.buildNotes(),
      },
      producedEvidence: {
        observationNodeIds: [],
        timestampRange: { start: startTime, end: completedAt },
      },
      matches: {
        status: replayOutcome.status === originalOutcome.status,
        errorCount: replayOutcome.errorCount === originalOutcome.errorCount,
        timing: this.isWithinTimingEnvelope(originalOutcome.timing, replayOutcome.timing),
        behavior: replayOutcome.responseFingerprint === originalOutcome.responseFingerprint,
        overall: status === 'REPRODUCED',
      },
    }
  }

  private buildFailedRun(startTime: number, error: unknown): ReplayRun {
    const completedAt = Date.now()

    return {
      id: `replayrun:${this.fixture.id}:${completedAt}:failed`,
      fixtureId: this.fixture.id,
      investigationId: this.fixture.investigationId,
      startedAt: startTime,
      completedAt,
      durationMs: completedAt - startTime,
      observations: [
        ...this.observations,
        {
          timestamp: completedAt,
          type: 'outcome',
          description: `Replay failed: ${error instanceof Error ? error.message : String(error)}`,
          success: false,
        },
      ],
      outcome: {
        status: 'UNDETERMINED',
        confidence: 0,
        signature: {
          targetRequest: {
            method: this.fixture.target.requestMethod,
            url: this.fixture.target.requestUrl,
          },
          status: 0,
          statusText: 'ERROR',
          responseFingerprint: '',
          errorFingerprints: [],
          errorCount: 0,
          relevantRuntimeEvents: [],
          timing: { requestDuration: 0, totalTime: completedAt - startTime },
          causalEvidence: [],
        },
        unsupportedCapabilities: [],
        notes: `Replay execution failed`,
      },
      producedEvidence: {
        observationNodeIds: [],
        timestampRange: { start: startTime, end: completedAt },
      },
      matches: {
        status: false,
        errorCount: false,
        timing: false,
        behavior: false,
        overall: false,
      },
    }
  }

  private calculateConfidence(): number {
    // Higher confidence if all observations succeeded
    const successCount = this.observations.filter((o) => o.success).length
    const total = this.observations.length || 1
    return successCount / total
  }

  private detectUnsupportedCapabilities(): string[] {
    const unsupported: string[] = []

    if (!this.fixture.capabilities.localStorage && this.fixture.initialState.localStorage) {
      unsupported.push('localStorage')
    }

    if (!this.fixture.capabilities.cookies && this.fixture.initialState.cookies?.length) {
      unsupported.push('cookies')
    }

    return unsupported
  }

  private buildNotes(): string {
    if (this.observations.some((o) => !o.success)) {
      return 'Some observations failed; see details'
    }
    const unsupported = this.detectUnsupportedCapabilities()
    if (unsupported.length > 0) {
      return `Unsupported: ${unsupported.join(', ')}`
    }
    return 'Replay completed successfully'
  }

  private isWithinTimingEnvelope(original: any, replay: any): boolean {
    if (!original || !replay) return true
    // Within 2x time envelope
    return replay.requestDuration < original.requestDuration * 2
  }
}

export async function executeReplay(
  fixture: ReplayFixture,
  browser: ReplayBrowser,
  originalOutcome: OutcomeSignature,
  options?: ReplayEngineOptions
): Promise<ReplayRun> {
  const engine = new ReplayEngine(fixture, browser, options)
  return engine.execute(originalOutcome)
}
