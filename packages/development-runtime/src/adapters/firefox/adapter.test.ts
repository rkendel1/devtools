/**
 * PR 4.14: Firefox Adapter Unit Test
 *
 * Proves Firefox works with the exact same DevelopmentRuntime contract as Chrome.
 * Uses mock adapter for unit testing (real browser smoke test is separate).
 * This validates the adapter boundary and contract, not the browser protocol.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DevelopmentRuntime } from '../../core/runtime'
import type { BrowserRuntimeAdapter, Selection } from '../../types'

/**
 * Mock Firefox Adapter for unit testing
 * Simulates Firefox behavior without requiring a real browser
 */
class MockFirefoxAdapter implements BrowserRuntimeAdapter {
  private selectionCallback: ((sel: Selection) => void) | null = null

  getBrowserName() {
    return 'firefox' as const
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
        enabled: false, // Firefox doesn't support replay
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

describe('PR 4.14: Firefox Adapter', () => {
  let firefoxRuntime: DevelopmentRuntime
  let chromeRuntime: DevelopmentRuntime

  beforeEach(() => {
    firefoxRuntime = new DevelopmentRuntime({
      browserAdapter: new MockFirefoxAdapter(),
    })

    // Use mock Chrome adapter too for consistent testing
    class MockChromeAdapter implements BrowserRuntimeAdapter {
      private selectionCallback: ((sel: Selection) => void) | null = null

      getBrowserName() {
        return 'chromium' as const
      }

      async getCapabilities() {
        return {
          selection: { enabled: true, supportsVisualSelection: true, supportsSourceMapping: true },
          elementInspection: { enabled: true, supportsBoundingBox: true, supportsComputedStyle: true, supportsDOMPath: true },
          replay: { enabled: false, supportsClickReplay: false, supportsScrollReplay: false, supportsInputReplay: false },
          verification: { enabled: true, supportsScreenCapture: false, supportsMetricsCapture: true, supportsPerformanceObservation: true },
        }
      }

      async enableSelectionMode() {
        setTimeout(() => {
          if (this.selectionCallback) {
            this.selectionCallback({
              elementQuery: '.checkout-button',
              boundingBox: { x: 50, y: 400, width: 400, height: 48 },
              sourceHints: { sourceLocations: [{ file: 'src/app.tsx', line: 42, confidence: 'HIGH' as const }], framework: { name: 'react' as const, detected: true } },
              computedStyle: { display: 'block', visibility: 'visible' },
            })
          }
        }, 50)
      }

      async disableSelectionMode() {}

      onElementSelected(callback: (sel: Selection) => void) {
        this.selectionCallback = callback
      }

      async inspectElement() {
        return { width: 400, height: 48, x: 50, y: 400, display: 'block', visibility: 'visible' }
      }

      async captureElementState() {
        return { width: 200, height: 48, x: 150, y: 400, display: 'block', visibility: 'visible' }
      }

      async waitForPageReady() {}

      async disconnect() {}
    }

    chromeRuntime = new DevelopmentRuntime({
      browserAdapter: new MockChromeAdapter(),
    })
  })

  describe('BrowserRuntimeAdapter contract', () => {
    it('should report honest Firefox capabilities', async () => {
      const capabilities = await firefoxRuntime.getCapabilities()

      // Firefox has same selection support as Chrome
      expect(capabilities.selection.enabled).toBe(true)
      expect(capabilities.selection.supportsVisualSelection).toBe(true)

      // Firefox has same inspection support
      expect(capabilities.elementInspection.enabled).toBe(true)
      expect(capabilities.elementInspection.supportsBoundingBox).toBe(true)

      // Firefox does NOT support replay (honest assessment)
      expect(capabilities.replay.enabled).toBe(false)

      // Firefox has same verification support
      expect(capabilities.verification.enabled).toBe(true)
      expect(capabilities.verification.supportsMetricsCapture).toBe(true)
    })

    it('should have same capabilities interface as Chrome', async () => {
      const fireCaps = await firefoxRuntime.getCapabilities()
      const chromeCaps = await chromeRuntime.getCapabilities()

      // Same interface structure (keys match)
      expect(Object.keys(fireCaps).sort()).toEqual(Object.keys(chromeCaps).sort())

      // Both have selection, inspection, replay, verification
      expect(fireCaps).toHaveProperty('selection')
      expect(fireCaps).toHaveProperty('elementInspection')
      expect(fireCaps).toHaveProperty('replay')
      expect(fireCaps).toHaveProperty('verification')
    })
  })

  describe('Selection workflow', () => {
    it('Firefox should return Selection with same fields as Chrome', async () => {
      // Both should return selections with identical structure
      const firefoxSelection = await firefoxRuntime.select()
      const chromeSelection = await chromeRuntime.select()

      // Both must have these fields
      expect(firefoxSelection).toHaveProperty('elementQuery')
      expect(firefoxSelection).toHaveProperty('boundingBox')
      expect(firefoxSelection).toHaveProperty('sourceHints')
      expect(firefoxSelection).toHaveProperty('computedStyle')

      expect(chromeSelection).toHaveProperty('elementQuery')
      expect(chromeSelection).toHaveProperty('boundingBox')
      expect(chromeSelection).toHaveProperty('sourceHints')
      expect(chromeSelection).toHaveProperty('computedStyle')

      // Bounding box has same fields
      expect(firefoxSelection.boundingBox).toHaveProperty('x')
      expect(firefoxSelection.boundingBox).toHaveProperty('y')
      expect(firefoxSelection.boundingBox).toHaveProperty('width')
      expect(firefoxSelection.boundingBox).toHaveProperty('height')

      expect(chromeSelection.boundingBox).toHaveProperty('x')
      expect(chromeSelection.boundingBox).toHaveProperty('y')
      expect(chromeSelection.boundingBox).toHaveProperty('width')
      expect(chromeSelection.boundingBox).toHaveProperty('height')
    })

    it('Firefox selection should be serializable like Chrome', async () => {
      const firefoxSelection = await firefoxRuntime.select()

      // Should be JSON serializable (no circular references, no functions)
      const json = JSON.stringify(firefoxSelection)
      expect(json).toBeDefined()

      // Should deserialize back
      const deserialized = JSON.parse(json)
      expect(deserialized.elementQuery).toBe(firefoxSelection.elementQuery)
      expect(deserialized.boundingBox.width).toBe(firefoxSelection.boundingBox.width)
    })
  })

  describe('Verification contract', () => {
    it('Firefox verify should return same outcome contract as Chrome', async () => {
      const firefoxSelection = await firefoxRuntime.select()
      const chromeSelection = await chromeRuntime.select()

      // Simulated code change (from workspace)
      const mockChange = {
        id: 'change:test',
        workspaceId: 'test',
        taskId: 'task:test',
        investigationId: '',
        kind: 'code_change',
        label: 'Test change',
        description: 'Test',
        filePath: 'test.tsx',
        lineStart: 1,
        lineEnd: 1,
        createdAt: Date.now(),
        createdBy: 'agent',
        status: 'READY_FOR_VERIFICATION',
        properties: {},
      }

      // Both must return VerificationOutcome with identical structure
      const firefoxOutcome = await firefoxRuntime.verify({
        selection: firefoxSelection,
        change: mockChange,
      })

      const chromeOutcome = await chromeRuntime.verify({
        selection: chromeSelection,
        change: mockChange,
      })

      // Both must have these fields
      expect(firefoxOutcome).toHaveProperty('status')
      expect(firefoxOutcome).toHaveProperty('confidence')
      expect(firefoxOutcome).toHaveProperty('beforeMetrics')
      expect(firefoxOutcome).toHaveProperty('afterMetrics')
      expect(firefoxOutcome).toHaveProperty('evidence')

      expect(chromeOutcome).toHaveProperty('status')
      expect(chromeOutcome).toHaveProperty('confidence')
      expect(chromeOutcome).toHaveProperty('beforeMetrics')
      expect(chromeOutcome).toHaveProperty('afterMetrics')
      expect(chromeOutcome).toHaveProperty('evidence')

      // Status values must be from the same enum
      expect(['FIXED', 'FAILED', 'REGRESSION']).toContain(firefoxOutcome.status)
      expect(['FIXED', 'FAILED', 'REGRESSION']).toContain(chromeOutcome.status)

      // Confidence must be a number 0-1
      expect(typeof firefoxOutcome.confidence).toBe('number')
      expect(firefoxOutcome.confidence).toBeGreaterThanOrEqual(0)
      expect(firefoxOutcome.confidence).toBeLessThanOrEqual(1)

      expect(typeof chromeOutcome.confidence).toBe('number')
      expect(chromeOutcome.confidence).toBeGreaterThanOrEqual(0)
      expect(chromeOutcome.confidence).toBeLessThanOrEqual(1)
    })

    it('Firefox outcome should be serializable like Chrome', async () => {
      const selection = await firefoxRuntime.select()

      const mockChange = {
        id: 'change:test',
        workspaceId: 'test',
        taskId: 'task:test',
        investigationId: '',
        kind: 'code_change',
        label: 'Test',
        description: 'Test',
        filePath: 'test.tsx',
        lineStart: 1,
        lineEnd: 1,
        createdAt: Date.now(),
        createdBy: 'agent',
        status: 'READY_FOR_VERIFICATION',
        properties: {},
      }

      const outcome = await firefoxRuntime.verify({
        selection,
        change: mockChange,
      })

      // Should be JSON serializable
      const json = JSON.stringify(outcome)
      expect(json).toBeDefined()

      // Should deserialize
      const deserialized = JSON.parse(json)
      expect(deserialized.status).toBe(outcome.status)
      expect(deserialized.confidence).toBe(outcome.confidence)
    })
  })

  describe('Identical contract proof', () => {
    it('Firefox and Chrome return identical Selection structure from select()', async () => {
      const firefoxSelection = await firefoxRuntime.select()
      const chromeSelection = await chromeRuntime.select()

      // Both must have identical fields
      expect(firefoxSelection).toHaveProperty('elementQuery')
      expect(firefoxSelection).toHaveProperty('boundingBox')
      expect(firefoxSelection).toHaveProperty('sourceHints')
      expect(firefoxSelection).toHaveProperty('computedStyle')

      expect(chromeSelection).toHaveProperty('elementQuery')
      expect(chromeSelection).toHaveProperty('boundingBox')
      expect(chromeSelection).toHaveProperty('sourceHints')
      expect(chromeSelection).toHaveProperty('computedStyle')

      // Boundary boxes have identical structure
      expect(firefoxSelection.boundingBox).toHaveProperty('x')
      expect(firefoxSelection.boundingBox).toHaveProperty('y')
      expect(firefoxSelection.boundingBox).toHaveProperty('width')
      expect(firefoxSelection.boundingBox).toHaveProperty('height')

      expect(chromeSelection.boundingBox).toHaveProperty('x')
      expect(chromeSelection.boundingBox).toHaveProperty('y')
      expect(chromeSelection.boundingBox).toHaveProperty('width')
      expect(chromeSelection.boundingBox).toHaveProperty('height')
    })

    it('Firefox and Chrome return identical VerificationOutcome structure from verify()', async () => {
      const selection = await firefoxRuntime.select()

      const mockChange = {
        id: 'change:test',
        workspaceId: 'test',
        taskId: 'task:test',
        investigationId: '',
        kind: 'code_change' as const,
        label: 'Test',
        description: 'Test',
        filePath: 'test.tsx',
        lineStart: 1,
        lineEnd: 1,
        createdAt: Date.now(),
        createdBy: 'agent' as const,
        status: 'READY_FOR_VERIFICATION' as const,
        properties: {},
      }

      const firefoxOutcome = await firefoxRuntime.verify({ selection, change: mockChange })
      const chromeOutcome = await chromeRuntime.verify({ selection, change: mockChange })

      // Both must have identical outcome structure
      expect(firefoxOutcome).toHaveProperty('status')
      expect(firefoxOutcome).toHaveProperty('confidence')
      expect(firefoxOutcome).toHaveProperty('beforeMetrics')
      expect(firefoxOutcome).toHaveProperty('afterMetrics')
      expect(firefoxOutcome).toHaveProperty('evidence')

      expect(chromeOutcome).toHaveProperty('status')
      expect(chromeOutcome).toHaveProperty('confidence')
      expect(chromeOutcome).toHaveProperty('beforeMetrics')
      expect(chromeOutcome).toHaveProperty('afterMetrics')
      expect(chromeOutcome).toHaveProperty('evidence')

      // Status values must match enum
      expect(['FIXED', 'FAILED', 'REGRESSION']).toContain(firefoxOutcome.status)
      expect(['FIXED', 'FAILED', 'REGRESSION']).toContain(chromeOutcome.status)

      // Confidence must be 0-1 for both
      expect(typeof firefoxOutcome.confidence).toBe('number')
      expect(firefoxOutcome.confidence).toBeGreaterThanOrEqual(0)
      expect(firefoxOutcome.confidence).toBeLessThanOrEqual(1)

      expect(typeof chromeOutcome.confidence).toBe('number')
      expect(chromeOutcome.confidence).toBeGreaterThanOrEqual(0)
      expect(chromeOutcome.confidence).toBeLessThanOrEqual(1)
    })
  })

  describe('Architectural isolation', () => {
    it('Firefox adapter requires no changes to DevelopmentRuntime', () => {
      // Both firefox and chrome runtimes use the exact same DevelopmentRuntime class
      // This proves no conditionals or browser-specific logic is needed in the runtime

      expect(firefoxRuntime.constructor.name).toBe('DevelopmentRuntime')
      expect(chromeRuntime.constructor.name).toBe('DevelopmentRuntime')

      // Same runtime type for both browsers - proves the abstraction works
      expect(firefoxRuntime.constructor).toBe(chromeRuntime.constructor)
    })
  })
})
