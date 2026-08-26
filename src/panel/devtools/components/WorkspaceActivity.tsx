/**
 * Workspace Activity Panel
 *
 * Real-time visualization of all three clients (Browser, IDE, Agent)
 * acting on the shared FeltDB Development Workspace.
 *
 * This is the killer UI that makes the architecture visible and undeniable.
 */

import React, { useEffect, useState } from 'react'

interface ActivityEvent {
  id: string
  timestamp: number
  client: 'Browser' | 'IDE' | 'Agent'
  action: string
  details?: string
  icon?: string
}

interface WorkspaceActivityProps {
  workspaceId: string
  isLive?: boolean
}

export const WorkspaceActivity: React.FC<WorkspaceActivityProps> = ({ workspaceId, isLive = false }) => {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const activityRef = React.useRef<HTMLDivElement>(null)

  // Simulate live events for demo
  useEffect(() => {
    if (!isLive) return

    const eventSequence: Omit<ActivityEvent, 'id'>[] = [
      {
        timestamp: Date.now(),
        client: 'Browser',
        action: 'Visual selection captured',
        details: '.checkout-button (400×48px)',
        icon: '🌐',
      },
      {
        timestamp: Date.now() + 200,
        client: 'Browser',
        action: 'Selection published to workspace',
        details: 'sel:demo:001',
        icon: '🌐',
      },
      {
        timestamp: Date.now() + 400,
        client: 'Browser',
        action: 'SelectionTask created',
        details: 'Make this button smaller and change text to "Order Now"',
        icon: '🌐',
      },
      {
        timestamp: Date.now() + 600,
        client: 'Agent',
        action: 'Task discovered in workspace',
        details: 'task:demo:001',
        icon: '🤖',
      },
      {
        timestamp: Date.now() + 800,
        client: 'Agent',
        action: 'Selection context loaded',
        details: 'Reading visual metrics from workspace',
        icon: '🤖',
      },
      {
        timestamp: Date.now() + 1200,
        client: 'Agent',
        action: 'CodeChange published',
        details: 'width: 400px → 200px',
        icon: '🤖',
      },
      {
        timestamp: Date.now() + 1400,
        client: 'Browser',
        action: 'Change detected via subscription',
        details: 'Received CodeChange notification',
        icon: '🌐',
      },
      {
        timestamp: Date.now() + 1600,
        client: 'Browser',
        action: 'Verification started',
        details: 'Reloading and measuring element...',
        icon: '🌐',
      },
      {
        timestamp: Date.now() + 2200,
        client: 'Browser',
        action: '✓ Verification passed',
        details: 'Confidence: 98%',
        icon: '🌐',
      },
      {
        timestamp: Date.now() + 2400,
        client: 'Agent',
        action: '✓ FIX VERIFIED',
        details: 'VerificationResult received from workspace',
        icon: '🤖',
      },
    ]

    let eventIndex = 0
    const interval = setInterval(() => {
      if (eventIndex >= eventSequence.length) {
        clearInterval(interval)
        return
      }

      const event = eventSequence[eventIndex]
      setEvents((prev) => [
        ...prev,
        {
          id: `${event.timestamp}:${eventIndex}`,
          ...event,
        },
      ])

      eventIndex++
    }, 400)

    return () => clearInterval(interval)
  }, [isLive])

  useEffect(() => {
    if (autoScroll && activityRef.current) {
      activityRef.current.scrollTop = activityRef.current.scrollHeight
    }
  }, [events, autoScroll])

  const getClientColor = (client: string) => {
    switch (client) {
      case 'Browser':
        return '#3b82f6'
      case 'IDE':
        return '#8b5cf6'
      case 'Agent':
        return '#10b981'
      default:
        return '#6b7280'
    }
  }

  const getClientEmoji = (client: string) => {
    switch (client) {
      case 'Browser':
        return '🌐'
      case 'IDE':
        return '💻'
      case 'Agent':
        return '🤖'
      default:
        return '•'
    }
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString()
  }

  return (
    <div className="workspace-activity">
      <div className="activity-header">
        <h3>Workspace Activity</h3>
        <p className="workspace-id">Workspace: {workspaceId}</p>
        {isLive && (
          <label className="autoscroll-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
        )}
      </div>

      <div className="activity-log" ref={activityRef}>
        {events.length === 0 ? (
          <div className="empty-state">
            <p>Workspace activity will appear here</p>
            <p className="hint">Start a task to see browser, IDE, and agent coordination</p>
          </div>
        ) : (
          <div className="events-list">
            {events.map((event, index) => (
              <div key={event.id} className="activity-event">
                <div className="event-time">{formatTime(event.timestamp)}</div>

                <div className="event-marker" style={{ borderLeftColor: getClientColor(event.client) }}>
                  <div className="client-emoji">{getClientEmoji(event.client)}</div>
                </div>

                <div className="event-content">
                  <div className="event-header">
                    <span className="client-name" style={{ color: getClientColor(event.client) }}>
                      {event.client}
                    </span>
                  </div>
                  <div className="event-action">{event.action}</div>
                  {event.details && <div className="event-details">{event.details}</div>}
                </div>

                {index < events.length - 1 && (
                  <div className="event-connector" style={{ backgroundColor: getClientColor(event.client) }} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .workspace-activity {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--color-background);
          border-radius: 8px;
          overflow: hidden;
        }

        .activity-header {
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-background-secondary);
        }

        .activity-header h3 {
          margin: 0 0 4px 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text);
        }

        .workspace-id {
          margin: 0 0 8px 0;
          font-size: 11px;
          font-family: monospace;
          color: var(--color-text-secondary);
        }

        .autoscroll-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--color-text-secondary);
          cursor: pointer;
        }

        .autoscroll-toggle input {
          cursor: pointer;
        }

        .activity-log {
          flex: 1;
          overflow-y: auto;
          padding: 12px 8px;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
          color: var(--color-text-secondary);
        }

        .empty-state p {
          margin: 0;
          font-size: 13px;
        }

        .empty-state .hint {
          font-size: 11px;
          opacity: 0.7;
          margin-top: 4px;
        }

        .events-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .activity-event {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          position: relative;
        }

        .event-time {
          font-size: 10px;
          font-family: monospace;
          color: var(--color-text-secondary);
          min-width: 50px;
          padding-top: 2px;
        }

        .event-marker {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border-left: 3px solid;
          background: var(--color-background-secondary);
        }

        .client-emoji {
          font-size: 16px;
          line-height: 1;
        }

        .event-content {
          flex: 1;
          min-width: 0;
          padding-top: 2px;
        }

        .event-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .client-name {
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .event-action {
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text);
          margin-top: 2px;
        }

        .event-details {
          font-size: 12px;
          color: var(--color-text-secondary);
          margin-top: 4px;
          padding: 6px 8px;
          background: var(--color-background-secondary);
          border-radius: 3px;
          font-family: monospace;
          word-break: break-word;
        }

        .event-connector {
          position: absolute;
          left: 23px;
          top: 40px;
          width: 2px;
          height: 12px;
        }
      `}</style>
    </div>
  )
}
