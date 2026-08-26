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
  taskId: string
  investigationId: string
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
  status: 'PUBLISHED' | 'READY_FOR_VERIFICATION' | 'VERIFYING' | 'VERIFIED' | 'FAILED'
  properties: {
    changeType?: 'add' | 'modify' | 'delete'
    context?: Record<string, unknown>
  }
}

export interface VerificationRun {
  id: string
  workspaceId: string
  taskId: string
  codeChangeId: string
  investigationId: string
  replayFixtureId: string
  kind: 'verification_run'
  label: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  properties: {
    notes?: string
  }
}

export interface VerificationResult {
  id: string
  workspaceId: string
  taskId: string
  verificationRunId: string
  codeChangeId: string
  investigationId: string
  kind: 'verification_result'
  originalOutcome: number
  newOutcome: number
  newErrors: string[]
  status: 'FIXED' | 'NOT_FIXED' | 'REGRESSION' | 'INCONCLUSIVE'
  confidence: number
  createdAt: number
  evidence: Array<{
    nodeId: string
    type: 'replay' | 'investigation' | 'observation'
  }>
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

export function createSelectionId(): string {
  return `selection:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function createSelectionTaskId(): string {
  return `selection_task:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function createVerificationRunId(): string {
  return `verify:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export function createVerificationResultId(): string {
  return `result:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

export interface VisualSelection {
  id: string
  workspaceId: string
  kind: 'visual_selection'
  url: string
  selector: string
  elementRole?: string
  textContent: string
  boundingBox: {
    x: number
    y: number
    width: number
    height: number
  }
  domPath: string
  nearbyElements: Array<{
    selector: string
    text: string
  }>
  sourceHints?: Array<{
    file: string
    line?: number
  }>
  capturedAt: number
  properties: {
    investigationId?: string
    context?: Record<string, unknown>
  }
}

export interface SelectionTask {
  id: string
  workspaceId: string
  kind: 'selection_task'
  selectionId: string
  userInstruction: string
  taskType: 'UI_CHANGE' | 'DEBUG_QUESTION' | 'CONTENT_CHANGE'
  createdAt: number
  status: 'open' | 'in_progress' | 'completed' | 'failed'
  properties: {
    context?: Record<string, unknown>
  }
}
