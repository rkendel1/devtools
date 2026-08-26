import { describe, it, expect, beforeEach } from 'vitest'
import { LocalFeltDBNode, WorkspaceStore } from './localFeltDBNode'

describe('LocalFeltDBNode', () => {
  let node: LocalFeltDBNode

  beforeEach(() => {
    node = new LocalFeltDBNode()
  })

  describe('Basic read/write', () => {
    it('should write and read values', () => {
      const wsId = 'ws_123'
      const chromeClientId = node.connectClient(wsId, 'chrome')

      node.write(wsId, 'task', { id: 'inv-123', diagnosis: 'test failure' })

      const value = node.read(wsId, 'task')

      expect(value).toEqual({ id: 'inv-123', diagnosis: 'test failure' })
    })

    it('should handle multiple keys', () => {
      const wsId = 'ws_123'
      node.connectClient(wsId, 'chrome')

      node.write(wsId, 'task', { id: 'inv-123' })
      node.write(wsId, 'change', { file: 'checkout.ts', status: 'applied' })
      node.write(wsId, 'verification', { status: 'running' })

      expect(node.read(wsId, 'task')).toEqual({ id: 'inv-123' })
      expect(node.read(wsId, 'change')).toEqual({ file: 'checkout.ts', status: 'applied' })
      expect(node.read(wsId, 'verification')).toEqual({ status: 'running' })
    })
  })

  describe('Cross-client communication', () => {
    it('should allow chrome to write and vscode to read', () => {
      const wsId = 'ws_123'
      const chromeClientId = node.connectClient(wsId, 'chrome')
      const vscodeClientId = node.connectClient(wsId, 'vscode')

      // Chrome writes
      node.write(wsId, 'task', { id: 'inv-123', diagnosis: 'currency validation failed' })

      // VS Code reads
      const task = node.read(wsId, 'task')

      expect(task).toEqual({ id: 'inv-123', diagnosis: 'currency validation failed' })
    })

    it('should allow vscode to write and chrome to read', () => {
      const wsId = 'ws_123'
      const chromeClientId = node.connectClient(wsId, 'chrome')
      const vscodeClientId = node.connectClient(wsId, 'vscode')

      // VS Code writes
      node.write(wsId, 'change', {
        workspaceId: wsId,
        filePath: 'src/api/checkout.ts',
        change: 'Add currency validation',
        status: 'applied',
      })

      // Chrome reads
      const change = node.read(wsId, 'change')

      expect(change).toEqual({
        workspaceId: wsId,
        filePath: 'src/api/checkout.ts',
        change: 'Add currency validation',
        status: 'applied',
      })
    })

    it('should support subscription to changes', () => {
      const wsId = 'ws_123'
      node.connectClient(wsId, 'chrome')
      node.connectClient(wsId, 'vscode')

      let receivedValue: unknown = null

      // VS Code subscribes to task changes
      const unsubscribe = node.subscribe(wsId, 'task', (key, value) => {
        receivedValue = value
      })

      // Chrome writes
      node.write(wsId, 'task', { id: 'inv-123', diagnosis: 'test' })

      // Verify VS Code received the change
      expect(receivedValue).toEqual({ id: 'inv-123', diagnosis: 'test' })

      unsubscribe()
    })

    it('should maintain separate subscriptions for different keys', () => {
      const wsId = 'ws_123'
      node.connectClient(wsId, 'chrome')
      node.connectClient(wsId, 'vscode')

      const receivedUpdates: Array<[string, unknown]> = []

      // Subscribe to both task and change
      const unsubTask = node.subscribe(wsId, 'task', (key, value) => {
        receivedUpdates.push([key, value])
      })

      const unsubChange = node.subscribe(wsId, 'change', (key, value) => {
        receivedUpdates.push([key, value])
      })

      // Write to both
      node.write(wsId, 'task', { id: 'inv-123' })
      node.write(wsId, 'change', { file: 'checkout.ts' })

      // Verify both updates were received
      expect(receivedUpdates).toHaveLength(2)
      expect(receivedUpdates[0]).toEqual(['task', { id: 'inv-123' }])
      expect(receivedUpdates[1]).toEqual(['change', { file: 'checkout.ts' }])

      unsubTask()
      unsubChange()
    })
  })

  describe('Client management', () => {
    it('should track connected clients', () => {
      const wsId = 'ws_123'

      node.connectClient(wsId, 'chrome')
      node.connectClient(wsId, 'vscode')
      node.connectClient(wsId, 'agent')

      const clients = node.getConnectedClients()

      expect(clients).toHaveLength(3)
      expect(clients.map((c) => c.kind)).toContain('chrome')
      expect(clients.map((c) => c.kind)).toContain('vscode')
      expect(clients.map((c) => c.kind)).toContain('agent')
    })

    it('should handle client disconnect', () => {
      const wsId = 'ws_123'

      const clientId = node.connectClient(wsId, 'chrome')
      expect(node.getConnectedClients()).toHaveLength(1)

      node.disconnectClient(clientId)
      expect(node.getConnectedClients()).toHaveLength(0)
    })

    it('should report health when clients connected', () => {
      const wsId = 'ws_123'
      expect(node.isHealthy()).toBe(false)

      node.connectClient(wsId, 'chrome')
      expect(node.isHealthy()).toBe(true)
    })
  })

  describe('Workspace isolation', () => {
    it('should isolate data between workspaces', () => {
      const ws1 = 'ws_111'
      const ws2 = 'ws_222'

      node.connectClient(ws1, 'chrome')
      node.connectClient(ws2, 'vscode')

      node.write(ws1, 'task', { id: 'inv-111' })
      node.write(ws2, 'task', { id: 'inv-222' })

      expect(node.read(ws1, 'task')).toEqual({ id: 'inv-111' })
      expect(node.read(ws2, 'task')).toEqual({ id: 'inv-222' })
    })
  })

  describe('WorkspaceStore', () => {
    let store: WorkspaceStore

    beforeEach(() => {
      store = new WorkspaceStore()
    })

    it('should create workspace on demand', () => {
      const ws = store.createOrGet('ws_123')

      expect(ws.id).toBe('ws_123')
      expect(ws.createdAt).toBeGreaterThan(0)
      expect(ws.objects.size).toBe(0)
    })

    it('should return same workspace on subsequent calls', () => {
      const ws1 = store.createOrGet('ws_123')
      const ws2 = store.createOrGet('ws_123')

      expect(ws1).toBe(ws2)
    })

    it('should persist workspace after creation', () => {
      store.createOrGet('ws_123')
      store.set('ws_123', 'key', 'value')

      const ws = store.createOrGet('ws_123')
      expect(ws.objects.get('key')).toBe('value')
    })
  })

  describe('Vertical slice: investigation → workspace → task → agent', () => {
    it('should complete browser→ide pairing flow', () => {
      const wsId = 'ws_project_123'

      // Chrome connects and publishes investigation
      const chromeClientId = node.connectClient(wsId, 'chrome')

      node.write(wsId, 'investigation', {
        id: 'inv-184',
        diagnosis: 'POST /api/checkout returns 422',
        confidence: 0.96,
        sourceLocations: [{ file: 'src/api/checkout.ts', line: 45 }],
      })

      // VS Code connects and reads investigation
      const vscodeClientId = node.connectClient(wsId, 'vscode')

      const investigation = node.read(wsId, 'investigation')

      expect(investigation).toEqual({
        id: 'inv-184',
        diagnosis: 'POST /api/checkout returns 422',
        confidence: 0.96,
        sourceLocations: [{ file: 'src/api/checkout.ts', line: 45 }],
      })

      // VS Code creates a task
      node.write(wsId, 'task', {
        id: 'task-184',
        investigationId: 'inv-184',
        label: 'Fix currency validation',
        status: 'open',
      })

      // Chrome reads task
      const task = node.read(wsId, 'task')

      expect(task).toEqual({
        id: 'task-184',
        investigationId: 'inv-184',
        label: 'Fix currency validation',
        status: 'open',
      })

      // Verify both clients are connected
      expect(node.getConnectedClients()).toHaveLength(2)
      expect(node.isHealthy()).toBe(true)
    })
  })
})
