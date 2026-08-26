/**
 * Local FeltDB Node: Workspace authority for paired development
 *
 * feltdb dev
 * Starts a local node that Chrome extension and IDE clients connect to.
 * Single source of truth for development workspace state.
 *
 * Key property: Durable. Survives restart. Clients reconnect to same state.
 */

import type { FeltNode, FeltEdge } from './evidenceGraph'

export interface WorkspaceObject {
  [key: string]: unknown
}

export interface WorkspaceState {
  id: string
  createdAt: number
  lastModifiedAt: number
  objects: Map<string, WorkspaceObject>
  nodes: Map<string, FeltNode>
  edges: Map<string, FeltEdge>
}

export interface WorkspaceClient {
  id: string
  kind: 'chrome' | 'vscode' | 'cursor' | 'claude-code' | 'agent' | 'cli'
  connectedAt: number
  lastActivityAt: number
}

export interface WorkspaceSubscription {
  callback: (key: string, value: unknown) => void
  unsubscribe: () => void
}

/**
 * In-memory workspace store (Phase 4.4 MVP)
 * Later: persist to filesystem or SQLite
 */
export class WorkspaceStore {
  private workspaces = new Map<string, WorkspaceState>()
  private subscriptions = new Map<string, Set<(key: string, value: unknown) => void>>()

  createOrGet(workspaceId: string): WorkspaceState {
    if (this.workspaces.has(workspaceId)) {
      return this.workspaces.get(workspaceId)!
    }

    const workspace: WorkspaceState = {
      id: workspaceId,
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
      objects: new Map(),
      nodes: new Map(),
      edges: new Map(),
    }

    this.workspaces.set(workspaceId, workspace)
    return workspace
  }

  get(workspaceId: string, key: string): unknown {
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) return undefined
    return workspace.objects.get(key)
  }

  set(workspaceId: string, key: string, value: unknown): void {
    const workspace = this.createOrGet(workspaceId)
    workspace.objects.set(key, value as WorkspaceObject)
    workspace.lastModifiedAt = Date.now()

    // Notify subscribers
    const subs = this.subscriptions.get(`${workspaceId}:${key}`)
    if (subs) {
      for (const callback of subs) {
        callback(key, value)
      }
    }
  }

  subscribe(workspaceId: string, key: string, callback: (key: string, value: unknown) => void): () => void {
    const subKey = `${workspaceId}:${key}`
    if (!this.subscriptions.has(subKey)) {
      this.subscriptions.set(subKey, new Set())
    }

    this.subscriptions.get(subKey)!.add(callback)

    return () => {
      this.subscriptions.get(subKey)?.delete(callback)
    }
  }

  addNode(workspaceId: string, node: FeltNode): void {
    const workspace = this.createOrGet(workspaceId)
    workspace.nodes.set(node.id, node)
    workspace.lastModifiedAt = Date.now()

    this.notifyChange(workspaceId, `node:${node.id}`, node)
  }

  getNode(workspaceId: string, nodeId: string): FeltNode | undefined {
    return this.workspaces.get(workspaceId)?.nodes.get(nodeId)
  }

  addEdge(workspaceId: string, edge: FeltEdge): void {
    const workspace = this.createOrGet(workspaceId)
    workspace.edges.set(edge.id, edge)
    workspace.lastModifiedAt = Date.now()

    this.notifyChange(workspaceId, `edge:${edge.id}`, edge)
  }

  getEdge(workspaceId: string, edgeId: string): FeltEdge | undefined {
    return this.workspaces.get(workspaceId)?.edges.get(edgeId)
  }

  private notifyChange(workspaceId: string, key: string, value: unknown): void {
    const subs = this.subscriptions.get(`${workspaceId}:${key}`)
    if (subs) {
      for (const callback of subs) {
        callback(key, value)
      }
    }
  }
}

/**
 * Local FeltDB Node: Central authority for workspace state
 */
export class LocalFeltDBNode {
  private store: WorkspaceStore
  private clients = new Map<string, WorkspaceClient>()
  private clientIdCounter = 0

  constructor() {
    this.store = new WorkspaceStore()
  }

  /**
   * Client connects to node
   */
  connectClient(workspaceId: string, clientKind: WorkspaceClient['kind']): string {
    const clientId = `client:${this.clientIdCounter++}`

    this.clients.set(clientId, {
      id: clientId,
      kind: clientKind,
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
    })

    // Ensure workspace exists
    this.store.createOrGet(workspaceId)

    return clientId
  }

  /**
   * Client disconnects
   */
  disconnectClient(clientId: string): void {
    this.clients.delete(clientId)
  }

  /**
   * Client reads value from workspace
   */
  read(workspaceId: string, key: string): unknown {
    const client = Array.from(this.clients.values())[0] // Track which client
    if (client) {
      client.lastActivityAt = Date.now()
    }
    return this.store.get(workspaceId, key)
  }

  /**
   * Client writes value to workspace
   */
  write(workspaceId: string, key: string, value: unknown): void {
    const client = Array.from(this.clients.values())[0]
    if (client) {
      client.lastActivityAt = Date.now()
    }
    this.store.set(workspaceId, key, value)
  }

  /**
   * Client subscribes to changes
   */
  subscribe(workspaceId: string, key: string, callback: (key: string, value: unknown) => void): () => void {
    const client = Array.from(this.clients.values())[0]
    if (client) {
      client.lastActivityAt = Date.now()
    }
    return this.store.subscribe(workspaceId, key, callback)
  }

  /**
   * Add FeltDB node to workspace
   */
  addNode(workspaceId: string, node: FeltNode): void {
    this.store.addNode(workspaceId, node)
  }

  /**
   * Get FeltDB node from workspace
   */
  getNode(workspaceId: string, nodeId: string): FeltNode | undefined {
    return this.store.getNode(workspaceId, nodeId)
  }

  /**
   * Add FeltDB edge to workspace
   */
  addEdge(workspaceId: string, edge: FeltEdge): void {
    this.store.addEdge(workspaceId, edge)
  }

  /**
   * Get FeltDB edge from workspace
   */
  getEdge(workspaceId: string, edgeId: string): FeltEdge | undefined {
    return this.store.getEdge(workspaceId, edgeId)
  }

  /**
   * Get all connected clients
   */
  getConnectedClients(): WorkspaceClient[] {
    return Array.from(this.clients.values())
  }

  /**
   * Health check
   */
  isHealthy(): boolean {
    return this.clients.size > 0
  }
}

// Global singleton for development
let globalNode: LocalFeltDBNode | null = null

export function getLocalFeltDBNode(): LocalFeltDBNode {
  if (!globalNode) {
    globalNode = new LocalFeltDBNode()
  }
  return globalNode
}

export function setLocalFeltDBNode(node: LocalFeltDBNode | null): void {
  globalNode = node
}
