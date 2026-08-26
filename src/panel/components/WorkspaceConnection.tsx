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

    if (!/^FELT-[A-Z0-9]{6}$/i.test(pairingCode.trim())) {
      setLocalError('Enter a pairing code in the format FELT-XXXXXX')
      return
    }

    try {
      await onConnect(pairingCode.trim().toUpperCase())
      setPairingCode('')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  return (
    <div className="workspace-connection">
      <div className="connection-header">
        <h2>Development Workspace</h2>
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
            <label htmlFor="pairing-code">Enter pairing code</label>
            <input
              id="pairing-code"
              type="text"
              placeholder="FELT-XXXXXX"
              value={pairingCode}
              onChange={(e) => {
                setPairingCode(e.target.value.toUpperCase())
                setLocalError('')
              }}
              disabled={loading}
              autoFocus
            />
            <small className="hint">
              Start the FeltDB development server, then enter its <strong>Pairing Code</strong>.
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
