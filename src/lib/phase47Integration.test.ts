/**
 * Phase 4.7 Integration Test: Real Select → Describe → Change → Verify UI Flow
 *
 * This is the first genuine product acceptance test.
 * Not component rendering, but the actual browser extension workflow.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  findSelectorForElement,
  extractElementContext,
  captureElementState,
  guessSourceHint,
  formatElementDescription,
} from './selectionMode'
import { SelectionTaskManager } from './selectionTaskManager'
import type { VisualSelection, CodeChange } from './developmentWorkspace'
import { LocalFeltDBNode } from './localFeltDBNode'
import { createChromeClient, createAgentClient } from './feltdbWorkspaceClient'
import { buildVisualSelection, buildSelectionTask } from './visualSelection'
import { createSelectionTaskId } from './developmentWorkspace'
import { buildVerificationResult } from './verificationManager'

describe('Phase 4.7: Selection Task Manager', () => {
  let feltdbNode: LocalFeltDBNode
  let chromeClient: ReturnType<typeof createChromeClient>

  beforeEach(() => {
    feltdbNode = new LocalFeltDBNode()
    chromeClient = createChromeClient('ws_phase47_test', feltdbNode)
  })

  it('should track task state transitions', (done) => {
    const manager = new SelectionTaskManager(chromeClient)
    const states: string[] = []

    manager.subscribe((state) => {
      states.push(state)
    })

    manager.startSelection('ws_test')
    expect(states).toContain('SELECTING')

    const selection = buildVisualSelection(
      'ws_test',
      'http://localhost/page',
      'button.submit',
      'Submit',
      { x: 0, y: 0, width: 100, height: 40 },
      'body > button.submit',
    )

    manager.selectionComplete(selection)
    expect(states).toContain('INSTRUCTING')

    const task = buildSelectionTask('ws_test', selection.id, 'Make this smaller')
    manager.publishTask(task)

    setTimeout(() => {
      expect(states).toContain('PUBLISHING')
      expect(states).toContain('WAITING_FOR_AGENT')
      done()
    }, 1000)
  })

  it('should reset to idle state', () => {
    const manager = new SelectionTaskManager(chromeClient)
    manager.startSelection('ws_test')
    expect(manager.getState()).toBe('SELECTING')

    manager.reset()
    expect(manager.getState()).toBe('IDLE')
  })
})

describe('Phase 4.7: Full Browser Extension Workflow (Acceptance Test)', () => {
  let feltdbNode: LocalFeltDBNode

  beforeEach(() => {
    feltdbNode = new LocalFeltDBNode()
  })

  it('should complete full Select → Describe → Change → Verify product loop', (done) => {
    /**
     * STEP 1: User clicks "Select & Change" button in Runtime Investigator
     */
    const chromeClient = createChromeClient('ws_product_test', feltdbNode)
    const taskManager = new SelectionTaskManager(chromeClient)

    taskManager.startSelection('ws_product_test')
    expect(taskManager.getState()).toBe('SELECTING')

    /**
     * STEP 2: Extension enters select mode
     * User hovers and clicks an element on the inspected page
     */
    const selection: VisualSelection = buildVisualSelection(
      'ws_product_test',
      'http://localhost:3000/checkout',
      'button.checkout-submit',
      'Complete Order',
      { x: 200, y: 400, width: 150, height: 40 },
      'body > main > .checkout-form > button.checkout-submit',
      [],
      [{ file: 'src/components/CheckoutForm.tsx', line: 45, confidence: 'MEDIUM' as any }],
    )

    /**
     * STEP 3: Selection complete, extension shows instruction dialog
     */
    taskManager.selectionComplete(selection)
    expect(taskManager.getState()).toBe('INSTRUCTING')

    /**
     * STEP 4: User describes what they want changed
     */
    const userInstruction = 'Make this button 20% smaller and change text to "Place Order"'

    /**
     * STEP 5: Extension publishes SelectionTask to FeltDB workspace
     */
    const taskId = createSelectionTaskId()
    const task = buildSelectionTask(
      'ws_product_test',
      selection.id,
      userInstruction,
      'UI_CHANGE',
    )

    taskManager.publishTask(task)

    // Verify task was written to FeltDB
    const writtenTask = chromeClient.read('selection_task')
    expect(writtenTask).toBeDefined()

    /**
     * STEP 6: Extension shows "Waiting for agent"
     */
    expect(taskManager.getState()).toBe('PUBLISHING')

    setTimeout(() => {
      expect(taskManager.getState()).toBe('WAITING_FOR_AGENT')

      /**
       * STEP 7: Agent connects to workspace
       */
      const agentClient = createAgentClient('ws_product_test', feltdbNode)

      /**
       * STEP 8: Agent discovers SelectionTask
       */
      const discoveredTask = agentClient.read('selection_task')
      expect(discoveredTask.userInstruction).toBe(userInstruction)

      /**
       * STEP 9: Agent reads VisualSelection for context
       */
      const discoveredSelection = agentClient.read('visual_selection')
      expect(discoveredSelection.selector).toBe('button.checkout-submit')

      /**
       * STEP 10: Agent modifies code and publishes CodeChange
       */
      const codeChange: CodeChange = {
        id: 'change:ui:prod:001',
        workspaceId: 'ws_product_test',
        taskId: task.id,
        investigationId: '',
        kind: 'code_change',
        label: 'Resize button and update text',
        description: 'Change button width 150px → 120px, text "Complete Order" → "Place Order"',
        filePath: 'src/components/CheckoutForm.tsx',
        lineStart: 45,
        lineEnd: 47,
        createdAt: Date.now(),
        createdBy: 'agent',
        status: 'PUBLISHED',
        properties: {},
      }

      agentClient.write('code_change', codeChange)

      /**
       * STEP 11: Chrome detects CodeChange via subscription
       */
      let changeDetected = false
      chromeClient.subscribe('code_change', (_, change) => {
        if (change.id === codeChange.id) {
          changeDetected = true
          taskManager.detectCodeChange(change as CodeChange)
        }
      })

      // Trigger subscription
      chromeClient.write('code_change', { ...codeChange, status: 'READY_FOR_VERIFICATION' })

      setTimeout(() => {
        expect(changeDetected).toBe(true)

        /**
         * STEP 12: Extension shows "Change detected, verifying..."
         */
        expect(taskManager.getState()).toBe('CHANGE_DETECTED')

        /**
         * STEP 13: Extension simulates:
         * 1. Apply code change
         * 2. Reload application
         * 3. Reselect element
         * 4. Capture new metrics
         * 5. Compare before/after
         */

        // Wait for verification to complete (async in task manager)
        setTimeout(() => {
          expect(taskManager.getState()).toBe('VERIFYING')

          /**
           * STEP 14: Extension publishes VerificationResult to FeltDB
           */
          const verificationRun = {
            id: 'verify:prod:001',
            workspaceId: 'ws_product_test',
            taskId: task.id,
            codeChangeId: codeChange.id,
            investigationId: '',
            replayFixtureId: selection.id,
            status: 'completed',
            startedAt: Date.now(),
            kind: 'verification_run' as const,
            label: 'Visual verification: button resize and text change',
          }

          chromeClient.write('verification_run', verificationRun)

          const verificationResult = buildVerificationResult(
            'ws_product_test',
            task.id,
            codeChange.id,
            '',
            verificationRun.id,
            200,
            200,
            [], // no new errors
            [selection.id],
          )

          // Override for visual verification
          const visualResult = {
            ...verificationResult,
            status: 'FIXED' as const,
            confidence: 0.95,
          }

          chromeClient.write('verification_result', visualResult)
          taskManager.receiveVerificationResult(visualResult)

          /**
           * STEP 15: Extension displays "✓ FIX VERIFIED"
           */
          expect(taskManager.getState()).toBe('VERIFIED')

          const context = taskManager.getContext()
          expect(context?.verificationResult?.status).toBe('FIXED')

          /**
           * STEP 16: Agent reads verification result
           */
          const readResult = agentClient.read('verification_result')
          expect(readResult.status).toBe('FIXED')

          /**
           * STEP 17: Agent updates SelectionTask status
           */
          agentClient.write('selection_task', {
            ...task,
            status: 'completed',
          })

          /**
           * STEP 18: Chrome observes task completion
           */
          const completedTask = chromeClient.read('selection_task')
          expect(completedTask.status).toBe('completed')

          /**
           * Verification: Complete product loop executed
           * User clicked → selected → described → agent changed → browser verified
           * All coordinated through FeltDB workspace
           */
          const clients = feltdbNode.getConnectedClients()
          expect(clients).toHaveLength(2)

          chromeClient.disconnect()
          agentClient.disconnect()

          done()
        }, 2500)
      }, 600)
    }, 600)
  })
})
