/**
 * Development Workspace Panel
 *
 * DevTools interface for Runtime Investigator as a FeltDB Development Workspace client.
 * Shows workspace status, connected clients, and enables Select → Describe → Change → Verify workflow.
 *
 * Now uses @feltdb/development-runtime to handle browser interaction.
 * DevTools orchestrates: workspace coordination + user experience.
 * Runtime handles: browser interaction (select, verify).
 */

import React, { useEffect, useState } from 'react'
import type { DevToolsWorkspaceStatus } from './workspaceClient'
import { DevToolsWorkspaceClient } from './workspaceClient'
import type { CodeChange, VerificationResult } from '@feltdb/core/workspace'
import type { VisualSelection } from '../../lib/developmentWorkspace'
import { DevelopmentRuntime, createChromiumAdapter } from '@feltdb/development-runtime'
import type { VerificationOutcome } from '@feltdb/development-runtime'
import { SelectionModeUI } from './components/SelectionModeUI'
import { TaskDisplay } from './components/TaskDisplay'
import { VerificationPanel } from './components/VerificationPanel'
import { WorkspaceStatusBar } from './components/WorkspaceStatusBar'
import { ProposalWorkspacePanel } from './ProposalWorkspacePanel'
import type { BridgeConnection } from '../../lib/proposalBridge'

interface WorkspacePanelProps {
  workspace: any // @feltdb/core workspace
  workspaceId: string
  projectName: string
  /** The shared workspace connection, reused for proposal repository context. */
  bridgeConnection?: BridgeConnection
  /** The proposal Studio currently has open, if any. */
  proposalId?: string
  onApproveProposal?: (proposal: import('../../lib/proposal').Proposal) => Promise<void>
}

type PanelPhase = 'idle' | 'selecting' | 'describing' | 'waiting' | 'change_detected' | 'verifying' | 'verified'

