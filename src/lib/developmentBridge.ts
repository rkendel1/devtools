/**
 * Development Bridge: Abstraction for IDE/Agent integration
 *
 * Allows multiple implementations (VS Code, Cursor, Claude Code, CLI) without coupling.
 * All operations are against FeltDB. No direct Chrome → IDE communication.
 *
 * First implementation: Local/in-memory for testing.
 * Future implementations: VS Code extension, Cursor, Claude Code extension, CLI.
 */

import type {
  DevelopmentWorkspace,
  DevelopmentTask,
  InvestigationContextEnvelope,
  CodeChange,
  VerificationRun,
} from './developmentWorkspace'
import { createWorkspaceId, createTaskId, createCodeChangeId, createVerificationRunId } from './developmentWorkspace'

export interface DevelopmentBridgeCapabilities {
  canPublishInvestigation: boolean
  canPublishTask: boolean
  canOpenSourceLocation: boolean
  canDiscoverWorkspace: boolean
  canNotifyChange: boolean
}

export interface DevelopmentBridgeCallbacks {
  onTaskDiscovered?: (task: DevelopmentTask) => void
  onTaskUpdated?: (task: DevelopmentTask) => void
  onCodeChangeProposed?: (change: CodeChange) => void
  onVerificationRequired?: (run: VerificationRun) => void
}

export interface DevelopmentBridge {
  capabilities(): DevelopmentBridgeCapabilities

  // Workspace operations
  getOrCreateWorkspace(
    repositoryUrl: string,
    branch: string,
    browserSessionId?: string
  ): Promise<DevelopmentWorkspace>

  getWorkspace(workspaceId: string): Promise<DevelopmentWorkspace | null>

  // Investigation and task publishing
  publishInvestigation(
    workspaceId: string,
    envelope: InvestigationContextEnvelope
  ): Promise<DevelopmentTask>

  // Task operations
  publishTask(task: DevelopmentTask): Promise<void>

  discoverTasks(workspaceId: string, status?: string): Promise<DevelopmentTask[]>

  updateTaskStatus(
    taskId: string,
    status: DevelopmentTask['status'],
    updates?: Partial<DevelopmentTask>
  ): Promise<void>

  // Source location operations
  openSourceLocation(file: string, line?: number, column?: number): Promise<void>

  // Change operations
  proposedCodeChange(
    workspaceId: string,
    taskId: string,
    change: CodeChange
  ): Promise<void>

  // Notification
  notifyChange(workspaceId: string, message: string): Promise<void>

  // Callbacks
  onDiscoveredTask(callback: (task: DevelopmentTask) => void): () => void
  onVerificationRequired(callback: (run: VerificationRun) => void): () => void
}

/**
 * LocalDevelopmentBridge: In-memory implementation for testing
 * Stores workspace and tasks in memory. Can be extended to FeltDB integration.
 */
export class LocalDevelopmentBridge implements DevelopmentBridge {
  private workspaces = new Map<string, DevelopmentWorkspace>()
  private tasks = new Map<string, DevelopmentTask>()
  private changes = new Map<string, CodeChange>()
  private callbacks: DevelopmentBridgeCallbacks = {}

  capabilities(): DevelopmentBridgeCapabilities {
    return {
      canPublishInvestigation: true,
      canPublishTask: true,
      canOpenSourceLocation: false,
      canDiscoverWorkspace: true,
      canNotifyChange: true,
    }
  }

  async getOrCreateWorkspace(
    repositoryUrl: string,
    branch: string,
    browserSessionId?: string
  ): Promise<DevelopmentWorkspace> {
    const existingKey = Array.from(this.workspaces.entries()).find(
      ([, ws]) => ws.repositoryUrl === repositoryUrl && ws.branch === branch
    )?.[0]

    if (existingKey) {
      return this.workspaces.get(existingKey)!
    }

    const workspace: DevelopmentWorkspace = {
      id: createWorkspaceId(),
      kind: 'development_workspace',
      label: `${repositoryUrl.split('/').pop()} @ ${branch}`,
      repositoryUrl,
      branch,
      browserSessionId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      properties: {
        repositoryName: repositoryUrl.split('/').pop(),
      },
    }

    this.workspaces.set(workspace.id, workspace)
    return workspace
  }

  async getWorkspace(workspaceId: string): Promise<DevelopmentWorkspace | null> {
    return this.workspaces.get(workspaceId) || null
  }

  async publishInvestigation(
    workspaceId: string,
    envelope: InvestigationContextEnvelope
  ): Promise<DevelopmentTask> {
    const task: DevelopmentTask = {
      id: createTaskId(),
      workspaceId,
      investigationId: envelope.investigationId,
      kind: 'development_task',
      label: envelope.problem.diagnosis,
      description: envelope.problem.diagnosis,
      userInstruction: envelope.task?.description,
      status: 'open',
      sourceLocations: envelope.problem.sourceLocations || [],
      evidenceReferenceIds: envelope.evidence.nodeIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      properties: {
        context: {
          pageUrl: envelope.reproduction.pageUrl,
          targetRequest: envelope.reproduction.targetRequest,
          replayId: envelope.replay?.id,
          counterfactuals: envelope.counterfactuals,
        },
      },
    }

    this.tasks.set(task.id, task)

    if (this.callbacks.onTaskDiscovered) {
      this.callbacks.onTaskDiscovered(task)
    }

    return task
  }

  async publishTask(task: DevelopmentTask): Promise<void> {
    this.tasks.set(task.id, task)
  }

  async discoverTasks(workspaceId: string, status?: string): Promise<DevelopmentTask[]> {
    const allTasks = Array.from(this.tasks.values())

    return allTasks.filter((t) => {
      const matchesWorkspace = t.workspaceId === workspaceId
      const matchesStatus = !status || t.status === status
      return matchesWorkspace && matchesStatus
    })
  }

  async updateTaskStatus(
    taskId: string,
    status: DevelopmentTask['status'],
    updates?: Partial<DevelopmentTask>
  ): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return

    task.status = status
    task.updatedAt = Date.now()

    if (updates) {
      Object.assign(task, updates)
    }

    this.tasks.set(taskId, task)

    if (this.callbacks.onTaskUpdated) {
      this.callbacks.onTaskUpdated(task)
    }
  }

  async openSourceLocation(file: string, line?: number, _column?: number): Promise<void> {
    console.log(`[DevelopmentBridge] Would open ${file}:${line}`)
  }

  async proposedCodeChange(
    workspaceId: string,
    taskId: string,
    change: CodeChange
  ): Promise<void> {
    this.changes.set(change.id, change)

    if (this.callbacks.onCodeChangeProposed) {
      this.callbacks.onCodeChangeProposed(change)
    }
  }

  async notifyChange(workspaceId: string, message: string): Promise<void> {
    console.log(`[DevelopmentBridge] ${message}`)
  }

  onDiscoveredTask(callback: (task: DevelopmentTask) => void): () => void {
    this.callbacks.onTaskDiscovered = callback
    return () => {
      this.callbacks.onTaskDiscovered = undefined
    }
  }

  onVerificationRequired(callback: (run: VerificationRun) => void): () => void {
    this.callbacks.onVerificationRequired = callback
    return () => {
      this.callbacks.onVerificationRequired = undefined
    }
  }
}

let globalBridge: DevelopmentBridge | null = null

export function setDevelopmentBridge(bridge: DevelopmentBridge): void {
  globalBridge = bridge
}

export function getDevelopmentBridge(): DevelopmentBridge {
  if (!globalBridge) {
    globalBridge = new LocalDevelopmentBridge()
  }
  return globalBridge
}
