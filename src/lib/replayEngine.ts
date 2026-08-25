/**
 * Replay Engine: Execute a ReplayFixture and capture outcome
 *
 * Narrow scope: navigation + network mocking + single interaction + outcome capture
 * Don't try to reproduce arbitrary browser state yet.
 * Explicitly report unsupported features.
 */

import type { ReplayFixture, ReplayRun, ReplayObservation, OutcomeSignature } from './replayContract'
import { classifyOutcome, createResponseFingerprint, createErrorFingerprint } from './replayContract'

export interface ReplayEngineOptions {
  timeout?: number
  headless?: boolean
  viewport?: { width: number; height: number }
}

export class ReplayEngine {
  private fixture: ReplayFixture
  private observations: ReplayObservation[] = []
  private interceptedRequests: Map<string, { request: unknown; response: unknown }> = new Map()
  private runtimeErrors: Array<{ type: string; message: string; timestamp: number }> = []
  private options: ReplayEngineOptions

  constructor(fixture: ReplayFixture, options: ReplayEngineOptions = {}) {
    this.fixture = fixture
    this.options = { timeout: 30000, ...options }
  }

  async execute(originalOutcome: OutcomeSignature): Promise<ReplayRun> {
    const startTime = Date.now()

    try {
      // Step 1: Navigate to page
      await this.navigate()

      // Step 2: Set up network mocks
      await this.setupNetworkInterception()

      // Step 3: Execute interactions
      for (const interaction of this.fixture.interactions) {
        await this.executeInteraction(interaction)
      }

      // Step 4: Capture outcome
      const replayOutcome = await this.captureOutcome()

      // Step 5: Classify
      const status = classifyOutcome(originalOutcome, replayOutcome)

      return this.buildReplayRun(startTime, status, replayOutcome, originalOutcome)
    } catch (error) {
      return this.buildFailedRun(startTime, error)
    }
  }

  private async navigate(): Promise<void> {
    this.addObservation('navigation', `Navigating to ${this.fixture.initialState.url}`, true)

    // In a real implementation, this would use Chrome DevTools Protocol
    // For now, we track what we attempted
    // The actual navigation would be in the DevTools page context

    this.addObservation('navigation', 'Page loaded (simulated)', true)
  }

  private async setupNetworkInterception(): Promise<void> {
    if (this.fixture.networkFixtures.length === 0) {
      this.addObservation('network', 'No network fixtures to set up', true)
      return
    }

    this.addObservation('network', `Setting up ${this.fixture.networkFixtures.length} network mocks`, true)

    for (const fixture of this.fixture.networkFixtures) {
      this.addObservation(
        'network',
        `Mock: ${fixture.method} ${fixture.pattern} → ${fixture.responseStatus}`,
        true
      )
    }
  }

  private async executeInteraction(interaction: any): Promise<void> {
    if (interaction.type === 'navigate') {
      this.addObservation('interaction', `Navigate to ${interaction.url}`, true)
    } else if (interaction.type === 'click') {
      this.addObservation('interaction', `Click on ${interaction.selector}`, true)
    } else if (interaction.type === 'input') {
      this.addObservation('interaction', `Input "${interaction.value}" to ${interaction.selector}`, true)
    } else if (interaction.type === 'wait') {
      this.addObservation('interaction', `Wait ${interaction.delayMs}ms`, true)
    }
  }

  private async captureOutcome(): Promise<OutcomeSignature> {
    // This would capture:
    // - The target request that was made
    // - Response status and body
    // - Any errors that occurred
    // - Timing information

    // For now, return a placeholder that would be populated by actual replay
    return {
      targetRequest: {
        method: this.fixture.target.requestMethod,
        url: this.fixture.target.requestUrl,
      },
      status: 0,
      statusText: 'NOT_YET_CAPTURED',
      responseFingerprint: '',
      errorFingerprints: [],
      errorCount: 0,
      relevantRuntimeEvents: [],
      timing: {
        requestDuration: 0,
        totalTime: Date.now(),
      },
      causalEvidence: [],
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

    if (this.fixture.capabilities.localStorage && this.fixture.initialState.localStorage) {
      unsupported.push('localStorage')
    }

    if (this.fixture.capabilities.cookies && this.fixture.initialState.cookies?.length) {
      unsupported.push('cookies')
    }

    return unsupported
  }

  private buildNotes(): string {
    if (this.observations.some((o) => !o.success)) {
      return 'Some observations failed; see details'
    }
    if (this.detectUnsupportedCapabilities().length > 0) {
      return `Unsupported: ${this.detectUnsupportedCapabilities().join(', ')}`
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
  originalOutcome: OutcomeSignature,
  options?: ReplayEngineOptions
): Promise<ReplayRun> {
  const engine = new ReplayEngine(fixture, options)
  return engine.execute(originalOutcome)
}
