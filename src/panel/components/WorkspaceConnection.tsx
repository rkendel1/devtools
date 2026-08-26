import { useState } from 'react'
import '../styles/WorkspaceConnection.css'

interface WorkspaceConnectionProps {
  onConnect: (pairingCode: string) => Promise<void>
  isConnected: boolean
  workspaceId?: string
  error?: string
  loading?: boolean
}

export function WorkspaceConnection({
  onConnect,
  isConnected,
  workspaceId,
  error,
  loading = false,
}: WorkspaceConnectionProps) {
  const [pairingCode, setPairingCode] = useState('')
  const [localError, setLocalError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')

    if (!pairingCode.trim()) {
      setLocalError('Please enter a pairing code')
      return
    }

    try {
      await onConnect(pairingCode.trim())
      setPairingCode('')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  return (
    <div className="workspace-connection">
      <div className="connection-header">
        <h2>FeltDB Workspace</h2>
        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot"></span>
          {isConnected ? 'Connected' : 'Not Connected'}
        </div>
      </div>

      {isConnected && workspaceId && (
        <div className="connection-info">
          <div className="info-item">
            <label>Workspace ID</label>
            <code>{workspaceId}</code>
          </div>
        </div>
      )}

      {!isConnected && (
        <form onSubmit={handleSubmit} className="connection-form">
          <div className="form-group">
            <label htmlFor="pairing-code">Pairing Code</label>
            <input
              id="pairing-code"
              type="text"
              placeholder="Enter pairing code (e.g., FELT-C7C452)"
              value={pairingCode}
              onChange={(e) => {
                setPairingCode(e.target.value.toUpperCase())
                setLocalError('')
              }}
              disabled={loading}
              autoFocus
            />
            <small className="hint">
              Start a FeltDB dev server with: <code>npx @feltdb/core@0.6.1 dev</code>
            </small>
          </div>

          {(error || localError) && <div className="error-message">{error || localError}</div>}

          <button type="submit" disabled={loading || !pairingCode.trim()} className="connect-button">
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      )}

      {isConnected && (
        <div className="connection-actions">
          <button className="disconnect-button" onClick={() => setPairingCode('')}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
