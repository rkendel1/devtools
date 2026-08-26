import type { StoredEvidenceEdge, StoredEvidenceNode } from './evidenceGraph'

export type EvidenceLayer = 'observed' | 'inferred' | 'hypothesis' | 'rejected'

export interface EvidenceClaim {
  layer: EvidenceLayer
  statement: string
  confidence: number
  evidence: string[]
  missingEvidence?: string[]
  rejectionReason?: string // Why was this hypothesis rejected?
}

export interface ConfidenceScore {
  causal: number // Is this the root cause? (0-1)
  evidence: number // How complete is the evidence? (0-1)
  reproduction: boolean // Can we reproduce it?
  counterfactual: boolean // Have we confirmed with counterfactual?
  overall: number // Aggregate confidence (0-1)
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

  const averageConfidence = steps.length > 0 ? steps.reduce((sum, s) => sum + s.claim.confidence, 0) / steps.length : 0

  return {
    steps,
    confidence: averageConfidence,
  }
}

function buildStatement(edge: StoredEvidenceEdge, toNode: StoredEvidenceNode, layer: EvidenceLayer): string {
  const edgeText = edge.kind.replace(/_/g, ' ').toLowerCase()
  const nodeDesc = toNode.label || toNode.kind

  const prefix = {
    observed: 'OBSERVED:',
    inferred: 'INFERRED:',
    hypothesis: 'HYPOTHESIS:',
    rejected: 'REJECTED:',
  }[layer]

  return `${prefix} ${nodeDesc} ${edgeText}`
}

export function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return '#10b981' // green
  if (confidence >= 0.7) return '#f59e0b' // amber
  return '#ef4444' // red
}

export function layerIcon(layer: EvidenceLayer): string {
  return { observed: '●', inferred: '◐', hypothesis: '◯', rejected: '✗' }[layer]
}

export function createConfidenceScore(options: Partial<ConfidenceScore> = {}): ConfidenceScore {
  const score: ConfidenceScore = {
    causal: options.causal ?? 0,
    evidence: options.evidence ?? 0,
    reproduction: options.reproduction ?? false,
    counterfactual: options.counterfactual ?? false,
    overall: 0,
  }

  // Calculate overall as weighted average
  let total = 0
  let weight = 0

  if (score.causal > 0) {
    total += score.causal * 2 // Causal is most important
    weight += 2
  }

  if (score.evidence > 0) {
    total += score.evidence
    weight += 1
  }

  if (score.reproduction) {
    total += 1
    weight += 1
  }

  if (score.counterfactual) {
    total += 1
    weight += 1
  }

  score.overall = weight > 0 ? total / weight : 0

  return score
}
