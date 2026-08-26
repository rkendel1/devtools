/**
 * Workspace Status Bar
 * Shows connection state, workspace ID, project name, and connected clients
 */

import React, { useState } from 'react'
import type { DevToolsWorkspaceStatus } from '../workspaceClient'

interface WorkspaceStatusBarProps {
  status: DevToolsWorkspaceStatus
  projectName: string
  message: string
}

export const WorkspaceStatusBar: React.FC<WorkspaceStatusBarProps> = ({
  status,
  projectName,
  message,
}) => {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="workspace-status-bar">
      <div className="status-header">
        <div className="status-info">
          <span className={`status-dot ${status.connected ? 'connected' : 'disconnected'}`}>
            {status.connected ? '●' : '○'}
          </span>
          <div className="project-info">
            <h2>{projectName}</h2>
            <p className="status-message">{message}</p>
          </div>
        </div>

        {status.connected && (
          <button
            className="show-details"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? '▼' : '▶'} Details
          </button>
        )}
      </div>

      {showDetails && status.connected && (
        <div className="status-details">
          <div className="detail-row">
            <span className="label">Workspace ID</span>
            <code>{status.workspaceId?.slice(0, 16)}...</code>
          </div>

          <div className="detail-row">
            <span className="label">Connected Clients</span>
            <span className="client-count">{status.clientsConnected.length}</span>
          </div>

          {status.clientsConnected.length > 0 && (
            <div className="clients-list">
              {status.clientsConnected.map((client) => (
                <div key={client.id} className="client-item">
                  <span className="client-kind">
                    {client.kind === 'chrome' && '🌐'}
                    {client.kind === 'ide' && '💻'}
                    {client.kind === 'agent' && '🤖'}
                    {client.kind === 'cli' && '⌨️'}
                  </span>
                  <span className="client-name">
                    {client.kind === 'chrome' && 'Chrome / Runtime Investigator'}
                    {client.kind === 'ide' && 'VS Code / FeltDB Client'}
                    {client.kind === 'agent' && 'Agent / Claude Code'}
                    {client.kind === 'cli' && 'CLI / Dev Tools'}
                  </span>
                  <span className="client-time">
                    {new Date(client.connectedAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          {status.lastEvent && (
            <div className="last-event">
              <span className="label">Last event</span>
              <span className="event-info">
                {status.lastEvent.type} at {new Date(status.lastEvent.timestamp).toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>
      )}

      <style>{`
        .workspace-status-bar {
          border-bottom: 1px solid var(--color-border);
          padding: 12px 16px;
          background: var(--color-background-secondary);
        }

        .status-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .status-info {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          min-width: 0;
        }

        .status-dot {
          font-size: 16px;
          line-height: 1;
          flex-shrink: 0;
        }

        .status-dot.connected {
          color: #10b981;
        }

        .status-dot.disconnected {
          color: var(--color-text-secondary);
        }

        .project-info {
          min-width: 0;
        }

        .project-info h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text);
        }

        .status-message {
          margin: 2px 0 0 0;
          font-size: 12px;
          color: var(--color-text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .show-details {
          padding: 4px 8px;
          background: transparent;
          border: 1px solid var(--color-border);
          border-radius: 3px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          color: var(--color-text-secondary);
          white-space: nowrap;
        }

        .show-details:hover {
          background: var(--color-background);
          color: var(--color-text);
        }

        .status-details {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 12px;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }

        .detail-row .label {
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.5px;
        }

        .detail-row code {
          font-family: monospace;
          font-size: 11px;
          color: var(--color-text);
        }

        .client-count {
          font-weight: 600;
          color: var(--color-text);
        }

        .clients-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 4px;
        }

        .client-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          background: var(--color-background);
          border-radius: 4px;
        }

        .client-kind {
          font-size: 14px;
        }

        .client-name {
          flex: 1;
          color: var(--color-text);
          font-weight: 500;
        }

        .client-time {
          color: var(--color-text-secondary);
          font-size: 11px;
        }

        .last-event {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          padding-top: 8px;
          border-top: 1px solid var(--color-border);
        }

        .last-event .label {
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.5px;
        }

        .event-info {
          color: var(--color-text);
          font-size: 12px;
        }
      `}</style>
    </div>
  )
}
