import { describe, it, expect, beforeEach } from 'vitest'
import {
  captureElementMetrics,
  compareVisualState,
  classifyVisualVerification,
  buildVisualSelection,
  buildSelectionTask,
  formatVisualComparison,
} from './visualSelection'
import type { VisualSelection, SelectionTask, CodeChange, VerificationResult } from './developmentWorkspace'
import { LocalFeltDBNode } from './localFeltDBNode'
import { createChromeClient, createAgentClient } from './feltdbWorkspaceClient'
import { buildVerificationResult } from './verificationManager'

describe('Visual Selection & Verification', () => {
  describe('Element metrics capture', () => {
    it('should capture element metrics', () => {
      const box = { x: 100, y: 200, width: 300, height: 50 }
      const style = { display: 'flex', fontSize: '16px' }

      const metrics = captureElementMetrics(box, style)

      expect(metrics.width).toBe(300)
      expect(metrics.height).toBe(50)
      expect(metrics.x).toBe(100)
      expect(metrics.y).toBe(200)
      expect(metrics.computedStyle.display).toBe('flex')
    })
  })

  describe('Visual state comparison', () => {
    it('should detect size change', () => {
      const before = captureElementMetrics({ x: 0, y: 0, width: 300, height: 50 })
      const after = captureElementMetrics({ x: 0, y: 0, width: 200, height: 50 })

      const comparison = compareVisualState(before, after, 'Click me', 'Click me')

      expect(comparison.size.changed).toBe(true)
      expect(comparison.position.changed).toBe(false)
    })

    it('should detect position change', () => {
      const before = captureElementMetrics({ x: 100, y: 200, width: 300, height: 50 })
      const after = captureElementMetrics({ x: 100, y: 100, width: 300, height: 50 })

      const comparison = compareVisualState(before, after, 'Text', 'Text')

      expect(comparison.position.changed).toBe(true)
    })

    it('should detect text content change', () => {
      const before = captureElementMetrics({ x: 0, y: 0, width: 300, height: 50 })
      const after = captureElementMetrics({ x: 0, y: 0, width: 300, height: 50 })

      const comparison = compareVisualState(before, after, 'Old text', 'New text')

      expect(comparison.textContent.changed).toBe(true)
    })
  })

  describe('Visual verification classification', () => {
    it('should verify when expected changes occur', () => {
      const before = captureElementMetrics({ x: 0, y: 0, width: 300, height: 50 })
      const after = captureElementMetrics({ x: 0, y: 0, width: 200, height: 50 })
      const comparison = compareVisualState(before, after, 'Text', 'Text')

      const result = classifyVisualVerification(comparison, ['size'])

      expect(result).toBe('VERIFIED')
    })

    it('should report not changed when no modifications', () => {
      const before = captureElementMetrics({ x: 0, y: 0, width: 300, height: 50 })
      const after = captureElementMetrics({ x: 0, y: 0, width: 300, height: 50 })
      const comparison = compareVisualState(before, after, 'Text', 'Text')

      const result = classifyVisualVerification(comparison, ['size'])

      expect(result).toBe('NOT_CHANGED')
    })

    it('should report incomplete when partial changes', () => {
      const before = captureElementMetrics({ x: 0, y: 0, width: 300, height: 50 })
      const after = captureElementMetrics({ x: 0, y: 0, width: 200, height: 50 })
      const comparison = compareVisualState(before, after, 'Text', 'Text')

      const result = classifyVisualVerification(comparison, ['size', 'position'])

      expect(result).toBe('INCOMPLETE')
    })
  })

  describe('Model building', () => {
    it('should build visual selection', () => {
      const selection = buildVisualSelection(
        'ws_123',
        'http://example.com/page',
        'button.checkout',
        'Proceed to checkout',
        { x: 100, y: 200, width: 120, height: 40 },
        'body > main > section > button.checkout',
      )

      expect(selection.kind).toBe('visual_selection')
      expect(selection.url).toContain('example.com')
      expect(selection.selector).toBe('button.checkout')
    })

    it('should build selection task', () => {
      const task = buildSelectionTask(
        'ws_123',
        'selection:123',
        'Make this button smaller and move it to the right',
      )

      expect(task.kind).toBe('selection_task')
      expect(task.taskType).toBe('UI_CHANGE')
      expect(task.status).toBe('open')
    })
  })

  describe('Formatting', () => {
    it('should format visual comparison', () => {
      const before = captureElementMetrics({ x: 0, y: 0, width: 300, height: 50 })
      const after = captureElementMetrics({ x: 10, y: 20, width: 200, height: 50 })
      const comparison = compareVisualState(before, after, 'Old', 'New')

      const formatted = formatVisualComparison(comparison)

      expect(formatted).toContain('SIZE')
      expect(formatted).toContain('POSITION')
      expect(formatted).toContain('CONTENT')
    })
  })
})

