import { describe, it, expect } from 'vitest'
import type { DevelopmentWorkspace, DevelopmentTask, InvestigationContextEnvelope } from './developmentWorkspace'
import { createWorkspaceId, createTaskId } from './developmentWorkspace'
import { LocalDevelopmentBridge } from './developmentBridge'
import { extractInvestigationEnvelope, summarizeEnvelope } from './investigationEnvelope'
import type { Investigation, ReplayRunReference, CounterfactualFinding } from './developmentWorkspace'

describe('developmentWorkspace', () => {
  describe('DevelopmentBridge', () => {
    it('should create and retrieve workspace', async () => {
      const bridge = new LocalDevelopmentBridge()

      const workspace = await bridge.getOrCreateWorkspace(
        'https://github.com/myapp/repo',
        'main',
        'session-123'
      )

      expect(workspace.id).toMatch(/^workspace:/)
      expect(workspace.repositoryUrl).toBe('https://github.com/myapp/repo')
      expect(workspace.branch).toBe('main')
      expect(workspace.browserSessionId).toBe('session-123')
    })

    it('should reuse existing workspace for same repo/branch', async () => {
      const bridge = new LocalDevelopmentBridge()

      const ws1 = await bridge.getOrCreateWorkspace(
        'https://github.com/myapp/repo',
        'main'
      )

      const ws2 = await bridge.getOrCreateWorkspace(
        'https://github.com/myapp/repo',
        'main'
      )

      expect(ws1.id).toBe(ws2.id)
    })

    it('should publish investigation as development task', async () => {
      const bridge = new LocalDevelopmentBridge()
      const workspace = await bridge.getOrCreateWorkspace(
        'https://github.com/myapp/repo',
        'main'
      )

      const envelope: InvestigationContextEnvelope = {
        workspaceId: workspace.id,
        investigationId: 'inv-123',
        problem: {
          diagnosis: 'POST /api/checkout returns 422',
          confidence: 0.96,
          sourceLocations: [
            {
              file: 'src/cart/checkout.ts',
              line: 184,
            },
          ],
        },
        reproduction: {
          pageUrl: 'http://localhost:3000',
          targetRequest: {
            method: 'POST',
            url: 'http://localhost:3000/api/checkout',
          },
          status: 422,
          errorCount: 1,
          reproductionSteps: [
            'Navigate to checkout',
            'Click checkout button',
          ],
        },
        replay: {
          id: 'replay:123',
          status: 'REPRODUCED',
          confidence: 0.9,
          observationCount: 4,
        },
        counterfactuals: [
          {
            id: 'exp:123',
            variable: 'currency',
            status: 'ISOLATES_CAUSE',
            confidence: 0.95,
            reasoning: 'Changing currency from null to USD changed HTTP status from 422 to 200',
            baselineOutcome: 422,
            experimentOutcome: 200,
          },
        ],
        evidence: {
          nodeIds: ['node:1', 'node:2', 'node:3'],
        },
      }

      const task = await bridge.publishInvestigation(workspace.id, envelope)

      expect(task.workspaceId).toBe(workspace.id)
      expect(task.investigationId).toBe('inv-123')
      expect(task.label).toBe('POST /api/checkout returns 422')
      expect(task.status).toBe('open')
      expect(task.sourceLocations).toHaveLength(1)
      expect(task.sourceLocations[0].file).toBe('src/cart/checkout.ts')
    })

    it('should discover tasks for workspace', async () => {
      const bridge = new LocalDevelopmentBridge()
      const workspace = await bridge.getOrCreateWorkspace(
        'https://github.com/myapp/repo',
        'main'
      )

      const envelope: InvestigationContextEnvelope = {
        workspaceId: workspace.id,
        investigationId: 'inv-123',
        problem: {
          diagnosis: 'Database connection failed',
          confidence: 0.92,
        },
        reproduction: {
          targetRequest: {
            method: 'GET',
            url: 'http://localhost:3000/api/data',
          },
          status: 500,
          errorCount: 1,
        },
        counterfactuals: [],
        evidence: {
          nodeIds: [],
        },
      }

      await bridge.publishInvestigation(workspace.id, envelope)

      const tasks = await bridge.discoverTasks(workspace.id)

      expect(tasks).toHaveLength(1)
      expect(tasks[0].investigationId).toBe('inv-123')
    })

    it('should filter tasks by status', async () => {
      const bridge = new LocalDevelopmentBridge()
      const workspace = await bridge.getOrCreateWorkspace(
        'https://github.com/myapp/repo',
        'main'
      )

      const envelope: InvestigationContextEnvelope = {
        workspaceId: workspace.id,
        investigationId: 'inv-123',
        problem: {
          diagnosis: 'Test issue',
          confidence: 0.9,
        },
        reproduction: {
          targetRequest: {
            method: 'GET',
            url: 'http://localhost:3000',
          },
          status: 500,
          errorCount: 1,
        },
        counterfactuals: [],
        evidence: {
          nodeIds: [],
        },
      }

      const task1 = await bridge.publishInvestigation(workspace.id, envelope)

      await bridge.updateTaskStatus(task1.id, 'in_progress')

      const openTasks = await bridge.discoverTasks(workspace.id, 'open')
      const inProgressTasks = await bridge.discoverTasks(workspace.id, 'in_progress')

      expect(openTasks).toHaveLength(0)
      expect(inProgressTasks).toHaveLength(1)
    })

    it('should notify on task discovery', async () => {
      const bridge = new LocalDevelopmentBridge()
      let discoveredTask: DevelopmentTask | null = null

      bridge.onDiscoveredTask((task) => {
        discoveredTask = task
      })

      const workspace = await bridge.getOrCreateWorkspace(
        'https://github.com/myapp/repo',
        'main'
      )

      const envelope: InvestigationContextEnvelope = {
        workspaceId: workspace.id,
        investigationId: 'inv-123',
        problem: {
          diagnosis: 'Test issue',
          confidence: 0.9,
        },
        reproduction: {
          targetRequest: {
            method: 'GET',
            url: 'http://localhost:3000',
          },
          status: 500,
          errorCount: 1,
        },
        counterfactuals: [],
        evidence: {
          nodeIds: [],
        },
      }

      await bridge.publishInvestigation(workspace.id, envelope)

      expect(discoveredTask).not.toBeNull()
      expect(discoveredTask?.investigationId).toBe('inv-123')
    })
  })

  describe('Investigation Envelope', () => {
    it('should extract clean envelope from investigation', () => {
      const investigation: Investigation = {
        id: 'inv-123',
        workspaceId: 'workspace-123',
        kind: 'investigation',
        label: 'Test failure',
        diagnosis: 'Currency field is required',
        confidence: 0.96,
        observedAt: 1234567890,
        createdAt: 1234567890,
        properties: {
          pageUrl: 'http://localhost:3000',
          targetRequest: {
            method: 'POST',
            url: 'http://localhost:3000/api/checkout',
          },
          status: 422,
          errorCount: 1,
          reproductionSteps: ['Click checkout'],
        },
      }

      const envelope = extractInvestigationEnvelope('workspace-123', {
        investigation,
        sourceLocations: [
          {
            file: 'src/checkout.ts',
            line: 50,
          },
        ],
        evidenceNodeIds: ['node-1', 'node-2'],
      })

      expect(envelope.investigationId).toBe('inv-123')
      expect(envelope.problem.diagnosis).toBe('Currency field is required')
      expect(envelope.problem.confidence).toBe(0.96)
      expect(envelope.reproduction.status).toBe(422)
      expect(envelope.reproduction.errorCount).toBe(1)
      expect(envelope.evidence.nodeIds).toEqual(['node-1', 'node-2'])
    })

    it('should include replay confirmation in envelope', () => {
      const investigation: Investigation = {
        id: 'inv-123',
        workspaceId: 'workspace-123',
        kind: 'investigation',
        label: 'Test',
        diagnosis: 'Test issue',
        confidence: 0.9,
        observedAt: 1234567890,
        createdAt: 1234567890,
        properties: {
          status: 422,
          errorCount: 1,
        },
      }

      const replayRun = {
        id: 'replay:123:abc',
        outcome: {
          status: 'REPRODUCED' as const,
          confidence: 0.9,
          signature: {} as any,
          unsupportedCapabilities: [],
          notes: 'Test',
        },
        observations: [
          { timestamp: 0, type: 'navigation', description: 'Nav', success: true },
          { timestamp: 1, type: 'interaction', description: 'Click', success: true },
          { timestamp: 2, type: 'target_request', description: 'Request', success: true },
          { timestamp: 3, type: 'runtime_error', description: 'Error', success: true },
        ],
      } as any

      const envelope = extractInvestigationEnvelope('workspace-123', {
        investigation,
        replayRun,
      })

      expect(envelope.replay).toBeDefined()
      expect(envelope.replay?.status).toBe('REPRODUCED')
      expect(envelope.replay?.confidence).toBe(0.9)
      expect(envelope.replay?.observationCount).toBe(4)
    })

    it('should include counterfactual findings in envelope', () => {
      const investigation: Investigation = {
        id: 'inv-123',
        workspaceId: 'workspace-123',
        kind: 'investigation',
        label: 'Test',
        diagnosis: 'Test issue',
        confidence: 0.9,
        observedAt: 1234567890,
        createdAt: 1234567890,
        properties: {
          status: 422,
          errorCount: 1,
        },
      }

      const findings: CounterfactualFinding[] = [
        {
          id: 'exp-123',
          variable: 'currency',
          status: 'ISOLATES_CAUSE',
          confidence: 0.95,
          reasoning: 'Changing currency fixed the error',
          baselineOutcome: 422,
          experimentOutcome: 200,
        },
      ]

      const envelope = extractInvestigationEnvelope('workspace-123', {
        investigation,
        counterfactualFindings: findings,
      })

      expect(envelope.counterfactuals).toHaveLength(1)
      expect(envelope.counterfactuals[0].variable).toBe('currency')
      expect(envelope.counterfactuals[0].status).toBe('ISOLATES_CAUSE')
    })

    it('should generate human-readable summary', () => {
      const envelope: InvestigationContextEnvelope = {
        workspaceId: 'workspace-123',
        investigationId: 'inv-123',
        problem: {
          diagnosis: 'Currency field is required',
          confidence: 0.96,
          sourceLocations: [
            {
              file: 'src/checkout.ts',
              line: 50,
            },
          ],
        },
        reproduction: {
          pageUrl: 'http://localhost:3000',
          targetRequest: {
            method: 'POST',
            url: 'http://localhost:3000/api/checkout',
          },
          status: 422,
          errorCount: 1,
        },
        replay: {
          id: 'replay:123',
          status: 'REPRODUCED',
          confidence: 0.9,
          observationCount: 4,
        },
        counterfactuals: [
          {
            id: 'exp-123',
            variable: 'currency',
            status: 'ISOLATES_CAUSE',
            confidence: 0.95,
            reasoning: 'Changing currency from null to USD fixed the error',
            baselineOutcome: 422,
            experimentOutcome: 200,
          },
        ],
        evidence: {
          nodeIds: ['node-1'],
        },
      }

      const summary = summarizeEnvelope(envelope)

      expect(summary).toContain('Task: Currency field is required')
      expect(summary).toContain('Workspace: workspace-123')
      expect(summary).toContain('Investigation: inv-123')
      expect(summary).toContain('src/checkout.ts:50')
      expect(summary).toContain('REPRODUCED')
      expect(summary).toContain('currency')
      expect(summary).toContain('95%')
    })
  })
})
