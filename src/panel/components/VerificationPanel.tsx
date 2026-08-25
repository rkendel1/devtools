import { useState } from 'react'
import { compareInvestigations, formatVerificationSummary, getVerificationStatusColor, getVerificationStatusIcon } from '../../lib/verificationLoop'
import type { InvestigationRecord } from '../../lib/types'
import type { VerificationSnapshot } from '../../lib/verificationLoop'
import '../styles/VerificationPanel.css'

export function VerificationPanel({ before, after }: { before: InvestigationRecord; after: InvestigationRecord | null }) {
  const [expanded, setExpanded] = useState(false)
  if (!after) return null

  const verification = compareInvestigations(before, after)
  const statusColor = getVerificationStatusColor(verification.status)
  const statusIcon = getVerificationStatusIcon(verification.status)

  return (
    <div className="verification-panel">
      <div className="verification-header" onClick={() => setExpanded(!expanded)}>
        <div className="verification-summary">
          <span className="status-icon" style={{ color: statusColor }}>
            {statusIcon}
          </span>
          <div className="summary-text">
            <h3>Verification Results</h3>
            <p>{verification.changes.length > 0 ? `${verification.changes.length} changes detected` : 'No observable changes'}</p>
          </div>
        </div>
        <div className="verification-status" style={{ borderColor: statusColor, color: statusColor }}>
          <span className="status-label">{verification.status.toUpperCase()}</span>
        </div>
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="verification-details">
          <div className="comparison-grid">
            <div className="before-column">
              <h4>Before Fix</h4>
              <div className="comparison-value">
                <span className="label">Status</span>
                <span className={`status-badge ${before.graph.request.status >= 400 ? 'error' : 'success'}`}>
                  {before.graph.request.status} {before.graph.response.statusText}
                </span>
              </div>
              <div className="comparison-value">
                <span className="label">Diagnosis</span>
                <p>{before.result.diagnosis}</p>
              </div>
              <div className="comparison-value">
                <span className="label">Confidence</span>
                <span className="confidence">{Math.round(before.result.confidence * 100)}%</span>
              </div>
              <div className="comparison-value">
                <span className="label">Errors</span>
                <span className="error-count">
                  {before.graph.relatedEvents.filter((e) => e.type === 'runtime.error' || e.type === 'console.error').length}
                </span>
              </div>
            </div>

            <div className="after-column">
              <h4>After Fix</h4>
              <div className="comparison-value">
                <span className="label">Status</span>
                <span className={`status-badge ${after.graph.request.status >= 400 ? 'error' : 'success'}`}>
                  {after.graph.request.status} {after.graph.response.statusText}
                </span>
              </div>
              <div className="comparison-value">
                <span className="label">Diagnosis</span>
                <p>{after.result.diagnosis}</p>
              </div>
              <div className="comparison-value">
                <span className="label">Confidence</span>
                <span className="confidence">{Math.round(after.result.confidence * 100)}%</span>
              </div>
              <div className="comparison-value">
                <span className="label">Errors</span>
                <span className="error-count">
                  {after.graph.relatedEvents.filter((e) => e.type === 'runtime.error' || e.type === 'console.error').length}
                </span>
              </div>
            </div>
          </div>

          {verification.changes.length > 0 && (
            <div className="changes-section">
              <h4>Changes Detected</h4>
              <div className="changes-list">
                {verification.changes.map((change, index) => {
                  const icon =
                    change.severity === 'success' ? '✓' : change.severity === 'warning' ? '⚠' : '✗'
                  return (
                    <div key={index} className={`change-item ${change.severity}`}>
                      <div className="change-header">
                        <span className="change-icon">{icon}</span>
                        <span className="change-type">{change.type}</span>
                        <span className="change-description">{change.description}</span>
                      </div>
                      {change.before !== null && change.after !== null && (
                        <div className="change-values">
                          <span className="before-value">Before: {change.before}</span>
                          <span className="arrow">→</span>
                          <span className="after-value">After: {change.after}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="summary-section">
            <h4>Summary</h4>
            <pre className="summary-text">{formatVerificationSummary(verification)}</pre>
          </div>

          <div className="verification-actions">
            {verification.status === 'fixed' && (
              <div className="success-message">
                <p>✓ Original failure resolved. The fix appears to be working correctly.</p>
              </div>
            )}
            {verification.status === 'regressed' && (
              <div className="danger-message">
                <p>✗ New or continued failures detected. The fix may not be complete.</p>
              </div>
            )}
            {verification.status === 'changed' && (
              <div className="warning-message">
                <p>~ Behavior changed, but the original issue may not be fully resolved. Review the changes above.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
