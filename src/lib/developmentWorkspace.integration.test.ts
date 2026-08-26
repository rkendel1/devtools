import { describe, it, expect } from 'vitest'
import { LocalDevelopmentBridge } from './developmentBridge'
import { extractInvestigationEnvelope } from './investigationEnvelope'
import type { Investigation, CounterfactualFinding } from './developmentWorkspace'

describe('Development Workspace Integration', () => {
  it('should complete vertical slice: investigation → workspace → task → agent discovery', async () => {
    /**
     * STEP 1: Browser Runtime Investigator observes failure
     * (Simulating what already exists in Phase 4.3)
     */
    const bridge = new LocalDevelopmentBridge()
    const workspace = await bridge.getOrCreateWorkspace(
      'https://github.com/myapp/checkout',
      'main',
      'browser-session-123'
    )

    const browserObservedInvestigation: Investigation = {
      id: 'inv-184',
      workspaceId: workspace.id,
      kind: 'investigation',
      label: 'Checkout failure',
      diagnosis: 'POST /api/checkout returns 422 - currency field is required',
      confidence: 0.96,
      observedAt: Date.now(),
      createdAt: Date.now(),
      properties: {
        pageUrl: 'http://localhost:3000/checkout',
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        errorCount: 1,
        reproductionSteps: [
          'Navigate to http://localhost:3000/',
          'Click #checkout-btn',
          'POST returns 422 with error: currency_required',
        ],
      },
    }

    /**
     * STEP 2: Browser records replay confirmation
     * (Phase 4.3: ReplayRun shows REPRODUCED)
     */
    const replayConfirmation = {
      id: 'replayrun:inv-184:1234567890',
      outcome: {
        status: 'REPRODUCED' as const,
        confidence: 0.9,
      },
      observations: [
        { timestamp: 1, type: 'navigation', description: 'Navigate', success: true },
        { timestamp: 2, type: 'interaction', description: 'Click', success: true },
        { timestamp: 3, type: 'target_request', description: 'POST', success: true },
        { timestamp: 4, type: 'runtime_error', description: 'error', success: true },
      ],
    }

    /**
     * STEP 3: Browser runs counterfactual experiment
     * (Phase 5: Experiment shows currency is causal)
     */
    const causalFinding: CounterfactualFinding = {
      id: 'exp-184:1',
      variable: 'currency',
      status: 'ISOLATES_CAUSE',
      confidence: 0.95,
      reasoning: 'Changing currency from null to "USD" changed HTTP status from 422 to 200',
      baselineOutcome: 422,
      experimentOutcome: 200,
    }

    /**
     * STEP 4: Extract clean development context
     * (No Chrome telemetry, no ReplayRun internals)
     */
    const envelope = extractInvestigationEnvelope(workspace.id, {
      investigation: browserObservedInvestigation,
      replayRun: replayConfirmation as any,
      counterfactualFindings: [causalFinding],
      sourceLocations: [
        {
          file: 'src/api/checkout.ts',
          line: 45,
        },
      ],
      evidenceNodeIds: ['replay:inv-184:obs:1', 'replay:inv-184:obs:2', 'exp:inv-184:find:1'],
    })

    /**
     * STEP 5: Verify envelope contains only development-safe data
     */
    expect(envelope.workspaceId).toBe(workspace.id)
    expect(envelope.investigationId).toBe('inv-184')
    expect(envelope.problem.diagnosis).toBe(
      'POST /api/checkout returns 422 - currency field is required'
    )
    expect(envelope.problem.confidence).toBe(0.96)
    expect(envelope.reproduction.status).toBe(422)
    expect(envelope.reproduction.errorCount).toBe(1)
    expect(envelope.replay?.status).toBe('REPRODUCED')
    expect(envelope.counterfactuals).toHaveLength(1)
    expect(envelope.counterfactuals[0].variable).toBe('currency')

    /**
     * STEP 6: Publish to development bridge
     * (IDE/Agent would call this)
     */

    const task = await bridge.publishInvestigation(workspace.id, envelope)

    /**
     * STEP 7: Verify task contains clean development context
     * (Not raw Chrome data)
     */
    expect(task.id).toMatch(/^task:/)
    expect(task.workspaceId).toBe(workspace.id)
    expect(task.investigationId).toBe('inv-184')
    expect(task.label).toBe('POST /api/checkout returns 422 - currency field is required')
    expect(task.status).toBe('open')
    expect(task.sourceLocations).toHaveLength(1)
    expect(task.sourceLocations[0].file).toBe('src/api/checkout.ts')
    expect(task.sourceLocations[0].line).toBe(45)
    expect(task.evidenceReferenceIds).toEqual([
      'replay:inv-184:obs:1',
      'replay:inv-184:obs:2',
      'exp:inv-184:find:1',
    ])

    /**
     * STEP 8: Agent/IDE discovers task from workspace
     */
    const discoveredTasks = await bridge.discoverTasks(workspace.id, 'open')

    expect(discoveredTasks).toHaveLength(1)
    expect(discoveredTasks[0].id).toBe(task.id)

    /**
     * STEP 9: Verify task properties contain development context
     */
    const discoveredTask = discoveredTasks[0]
    const context = discoveredTask.properties.context as any

    expect(context.pageUrl).toBe('http://localhost:3000/checkout')
    expect(context.targetRequest.method).toBe('POST')
    expect(context.targetRequest.url).toBe('http://localhost:3000/api/checkout')
    expect(context.replayId).toBe('replayrun:inv-184:1234567890')
    expect(context.counterfactuals).toHaveLength(1)
    expect(context.counterfactuals[0].variable).toBe('currency')

    /**
     * STEP 10: Verify key invariant
     * Same workspaceId means same development context
     */
    expect(workspace.id).toBe(discoveredTask.workspaceId)
    expect(workspace.id).toBe(envelope.workspaceId)

    // Both browser and agent operate on the same workspace
    // No data copying needed
  })

  it('should handle multiple investigations in same workspace', async () => {
    const bridge = new LocalDevelopmentBridge()
    const workspace = await bridge.getOrCreateWorkspace(
      'https://github.com/myapp/checkout',
      'main'
    )

    // Investigation 1: Checkout failure
    const envelope1 = {
      workspaceId: workspace.id,
      investigationId: 'inv-1',
      problem: {
        diagnosis: 'Checkout returns 422',
        confidence: 0.95,
      },
      reproduction: {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        errorCount: 1,
      },
      counterfactuals: [],
      evidence: {
        nodeIds: [],
      },
    }

    // Investigation 2: Payment processing failure
    const envelope2 = {
      workspaceId: workspace.id,
      investigationId: 'inv-2',
      problem: {
        diagnosis: 'Payment processor returns timeout',
        confidence: 0.92,
      },
      reproduction: {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/payment',
        },
        status: 504,
        errorCount: 1,
      },
      counterfactuals: [],
      evidence: {
        nodeIds: [],
      },
    }

    const task1 = await bridge.publishInvestigation(workspace.id, envelope1)
    const task2 = await bridge.publishInvestigation(workspace.id, envelope2)

    const tasks = await bridge.discoverTasks(workspace.id)

    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => t.investigationId)).toContain('inv-1')
    expect(tasks.map((t) => t.investigationId)).toContain('inv-2')

    // Both tasks live in same workspace
    expect(task1.workspaceId).toBe(workspace.id)
    expect(task2.workspaceId).toBe(workspace.id)
  })

  it('should preserve evidence reference IDs for future detailed inspection', async () => {
    const bridge = new LocalDevelopmentBridge()
    const workspace = await bridge.getOrCreateWorkspace(
      'https://github.com/myapp/repo',
      'main'
    )

    const envelope = {
      workspaceId: workspace.id,
      investigationId: 'inv-123',
      problem: {
        diagnosis: 'Test issue',
        confidence: 0.9,
      },
      reproduction: {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/test',
        },
        status: 500,
        errorCount: 1,
      },
      counterfactuals: [],
      evidence: {
        // These are FeltDB node IDs the agent can later use for detailed inspection
        nodeIds: [
          'investigation:inv-123',
          'replay:inv-123:1234567890',
          'observation:nav:1',
          'observation:click:2',
          'finding:currency:isolates',
        ],
      },
    }

    const task = await bridge.publishInvestigation(workspace.id, envelope)

    // Agent can reference these IDs if it needs to inspect full evidence graph
    expect(task.evidenceReferenceIds).toEqual([
      'investigation:inv-123',
      'replay:inv-123:1234567890',
      'observation:nav:1',
      'observation:click:2',
      'finding:currency:isolates',
    ])

    // But agent doesn't need them for basic task understanding
    // Everything needed for development decision is in the envelope
  })

  it('should establish pairing: agent and browser both reference same workspaceId', async () => {
    // Single bridge instance (simulating shared FeltDB)
    const bridge = new LocalDevelopmentBridge()

    // Browser creates workspace
    const browserWorkspace = await bridge.getOrCreateWorkspace(
      'https://github.com/myapp/checkout',
      'dev',
      'chrome-session-456'
    )

    // Agent queries same workspace (same bridge, so same ID)
    const agentWorkspace = await bridge.getOrCreateWorkspace(
      'https://github.com/myapp/checkout',
      'dev'
    )

    // Same workspace ID means they're participating in same development context
    expect(browserWorkspace.id).toBe(agentWorkspace.id)

    // Browser publishes investigation
    const envelope = {
      workspaceId: browserWorkspace.id,
      investigationId: 'inv-test',
      problem: {
        diagnosis: 'Currency validation failed',
        confidence: 0.94,
      },
      reproduction: {
        targetRequest: {
          method: 'POST',
          url: 'http://localhost:3000/api/checkout',
        },
        status: 422,
        errorCount: 1,
      },
      counterfactuals: [],
      evidence: {
        nodeIds: [],
      },
    }

    await bridge.publishInvestigation(browserWorkspace.id, envelope)

    // Agent discovers same task
    const tasks = await bridge.discoverTasks(agentWorkspace.id)

    expect(tasks).toHaveLength(1)
    expect(tasks[0].investigationId).toBe('inv-test')

    // Verification: same workspace ID established the pairing
    expect(browserWorkspace.id).toBe(agentWorkspace.id)
    expect(tasks[0].workspaceId).toBe(browserWorkspace.id)
  })
})
