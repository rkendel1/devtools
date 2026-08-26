import { describe, it, expect, beforeEach } from 'vitest'
import {
  createChangeFixture,
  classifyVerificationOutcome,
  buildVerificationResult,
  buildVerificationRun,
  formatVerificationResult,
  getVerificationStatusIcon,
} from './verificationManager'
import type { ReplayFixture } from './replayEngine'
import type { CodeChange, DevelopmentTask, VerificationResult } from './developmentWorkspace'
import { LocalFeltDBNode } from './localFeltDBNode'
import { createChromeClient, createAgentClient } from './feltdbWorkspaceClient'

describe('Verification Manager', () => {
  describe('Outcome classification', () => {
    it('should classify FIXED when error resolved', () => {
      const status = classifyVerificationOutcome(422, 200, [])
      expect(status).toBe('FIXED')
    })

    it('should classify REGRESSION when new error appears', () => {
      const status = classifyVerificationOutcome(200, 200, ['TypeError: Cannot read property x'])
      expect(status).toBe('REGRESSION')
    })

    it('should classify NOT_FIXED when outcome unchanged', () => {
      const status = classifyVerificationOutcome(422, 422, [])
      expect(status).toBe('NOT_FIXED')
    })

    it('should classify INCONCLUSIVE when outcome differs but no error', () => {
      const status = classifyVerificationOutcome(422, 500, [])
      expect(status).toBe('INCONCLUSIVE')
    })
  })

  describe('Verification result building', () => {
    it('should build result with correct status and confidence', () => {
      const result = buildVerificationResult(
        'ws_123',
        'task:123',
        'change:123',
        'inv:123',
        'verify:123',
        422,
        200,
        [],
        ['node:1', 'node:2'],
      )

      expect(result.status).toBe('FIXED')
      expect(result.confidence).toBe(0.9)
      expect(result.originalOutcome).toBe(422)
      expect(result.newOutcome).toBe(200)
      expect(result.evidence).toHaveLength(2)
    })

    it('should lower confidence when outcome unchanged', () => {
      const result = buildVerificationResult(
        'ws_123',
        'task:123',
        'change:123',
        'inv:123',
        'verify:123',
        422,
        422,
        [],
        [],
      )

      expect(result.confidence).toBe(0.3)
    })

    it('should max confidence when new errors detected', () => {
      const result = buildVerificationResult(
        'ws_123',
        'task:123',
        'change:123',
        'inv:123',
        'verify:123',
        200,
        200,
        ['RuntimeError: x is undefined'],
        [],
      )

      expect(result.confidence).toBe(1.0)
      expect(result.status).toBe('REGRESSION')
    })
  })

  describe('Verification run building', () => {
    it('should build run with pending status', () => {
      const run = buildVerificationRun('ws_123', 'task:123', 'change:123', 'inv:123', 'fixture:123')

      expect(run.status).toBe('pending')
      expect(run.workspaceId).toBe('ws_123')
      expect(run.codeChangeId).toBe('change:123')
    })
  })

  describe('Formatting', () => {
    it('should format verification result', () => {
      const result = buildVerificationResult(
        'ws_123',
        'task:123',
        'change:123',
        'inv:123',
        'verify:123',
        422,
        200,
        [],
        [],
      )

      const formatted = formatVerificationResult(result)
      expect(formatted).toContain('VERIFICATION')
      expect(formatted).toContain('FIXED')
      expect(formatted).toContain('422')
      expect(formatted).toContain('200')
    })

    it('should return correct icon for status', () => {
      expect(getVerificationStatusIcon('FIXED')).toBe('✓')
      expect(getVerificationStatusIcon('NOT_FIXED')).toBe('✗')
      expect(getVerificationStatusIcon('REGRESSION')).toBe('⚠')
      expect(getVerificationStatusIcon('INCONCLUSIVE')).toBe('~')
    })
  })
})

