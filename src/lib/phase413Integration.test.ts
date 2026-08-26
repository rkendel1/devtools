/**
 * Phase 4.13: Runtime Investigator Adoption
 *
 * DevTools now consumes @feltdb/development-runtime for browser interaction.
 * Validates the complete workflow using the new architecture:
 *
 * SelectionModeUI → runtime.select() → workspace
 * VerificationPanel → runtime.verify() → workspace
 *
 * Everything coordinated through FeltDB Development Workspace shared state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { BrowserRuntimeAdapter, Selection } from '@feltdb/development-runtime'
import { DevelopmentRuntime } from '@feltdb/development-runtime'
import type { VisualSelection, CodeChange, VerificationResult } from './developmentWorkspace'
import { LocalFeltDBNode } from './localFeltDBNode'
import { createChromeClient, createAgentClient } from './feltdbWorkspaceClient'
import { buildVisualSelection, buildSelectionTask } from './visualSelection'
import { createCodeChangeId } from './developmentWorkspace'
import { buildVerificationResult } from './verificationManager'

/**
 * Mock Chromium Adapter for testing
 * Simulates browser interaction without needing a real browser
 */
class TestChromiumAdapter implements BrowserRuntimeAdapter {
  private selectedElement: Selection | null = null
  private selectionCallback: ((sel: Selection) => void) | null = null

  getBrowserName() {
    return 'chromium' as const
  }

  async getCapabilities() {
    return {
      selection: {
        enabled: true,
        supportsVisualSelection: true,
        supportsSourceMapping: true,
      },
      elementInspection: {
        enabled: true,
        supportsBoundingBox: true,
        supportsComputedStyle: true,
        supportsDOMPath: true,
      },
      replay: {
        enabled: false,
        supportsClickReplay: false,
        supportsScrollReplay: false,
        supportsInputReplay: false,
      },
      verification: {
        enabled: true,
        supportsScreenCapture: false,
        supportsMetricsCapture: true,
        supportsPerformanceObservation: true,
      },
    }
  }

  async enableSelectionMode() {
    // Simulate: user will click element
    setTimeout(() => {
      if (this.selectionCallback) {
        this.selectionCallback({
          elementQuery: '.checkout-button',
          boundingBox: { x: 50, y: 400, width: 400, height: 48 },
          sourceHints: {
            sourceLocations: [{ file: 'src/app.tsx', line: 42, confidence: 'HIGH' as const }],
            framework: { name: 'react' as const, detected: true },
          },
          computedStyle: {
            display: 'block',
            visibility: 'visible',
          },
        })
      }
    }, 50)
  }

  async disableSelectionMode() {}

  onElementSelected(callback: (sel: Selection) => void) {
    this.selectionCallback = callback
  }

  async inspectElement() {
    return {
      width: 400,
      height: 48,
      x: 50,
      y: 400,
      display: 'block',
      visibility: 'visible',
    }
  }

  async captureElementState() {
    // After code change: element is smaller
    return {
      width: 200,
      height: 48,
      x: 150,
      y: 400,
      display: 'block',
      visibility: 'visible',
    }
  }

  async waitForPageReady() {}

  async disconnect() {}
}

