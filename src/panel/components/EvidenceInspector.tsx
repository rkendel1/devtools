import { useState } from 'react'
import { openSourceLocation } from '../../lib/chrome'
import { buildCausalChain, classifyEvidenceLayer, confidenceColor, layerIcon } from '../../lib/evidenceLayers'
import type { EvidenceNeighborhood } from '../../lib/evidenceGraph'
import '../styles/EvidenceInspector.css'

export function EvidenceInspector({ neighborhood }: { neighborhood: EvidenceNeighborhood }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>(neighborhood.rootId)
  const [viewMode, setViewMode] = useState<'chain' | 'node' | 'graph'>('chain')

  const nodesMap = new Map(neighborhood.nodes.map((n) => [n.id, n]))
  const selectedNode = nodesMap.get(selectedNodeId)

  const chain = buildCausalChain(
    neighborhood.nodes.find((n) => n.id === neighborhood.rootId)!,
    neighborhood.edges,
    nodesMap
  )

  const relatedEdges = neighborhood.edges.filter((e) => e.from === selectedNodeId || e.to === selectedNodeId)

  return (
    <div className="evidence-inspector">
      <div className="inspector-header">
        <h3>Evidence Chain Analysis</h3>
        <div className="view-modes">
          <button
            className={viewMode === 'chain' ? 'active' : ''}
            onClick={() => setViewMode('chain')}
            title="Causal chain view"
          >
            Chain
          </button>
          <button
            className={viewMode === 'node' ? 'active' : ''}
            onClick={() => setViewMode('node')}
            title="Node inspector"
          >
            Node
          </button>
          <button
            className={viewMode === 'graph' ? 'active' : ''}
            onClick={() => setViewMode('graph')}
            title="Graph view"
          >
            Graph
          </button>
        </div>
      </div>

      {viewMode === 'chain' && (
        <div className="causal-chain">
          <div className="chain-summary">
            <p>
              Chain confidence:{' '}
              <strong style={{ color: confidenceColor(chain.confidence) }}>
                {Math.round(chain.confidence * 100)}%
              </strong>
            </p>
            <p className="meta">{chain.steps.length} causal steps identified</p>
          </div>

          <div className="chain-steps">
            {chain.steps.map((step, index) => (
              <div key={`${step.nodeId}:${index}`} className="chain-step">
                <div
                  className="step-header"
                  onClick={() => setSelectedNodeId(step.nodeId)}
                  style={{ cursor: 'pointer', borderLeftColor: confidenceColor(step.claim.confidence) }}
                >
                  <div className="step-marker">
                    <span className="step-icon" title={step.claim.layer}>
                      {layerIcon(step.claim.layer)}
                    </span>
                    <span className="step-number">{index + 1}</span>
                  </div>
                  <div className="step-content">
                    <div className="step-statement">{step.claim.statement}</div>
                    <div className="step-metadata">
                      <span className={`layer-badge ${step.claim.layer}`}>{step.claim.layer}</span>
                      <span className="confidence">{Math.round(step.claim.confidence * 100)}%</span>
                    </div>
                  </div>
                </div>

                {step.claim.evidence.length > 0 && (
                  <div className="step-evidence">
                    <strong>Evidence:</strong>
                    <ul>
                      {step.claim.evidence.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {step.claim.missingEvidence && step.claim.missingEvidence.length > 0 && (
                  <div className="step-missing">
                    <strong>Missing:</strong>
                    <ul>
                      {step.claim.missingEvidence.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="layer-legend">
            <p>
              <strong>Evidence Layers:</strong>
            </p>
            <div className="legend-items">
              <div className="legend-item">
                <span className="layer-icon">●</span>
                <span>Observed - 100% confidence (recorded data)</span>
              </div>
              <div className="legend-item">
                <span className="layer-icon">◐</span>
                <span>Inferred - 70-99% confidence (logical deduction)</span>
              </div>
              <div className="legend-item">
                <span className="layer-icon">◯</span>
                <span>Hypothesis - &lt;70% confidence (speculation)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'node' && selectedNode && (
        <div className="node-inspector">
          <div className="node-header">
            <button onClick={() => setSelectedNodeId(neighborhood.rootId)} className="back-button">
              ← Back
            </button>
            <h4>{selectedNode.label}</h4>
            <span className="node-kind-badge">{selectedNode.kind}</span>
          </div>

          <div className="node-details">
            <div className="detail-section">
              <h5>Node ID</h5>
              <code>{selectedNode.id}</code>
            </div>

            {selectedNode.kind === 'source' && selectedNode.data.source && (
              <div className="detail-section">
                <h5>Source Location</h5>
                <button
                  className="source-link"
                  onClick={() =>
                    openSourceLocation(selectedNode.data.source as string, selectedNode.data.line as number | undefined)
                  }
                >
                  {selectedNode.data.source}
                  {selectedNode.data.line ? `:${selectedNode.data.line}` : ''}
                </button>
              </div>
            )}

            <div className="detail-section">
              <h5>Relationships</h5>
              <div className="relationships">
                {relatedEdges.map((edge) => {
                  const isOutgoing = edge.from === selectedNodeId
                  const relatedNode = nodesMap.get(isOutgoing ? edge.to : edge.from)
                  if (!relatedNode) return null

                  return (
                    <div key={edge.id} className="relationship">
                      <button
                        className="relationship-button"
                        onClick={() => setSelectedNodeId(relatedNode.id)}
                        title={`Navigate to ${relatedNode.label}`}
                      >
                        <span className="rel-arrow">{isOutgoing ? '→' : '←'}</span>
                        <span className="rel-kind">{edge.kind}</span>
                        <span className="rel-label">{relatedNode.label}</span>
                      </button>
                      <span className="rel-confidence" style={{ color: confidenceColor(edge.confidence) }}>
                        {Math.round(edge.confidence * 100)}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {Object.keys(selectedNode.data).length > 0 && (
              <div className="detail-section">
                <h5>Data</h5>
                <pre>{JSON.stringify(selectedNode.data, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {viewMode === 'graph' && (
        <div className="graph-view">
          <svg
            className="evidence-graph-interactive"
            viewBox={`0 0 800 400`}
            style={{ border: '1px solid #e5e7eb', borderRadius: '6px', background: 'var(--bg-secondary)' }}
          >
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" fill="currentColor" />
              </marker>
            </defs>
            {neighborhood.edges.map((edge) => {
              const fromNode = nodesMap.get(edge.from)
              const toNode = nodesMap.get(edge.to)
              if (!fromNode || !toNode) return null

              const fromIndex = neighborhood.nodes.indexOf(fromNode)
              const toIndex = neighborhood.nodes.indexOf(toNode)
              const angle = ((fromIndex + toIndex) / neighborhood.nodes.length) * Math.PI * 2
              const fromX = 400 + Math.cos(angle) * 150
              const fromY = 200 + Math.sin(angle) * 150
              const toX = 400 + Math.cos(angle + Math.PI / neighborhood.nodes.length) * 150
              const toY = 200 + Math.sin(angle + Math.PI / neighborhood.nodes.length) * 150

              return (
                <g key={edge.id} opacity="0.6">
                  <line
                    x1={fromX}
                    y1={fromY}
                    x2={toX}
                    y2={toY}
                    stroke={confidenceColor(edge.confidence)}
                    strokeWidth="2"
                    markerEnd="url(#arrowhead)"
                  />
                </g>
              )
            })}
          </svg>
          <p className="meta">Interactive graph visualization (nodes clickable in Node view)</p>
        </div>
      )}
    </div>
  )
}
