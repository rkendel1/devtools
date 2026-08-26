/**
 * DevelopmentRuntime
 *
 * Orchestrates browser interaction workflow: SELECT → CAPTURE → VERIFY
 * Does not own workspace concerns (publish, subscribe, discovery).
 * Does not own DevTools UI (describe, task management).
 */

import type {
  RuntimeConfig,
  BrowserRuntimeAdapter,
  BrowserCapabilities,
  Selection,
  ElementMetrics,
  VerifyParams,
  VerificationOutcome,
} from '../types'

export class DevelopmentRuntime {
  private adapter: BrowserRuntimeAdapter
  private isConnected = false

  constructor(config: RuntimeConfig) {
    this.adapter = config.browserAdapter
  }

  /**
   * Get browser capabilities (honest assessment of what this adapter can do)
   */
  async getCapabilities(): Promise<BrowserCapabilities> {
    return this.adapter.getCapabilities()
  }

  /**
   * SELECT: Capture element selection from browser
   *
   * Enables selection mode, waits for user to click element,
   * returns detailed selection including query, bounding box, source hints.
   */
  async select(): Promise<Selection> {
    if (!this.isConnected) {
      await this.connect()
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.adapter.disableSelectionMode().catch(() => {})
        reject(new Error('Selection timeout: no element selected within 30s'))
      }, 30000)

      this.adapter.onElementSelected((selection) => {
        clearTimeout(timeout)
        this.adapter.disableSelectionMode().catch(() => {})
        resolve(selection)
      })

      this.adapter.enableSelectionMode().catch((err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  /**
   * CAPTURE: Measure current element state
   *
   * Used to get baseline metrics before changes are applied.
   */
  async captureElementState(query: string): Promise<ElementMetrics> {
    if (!this.isConnected) {
      await this.connect()
    }
    return this.adapter.captureElementState(query)
  }

  /**
   * Capture screenshot of current page state
   * Optional: only if browser supports it.
   */
  async captureScreenshot(): Promise<string | undefined> {
    if (!this.isConnected) {
      await this.connect()
    }
    return this.adapter.captureScreenshot?.()
  }

  /**
   * VERIFY: Measure element after code change and compare
   *
   * Takes selection (before) and CodeChange (what was changed).
   * Captures new metrics, compares before/after, returns verification outcome.
   *
   * Does NOT know that CodeChange came from an agent.
   * Does NOT know about workspace.
   * Just answers: did the running application actually change as requested?
   */
  async verify(params: VerifyParams): Promise<VerificationOutcome> {
    const { selection, change } = params

    if (!this.isConnected) {
      await this.connect()
    }

    // Ensure page is ready after code change
    await this.waitForPageReady()

    // Capture new state
    const afterMetrics = await this.adapter.captureElementState(selection.elementQuery)

    // Get before metrics (from original selection)
    const beforeMetrics: ElementMetrics = {
      width: selection.boundingBox.width,
      height: selection.boundingBox.height,
      x: selection.boundingBox.x,
      y: selection.boundingBox.y,
      display: selection.computedStyle?.display || 'block',
      visibility: selection.computedStyle?.visibility || 'visible',
    }

    // Determine if change is FIXED/FAILED/REGRESSION
    const status = determineVerificationStatus(beforeMetrics, afterMetrics)

    // Optional: capture evidence
    const beforeScreenshot = await this.captureScreenshot()
    const evidence: VerificationOutcome['evidence'] = {}

    if (beforeScreenshot) {
      // In real scenario, we'd capture before AND after screenshots
      // For now, we have the current state
      evidence.screenshots = {
        before: '', // Would need to capture earlier
        after: beforeScreenshot,
      }
    }

    const confidence = calculateConfidence(beforeMetrics, afterMetrics, status)

    return {
      status,
      confidence,
      beforeMetrics,
      afterMetrics,
      evidence,
    }
  }

  /**
   * Wait for page to be ready after reload/navigation
   *
   * Handles document.readyState and custom readiness signals.
   */
  async waitForPageReady(): Promise<void> {
    if (!this.isConnected) {
      await this.connect()
    }
    return this.adapter.waitForPageReady()
  }

  /**
   * Connect to browser (one-time setup)
   */
  private async connect(): Promise<void> {
    // Verify adapter can connect
    const caps = await this.adapter.getCapabilities()
    if (!caps.verification.enabled) {
      throw new Error('Browser adapter verification is not enabled')
    }
    this.isConnected = true
  }

  /**
   * Cleanup and disconnect
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.adapter.disconnect()
      this.isConnected = false
    }
  }
}

/**
 * Determine verification status based on before/after metrics
 */
function determineVerificationStatus(
  before: ElementMetrics,
  after: ElementMetrics,
): 'FIXED' | 'FAILED' | 'REGRESSION' {
  // If metrics changed significantly, assume FIXED
  if (before.width !== after.width || before.height !== after.height) {
    return 'FIXED'
  }

  // If visibility/display changed, assume FIXED
  if (before.display !== after.display || before.visibility !== after.visibility) {
    return 'FIXED'
  }

  // If nothing changed, assume FAILED
  return 'FAILED'
}

/**
 * Calculate confidence score for verification
 * Based on metric changes and visibility state
 */
function calculateConfidence(
  before: ElementMetrics,
  after: ElementMetrics,
  status: 'FIXED' | 'FAILED' | 'REGRESSION',
): number {
  if (status === 'FAILED') {
    return 0.1 // Low confidence: nothing changed
  }

  if (status === 'REGRESSION') {
    return 0.2 // Low confidence: worse than before
  }

  // FIXED: calculate confidence based on metric change magnitude
  const widthChange = Math.abs(after.width - before.width)
  const heightChange = Math.abs(after.height - before.height)
  const totalChange = widthChange + heightChange

  // Larger changes = higher confidence
  const baseConfidence = Math.min(totalChange / 200, 1.0)

  // Visibility state matters
  if (after.visibility !== before.visibility) {
    return Math.min(baseConfidence + 0.2, 1.0)
  }

  return baseConfidence
}
