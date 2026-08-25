/**
 * Replay Panel: Minimal UI for replay results
 *
 * Shows:
 * - Replay status (REPRODUCED, PARTIAL, NOT_REPRODUCED)
 * - Confidence score
 * - Observation checklist
 * - Link to evidence inspector
 */

import React, { useState } from 'react'
import type { ReplayRun } from '../lib/replayContract'
import { formatReplayStatus } from '../lib/replayFeltDB'
import '../styles/ReplayPanel.css'

interface ReplayPanelProps {
  run: ReplayRun
  onInspectEvidence?: () => void
}

export const ReplayPanel: React.FC<ReplayPanelProps> = ({ run, onInspectEvidence }) => {
  const [expanded, setExpanded] = useState(false)
  const status = formatReplayStatus(run.outcome.status, run.outcome.confidence)
  const confidencePercent = Math.round(run.outcome.confidence * 100)
  const successCount = run.observations.filter((o) => o.success).length

  return (
    <div className="replay-panel">
      <div className="replay-header">
        <div className="replay-status">
          <span className="replay-icon" style={{ color: status.color }}>
            {status.icon}
          </span>
          <div className="replay-title">
            <div className="replay-id">
              REPLAY #{run.id.split(':')[2]?.slice(0, 6) || 'unknown'}
            </div>
            <div className="replay-result" style={{ color: status.color }}>
              {status.text}
            </div>
          </div>
        </div>

        <div className="replay-stats">
          <div className="replay-confidence">
            <div className="confidence-value">{confidencePercent}%</div>
            <div className="confidence-label">confidence</div>
          </div>

          <div className="replay-count">
            <div className="count-value">{successCount}/{run.observations.length}</div>
            <div className="count-label">observations</div>
          </div>
        </div>

        <button
          className="replay-toggle"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Collapse observations' : 'Expand observations'}
        >
          {expanded ? '▼' : '▶'}
        </button>
      </div>

      {expanded && (
        <div className="replay-observations">
          <div className="observations-list">
            {run.observations.map((obs, idx) => (
              <div key={idx} className={`observation-item observation-${obs.type}`}>
                <span className={`observation-icon ${obs.success ? 'success' : 'failure'}`}>
                  {obs.success ? '✓' : '✗'}
                </span>
                <div className="observation-content">
                  <div className="observation-type">{obs.type}</div>
                  <div className="observation-description">{obs.description}</div>
                </div>
              </div>
            ))}
          </div>

          {onInspectEvidence && (
            <button className="replay-inspect-btn" onClick={onInspectEvidence}>
              🔍 Inspect Evidence Chain
            </button>
          )}

          <div className="replay-footer">
            <div className="replay-metadata">
              <span>Duration: {run.durationMs}ms</span>
              <span>Captured: {new Date(run.completedAt).toLocaleTimeString()}</span>
            </div>
            <div className="replay-notes">{run.outcome.notes}</div>
          </div>
        </div>
      )}
    </div>
  )
}
