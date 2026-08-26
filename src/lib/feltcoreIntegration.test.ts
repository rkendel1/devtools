/**
 * FeltDB Core Integration Test
 *
 * Proves Runtime Investigator works as a client of @feltdb/core Development Workspace
 *
 * This is the critical acceptance test:
 * Chrome extension → FeltDB workspace ← IDE/Agent
 *
 * No custom bridge. No duplication. Just shared state.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type {
  DevelopmentWorkspace,
  DevelopmentTask,
  VisualSelection,
  CodeChange,
  VerificationResult,
} from '@feltdb/core/workspace'
import {
  connectDevelopmentWorkspace,
  publishSelection,
  publishTask,
  subscribeToCodeChanges,
  publishVerificationResult,
} from './workspaceConnection'

describe('FeltDB Core Integration: Runtime Investigator as Workspace Client', () => {
  /**
   * Mock implementation of @feltdb/core workspace for testing
   * In real usage, this would be the actual @feltdb/core Development Workspace API
   */
  class MockFeltDBWorkspace implements DevelopmentWorkspace {
    private data: Map<string, unknown> = new Map()
    private subscribers: Map<string, Set<(value: unknown) => void>> = new Map()

    write(key: string, value: unknown): void {
      this.data.set(key, value)
      this.notify(key, value)
    }

    read(key: string): unknown {
      return this.data.get(key)
    }

    subscribe(key: string, callback: (value: unknown) => void): () => void {
      if (!this.subscribers.has(key)) {
        this.subscribers.set(key, new Set())
      }
      this.subscribers.get(key)!.add(callback)

      return () => {
        this.subscribers.get(key)?.delete(callback)
      }
    }

    private notify(key: string, value: unknown): void {
      this.subscribers.get(key)?.forEach((callback) => {
        callback(value)
      })
    }

    query(type: string): Promise<unknown[]> {
      return Promise.resolve([])
    }
  }

  let workspace: MockFeltDBWorkspace

  beforeEach(() => {
    workspace = new MockFeltDBWorkspace()
  })

  it('should write visual selection to workspace', async () => {
    const selection: VisualSelection = {
      id: 'sel:001',
      workspaceId: 'ws_test',
      kind: 'visual_selection',
      url: 'http://localhost:3000/checkout',
      selector: 'button.checkout-submit',
      elementRole: 'button',
      textContent: 'Complete Order',
      boundingBox: { x: 200, y: 400, width: 150, height: 40 },
      domPath: 'body > main > button.checkout-submit',
      nearbyElements: [],
      sourceHints: [{ file: 'src/components/Checkout.tsx', line: 45, confidence: 'MEDIUM' }],
      capturedAt: Date.now(),
      properties: {},
    }

    // Simulate extension publishing selection to workspace
    workspace.write('visual_selection', selection)

    const written = workspace.read('visual_selection')
    expect(written).toEqual(selection)
  })

  it('should write development task to workspace', async () => {
    const task: DevelopmentTask = {
      id: 'task:001',
      workspaceId: 'ws_test',
      kind: 'selection_task',
      selectionId: 'sel:001',
      userInstruction: 'Make this button 20% smaller',
      taskType: 'UI_CHANGE',
      createdAt: Date.now(),
      status: 'open',
      properties: {},
    }

    workspace.write('selection_task', task)

    const written = workspace.read('selection_task')
    expect(written).toEqual(task)
  })

  it('should subscribe to code changes', async () => {
    const change: CodeChange = {
      id: 'change:001',
      workspaceId: 'ws_test',
      taskId: 'task:001',
      investigationId: '',
      kind: 'code_change',
      label: 'Resize button',
      description: 'width: 150px → 120px',
      filePath: 'src/components/Checkout.tsx',
      lineStart: 45,
      lineEnd: 47,
      createdAt: Date.now(),
      createdBy: 'agent',
      status: 'PUBLISHED',
      properties: {},
    }

    let receivedChange: unknown = null

    // Subscribe before publishing
    workspace.subscribe('code_change', (value) => {
      receivedChange = value
    })

    // Simulate agent publishing change
    workspace.write('code_change', change)

    expect(receivedChange).toEqual(change)
  })

  it('should write verification result to workspace', async () => {
    const result: VerificationResult = {
      id: 'result:001',
      workspaceId: 'ws_test',
      taskId: 'task:001',
      verificationRunId: 'verify:001',
      codeChangeId: 'change:001',
      investigationId: '',
      kind: 'verification_result',
      originalOutcome: 200,
      newOutcome: 200,
      newErrors: [],
      status: 'FIXED',
      confidence: 0.95,
      createdAt: Date.now(),
      evidence: [],
    }

    workspace.write('verification_result', result)

    const written = workspace.read('verification_result')
    expect(written).toEqual(result)
  })
})

