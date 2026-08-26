import { describe, it, expect, beforeEach } from 'vitest'
import {
  FeltDBWorkspaceClient,
  createChromeClient,
  createVSCodeClient,
  createAgentClient,
} from './feltdbWorkspaceClient'
import { LocalFeltDBNode } from './localFeltDBNode'

describe('FeltDB Workspace Client', () => {
  let feltdbNode: LocalFeltDBNode

  beforeEach(() => {
    feltdbNode = new LocalFeltDBNode()
  })

  describe('Basic client operations', () => {
    it('should create client and read/write', () => {
      const client = new FeltDBWorkspaceClient('ws_123', 'chrome', feltdbNode)

      client.write('key1', 'value1')
      const value = client.read('key1')

      expect(value).toBe('value1')
    })

    it('should track client identity', () => {
      const client = new FeltDBWorkspaceClient('ws_123', 'chrome', feltdbNode)

      expect(client.getWorkspaceId()).toBe('ws_123')
      expect(client.getClientKind()).toBe('chrome')
      expect(client.getClientId()).toMatch(/^client:/)
    })

    it('should disconnect and cleanup', () => {
      const client = new FeltDBWorkspaceClient('ws_123', 'chrome', feltdbNode)

      expect(feltdbNode.getConnectedClients()).toHaveLength(1)

      client.disconnect()

      expect(feltdbNode.getConnectedClients()).toHaveLength(0)
    })
  })

  describe('Cross-client communication', () => {
    it('Chrome writes → VS Code reads', () => {
      const chromeClient = createChromeClient('ws_123', feltdbNode)
      const vscodeClient = createVSCodeClient('ws_123', feltdbNode)

      // Chrome writes investigation
      chromeClient.write('investigation', {
        id: 'inv-184',
        diagnosis: 'POST /api/checkout returns 422',
        confidence: 0.96,
      })

      // VS Code reads investigation
      const investigation = vscodeClient.read('investigation')

      expect(investigation).toEqual({
        id: 'inv-184',
        diagnosis: 'POST /api/checkout returns 422',
        confidence: 0.96,
      })

      chromeClient.disconnect()
      vscodeClient.disconnect()
    })

    it('VS Code writes → Chrome reads', () => {
      const chromeClient = createChromeClient('ws_123', feltdbNode)
      const vscodeClient = createVSCodeClient('ws_123', feltdbNode)

      // VS Code writes code change
      vscodeClient.write('change', {
        workspaceId: 'ws_123',
        filePath: 'src/api/checkout.ts',
        lineStart: 45,
        lineEnd: 47,
        change: 'Add currency validation check',
        status: 'applied',
      })

      // Chrome reads code change
      const change = chromeClient.read('change')

      expect(change).toEqual({
        workspaceId: 'ws_123',
        filePath: 'src/api/checkout.ts',
        lineStart: 45,
        lineEnd: 47,
        change: 'Add currency validation check',
        status: 'applied',
      })

      chromeClient.disconnect()
      vscodeClient.disconnect()
    })

    it('Chrome subscribes to VS Code changes', () => {
      const chromeClient = createChromeClient('ws_123', feltdbNode)
      const vscodeClient = createVSCodeClient('ws_123', feltdbNode)

      let receivedValue: unknown = null

      // Chrome subscribes to verification result
      chromeClient.subscribe('verification', (key, value) => {
        receivedValue = value
      })

      // VS Code writes verification result
      vscodeClient.write('verification', {
        status: 'passed',
        originalOutcome: 422,
        newOutcome: 200,
      })

      // Chrome receives the update
      expect(receivedValue).toEqual({
        status: 'passed',
        originalOutcome: 422,
        newOutcome: 200,
      })

      chromeClient.disconnect()
      vscodeClient.disconnect()
    })

    it('VS Code subscribes to Chrome changes', () => {
      const chromeClient = createChromeClient('ws_123', feltdbNode)
      const vscodeClient = createVSCodeClient('ws_123', feltdbNode)

      let receivedValue: unknown = null

      // VS Code subscribes to replay status
      vscodeClient.subscribe('replay', (key, value) => {
        receivedValue = value
      })

      // Chrome writes replay status
      chromeClient.write('replay', {
        status: 'REPRODUCED',
        confidence: 0.9,
        observationCount: 4,
      })

      // VS Code receives the update
      expect(receivedValue).toEqual({
        status: 'REPRODUCED',
        confidence: 0.9,
        observationCount: 4,
      })

      chromeClient.disconnect()
      vscodeClient.disconnect()
    })
  })

  describe('Acceptance test: Complete pairing', () => {
    it('Chrome → FeltDB → VS Code (investigation to task)', () => {
      /**
       * STEP 1: Chrome observes failure and publishes investigation
       */
      const chromeClient = createChromeClient('ws_project', feltdbNode)

      chromeClient.write('investigation', {
        id: 'inv-184',
        diagnosis: 'POST /api/checkout returns 422 - currency field is required',
        confidence: 0.96,
        sourceLocations: [{ file: 'src/api/checkout.ts', line: 45 }],
        reproductionSteps: ['Navigate', 'Click checkout', 'POST returns 422'],
      })

      chromeClient.write('replay', {
        id: 'replay:184:abc',
        status: 'REPRODUCED',
        confidence: 0.9,
        observationCount: 4,
      })

      chromeClient.write('experiment', {
        variable: 'currency',
        status: 'ISOLATES_CAUSE',
        confidence: 0.95,
        reasoning: 'Changing currency from null to USD changed status from 422 to 200',
      })

      /**
       * STEP 2: VS Code connects to same workspace
       */
      const vscodeClient = createVSCodeClient('ws_project', feltdbNode)

      /**
       * STEP 3: VS Code reads investigation
       */
      const investigation = vscodeClient.read('investigation')
      expect(investigation).toEqual({
        id: 'inv-184',
        diagnosis: 'POST /api/checkout returns 422 - currency field is required',
        confidence: 0.96,
        sourceLocations: [{ file: 'src/api/checkout.ts', line: 45 }],
        reproductionSteps: ['Navigate', 'Click checkout', 'POST returns 422'],
      })

      /**
       * STEP 4: VS Code reads replay confirmation
       */
      const replay = vscodeClient.read('replay')
      expect(replay).toEqual({
        id: 'replay:184:abc',
        status: 'REPRODUCED',
        confidence: 0.9,
        observationCount: 4,
      })

      /**
       * STEP 5: VS Code reads experiment finding
       */
      const experiment = vscodeClient.read('experiment')
      expect(experiment).toEqual({
        variable: 'currency',
        status: 'ISOLATES_CAUSE',
        confidence: 0.95,
        reasoning: 'Changing currency from null to USD changed status from 422 to 200',
      })

      /**
       * STEP 6: VS Code creates development task
       */
      vscodeClient.write('task', {
        id: 'task:184',
        investigationId: 'inv-184',
        label: 'Add currency validation',
        status: 'open',
        sourceLocations: [{ file: 'src/api/checkout.ts', line: 45 }],
      })

      /**
       * STEP 7: Chrome reads task
       */
      const task = chromeClient.read('task')
      expect(task).toEqual({
        id: 'task:184',
        investigationId: 'inv-184',
        label: 'Add currency validation',
        status: 'open',
        sourceLocations: [{ file: 'src/api/checkout.ts', line: 45 }],
      })

      /**
       * STEP 8: Agent connects and reads task
       */
      const agentClient = createAgentClient('ws_project', feltdbNode)

      const agentTask = agentClient.read('task')
      expect(agentTask).toEqual(task)

      /**
       * STEP 9: Agent makes code change
       */
      agentClient.write('change', {
        id: 'change:184:1',
        taskId: 'task:184',
        filePath: 'src/api/checkout.ts',
        lineStart: 45,
        lineEnd: 47,
        change: `if (!cart.currency) throw new Error('Currency required')`,
        status: 'applied',
      })

      /**
       * STEP 10: Chrome reads code change
       */
      const change = chromeClient.read('change')
      expect(change).toEqual({
        id: 'change:184:1',
        taskId: 'task:184',
        filePath: 'src/api/checkout.ts',
        lineStart: 45,
        lineEnd: 47,
        change: `if (!cart.currency) throw new Error('Currency required')`,
        status: 'applied',
      })

      /**
       * STEP 11: Chrome executes verification
       */
      chromeClient.write('verification', {
        id: 'verify:184:1',
        codeChangeId: 'change:184:1',
        investigationId: 'inv-184',
        status: 'running',
      })

      chromeClient.write('verification_result', {
        replayStatus: 'NOT_REPRODUCED',
        originalOutcome: 422,
        newOutcome: 200,
        passedChecks: ['status_changed', 'no_new_errors'],
      })

      /**
       * STEP 12: Agent reads verification result
       */
      const verificationResult = agentClient.read('verification_result')
      expect(verificationResult).toEqual({
        replayStatus: 'NOT_REPRODUCED',
        originalOutcome: 422,
        newOutcome: 200,
        passedChecks: ['status_changed', 'no_new_errors'],
      })

      /**
       * STEP 13: Agent updates task status
       */
      agentClient.write('task_status', {
        taskId: 'task:184',
        status: 'completed',
        verificationPassed: true,
      })

      /**
       * STEP 14: Chrome reads final status
       */
      const finalStatus = chromeClient.read('task_status')
      expect(finalStatus).toEqual({
        taskId: 'task:184',
        status: 'completed',
        verificationPassed: true,
      })

      /**
       * Verification: All three clients are connected to same workspace
       */
      const clients = feltdbNode.getConnectedClients()
      expect(clients).toHaveLength(3)
      expect(clients.map((c) => c.kind)).toContain('chrome')
      expect(clients.map((c) => c.kind)).toContain('vscode')
      expect(clients.map((c) => c.kind)).toContain('agent')

      chromeClient.disconnect()
      vscodeClient.disconnect()
      agentClient.disconnect()

      expect(feltdbNode.getConnectedClients()).toHaveLength(0)
    })
  })

  describe('Helper functions', () => {
    it('createChromeClient', () => {
      const client = createChromeClient('ws_123', feltdbNode)
      expect(client.getClientKind()).toBe('chrome')
    })

    it('createVSCodeClient', () => {
      const client = createVSCodeClient('ws_123', feltdbNode)
      expect(client.getClientKind()).toBe('vscode')
    })

    it('createAgentClient', () => {
      const client = createAgentClient('ws_123', feltdbNode)
      expect(client.getClientKind()).toBe('agent')
    })
  })
})