export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({
  workspace,
  workspaceId,
  projectName,
  bridgeConnection,
  proposalId,
  onApproveProposal,
}) => {
  const [client] = useState(() => new DevToolsWorkspaceClient())
  const [runtime] = useState(() => new DevelopmentRuntime({
    browserAdapter: createChromiumAdapter(),
  }))
  const [status, setStatus] = useState<DevToolsWorkspaceStatus>({ connected: false, clientsConnected: [] })
  const [phase, setPhase] = useState<PanelPhase>('idle')

  const [selection, setSelection] = useState<VisualSelection | null>(null)
  const [taskDescription, setTaskDescription] = useState('')
  const [currentTask, setCurrentTask] = useState<any>(null)
  const [detectedChange, setDetectedChange] = useState<CodeChange | null>(null)
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null)
  const [message, setMessage] = useState('Workspace initializing...')

  // Initialize workspace connection
  useEffect(() => {
    if (!workspace) {
      setMessage('No workspace available')
      return
    }

    void client.connect(workspace, { workspaceId, projectName }).then(() => {
      setStatus(client.getStatus())
      setMessage('Workspace connected')

      // Subscribe to changes
      client.subscribe('code_change', (change: CodeChange) => {
        if (change.taskId === currentTask?.id) {
          setDetectedChange(change)
          setPhase('change_detected')
          setMessage('Agent changed code - verifying...')
        }
      })

      client.subscribe('verification_result', (result: VerificationResult) => {
        if (result.taskId === currentTask?.id) {
          setVerificationResult(result)
          setPhase(result.status === 'fixed' ? 'verified' : 'idle')
          setMessage(result.status === 'fixed' ? '✓ FIX VERIFIED' : 'Verification failed')
        }
      })
    })

    return () => {
      client.disconnect()
      void runtime.disconnect()
    }
  }, [workspace, workspaceId, projectName, currentTask?.id, client, runtime])

  const handleSelectionCaptured = (sel: VisualSelection) => {
    setSelection(sel)
    setPhase('describing')
    setMessage('Element selected - describe what you want to change')
  }

  const handleTaskSubmit = () => {
    if (!selection || !taskDescription.trim()) {
      setMessage('Please select an element and describe the change')
      return
    }

    try {
      const task = {
        id: `task:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`,
        workspaceId,
        selectionId: selection.id,
        userInstruction: taskDescription,
        taskType: 'UI_CHANGE',
        status: 'open',
        createdAt: Date.now(),
        kind: 'selection_task' as const,
        properties: {},
      }

      client.publishSelectionTask(task)
      client.publishVisualSelection(selection)

      setCurrentTask(task)
      setPhase('waiting')
      setMessage('Task sent to agent - waiting for changes...')
    } catch (error) {
      setMessage(`Error publishing task: ${String(error)}`)
    }
  }

  const handleVerifyChange = async () => {
    if (!detectedChange || !selection) {
      setMessage('No change or selection to verify')
      return
    }

    setPhase('verifying')
    setMessage('Verifying change...')

    try {
      // Use DevelopmentRuntime to verify the change
      // Runtime handles: page readiness, element capture, metrics comparison
      const outcome: VerificationOutcome = await runtime.verify({
        selection: {
          elementQuery: selection.selector,
          boundingBox: selection.boundingBox,
          sourceHints: {
            sourceLocations: (selection.sourceHints || []).map((location) => ({
              ...location,
              line: location.line ?? 1,
              confidence: 'MEDIUM' as const,
            })),
          },
        },
        change: detectedChange,
      })

      // Convert runtime VerificationOutcome to workspace VerificationResult
      const result: VerificationResult = {
        id: `result:${Date.now()}`,
        workspaceId,
        taskId: currentTask.id,
        codeChangeId: detectedChange.id,
        status: outcome.status === 'FIXED' ? 'fixed' : outcome.status === 'REGRESSION' ? 'regressed' : 'unchanged',
        summary: outcome.status === 'FIXED' ? 'Fix verified' : 'Verification did not confirm the fix',
        originalOutcome: 200,
        newOutcome: 200,
        newErrors: outcome.status === 'REGRESSION' ? 1 : 0,
        createdAt: Date.now(),
      }

      client.publishVerificationResult(result)
      setVerificationResult(result)
      setPhase(outcome.status === 'FIXED' ? 'verified' : 'idle')
      setMessage(outcome.status === 'FIXED' ? '✓ FIX VERIFIED' : 'Verification failed')
    } catch (error) {
      setMessage(`Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setPhase('idle')
    }
  }

  const handleReset = () => {
    setPhase('idle')
    setSelection(null)
    setTaskDescription('')
    setCurrentTask(null)
    setDetectedChange(null)
    setVerificationResult(null)
    setMessage('Ready for new selection')
  }

  return (
    <div className="workspace-panel">
      <WorkspaceStatusBar
        status={status}
        projectName={projectName}
        message={message}
      />

      {bridgeConnection && proposalId && (
        <ProposalWorkspacePanel
          connection={bridgeConnection}
          proposalId={proposalId}
          onApprove={onApproveProposal}
        />
      )}

      <div className="panel-content">
        {phase === 'idle' && (
          <SelectionModeUI
            onSelectionCaptured={handleSelectionCaptured}
            runtime={runtime}
            workspaceId={workspaceId}
          />
        )}

        {phase === 'describing' && selection && (
          <div className="describe-section">
            <div className="selected-info">
              <h3>Selected: {selection.selector}</h3>
              <p>{selection.textContent}</p>
              <p className="metrics">
                {selection.boundingBox.width}×{selection.boundingBox.height}px
              </p>
            </div>

            <div className="describe-form">
              <label>What do you want to change?</label>
              <textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="e.g., Make this button smaller and change text to 'Order Now'"
                rows={3}
              />

              <div className="form-actions">
                <button
                  className="primary"
                  onClick={handleTaskSubmit}
                  disabled={!taskDescription.trim()}
                >
                  Send to Agent
                </button>
                <button
                  className="secondary"
                  onClick={handleReset}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {(phase === 'waiting' || phase === 'change_detected' || phase === 'verifying') && currentTask && (
          <TaskDisplay
            task={currentTask}
            phase={phase}
            detectedChange={detectedChange}
            onVerify={handleVerifyChange}
          />
        )}

        {phase === 'verified' && verificationResult && (
          <VerificationPanel
            result={verificationResult}
            selection={selection}
            change={detectedChange}
            onReset={handleReset}
          />
        )}
      </div>

      <style>{`
        .workspace-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--color-background);
          color: var(--color-text);
        }

        .panel-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .selected-info {
          padding: 12px;
          background: var(--color-background-secondary);
          border-radius: 6px;
          border-left: 3px solid var(--color-primary);
        }

        .selected-info h3 {
          margin: 0 0 4px 0;
          font-size: 14px;
          font-weight: 600;
          font-family: monospace;
        }

        .selected-info p {
          margin: 4px 0;
          font-size: 13px;
          color: var(--color-text-secondary);
        }

        .metrics {
          font-size: 12px;
          font-weight: 500 !important;
        }

        .describe-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .describe-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .describe-form label {
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }

        .describe-form textarea {
          padding: 8px;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          font-size: 13px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: var(--color-background);
          color: var(--color-text);
          resize: vertical;
        }

        .describe-form textarea:focus {
          outline: none;
          border-color: var(--color-primary);
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
        }

        .form-actions {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }

        .form-actions button {
          flex: 1;
          padding: 8px 12px;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .form-actions .primary {
          background: var(--color-primary);
          color: white;
        }

        .form-actions .primary:hover:not(:disabled) {
          background: var(--color-primary-hover);
        }

        .form-actions .primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .form-actions .secondary {
          background: var(--color-border);
          color: var(--color-text);
        }

        .form-actions .secondary:hover {
          background: var(--color-border-hover);
        }
      `}</style>
    </div>
  )
}