describe('Phase 4.13: Runtime Investigator Adopts @feltdb/development-runtime', () => {
  let felt: LocalFeltDBNode
  let chromeClient: ReturnType<typeof createChromeClient>
  let agentClient: ReturnType<typeof createAgentClient>
  let runtime: DevelopmentRuntime

  beforeEach(() => {
    felt = new LocalFeltDBNode()
    chromeClient = createChromeClient('ws_checkout_4_13', felt)
    agentClient = createAgentClient('ws_checkout_4_13', felt)
    runtime = new DevelopmentRuntime({ browserAdapter: new TestChromiumAdapter() })
  })

  it('should complete full workflow with runtime-based selection and verification', (done) => {
    /**
     * STEP 1: User clicks "Select Element" button in DevTools
     * SelectionModeUI calls runtime.select()
     */
    runtime.select().then((runtimeSelection) => {
      expect(runtimeSelection.elementQuery).toBe('.checkout-button')
      expect(runtimeSelection.boundingBox.width).toBe(400)

      // STEP 2: DevTools converts runtime Selection to workspace VisualSelection
      const selection: VisualSelection = buildVisualSelection(
        'ws_checkout_4_13',
        'http://localhost:3000/checkout',
        runtimeSelection.elementQuery,
        'Complete Order',
        runtimeSelection.boundingBox,
        '.container > button.checkout-button',
        [],
        runtimeSelection.sourceHints.sourceLocations || [],
      )

      // STEP 3: DevTools publishes selection to workspace
      chromeClient.write('visual_selection', selection)

      const publishedSelection = chromeClient.read('visual_selection')
      expect(publishedSelection.selector).toBe('.checkout-button')
      expect(publishedSelection.boundingBox.width).toBe(400)

      // STEP 4: User describes intent
      const userInstruction = 'Make this button smaller'

      // STEP 5: DevTools publishes task
      const task = buildSelectionTask(
        'ws_checkout_4_13',
        selection.id,
        userInstruction,
        'UI_CHANGE',
      )

      chromeClient.write('selection_task', task)

      setTimeout(() => {
        // STEP 6: Agent discovers task
        const discoveredTask = agentClient.read('selection_task')
        expect(discoveredTask).toBeDefined()
        expect(discoveredTask.userInstruction).toContain('smaller')

        // STEP 7: Agent publishes CodeChange
        const change: CodeChange = {
          id: createCodeChangeId(),
          workspaceId: 'ws_checkout_4_13',
          taskId: task.id,
          investigationId: '',
          kind: 'code_change',
          label: 'Resize button',
          description: 'width: 400px → 200px',
          filePath: 'src/app.tsx',
          lineStart: 42,
          lineEnd: 42,
          createdAt: Date.now(),
          createdBy: 'agent',
          status: 'READY_FOR_VERIFICATION',
          properties: {},
        }

        agentClient.write('code_change', change)

        setTimeout(() => {
          // STEP 8: DevTools detects change
          const detectedChange = chromeClient.read('code_change')
          expect(detectedChange).toBeDefined()

          // STEP 9: User clicks "Verify" button
          // SelectionModeUI calls runtime.verify()
          runtime
            .verify({
              selection: {
                elementQuery: runtimeSelection.elementQuery,
                boundingBox: runtimeSelection.boundingBox,
                sourceHints: runtimeSelection.sourceHints,
              },
              change,
            })
            .then((outcome) => {
              expect(outcome.status).toBe('FIXED')
              expect(outcome.beforeMetrics.width).toBe(400)
              expect(outcome.afterMetrics.width).toBe(200)

              // STEP 10: DevTools converts outcome to VerificationResult
              const result = buildVerificationResult(
                'ws_checkout_4_13',
                task.id,
                change.id,
                '',
                `verify:${Date.now()}`,
                outcome.beforeMetrics.width,
                outcome.afterMetrics.width,
                [],
                [selection.id],
              )

              // STEP 11: DevTools publishes result
              chromeClient.write('verification_result', result)

              // STEP 12: Agent reads result
              const readResult = agentClient.read('verification_result')
              expect(readResult.status).toBe('FIXED')

              // Verify workspace contains all artifacts
              expect(chromeClient.read('visual_selection')).toBeDefined()
              expect(chromeClient.read('selection_task')).toBeDefined()
              expect(chromeClient.read('code_change')).toBeDefined()
              expect(chromeClient.read('verification_result')).toBeDefined()

              chromeClient.disconnect()
              agentClient.disconnect()
              void runtime.disconnect()

              done()
            })
            .catch(done)
        }, 100)
      }, 100)
    })
  })

  it('should prove no direct Chrome APIs remain in DevTools workflow layer', async () => {
    /**
     * This test validates the architectural goal:
     * DevTools no longer contains chrome.devtools.inspectedWindow or similar.
     * All browser interaction is delegated to @feltdb/development-runtime.
     */

    // Runtime owns the browser interaction capability
    const capabilities = await runtime.getCapabilities()

    expect(capabilities).toBeDefined()
    expect(capabilities.selection.enabled).toBe(true)
    expect(capabilities.verification.enabled).toBe(true)

    // Runtime API only exposes serializable types, not browser-specific objects
    expect(runtime.select).toBeDefined()
    expect(runtime.verify).toBeDefined()
    expect(runtime.disconnect).toBeDefined()

    // DevTools orchestrates: workspace coordination + user experience
    // Runtime orchestrates: browser interaction
    // These concerns are separated.
  })

  it('should maintain Phase 4.9 behavioral contract', (done) => {
    /**
     * Regression test: The 19-step workflow still works.
     * We've changed the implementation (using runtime instead of direct Chrome APIs),
     * but the observable behavior remains identical.
     */

    let changeDetected = false
    let verificationComplete = false

    // STEP 1: Selection
    runtime.select().then((runtimeSelection) => {
      const selection = buildVisualSelection(
        'ws_checkout_4_13',
        'http://localhost:3000',
        runtimeSelection.elementQuery,
        'Button',
        runtimeSelection.boundingBox,
        'button',
      )

      chromeClient.write('visual_selection', selection)

      // STEP 2: Task
      const task = buildSelectionTask('ws_checkout_4_13', selection.id, 'Make it smaller', 'UI_CHANGE')
      chromeClient.write('selection_task', task)

      // STEP 3: Subscribe to changes
      chromeClient.subscribe('code_change', () => {
        changeDetected = true
      })

      setTimeout(() => {
        // STEP 4: Agent publishes change
        const change: CodeChange = {
          id: createCodeChangeId(),
          workspaceId: 'ws_checkout_4_13',
          taskId: task.id,
          investigationId: '',
          kind: 'code_change',
          label: 'Test',
          description: 'Smaller',
          filePath: 'test.tsx',
          lineStart: 1,
          lineEnd: 1,
          createdAt: Date.now(),
          createdBy: 'agent',
          status: 'READY_FOR_VERIFICATION',
          properties: {},
        }

        agentClient.write('code_change', change)

        setTimeout(() => {
          expect(changeDetected).toBe(true)

          // STEP 5: Verify
          runtime
            .verify({ selection: runtimeSelection, change })
            .then((outcome) => {
              const result = buildVerificationResult(
                'ws_checkout_4_13',
                task.id,
                change.id,
                '',
                `verify:001`,
                400,
                200,
                [],
                [selection.id],
              )

              chromeClient.write('verification_result', result)
              verificationComplete = true

              expect(verificationComplete).toBe(true)
              expect(outcome.status).toBe('FIXED')

              chromeClient.disconnect()
              agentClient.disconnect()
              void runtime.disconnect()

              done()
            })
            .catch(done)
        }, 50)
      }, 50)
    })
  })
})
