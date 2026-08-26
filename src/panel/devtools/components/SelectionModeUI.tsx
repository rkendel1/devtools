/**
 * Selection Mode UI
 * Allows user to select an element from the inspected page
 */

import React, { useState } from 'react'
import type { VisualSelection } from '@feltdb/core/workspace'
import { createSelectionId } from '../../../lib/developmentWorkspace'

interface SelectionModeUIProps {
  onSelectionCaptured: (selection: VisualSelection) => void
}

export const SelectionModeUI: React.FC<SelectionModeUIProps> = ({ onSelectionCaptured }) => {
  const [selecting, setSelecting] = useState(false)
  const [hoveredElement, setHoveredElement] = useState<{
    selector: string
    text: string
    width: number
    height: number
  } | null>(null)

  const handleSelectClick = () => {
    setSelecting(true)

    // Send message to content script to enable selection mode
    chrome.devtools.inspectedWindow.eval(
      `
      (function() {
        const overlay = document.createElement('div');
        overlay.id = '__runtime-investigator-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 2147483647; background: transparent; pointer-events: all;';

        const handleMouseOver = (e) => {
          if (e.target.id === '__runtime-investigator-overlay') return;
          const rect = e.target.getBoundingClientRect();
          overlay.style.boxShadow = \`inset 0 0 0 2px #3b82f6, 0 0 0 2px #3b82f6\`;
          overlay.style.pointerEvents = 'none';
          e.target.style.outline = '2px solid #3b82f6';
        };

        const handleMouseOut = (e) => {
          if (e.target === document.body || e.target === document.documentElement) return;
          e.target.style.outline = '';
        };

        const handleClick = (e) => {
          e.preventDefault();
          e.stopPropagation();

          const element = e.target;
          const rect = element.getBoundingClientRect();

          // Try to find a CSS selector for the element
          let selector = element.tagName.toLowerCase();
          if (element.id) {
            selector = '#' + element.id;
          } else if (element.className) {
            const classes = Array.from(element.classList)
              .filter(c => c && !c.startsWith('__'))
              .join('.');
            if (classes) selector = element.tagName.toLowerCase() + '.' + classes;
          }

          window.__selectedElement = {
            selector: selector,
            text: element.textContent?.slice(0, 100) || '',
            tagName: element.tagName,
            role: element.getAttribute('role') || element.tagName.toLowerCase(),
            boundingBox: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            computedStyle: window.getComputedStyle(element),
          };

          document.body.removeChild(overlay);
          document.removeEventListener('mouseover', handleMouseOver);
          document.removeEventListener('mouseout', handleMouseOut);
          document.removeEventListener('click', handleClick, true);

          console.log('Element selected:', window.__selectedElement);
        };

        document.body.appendChild(overlay);
        document.addEventListener('mouseover', handleMouseOver, false);
        document.addEventListener('mouseout', handleMouseOut, false);
        document.addEventListener('click', handleClick, true);
      })();
      `,
      (result) => {
        // Check if element was selected
        setTimeout(() => {
          chrome.devtools.inspectedWindow.eval(
            'window.__selectedElement',
            (selectedElement) => {
              if (selectedElement && selectedElement[0]) {
                const data = selectedElement[0];
                const selection: VisualSelection = {
                  id: createSelectionId(),
                  workspaceId: 'ws_devtools', // Will be set by workspace
                  kind: 'visual_selection',
                  url: chrome.devtools.inspectedWindow.tabId.toString(),
                  selector: data.selector,
                  elementRole: data.role,
                  textContent: data.text,
                  boundingBox: data.boundingBox,
                  domPath: data.selector,
                  nearbyElements: [],
                  sourceHints: [],
                  capturedAt: Date.now(),
                  properties: {},
                };

                onSelectionCaptured(selection);
                setSelecting(false);
              }
            },
          )
        }, 100)
      },
    )
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

      {hoveredElement && (
        <div className="hovered-info">
          <p className="selector">{hoveredElement.selector}</p>
          <p className="text">{hoveredElement.text}</p>
          <p className="metrics">
            {hoveredElement.width}×{hoveredElement.height}px
          </p>
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

        .hovered-info {
          padding: 12px;
          background: var(--color-background);
          border-radius: 4px;
          border-left: 3px solid var(--color-primary);
          font-size: 12px;
        }

        .hovered-info .selector {
          margin: 0 0 4px 0;
          font-family: monospace;
          font-weight: 600;
          color: var(--color-primary);
        }

        .hovered-info .text {
          margin: 4px 0;
          color: var(--color-text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .hovered-info .metrics {
          margin: 4px 0 0 0;
          color: var(--color-text-secondary);
          font-weight: 500;
        }
      `}</style>
    </div>
  )
}
