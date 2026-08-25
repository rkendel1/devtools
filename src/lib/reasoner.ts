import type { EvidenceGraph, InvestigationResult } from './types'

export function reasonFromEvidence(graph: EvidenceGraph): InvestigationResult {
  const evidence: string[] = []

  evidence.push(`${graph.request.method} ${graph.request.url} returned ${graph.request.status}`)

  for (const finding of graph.comparison?.semanticDiff ?? []) {
    evidence.push(finding)
  }

  if (graph.relatedEvents.length > 0) {
    const first = graph.relatedEvents[0]
    evidence.push(`Related runtime event: ${first.message}`)
  }

  let diagnosis = 'Request failure likely caused by an API or server-side issue.'
  let confidence = 0.62

  const typeDiff = (graph.comparison?.semanticDiff ?? []).find((entry) => entry.includes('changed type'))
  if (typeDiff && graph.request.status >= 400) {
    diagnosis = 'Likely cause: API contract mismatch between expected and actual payload schema.'
    confidence = 0.94
  } else if (graph.request.status === 401 || graph.request.status === 403) {
    diagnosis = 'Likely cause: authentication or authorization problem.'
    confidence = 0.9
  } else if (graph.request.status >= 500) {
    diagnosis = 'Likely cause: backend service failure while processing the request.'
    confidence = 0.85
  }

  const alternatives = [
    'Backend validation rule changed for this endpoint.',
    'Client-side request construction mutated field values before sending.',
  ]

  const nextActions = ['Compare successful request', 'Trace request', 'Show source', 'Investigate further']

  return {
    diagnosis,
    confidence,
    evidence,
    alternatives,
    nextActions,
  }
}
