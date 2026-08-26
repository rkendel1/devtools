/**
 * Selection Mode UI
 * Allows user to select an element from the inspected page
 *
 * Uses @feltdb/development-runtime to handle browser interaction.
 * This component is now a consumer of the runtime, not the implementation.
 */

import React, { useEffect, useState } from 'react'
import type { VisualSelection } from '../../../lib/developmentWorkspace'
import type { Selection as RuntimeSelection } from '@feltdb/development-runtime'
import { createSelectionId } from '../../../lib/developmentWorkspace'

interface SelectionModeUIProps {
  onSelectionCaptured: (selection: VisualSelection) => void
  runtime: any // DevelopmentRuntime
}

export const SelectionModeUI: React.FC<SelectionModeUIProps> = ({ onSelectionCaptured, runtime }) => {
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSelectClick = async () => {
    setSelecting(true)
    setError(null)

    try {
      // Use DevelopmentRuntime to capture selection
      // Runtime handles all browser protocol details
      const runtimeSelection = await runtime.select()

      // Convert from runtime Selection to workspace VisualSelection
      const selection: VisualSelection = {
        id: createSelectionId(),
        workspaceId: 'ws_devtools',
        kind: 'visual_selection',
        url: typeof chrome !== 'undefined' ? chrome.devtools.inspectedWindow.tabId.toString() : 'unknown',
        selector: runtimeSelection.elementQuery,
        elementRole: 'button', // Could detect from runtime hints
        textContent: runtimeSelection.computedStyle?.content || 'element',
        boundingBox: runtimeSelection.boundingBox,
        domPath: runtimeSelection.elementQuery,
        nearbyElements: [],
        sourceHints: runtimeSelection.sourceHints.sourceLocations || [],
        capturedAt: Date.now(),
        properties: {},
      }

      onSelectionCaptured(selection)
      setSelecting(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Selection failed')
      setSelecting(false)
    }
  }

  return (
    <div className="selection-mode-ui">
      <div className="selection-header">
        <h3>Select Element</h3>
        <p>Click to select an element from the inspected page</p>
      </div>

      <button
        className={`select-button ${selecting ? 'selecting' : ''}`}
        onClick={handleSelectClick}
        disabled={selecting}
      >
        {selecting ? '👆 Click an element on the page...' : '▶ Select Element'}
      </button>

      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}

      <style>{`
        .selection-mode-ui {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, transparent 100%);
          border-radius: 8px;
          border: 1px solid var(--color-border);
        }

        .selection-header h3 {
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--color-text);
        }

        .selection-header p {
          margin: 0;
          font-size: 13px;
          color: var(--color-text-secondary);
        }

        .select-button {
          padding: 12px 16px;
          background: linear-gradient(135deg, var(--color-primary) 0%, #5b5fc7 100%);
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .select-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(59, 130, 246, 0.3);
        }

        .select-button:active {
          transform: translateY(0);
        }

        .select-button.selecting {
          background: var(--color-primary);
          cursor: wait;
          animation: pulse 2s infinite;
        }

        .select-button:disabled {
          opacity: 0.7;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }

        .error-message {
          padding: 12px;
          background: rgba(239, 68, 68, 0.1);
          border-radius: 4px;
          border-left: 3px solid #ef4444;
        }

        .error-message p {
          margin: 0;
          font-size: 12px;
          color: #dc2626;
          font-weight: 500;
        }
      `}</style>
    </div>
  )
}
