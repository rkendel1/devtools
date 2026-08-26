/**
 * FeltDB Development Workspace Client
 *
 * Runtime Investigator as a first-class client of @feltdb/core Development Workspace.
 * Browser-side selection, verification, and real-time subscription to task/change events.
 */

import type {
  VerificationResult,
} from '@feltdb/core/workspace'
import type { VisualSelection } from '../../lib/developmentWorkspace'

interface WorkspaceChannel {
  subscribe(key: string, callback: (value: unknown) => void): () => void
  write(key: string, value: unknown): void
  read(key: string): unknown
}

export interface WorkspaceClientConfig {
  workspaceId: string
  projectName: string
}

export interface DevToolsWorkspaceStatus {
  connected: boolean
  workspaceId?: string
  projectName?: string
  clientsConnected: Array<{
    id: string
    kind: 'chrome' | 'ide' | 'agent' | 'cli'
    connectedAt: number
  }>
  lastEvent?: {
    key: string
    timestamp: number
    type: 'visual_selection' | 'selection_task' | 'code_change' | 'verification_result'
  }
}

/**
 * DevTools workspace client
 * Manages connection, subscriptions, and publishing to @feltdb/core workspace
 */
export class DevToolsWorkspaceClient {
  private workspace: WorkspaceChannel | null = null
  private config: WorkspaceClientConfig | null = null
  private listeners: Map<string, Set<(value: any) => void>> = new Map()
  private subscriptionUnsubscribers: Map<string, () => void> = new Map()

  async connect(
    workspace: WorkspaceChannel,
    config: WorkspaceClientConfig,
  ): Promise<void> {
    this.workspace = workspace
    this.config = config
    this.setupSubscriptions()
  }

  private setupSubscriptions(): void {
    if (!this.workspace) return

    // Subscribe to key events for DevTools display
    this.subscribeToKey('visual_selection')
    this.subscribeToKey('selection_task')
    this.subscribeToKey('code_change')
    this.subscribeToKey('verification_result')
  }

  private subscribeToKey(key: string): void {
    if (!this.workspace) return

    const unsubscribe = this.workspace.subscribe(key, (value: unknown) => {
      this.notifyListeners(key, value)

      // Track last event
      if (!this.listeners.has('_lastEvent')) {
        this.listeners.set('_lastEvent', new Set())
      }
      this.notifyListeners('_lastEvent', {
        key,
        timestamp: Date.now(),
        type: key,
      })
    })

    this.subscriptionUnsubscribers.set(key, unsubscribe)
  }

  /**
   * Publish visual selection to workspace
   */
  publishVisualSelection(selection: VisualSelection): void {
    if (!this.workspace) throw new Error('Not connected to workspace')
    this.workspace.write('visual_selection', selection)
  }

  /**
   * Publish selection task to workspace
   */
  publishSelectionTask(task: any): void {
    if (!this.workspace) throw new Error('Not connected to workspace')
    this.workspace.write('selection_task', task)
  }

  /**
   * Publish verification result to workspace
   */
  publishVerificationResult(result: VerificationResult): void {
    if (!this.workspace) throw new Error('Not connected to workspace')
    this.workspace.write('verification_result', result)
  }

  /**
   * Read current value from workspace
   */
  read(key: string): any {
    if (!this.workspace) return null
    return this.workspace.read(key)
  }

  /**
   * Subscribe to changes on a key
   */
  subscribe(key: string, callback: (value: any) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(callback)

    return () => {
      this.listeners.get(key)?.delete(callback)
    }
  }

  private notifyListeners(key: string, value: any): void {
    this.listeners.get(key)?.forEach((callback) => {
      callback(value)
    })
  }

  /**
   * Get current workspace status
   */
  getStatus(): DevToolsWorkspaceStatus {
    if (!this.workspace || !this.config) {
      return {
        connected: false,
        clientsConnected: [],
      }
    }

    return {
      connected: true,
      workspaceId: this.config.workspaceId,
      projectName: this.config.projectName,
      clientsConnected: [], // Would be populated from workspace metadata
    }
  }

  disconnect(): void {
    this.subscriptionUnsubscribers.forEach((unsubscribe) => unsubscribe())
    this.subscriptionUnsubscribers.clear()
    this.listeners.clear()
    this.workspace = null
    this.config = null
  }

  isConnected(): boolean {
    return this.workspace !== null && this.config !== null
  }
}