describe('Phase 4.5: CodeChange → Verification Loop (Acceptance Test)', () => {
  let feltdbNode: LocalFeltDBNode

  beforeEach(() => {
    feltdbNode = new LocalFeltDBNode()
  })

  it('should complete full verification loop: Chrome → Agent → Change → Verification → Agent', () => {
    /**
     * STEP 1: Chrome creates investigation, replay fixture, and task
     */
    const chromeClient = createChromeClient('ws_verification_test', feltdbNode)

    // Chrome publishes investigation
    const investigationId = 'inv-184'
    chromeClient.write('investigation', {
      id: investigationId,
      diagnosis: 'POST /api/checkout returns 422 - currency field is required',
      confidence: 0.96,
      sourceLocations: [{ file: 'src/api/checkout.ts', line: 45 }],
      reproductionSteps: ['Navigate', 'Click checkout', 'POST returns 422'],
    })

    // Chrome publishes replay fixture
    const fixtureId = 'fixture:184'
    const replayFixture: ReplayFixture = {
      id: fixtureId,
      investigationId,
      label: 'Reproduce: POST checkout with currency=null',
      startUrl: 'http://localhost:3000/checkout',
      actions: [
        {
          type: 'navigate',
          url: 'http://localhost:3000/checkout',
        },
        {
          type: 'click',
          selector: 'button[data-test="submit-checkout"]',
        },
      ],
      expectedOutcome: {
        status: 422,
      },
    }

    chromeClient.write('replay_fixture', replayFixture)

    // Chrome publishes original replay run
    const originalReplayId = 'replay:184:original'
    chromeClient.write('replay_run', {
      id: originalReplayId,
      fixtureId,
      status: 'REPRODUCED',
      confidence: 0.9,
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
      observations: [
        { type: 'navigation', description: 'Navigated to checkout' },
        { type: 'interaction', description: 'Clicked submit' },
        { type: 'network', statusCode: 422, description: 'POST /api/checkout 422' },
        { type: 'error', description: 'currency field required' },
      ],
      outcome: { status: 422 },
    })

    // Chrome creates development task
    const taskId = 'task:184'
    chromeClient.write('task', {
      id: taskId,
      investigationId,
      label: 'POST /api/checkout returns 422 - currency validation',
      status: 'open',
      sourceLocations: [{ file: 'src/api/checkout.ts', line: 45 }],
    })

    /**
     * STEP 2: Agent connects to workspace
     */
    const agentClient = createAgentClient('ws_verification_test', feltdbNode)

    /**
     * STEP 3: Agent reads task
     */
    const readTask = agentClient.read('task')
    expect(readTask).toEqual({
      id: taskId,
      investigationId,
      label: 'POST /api/checkout returns 422 - currency validation',
      status: 'open',
      sourceLocations: [{ file: 'src/api/checkout.ts', line: 45 }],
    })

    /**
     * STEP 4: Chrome subscribes to code change events before agent publishes
     */
    let receivedChange: unknown = null
    chromeClient.subscribe('code_change', (key, value) => {
      receivedChange = value
    })

    /**
     * STEP 5: Agent publishes code change
     */
    const changeId = 'change:52'
    const codeChange: CodeChange = {
      id: changeId,
      workspaceId: 'ws_verification_test',
      taskId,
      investigationId,
      kind: 'code_change',
      label: 'Add currency validation check',
      description: 'Validate currency field before processing checkout',
      filePath: 'src/api/checkout.ts',
      lineStart: 45,
      lineEnd: 47,
      originalText: '  const amount = cart.total',
      newText: `  if (!cart.currency) throw new Error('Currency required')
  const amount = cart.total`,
      createdAt: Date.now(),
      createdBy: 'agent',
      status: 'PUBLISHED',
      properties: {
        changeType: 'add',
      },
    }

    agentClient.write('code_change', codeChange)

    /**
     * STEP 6: Chrome receives code change via subscription
     */
    expect(receivedChange).toEqual(codeChange)

    /**
     * STEP 7: Chrome updates code change status to READY_FOR_VERIFICATION
     */
    const updatedChange: CodeChange = {
      ...codeChange,
      status: 'READY_FOR_VERIFICATION',
    }
    chromeClient.write('code_change', updatedChange)

    /**
     * STEP 8: Chrome executes verification
     *
     * In a real scenario, Chrome would:
     * 1. Apply the code change to the running app
     * 2. Execute the ReplayFixture
     * 3. Capture outcome
     * 4. Compare to original
     *
     * For this test, we simulate the verification logic:
     */

    // Update code change to VERIFYING
    const verifyingChange: CodeChange = {
      ...updatedChange,
      status: 'VERIFYING',
    }
    chromeClient.write('code_change', verifyingChange)

    /**
     * STEP 9: Chrome produces verification run
     */
    const verificationRunId = 'verify:91'
    const verificationRun = buildVerificationRun(
      'ws_verification_test',
      taskId,
      changeId,
      investigationId,
      fixtureId,
    )

    chromeClient.write('verification_run', {
      id: verificationRunId,
      workspaceId: 'ws_verification_test',
      taskId,
      codeChangeId: changeId,
      investigationId,
      replayFixtureId: fixtureId,
      status: 'running',
      startedAt: Date.now(),
      kind: 'verification_run',
      label: `Verification for change: ${changeId}`,
    })

    /**
     * STEP 10: Chrome stores verification result
     *
     * After running the replay with the change applied:
     * - Original: 422 (currency missing)
     * - New: 200 OK (currency validation passes)
     * - No new errors
     * - Conclusion: FIX VERIFIED
     */
    const verificationResult = buildVerificationResult(
      'ws_verification_test',
      taskId,
      changeId,
      investigationId,
      verificationRunId,
      422, // original outcome
      200, // new outcome with change
      [], // no new errors
      [originalReplayId], // evidence: the original replay
    )

    chromeClient.write('verification_result', verificationResult)

    // Update code change to VERIFIED
    const verifiedChange: CodeChange = {
      ...verifyingChange,
      status: 'VERIFIED',
    }
    chromeClient.write('code_change', verifiedChange)

    /**
     * STEP 11: Agent reads verification result
     */
    const readResult = agentClient.read('verification_result')
    expect(readResult).toEqual(verificationResult)
    expect(readResult.status).toBe('FIXED')
    expect(readResult.confidence).toBe(0.9)

    /**
     * STEP 12: Agent marks task VERIFIED
     */
    agentClient.write('task', {
      ...readTask,
      status: 'completed',
    })

    /**
     * STEP 13: Chrome observes task is now VERIFIED
     */
    const finalTask = chromeClient.read('task')
    expect(finalTask.status).toBe('completed')

    /**
     * Verification: Complete loop closed
     * Browser → Agent → Code → Browser → Agent
     * All via shared FeltDB workspace
     */
    const clients = feltdbNode.getConnectedClients()
    expect(clients).toHaveLength(2)
    expect(clients.map((c) => c.kind)).toContain('chrome')
    expect(clients.map((c) => c.kind)).toContain('agent')

    chromeClient.disconnect()
    agentClient.disconnect()

    expect(feltdbNode.getConnectedClients()).toHaveLength(0)
  })
})
