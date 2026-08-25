import type { StoredEvidenceEdge, StoredEvidenceNode } from './evidenceGraph'

export type EvidenceLayer = 'observed' | 'inferred' | 'hypothesis'

export interface EvidenceClaim {
  layer: EvidenceLayer
  statement: string
  confidence: number
  evidence: string[]
  missingEvidence?: string[]
}

export interface CausalChain {
  steps: CausalStep[]
  confidence: number
}

export interface CausalStep {
  claim: EvidenceClaim
  nodeId: string
  nodeLabel: string
  nodeKind: string
}

export function classifyEvidenceLayer(edge: StoredEvidenceEdge): EvidenceLayer {
  if (edge.confidence === 1) return 'observed'
  if (edge.confidence >= 0.7) return 'inferred'
  return 'hypothesis'
}

export function buildCausalChain(
  root: StoredEvidenceNode,
  edges: StoredEvidenceEdge[],
  nodes: Map<string, StoredEvidenceNode>
): CausalChain {
  const steps: CausalStep[] = []
  const visited = new Set<string>()

  function traverse(nodeId: string, depth: number) {
    if (depth > 5 || visited.has(nodeId)) return

    visited.add(nodeId)
    const node = nodes.get(nodeId)
    if (!node) return

    const outgoing = edges.filter((e) => e.from === nodeId)
    for (const edge of outgoing) {
      const toNode = nodes.get(edge.to)
      if (!toNode) continue

      const layer = classifyEvidenceLayer(edge)
      const statement = buildStatement(edge, toNode, layer)
      const step: CausalStep = {
        claim: {
          layer,
          statement,
          confidence: edge.confidence,
          evidence: edge.evidence,
          missingEvidence: layer !== 'observed' ? ['Full lifecycle trace'] : undefined,
        },
        nodeId: edge.to,
        nodeLabel: toNode.label,
        nodeKind: toNode.kind,
      }

      steps.push(step)
      traverse(edge.to, depth + 1)
    }
  }

  traverse(root.id, 0)

  const confidence = steps.length > 0 ? steps.reduce((sum, s) => sum + s.claim.confidence, 0) / steps.length : 0

  return { steps, confidence }
}

function buildStatement(edge: StoredEvidenceEdge, toNode: StoredEvidenceNode, layer: EvidenceLayer): string {
  const edgeText = edge.kind.replace(/_/g, ' ').toLowerCase()
  const nodeDesc = toNode.label || toNode.kind

  const prefix = {
    observed: 'OBSERVED:',
    inferred: 'INFERRED:',
    hypothesis: 'HYPOTHESIS:',
  }[layer]

  return `${prefix} ${nodeDesc} ${edgeText}`
}

export function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return '#10b981' // green
  if (confidence >= 0.7) return '#f59e0b' // amber
  return '#ef4444' // red
}

export function layerIcon(layer: EvidenceLayer): string {
  return { observed: '●', inferred: '◐', hypothesis: '◯' }[layer]
}
