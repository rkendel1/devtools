/**
 * Development Workspace: Shared state model
 *
 * Browser Runtime Investigator and IDE/Agent are both clients of the same FeltDB workspace.
 * Everything hangs off DevelopmentWorkspace.
 *
 * Invariant: Same workspaceId = same development context.
 * No data copying between systems. All clients query FeltDB.
 */

export interface DevelopmentWorkspace {
  id: string
  kind: 'development_workspace'
  label: string
  repositoryUrl: string
  branch: string
  worktreeLocation?: string
  browserSessionId?: string
  createdAt: number
  lastActiveAt: number
  properties: {
    repositoryOwner?: string
    repositoryName?: string
    workspaceRoot?: string
    nodeVersion?: string
    packageManager?: string
  }
}

export interface Investigation {
  id: string
  workspaceId: string
  kind: 'investigation'
  label: string
  diagnosis: string
  confidence: number
  observedAt: number
  createdAt: number
  properties: {
    pageUrl?: string
    targetRequest?: {
      method: string
      url: string
    }
    status?: number
    errorCount?: number
    reproductionSteps?: string[]
  }
}

export interface ReplayRunReference {
  id: string
  status: 'REPRODUCED' | 'PARTIAL' | 'NOT_REPRODUCED' | 'UNDETERMINED'
  confidence: number
  observationCount: number
  timestamp: number
}

export interface CounterfactualFinding {
  id: string
  variable: string
  status: 'ISOLATES_CAUSE' | 'INCONCLUSIVE' | 'NOT_CAUSAL'
  confidence: number
  reasoning: string
  baselineOutcome: number
  experimentOutcome: number
}

export interface InvestigationContextEnvelope {
  workspaceId: string
  investigationId: string
  task?: {
    id: string
    description: string
  }
  problem: {
    diagnosis: string
    confidence: number
    sourceLocations?: Array<{
      file: string
      line?: number
      column?: number
    }>
  }
  reproduction: {
    pageUrl?: string
    targetRequest: {
      method: string
      url: string
    }
    status: number
    errorCount: number
    reproductionSteps?: string[]
  }
  replay?: {
    id: string
    status: 'REPRODUCED' | 'PARTIAL' | 'NOT_REPRODUCED'
    confidence: number
    observationCount: number
  }
  counterfactuals: CounterfactualFinding[]
  evidence: {
    nodeIds: string[]
  }
}

export interface DevelopmentTask {
  id: string
  workspaceId: string
  investigationId: string
  kind: 'development_task'
  label: string
  description: string
  userInstruction?: string
  status: 'open' | 'in_progress' | 'completed' | 'blocked'
  sourceLocations: Array<{
    file: string
    line?: number
    column?: number
  }>
  evidenceReferenceIds: string[]
  createdAt: number
  createdBy?: string
  updatedAt: number
  updatedBy?: string
  properties: {
    priority?: 'low' | 'medium' | 'high'
    context?: Record<string, unknown>
  }
}

export interface CodeChange {
  id: string
  workspaceId: string
  taskId?: string
  investigationId?: string
  kind: 'code_change'
  label: string
  description: string
  filePath: string
  lineStart?: number
  lineEnd?: number
  originalText?: string
  newText?: string
  createdAt: number
  createdBy?: string
  status: 'draft' | 'proposed' | 'applied' | 'reverted'
  properties: {
    changeType?: 'add' | 'modify' | 'delete'
    context?: Record<string, unknown>
  }
}

export interface VerificationRun {
  id: string
  workspaceId: string
  codeChangeId: string
  investigationId: string
  kind: 'verification_run'
  label: string
  status: 'pending' | 'running' | 'passed' | 'failed'
  replayId?: string
  replayStatus?: 'REPRODUCED' | 'NOT_REPRODUCED' | 'UNDETERMINED'
  confidence?: number
  createdAt: number
  completedAt?: number
  properties: {
    notes?: string
  }
}

export function createWorkspaceId(): string {
  return `workspace:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function createTaskId(): string {
  return `task:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function createCodeChangeId(): string {
  return `change:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function createVerificationRunId(): string {
  return `verify:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}
