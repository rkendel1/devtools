import type { InvestigationRecord } from './types'

function section(title: string, items: string[]): string[] {
  if (items.length === 0) return []
  return ['', title, ...items.map((item) => `- ${item}`)]
}

function location(source?: string, line?: number): string {
  if (!source) return line ? `line ${line}` : 'unknown source'
  return line ? `${source}:${line}` : source
}

export function formatInvestigationReport(record: InvestigationRecord): string {
  const { graph, result } = record
  const schema = Object.entries(graph.response.schemaHint).map(([key, type]) => `${key}: ${type}`)
  const relatedEvents = graph.relatedEvents.map(
    (event) => `${event.type}: ${event.message} (${location(event.source, event.line)})`,
  )
  const trace = graph.trace.map(
    (step, index) => `${index + 1}. ${step.label}${step.source || step.line ? ` — ${location(step.source, step.line)}` : ''}`,
  )

  return [
    'Chrome Runtime Investigator',
    `Captured: ${new Date(record.createdAt).toISOString()}`,
    `Request: ${graph.request.method} ${graph.request.url}`,
    `Response: ${graph.request.status} ${graph.response.statusText}`,
    `Initiator: ${location(graph.initiator?.source, graph.initiator?.line)}`,
    '',
    'Likely cause',
    result.diagnosis,
    `Confidence: ${Math.round(result.confidence * 100)}%`,
    ...section('Evidence', result.evidence),
    ...section('Potential anomalies', graph.anomalies),
    ...section('Related runtime events', relatedEvents),
    ...section('Response schema', schema),
    ...section('Differences from successful request', graph.comparison?.semanticDiff ?? []),
    ...section('Trace', trace),
    ...section('Alternative explanations', result.alternatives),
    ...section('Next actions', result.nextActions),
    '',
    `Sensitive data redacted: ${graph.redactionApplied ? 'yes' : 'no'}`,
  ].join('\n')
}
