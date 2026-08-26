/**
 * FeltDB Workspace Client: Connect to local FeltDB node
 *
 * Used by:
 * - Chrome extension (runtime investigator)
 * - VS Code (IDE integration)
 * - Cursor
 * - Claude Code
 * - Agent
 * - CLI
 */

import type { LocalFeltDBNode } from './localFeltDBNode'
import { getLocalFeltDBNode } from './localFeltDBNode'
import type { FeltNode, FeltEdge } from './feltRepository'

export type ClientKind = 'chrome' | 'vscode' | 'cursor' | 'claude-code' | 'agent' | 'cli'

export interface WorkspaceSubscriptionHandler {
  (key: string, value: unknown): void
}

export class FeltDBWorkspaceClient {
  private node: LocalFeltDBNode
  private workspaceId: string
  private clientId: string
  private clientKind: ClientKind
  private subscriptions = new Map<string, () => void>()

  constructor(workspaceId: string, clientKind: ClientKind, feltdbNode?: LocalFeltDBNode) {
    this.workspaceId = workspaceId
    this.clientKind = clientKind
    this.node = feltdbNode || getLocalFeltDBNode()

    // Connect to node
    this.clientId = this.node.connectClient(workspaceId, clientKind)
  }

  /**
   * Read value from workspace
   */
  read(key: string): unknown {
    return this.node.read(this.workspaceId, key)
  }

  /**
   * Write value to workspace
   */
  write(key: string, value: unknown): void {
    this.node.write(this.workspaceId, key, value)
  }

  /**
   * Subscribe to value changes
   */
  subscribe(key: string, handler: WorkspaceSubscriptionHandler): () => void {
    const unsubscribe = this.node.subscribe(this.workspaceId, key, handler)

    // Track subscription for cleanup
    this.subscriptions.set(key, unsubscribe)

    return () => {
      unsubscribe()
      this.subscriptions.delete(key)
    }
  }

  /**
   * Add FeltDB node (investigation, replay, experiment, etc.)
   */
  addNode(node: FeltNode): void {
    this.node.addNode(this.workspaceId, node)
  }

  /**
   * Get FeltDB node
   */
  getNode(nodeId: string): FeltNode | undefined {
    return this.node.getNode(this.workspaceId, nodeId)
  }

  /**
   * Add FeltDB edge (investigation→replay, replay→observation, etc.)
   */
  addEdge(edge: FeltEdge): void {
    this.node.addEdge(this.workspaceId, edge)
  }

  /**
   * Get FeltDB edge
   */
  getEdge(edgeId: string): FeltEdge | undefined {
    return this.node.getEdge(this.workspaceId, edgeId)
  }

  /**
   * Disconnect client and cleanup
   */
  disconnect(): void {
    // Unsubscribe all
    for (const unsubscribe of this.subscriptions.values()) {
      unsubscribe()
    }
    this.subscriptions.clear()

    // Disconnect from node
    this.node.disconnectClient(this.clientId)
  }

  /**
   * Get workspace ID
   */
  getWorkspaceId(): string {
    return this.workspaceId
  }

  /**
   * Get client ID
   */
  getClientId(): string {
    return this.clientId
  }

  /**
   * Get client kind
   */
  getClientKind(): ClientKind {
    return this.clientKind
  }
}

/**
 * Helper: Create client for Chrome extension
 */
export function createChromeClient(workspaceId: string, feltdbNode?: LocalFeltDBNode): FeltDBWorkspaceClient {
  return new FeltDBWorkspaceClient(workspaceId, 'chrome', feltdbNode)
}

/**
 * Helper: Create client for VS Code
 */
export function createVSCodeClient(workspaceId: string, feltdbNode?: LocalFeltDBNode): FeltDBWorkspaceClient {
  return new FeltDBWorkspaceClient(workspaceId, 'vscode', feltdbNode)
}

/**
 * Helper: Create client for agent
 */
export function createAgentClient(workspaceId: string, feltdbNode?: LocalFeltDBNode): FeltDBWorkspaceClient {
  return new FeltDBWorkspaceClient(workspaceId, 'agent', feltdbNode)
}
