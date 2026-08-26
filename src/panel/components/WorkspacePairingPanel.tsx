/**
 * Workspace Pairing Panel
 *
 * UI for connecting Chrome extension to @feltdb/core Development Workspace
 * Shows connection status, workspace details, and connected clients
 */

import React, { useState } from 'react'
import type { WorkspaceStatus } from '../../lib/workspaceConnection'

interface WorkspacePairingPanelProps {
  onConnect?: (workspaceId: string, projectName: string) => void
  onDisconnect?: () => void
  status?: WorkspaceStatus
  isLoading?: boolean
}

export const WorkspacePairingPanel: React.FC<WorkspacePairingPanelProps> = ({
  onConnect,
  onDisconnect,
  status,
  isLoading = false,
}) => {
  const [showInput, setShowInput] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')

  const handleConnect = () => {
    if (projectName && workspaceId) {
      onConnect?.(workspaceId, projectName)
      setShowInput(false)
      setProjectName('')
      setWorkspaceId('')
    }
  }

  return (
    <div className="workspace-pairing-panel">
      <div className="panel-header">
        <h3>Development Workspace</h3>
      </div>

      {!status?.connected ? (
        <div className="connection-section">
          <div className="status-indicator disconnected">
            <span className="status-dot">○</span>
            <span>Not connected</span>
          </div>

          {!showInput ? (
            <button
              onClick={() => setShowInput(true)}
              className="connect-button primary"
              disabled={isLoading}
            >
              {isLoading ? 'Connecting...' : 'Connect Workspace'}
            </button>
          ) : (
            <div className="connect-form">
              <div className="form-group">
                <label>Project Name</label>
                <input
                  type="text"
                  placeholder="my-checkout-app"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              <div className="form-group">
                <label>Workspace ID</label>
                <input
                  type="text"
                  placeholder="ws_7f82a4c2..."
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              <div className="form-actions">
                <button
                  onClick={handleConnect}
                  className="button primary"
                  disabled={!projectName || !workspaceId || isLoading}
                >
                  {isLoading ? 'Connecting...' : 'Connect'}
                </button>
                <button
                  onClick={() => {
                    setShowInput(false)
                    setProjectName('')
                    setWorkspaceId('')
                  }}
                  className="button secondary"
                  disabled={isLoading}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="connected-section">
          <div className="status-indicator connected">
            <span className="status-dot">●</span>
            <span>Connected</span>
          </div>

          <div className="workspace-info">
            <div className="info-item">
              <label>Project</label>
              <span className="value">{status.projectName}</span>
            </div>

            <div className="info-item">
              <label>Workspace ID</label>
              <span className="value workspace-id">{status.workspaceId}</span>
            </div>
          </div>

          {status.clientsConnected && status.clientsConnected.length > 0 && (
            <div className="clients-section">
              <h4>Connected Clients</h4>
              <ul className="clients-list">
                {status.clientsConnected.map((client) => (
                  <li key={client.id} className="client-item">
                    <span className="client-kind">{client.kind}</span>
                    <span className="client-time">
                      {new Date(client.connectedAt).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={onDisconnect}
            className="disconnect-button"
            disabled={isLoading}
          >
            Disconnect
          </button>
        </div>
      )}

      <style>{`
        .workspace-pairing-panel {
          border-top: 1px solid var(--color-border);
          padding: 16px;
          background: var(--color-background-secondary);
        }

        .panel-header {
          margin-bottom: 12px;
        }

        .panel-header h3 {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 12px;
        }

        .status-dot {
          font-size: 14px;
          line-height: 1;
        }

        .status-indicator.connected {
          color: #10b981;
        }

        .status-indicator.disconnected {
          color: var(--color-text-secondary);
        }

        .connection-section,
        .connected-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .connect-button,
        .disconnect-button {
          padding: 8px 12px;
          border-radius: 4px;
          border: none;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .connect-button.primary {
          background: var(--color-primary);
          color: white;
        }

        .connect-button.primary:hover:not(:disabled) {
          background: var(--color-primary-hover);
        }

        .disconnect-button {
          background: var(--color-danger-light);
          color: var(--color-danger);
          align-self: flex-start;
        }

        .disconnect-button:hover:not(:disabled) {
          background: var(--color-danger);
          color: white;
        }

        .connect-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .form-group label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }

        .form-group input {
          padding: 6px 8px;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          font-size: 12px;
          background: var(--color-background);
          color: var(--color-text);
          font-family: monospace;
        }

        .form-group input:focus {
          outline: none;
          border-color: var(--color-primary);
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
        }

        .form-actions {
          display: flex;
          gap: 8px;
          margin-top: 4px;
        }

        .button {
          flex: 1;
          padding: 6px 12px;
          border-radius: 4px;
          border: none;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .button.primary {
          background: var(--color-primary);
          color: white;
        }

        .button.primary:hover:not(:disabled) {
          background: var(--color-primary-hover);
        }

        .button.secondary {
          background: var(--color-border);
          color: var(--color-text);
        }

        .button.secondary:hover:not(:disabled) {
          background: var(--color-border-hover);
        }

        .button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .workspace-info {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 8px;
          background: var(--color-background);
          border-radius: 4px;
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }

        .info-item label {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .info-item .value {
          font-size: 12px;
          color: var(--color-text);
          font-family: monospace;
        }

        .info-item .value.workspace-id {
          font-size: 11px;
          opacity: 0.7;
        }

        .clients-section {
          padding: 8px;
          background: var(--color-background);
          border-radius: 4px;
        }

        .clients-section h4 {
          margin: 0 0 8px 0;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }

        .clients-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .client-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          padding: 4px 0;
        }

        .client-kind {
          font-weight: 600;
          text-transform: capitalize;
          color: var(--color-text);
        }

        .client-time {
          font-size: 10px;
          color: var(--color-text-secondary);
        }
      `}</style>
    </div>
  )
}
