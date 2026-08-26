/**
 * Verification Panel
 * Shows verification results with before/after comparison
 */

import React from 'react'
import type { VerificationResult, CodeChange, VisualSelection } from '@feltdb/core/workspace'

interface VerificationPanelProps {
  result: VerificationResult
  selection: VisualSelection | null
  change: CodeChange | null
  onReset: () => void
}

export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  result,
  selection,
  change,
  onReset,
}) => {
  const confidencePercent = Math.round((result.confidence ?? 0) * 100)

  return (
    <div className="verification-panel">
      <div className="verification-header">
        <h3 className={`status ${result.status === 'FIXED' ? 'verified' : 'failed'}`}>
          {result.status === 'FIXED' ? '✓ FIX VERIFIED' : '✗ Verification Failed'}
        </h3>
        <p className="confidence">Confidence: {confidencePercent}%</p>
      </div>

      <div className="comparison">
        <div className="column before">
          <h4>Before</h4>
          {selection && (
            <div className="metrics">
              <div className="metric-item">
                <span className="metric-label">Width</span>
                <span className="metric-value">{selection.boundingBox.width}px</span>
              </div>
              <div className="metric-item">
                <span className="metric-label">Height</span>
                <span className="metric-value">{selection.boundingBox.height}px</span>
              </div>
              <div className="metric-item">
                <span className="metric-label">Text</span>
                <span className="metric-value">{selection.textContent}</span>
              </div>
            </div>
          )}
        </div>

        <div className="arrow">→</div>

        <div className="column after">
          <h4>After</h4>
          {change && (
            <div className="metrics">
              <div className="metric-item">
                <span className="metric-label">Change</span>
                <span className="metric-value">{change.description}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {result.evidence && result.evidence.length > 0 && (
        <div className="evidence-section">
          <h4>Evidence</h4>
          <ul className="evidence-list">
            {result.evidence.map((item, index) => (
              <li key={index} className="evidence-item">
                <span className="evidence-type">{item.type || 'measurement'}</span>
                <span className="evidence-value">{item.metric}: verified</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="actions">
        <button className="primary reset-button" onClick={onReset}>
          New Selection
        </button>
      </div>

      <style>{`
        .verification-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, transparent 100%);
          border-radius: 8px;
          border: 1px solid var(--color-border);
        }

        .verification-header {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .verification-header h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
        }

        .verification-header h3.verified {
          color: #10b981;
        }

        .verification-header h3.failed {
          color: #ef4444;
        }

        .confidence {
          margin: 0;
          font-size: 12px;
          color: var(--color-text-secondary);
          font-weight: 500;
        }

        .comparison {
          display: flex;
          justify-content: space-between;
          align-items: stretch;
          gap: 12px;
        }

        .column {
          flex: 1;
          padding: 12px;
          background: var(--color-background);
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .column h4 {
          margin: 0;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }

        .before {
          border-left: 3px solid #94a3b8;
        }

        .after {
          border-left: 3px solid #10b981;
        }

        .arrow {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          font-weight: 600;
          color: var(--color-text-secondary);
          min-width: 40px;
        }

        .metrics {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
        }

        .metric-item {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }

        .metric-label {
          font-weight: 500;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.5px;
        }

        .metric-value {
          font-weight: 600;
          color: var(--color-text);
          text-align: right;
        }

        .evidence-section {
          padding: 12px;
          background: var(--color-background);
          border-radius: 6px;
        }

        .evidence-section h4 {
          margin: 0 0 8px 0;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }

        .evidence-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
        }

        .evidence-item {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          padding: 4px 0;
        }

        .evidence-type {
          font-weight: 500;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.5px;
        }

        .evidence-value {
          color: var(--color-text);
        }

        .actions {
          display: flex;
          gap: 8px;
        }

        .reset-button {
          flex: 1;
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

        .reset-button:hover {
          background: #059669;
        }
      `}</style>
    </div>
  )
}
