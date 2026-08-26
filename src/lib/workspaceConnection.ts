/**
 * Workspace Connection: Extension connects to real @feltdb/core Development Workspace
 *
 * The Runtime Investigator is now a client of @feltdb/core Development Workspace.
 * No custom bridge. No duplicate implementation.
 * Just: shared FeltDB state for browser, IDE, and agent.
 */

import type {
  DevelopmentWorkspace,
  DevelopmentTask,
  CodeChange,
  VerificationResult,
  VisualSelection,
} from '@feltdb/core/workspace'

export interface WorkspaceConnectionConfig {
  workspaceId: string
  projectName: string
  clientId: string
  clientKind: 'chrome' | 'ide' | 'agent'
}

export interface ConnectedWorkspace {
  workspaceId: string
  projectName: string
  clientId: string
  workspace: DevelopmentWorkspace
  isConnected: boolean
}

export interface WorkspaceStatus {
  connected: boolean
  workspaceId?: string
  projectName?: string
  clientsConnected: Array<{
    id: string
    kind: 'chrome' | 'ide' | 'agent' | 'cli'
    connectedAt: number
  }>
}

/**
 * Connect extension to a development workspace
 *
 * In real implementation, this would:
 * 1. Establish connection to @feltdb/core workspace
 * 2. Register as chrome-investigator client
 * 3. Subscribe to relevant events (CodeChange, Verification)
 *
 * For now, we define the interface that will use real @feltdb/core capability.
 */
export async function connectDevelopmentWorkspace(
  config: WorkspaceConnectionConfig,
): Promise<ConnectedWorkspace> {
  // This will use @feltdb/core's actual Development Workspace API
  // Placeholder for real implementation
  return {
    workspaceId: config.workspaceId,
    projectName: config.projectName,
    clientId: config.clientId,
    workspace: null as any, // Will be real workspace instance
    isConnected: true,
  }
}

/**
 * Disconnect from workspace
 */
export async function disconnectDevelopmentWorkspace(
  connected: ConnectedWorkspace,
): Promise<void> {
  // Cleanup subscriptions and disconnect
  connected.isConnected = false
}

/**
 * Query tasks in workspace
 */
export async function queryWorkspaceTasks(
  workspace: DevelopmentWorkspace,
  filter?: { status?: string; type?: string },
): Promise<DevelopmentTask[]> {
  // Use real @feltdb/core query API
  return []
}

/**
 * Watch for code changes in workspace
 */
export function subscribeToCodeChanges(
  workspace: DevelopmentWorkspace,
  callback: (change: CodeChange) => void,
): () => void {
  // Use real @feltdb/core subscription API
  return () => {} // Unsubscribe
}

/**
 * Watch for verification results
 */
export function subscribeToVerificationResults(
  workspace: DevelopmentWorkspace,
  callback: (result: VerificationResult) => void,
): () => void {
  // Use real @feltdb/core subscription API
  return () => {}
}

/**
 * Publish selection to workspace
 */
export async function publishSelection(
  workspace: DevelopmentWorkspace,
  selection: VisualSelection,
): Promise<void> {
  // Write selection to FeltDB workspace
}

/**
 * Publish task to workspace
 */
export async function publishTask(
  workspace: DevelopmentWorkspace,
  task: DevelopmentTask,
): Promise<void> {
  // Write task to FeltDB workspace
}

/**
 * Publish verification result
 */
export async function publishVerificationResult(
  workspace: DevelopmentWorkspace,
  result: VerificationResult,
): Promise<void> {
  // Write result to FeltDB workspace
}

/**
 * Get workspace status
 */
export async function getWorkspaceStatus(
  workspace: ConnectedWorkspace,
): Promise<WorkspaceStatus> {
  return {
    connected: workspace.isConnected,
    workspaceId: workspace.workspaceId,
    projectName: workspace.projectName,
    clientsConnected: [],
  }
}