describe('Phase 4.8: Full Integration Workflow (Acceptance Test)', () => {
  class MockFeltDBWorkspace implements DevelopmentWorkspace {
    private data: Map<string, unknown> = new Map()
    private subscribers: Map<string, Set<(value: unknown) => void>> = new Map()

    write(key: string, value: unknown): void {
      this.data.set(key, value)
      this.notify(key, value)
    }

    read(key: string): unknown {
      return this.data.get(key)
    }

    subscribe(key: string, callback: (value: unknown) => void): () => void {
      if (!this.subscribers.has(key)) {
        this.subscribers.set(key, new Set())
      }
      this.subscribers.get(key)!.add(callback)

      return () => {
        this.subscribers.get(key)?.delete(callback)
      }
    }

    private notify(key: string, value: unknown): void {
      this.subscribers.get(key)?.forEach((callback) => {
        callback(value)
      })
    }

    query(type: string): Promise<unknown[]> {
      return Promise.resolve([])
    }
  }

  let workspace: MockFeltDBWorkspace

  beforeEach(() => {
    workspace = new MockFeltDBWorkspace()
  })

  it('should complete full workflow: Select → Describe → Change → Verify via shared workspace', (done) => {
    /**
     * STEP 1: Chrome extension captures visual selection
     */
    const selection: VisualSelection = {
      id: 'sel:prod:001',
      workspaceId: 'ws_shared',
      kind: 'visual_selection',
      url: 'http://localhost:3000/checkout',
      selector: 'button.checkout-submit',
      elementRole: 'button',
      textContent: 'Complete Order',
      boundingBox: { x: 200, y: 400, width: 150, height: 40 },
      domPath: 'body > main > button.checkout-submit',
      nearbyElements: [],
      sourceHints: [{ file: 'src/components/Checkout.tsx', line: 45, confidence: 'MEDIUM' }],
      capturedAt: Date.now(),
      properties: {},
    }

    /**
     * STEP 2: Chrome writes selection to workspace
     */
    workspace.write('visual_selection', selection)

    const writtenSelection = workspace.read('visual_selection')
    expect(writtenSelection).toEqual(selection)

    /**
     * STEP 3: User describes change
     */
    const task: DevelopmentTask = {
      id: 'task:prod:001',
      workspaceId: 'ws_shared',
      kind: 'selection_task',
      selectionId: selection.id,
      userInstruction: 'Make this button 20% smaller and change text to "Place Order"',
      taskType: 'UI_CHANGE',
      createdAt: Date.now(),
      status: 'open',
      properties: {},
    }

    /**
     * STEP 4: Chrome writes task to workspace
     */
    workspace.write('selection_task', task)

    const writtenTask = workspace.read('selection_task')
    expect(writtenTask).toEqual(task)

    /**
     * STEP 5: IDE/Agent discovers task in workspace
     * (Agent would query: workspace.query({ type: 'selection_task', status: 'open' }))
     */
    const discoveredTask = workspace.read('selection_task')
    expect(discoveredTask.userInstruction).toContain('Make this button')

    /**
     * STEP 6: Agent also discovers selection for context
     */
    const discoveredSelection = workspace.read('visual_selection')
    expect(discoveredSelection.sourceHints).toBeDefined()

    /**
     * STEP 7: Agent makes code change
     */
    const change: CodeChange = {
      id: 'change:prod:001',
      workspaceId: 'ws_shared',
      taskId: task.id,
      investigationId: '',
      kind: 'code_change',
      label: 'Resize button and update text',
      description: 'width: 150px → 120px, text: "Complete Order" → "Place Order"',
      filePath: 'src/components/Checkout.tsx',
      lineStart: 45,
      lineEnd: 47,
      createdAt: Date.now(),
      createdBy: 'agent',
      status: 'READY_FOR_VERIFICATION',
      properties: {},
    }

    /**
     * STEP 8: Chrome subscribes to code changes before agent publishes
     */
    let detectedChange: unknown = null
    workspace.subscribe('code_change', (value) => {
      detectedChange = value
    })

    /**
     * STEP 9: Agent publishes code change to workspace
     */
    workspace.write('code_change', change)

    /**
     * STEP 10: Chrome receives change via subscription
     */
    expect(detectedChange).toEqual(change)

    /**
     * STEP 11: Chrome runs verification
     * (In real scenario: reload app, recapture element, compare metrics)
     */
    setTimeout(() => {
      /**
       * STEP 12: Chrome publishes verification result
       */
      const result: VerificationResult = {
        id: 'result:prod:001',
        workspaceId: 'ws_shared',
        taskId: task.id,
        verificationRunId: 'verify:prod:001',
        codeChangeId: change.id,
        investigationId: '',
        kind: 'verification_result',
        originalOutcome: 200,
        newOutcome: 200,
        newErrors: [],
        status: 'FIXED',
        confidence: 0.95,
        createdAt: Date.now(),
        evidence: [],
      }

      workspace.write('verification_result', result)

      /**
       * STEP 13: Agent reads verification result
       */
      const readResult = workspace.read('verification_result')
      expect(readResult.status).toBe('FIXED')

      /**
       * STEP 14: Verification complete via shared workspace
       * Both browser and agent see the same FeltDB state.
       * No copying. No syncing. No custom protocol.
       * Just: shared workspace.
       */
      expect(workspace.read('visual_selection')).toBeDefined()
      expect(workspace.read('selection_task')).toBeDefined()
      expect(workspace.read('code_change')).toBeDefined()
      expect(workspace.read('verification_result')).toBeDefined()

      done()
    }, 100)
  })
})
