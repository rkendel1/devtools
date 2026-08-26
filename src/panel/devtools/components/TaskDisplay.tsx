/**
 * Task Display
 * Shows task progress: waiting → change detected → verifying → verified
 */

import React from 'react'
import type { CodeChange } from '@feltdb/core/workspace'

type PanelPhase = 'waiting' | 'change_detected' | 'verifying'

interface TaskDisplayProps {
  task: any
  phase: PanelPhase
  detectedChange: CodeChange | null
  onVerify: () => void
}

export const TaskDisplay: React.FC<TaskDisplayProps> = ({
  task,
  phase,
  detectedChange,
  onVerify,
}) => {
  const steps = [
    { id: 'sent', label: 'Sent to agent', done: phase !== 'waiting' },
    { id: 'changed', label: 'Agent changed code', done: phase === 'change_detected' || phase === 'verifying' },
    { id: 'verifying', label: 'Browser verifying', done: phase === 'verifying' },
  ]

  return (
    <div className="task-display">
      <div className="task-header">
        <h3>Task #{task.id?.split(':')[1]?.slice(-4) || 'NEW'}</h3>
        <span className={`status-badge ${phase}`}>
          {phase === 'waiting' && '⏳ Waiting'}
          {phase === 'change_detected' && '✓ Changed'}
          {phase === 'verifying' && '⟳ Verifying'}
        </span>
      </div>

      <div className="task-steps">
        {steps.map((step, index) => (
          <div key={step.id} className={`step ${step.done ? 'done' : ''}`}>
            <div className="step-marker">
              {step.done ? '✓' : index === 0 ? '✓' : '○'}
            </div>
            <div className="step-label">{step.label}</div>
            {index < steps.length - 1 && <div className={`step-line ${step.done ? 'done' : ''}`} />}
          </div>
        ))}
      </div>

      {detectedChange && (
        <div className="change-section">
          <h4>Agent Change</h4>
          <div className="change-details">
            <div className="file-path">
              <span className="label">File</span>
              <code>{detectedChange.filePath}</code>
            </div>

            <div className="line-range">
              <span className="label">Lines</span>
              <span>{detectedChange.lineStart}-{detectedChange.lineEnd}</span>
            </div>

            <div className="description">
              <span className="label">Change</span>
              <p>{detectedChange.description}</p>
            </div>
          </div>
        </div>
      )}

      {phase === 'change_detected' && (
        <div className="verify-section">
          <p className="info">Code has been changed. Ready to verify the result?</p>
          <button className="primary verify-button" onClick={onVerify}>
            Verify Change
          </button>
        </div>
      )}

      <style>{`
        .task-display {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, transparent 100%);
          border-radius: 8px;
          border: 1px solid var(--color-border);
        }

        .task-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .task-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--color-text);
        }

        .status-badge {
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }

        .status-badge.waiting {
          background: rgba(59, 130, 246, 0.2);
          color: #3b82f6;
        }

        .status-badge.change_detected {
          background: rgba(16, 185, 129, 0.2);
          color: #10b981;
        }

        .status-badge.verifying {
          background: rgba(168, 85, 247, 0.2);
          color: #a855f7;
        }

        .task-steps {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .step {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 13px;
          color: var(--color-text-secondary);
        }

        .step.done {
          color: #10b981;
          font-weight: 500;
        }

        .step-marker {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--color-background);
          font-size: 12px;
          font-weight: 600;
        }

        .step.done .step-marker {
          background: #10b981;
          color: white;
        }

        .step-label {
          flex: 1;
        }

        .step-line {
          position: absolute;
          left: 36px;
          width: 2px;
          height: 8px;
          background: var(--color-border);
          margin-left: -50px;
          margin-top: 24px;
        }

        .step-line.done {
          background: #10b981;
        }

        .change-section {
          padding: 12px;
          background: var(--color-background);
          border-radius: 6px;
          border-left: 3px solid #3b82f6;
        }

        .change-section h4 {
          margin: 0 0 8px 0;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }

        .change-details {
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 12px;
        }

        .file-path,
        .line-range,
        .description {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .file-path .label,
        .line-range .label,
        .description .label {
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.5px;
        }

        .file-path code {
          font-family: monospace;
          font-size: 11px;
          color: #3b82f6;
        }

        .description p {
          margin: 0;
          color: var(--color-text);
          line-height: 1.4;
        }

        .verify-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 12px;
          background: rgba(16, 185, 129, 0.1);
          border-radius: 6px;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }

        .verify-section .info {
          margin: 0;
          font-size: 13px;
          color: var(--color-text);
        }

        .verify-button {
          padding: 8px 16px;
          background: #10b981;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .verify-button:hover {
          background: #059669;
        }
      `}</style>
    </div>
  )
}