describe('Phase 4.6: Select → Describe → Change → Verify (Acceptance Test)', () => {
  let feltdbNode: LocalFeltDBNode

  beforeEach(() => {
    feltdbNode = new LocalFeltDBNode()
  })

  it('should complete full UI change loop: Select → Describe → Agent Change → Verify', () => {
    /**
     * STEP 1: Chrome enables select mode and user clicks element
     */
    const chromeClient = createChromeClient('ws_ui_change', feltdbNode)

    const selection: VisualSelection = buildVisualSelection(
      'ws_ui_change',
      'http://localhost:3000/checkout',
      'button.submit-order',
      'Complete Order',
      { x: 200, y: 400, width: 150, height: 40 },
      'body > main > .checkout-form > button.submit-order',
      [
        { selector: 'input[name=email]', text: 'Email' },
        { selector: 'input[name=card]', text: 'Card' },
      ],
      [{ file: 'src/components/CheckoutForm.tsx', line: 45 }],
    )

    chromeClient.write('visual_selection', selection)

    /**
     * STEP 2: Chrome captures baseline metrics for verification later
     */
    const baselineMetrics = captureElementMetrics(selection.boundingBox)
    chromeClient.write('baseline_metrics', {
      selectionId: selection.id,
      elementMetrics: baselineMetrics,
      textContent: selection.textContent,
    })

    /**
     * STEP 3: User describes intent
     */
    const selectionTask = buildSelectionTask(
      'ws_ui_change',
      selection.id,
      'Make this button 20% smaller and change the text to "Place Order"',
      'UI_CHANGE',
    )

    chromeClient.write('selection_task', selectionTask)

    /**
     * STEP 4: Agent connects to workspace
     */
    const agentClient = createAgentClient('ws_ui_change', feltdbNode)

    /**
     * STEP 5: Chrome subscribes to code_change before agent publishes
     */
    let receivedChange: unknown = null
    chromeClient.subscribe('code_change', (_, value) => {
      receivedChange = value
    })

    /**
     * STEP 6: Agent discovers selection task
     */
    const discoveredTask = agentClient.read('selection_task')
    expect(discoveredTask).toEqual(selectionTask)

    /**
     * STEP 7: Agent reads visual selection context
     */
    const discoveredSelection = agentClient.read('visual_selection')
    expect(discoveredSelection.selector).toBe('button.submit-order')
    expect(discoveredSelection.sourceHints).toBeDefined()

    /**
     * STEP 8: Agent makes code change
     */
    const codeChange: CodeChange = {
      id: 'change:ui:77',
      workspaceId: 'ws_ui_change',
      taskId: selectionTask.id,
      investigationId: '',
      kind: 'code_change',
      label: 'Resize button and update text',
      description:
        'Change button.submit-order width from 150px to 120px and text from "Complete Order" to "Place Order"',
      filePath: 'src/components/CheckoutForm.tsx',
      lineStart: 45,
      lineEnd: 47,
      originalText: '<button className="submit-order" style={{width: "150px"}}>Complete Order</button>',
      newText: '<button className="submit-order" style={{width: "120px"}}>Place Order</button>',
      createdAt: Date.now(),
      createdBy: 'agent',
      status: 'PUBLISHED',
      properties: {},
    }

    agentClient.write('code_change', codeChange)

    /**
     * STEP 9: Chrome receives code change via subscription
     */
    expect(receivedChange).toEqual(codeChange)

    /**
     * STEP 10: Chrome marks as ready for verification
     */
    const readyChange: CodeChange = {
      ...codeChange,
      status: 'READY_FOR_VERIFICATION',
    }
    chromeClient.write('code_change', readyChange)

    /**
     * STEP 11: Chrome simulates reload and recapture
     *
     * In real scenario:
     * 1. Inject new code
     * 2. Reload application
     * 3. Find element with same selector
     * 4. Capture metrics
     *
     * For test, we simulate the new metrics:
     */
    const afterMetrics = captureElementMetrics({
      x: 200,
      y: 400,
      width: 120, // reduced from 150
      height: 40,
    })

    /**
     * STEP 12: Chrome compares before and after
     */
    const comparison = compareVisualState(
      baselineMetrics,
      afterMetrics,
      'Complete Order',
      'Place Order',
    )

    expect(comparison.size.changed).toBe(true)
    expect(comparison.size.before.width).toBe(150)
    expect(comparison.size.after.width).toBe(120)
    expect(comparison.textContent.changed).toBe(true)

    /**
     * STEP 13: Chrome classifies verification result
     */
    const verificationStatus = classifyVisualVerification(comparison, ['size', 'text'])
    expect(verificationStatus).toBe('VERIFIED')

    /**
     * STEP 14: Chrome stores verification result
     */
    const verificationRun = {
      id: 'verify:ui:44',
      workspaceId: 'ws_ui_change',
      taskId: selectionTask.id,
      codeChangeId: codeChange.id,
      investigationId: '',
      replayFixtureId: selection.id,
      status: 'completed',
      startedAt: Date.now(),
      kind: 'verification_run' as const,
      label: 'Visual verification for button resize',
    }

    chromeClient.write('verification_run', verificationRun)

    const verificationResult: VerificationResult = buildVerificationResult(
      'ws_ui_change',
      selectionTask.id,
      codeChange.id,
      '', // no investigation
      verificationRun.id,
      200, // baseline: success
      200, // after: success (but with visual change)
      [], // no new errors
      [selection.id],
    )

    // Override status since this is visual, not HTTP-based
    const visualVerificationResult: VerificationResult = {
      ...verificationResult,
      status: 'FIXED', // visual requirements met
      confidence: 0.95,
    }

    chromeClient.write('verification_result', visualVerificationResult)

    /**
     * STEP 15: Agent reads verification result
     */
    const readVerification = agentClient.read('verification_result')
    expect(readVerification).toEqual(visualVerificationResult)
    expect(readVerification.status).toBe('FIXED')

    /**
     * STEP 16: Agent marks task completed
     */
    agentClient.write('selection_task', {
      ...selectionTask,
      status: 'completed',
    })

    /**
     * STEP 17: Chrome observes task completion
     */
    const completedTask = chromeClient.read('selection_task')
    expect(completedTask.status).toBe('completed')

    /**
     * Verification: Complete UI change loop
     * User clicks → describes intent → agent changes code → browser verifies visual change
     * All via shared FeltDB workspace
     */
    const clients = feltdbNode.getConnectedClients()
    expect(clients).toHaveLength(2)

    chromeClient.disconnect()
    agentClient.disconnect()

    expect(feltdbNode.getConnectedClients()).toHaveLength(0)
  })
})
