import { useEffect, useState } from 'react'
import { feltRepository } from '../../lib/feltRepository'
import type { EvidenceNeighborhood } from '../../lib/evidenceGraph'

export function EvidenceGraphView({ investigationId }: { investigationId: string }) {
  const [neighborhood, setNeighborhood] = useState<EvidenceNeighborhood | null>(null)
  useEffect(() => {
    let active = true
    const unsubscribe = feltRepository.subscribeNeighborhood(investigationId, (value) => { if (active) setNeighborhood(value) })
    return () => { active = false; unsubscribe() }
  }, [investigationId])
  if (!neighborhood?.nodes.length) return null
  const width = 680
  const height = 300
  const positions = new Map(neighborhood.nodes.map((node, index) => {
    const angle = (index / neighborhood.nodes.length) * Math.PI * 2 - Math.PI / 2
    const radius = node.id === neighborhood.rootId ? 0 : Math.min(width, height) * 0.36
    return [node.id, { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius }]
  }))
  return <details className="graph-details"><summary>Evidence graph · {neighborhood.nodes.length} nodes · {neighborhood.edges.length} edges</summary>
    <svg className="evidence-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Causal evidence graph">
      {neighborhood.edges.map((edge) => { const from = positions.get(edge.from); const to = positions.get(edge.to); return from && to ? <g key={edge.id}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2}>{edge.kind}</text></g> : null })}
      {neighborhood.nodes.map((node) => { const point = positions.get(node.id)!; return <g key={node.id} transform={`translate(${point.x} ${point.y})`}><circle r={node.id === neighborhood.rootId ? 28 : 21} className={`node-${node.kind}`} /><text y="4" textAnchor="middle">{node.kind.slice(0, 8)}</text><title>{node.label}</title></g> })}
    </svg>
    {neighborhood.truncated && <p className="meta">Graph was bounded to protect responsiveness and model context.</p>}
    <table className="edge-table"><thead><tr><th>Relationship</th><th>Evidence</th><th>Confidence</th></tr></thead><tbody>{neighborhood.edges.map((edge) => <tr key={edge.id}><td>{edge.kind}</td><td>{edge.evidence.join(', ')}</td><td>{Math.round(edge.confidence * 100)}%</td></tr>)}</tbody></table>
  </details>
}
