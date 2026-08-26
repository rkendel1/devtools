/**
 * Selection Task Manager: Lifecycle management for UI change tasks
 *
 * Orchestrates:
 * 1. Selection capture
 * 2. Task publication to FeltDB
 * 3. CodeChange detection
 * 4. Verification execution
 * 5. Result reporting
 */

import type {
  VisualSelection,
  SelectionTask,
  CodeChange,
  VerificationResult,
} from './developmentWorkspace'
import type { FeltDBWorkspaceClient } from './feltdbWorkspaceClient'
import { captureElementState } from './selectionMode'

export type TaskState =
  | 'IDLE'
  | 'SELECTING'
  | 'INSTRUCTING'
  | 'PUBLISHING'
  | 'WAITING_FOR_AGENT'
  | 'CHANGE_DETECTED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'FAILED'

export interface TaskStateTransition {
  from: TaskState
  to: TaskState
  timestamp: number
  details?: Record<string, unknown>
}

export interface TaskExecutionContext {
  workspaceId: string
  selection: VisualSelection
  task: SelectionTask
  baselineElementState?: {
    rect: DOMRect
    display: string
    position: string
    computed: Record<string, string>
  }
  detectedChange?: CodeChange
  verificationResult?: VerificationResult
  stateHistory: TaskStateTransition[]
}

export class SelectionTaskManager {
  private state: TaskState = 'IDLE'
  private context: TaskExecutionContext | null = null
  private listeners: Array<(state: TaskState, context: TaskExecutionContext | null) => void> = []

  constructor(private client: FeltDBWorkspaceClient) {}

  /**
   * Lifecycle: Start selection mode
   */
  startSelection(workspaceId: string): void {
    this.setState('SELECTING')
    console.log('[SelectionTaskManager] Started selection mode')
  }

  /**
   * Lifecycle: Selection complete, ready for instruction
   */
  selectionComplete(selection: VisualSelection): void {
    this.context = {
      workspaceId: selection.workspaceId,
      selection,
      task: null as any, // Will be set when instruction is provided
      stateHistory: [],
    }

    // Capture baseline element state for verification later (only in browser)
    if (typeof document !== 'undefined') {
      const element = document.querySelector(selection.selector)
      if (element) {
        this.context.baselineElementState = captureElementState(element)
      }
    }

    this.setState('INSTRUCTING')
    console.log('[SelectionTaskManager] Selection complete, waiting for instruction')
  }

  /**
   * Lifecycle: Publish task to FeltDB
   */
  publishTask(task: SelectionTask): void {
    if (!this.context) {
      throw new Error('No selection context')
    }

    this.context.task = task

    // Write to FeltDB workspace
    this.client.write('visual_selection', this.context.selection)
    this.client.write('selection_task', task)

    this.setState('PUBLISHING')
    console.log(`[SelectionTaskManager] Task published: ${task.id}`)

    // Transition to waiting for agent
    setTimeout(() => {
      this.setState('WAITING_FOR_AGENT')
    }, 500)
  }

  /**
   * Lifecycle: Detect CodeChange published by agent
   */
  detectCodeChange(change: CodeChange): void {
    if (!this.context) {
      throw new Error('No task context')
    }

    if (change.taskId !== this.context.task.id) {
      return // Not our task
    }

    this.context.detectedChange = change
    this.setState('CHANGE_DETECTED')

    console.log(`[SelectionTaskManager] Change detected: ${change.id}`)

    // Transition to verification
    setTimeout(() => {
      this.verifyChange()
    }, 1000)
  }

  /**
   * Lifecycle: Execute verification
   */
  private verifyChange(): void {
    if (!this.context || !this.context.detectedChange) {
      throw new Error('No change to verify')
    }

    this.setState('VERIFYING')
    console.log('[SelectionTaskManager] Starting verification...')

    // In real implementation, this would:
    // 1. Apply code change
    // 2. Reload application
    // 3. Recapture element
    // 4. Compare metrics

    // For now, simulate verification
    setTimeout(() => {
      this.completeVerification()
    }, 2000)
  }

  /**
   * Lifecycle: Report verification result
   */
  private completeVerification(): void {
    if (!this.context) {
      throw new Error('No task context')
    }

    // In real implementation, verification result would come from browser
    // For now, mark as verified
    this.setState('VERIFIED')
    console.log('[SelectionTaskManager] Verification complete')
  }

  /**
   * Lifecycle: Handle verification result
   */
  receiveVerificationResult(result: VerificationResult): void {
    if (!this.context) {
      throw new Error('No task context')
    }

    this.context.verificationResult = result

    if (result.status === 'FIXED') {
      this.setState('VERIFIED')
    } else {
      this.setState('FAILED')
    }

    console.log(`[SelectionTaskManager] Verification result: ${result.status}`)
  }

  /**
   * State management
   */
  private setState(newState: TaskState): void {
    const oldState = this.state
    this.state = newState

    if (this.context) {
      this.context.stateHistory.push({
        from: oldState,
        to: newState,
        timestamp: Date.now(),
      })
    }

    // Notify listeners
    this.listeners.forEach((listener) => {
      listener(newState, this.context)
    })
  }

  /**
   * Observe state changes
   */
  subscribe(listener: (state: TaskState, context: TaskExecutionContext | null) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  /**
   * Query current state
   */
  getState(): TaskState {
    return this.state
  }

  getContext(): TaskExecutionContext | null {
    return this.context
  }

  /**
   * Reset to idle
   */
  reset(): void {
    this.context = null
    this.setState('IDLE')
  }
}
