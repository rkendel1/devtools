import type { InvestigationRecord } from './types'

export type EvidenceNodeKind = 'investigation' | 'request' | 'response' | 'runtime-event' | 'source' | 'issue-group'
export type EvidenceEdgeKind = 'INITIATED_BY' | 'RETURNED' | 'FOLLOWED_BY' | 'THREW_AT' | 'OBSERVED_DURING' | 'DUPLICATE_OF'

export interface StoredEvidenceNode {
  id: string
  investigationId: string
  kind: EvidenceNodeKind
  label: string
  timestamp: number
  data: Record<string, unknown>
}

export interface StoredEvidenceEdge {
  id: string
  investigationId: string
  from: string
  to: string
  kind: EvidenceEdgeKind
  confidence: number
  evidence: string[]
}

export interface EvidenceNeighborhood {
  rootId: string
  nodes: StoredEvidenceNode[]
  edges: StoredEvidenceEdge[]
  truncated: boolean
}

function safeId(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function investigationRootId(investigationId: string): string {
  return `investigation:${investigationId}`
}

export function normalizeEvidenceGraph(record: InvestigationRecord): { nodes: StoredEvidenceNode[]; edges: StoredEvidenceEdge[] } {
  const root = investigationRootId(record.id)
  const request = `request:${safeId(record.requestId)}`
  const response = `response:${safeId(record.requestId)}`
  const issue = `issue:${safeId(record.fingerprint ?? record.id)}`
  const nodes: StoredEvidenceNode[] = [
    { id: root, investigationId: record.id, kind: 'investigation', label: record.result.diagnosis, timestamp: record.lastSeenAt ?? record.createdAt, data: { confidence: record.result.confidence } },
    { id: issue, investigationId: record.id, kind: 'issue-group', label: record.name ?? record.result.diagnosis, timestamp: record.firstSeenAt ?? record.createdAt, data: { fingerprint: record.fingerprint, occurrences: record.occurrenceCount ?? 1 } },
    { id: request, investigationId: record.id, kind: 'request', label: `${record.graph.request.method} ${record.graph.request.url}`, timestamp: record.createdAt, data: { ...record.graph.request } },
    { id: response, investigationId: record.id, kind: 'response', label: `${record.graph.request.status} ${record.graph.response.statusText}`, timestamp: record.createdAt, data: { ...record.graph.response } },
  ]
  const edges: StoredEvidenceEdge[] = [
    { id: `${root}|OBSERVED_DURING|${request}`, investigationId: record.id, from: root, to: request, kind: 'OBSERVED_DURING', confidence: 1, evidence: ['selected request'] },
    { id: `${request}|RETURNED|${response}`, investigationId: record.id, from: request, to: response, kind: 'RETURNED', confidence: 1, evidence: [`HTTP ${record.graph.request.status}`] },
    { id: `${root}|DUPLICATE_OF|${issue}`, investigationId: record.id, from: root, to: issue, kind: 'DUPLICATE_OF', confidence: record.occurrenceCount && record.occurrenceCount > 1 ? 1 : 0.7, evidence: [record.fingerprint ?? 'investigation identity'] },
  ]

  if (record.graph.initiator?.source) {
    const source = `source:${safeId(`${record.graph.initiator.source}:${record.graph.initiator.line ?? ''}`)}`
    nodes.push({ id: source, investigationId: record.id, kind: 'source', label: `${record.graph.initiator.source}:${record.graph.initiator.line ?? 1}`, timestamp: record.createdAt, data: { ...record.graph.initiator } })
    edges.push({ id: `${request}|INITIATED_BY|${source}`, investigationId: record.id, from: request, to: source, kind: 'INITIATED_BY', confidence: 1, evidence: ['DevTools initiator stack'] })
  }

  record.graph.relatedEvents.forEach((event, index) => {
    const eventId = `event:${record.id}:${index}`
    nodes.push({ id: eventId, investigationId: record.id, kind: 'runtime-event', label: event.message, timestamp: record.createdAt, data: { ...event } })
    edges.push({ id: `${response}|FOLLOWED_BY|${eventId}`, investigationId: record.id, from: response, to: eventId, kind: 'FOLLOWED_BY', confidence: 0.9, evidence: ['temporal correlation'] })
    if (event.source) {
      const source = `source:${safeId(`${event.source}:${event.line ?? ''}`)}`
      if (!nodes.some((node) => node.id === source)) nodes.push({ id: source, investigationId: record.id, kind: 'source', label: `${event.source}:${event.line ?? 1}`, timestamp: record.createdAt, data: { source: event.source, line: event.line } })
      edges.push({ id: `${eventId}|THREW_AT|${source}`, investigationId: record.id, from: eventId, to: source, kind: 'THREW_AT', confidence: 1, evidence: ['runtime stack location'] })
    }
  })
  return { nodes, edges }
}

export function boundedNeighborhood(rootId: string, allNodes: StoredEvidenceNode[], allEdges: StoredEvidenceEdge[], depth = 2, limit = 80): EvidenceNeighborhood {
  const nodeMap = new Map(allNodes.map((node) => [node.id, node]))
  const selected = new Set([rootId])
  let frontier = new Set([rootId])
  let truncated = false
  for (let level = 0; level < Math.max(0, depth); level += 1) {
    const next = new Set<string>()
    for (const edge of allEdges) {
      if (frontier.has(edge.from)) next.add(edge.to)
      if (frontier.has(edge.to)) next.add(edge.from)
    }
    const unseen = [...next].filter((id) => !selected.has(id))
    for (const id of unseen) {
      if (selected.size >= limit) { truncated = true; break }
      if (nodeMap.has(id)) selected.add(id)
    }
    frontier = new Set(unseen)
    if (truncated || next.size === 0) break
  }
  const nodes = [...selected].flatMap((id) => nodeMap.get(id) ? [nodeMap.get(id)!] : [])
  const edges = allEdges.filter((edge) => selected.has(edge.from) && selected.has(edge.to)).slice(0, limit * 2)
  return { rootId, nodes, edges, truncated: truncated || edges.length >= limit * 2 }
}
