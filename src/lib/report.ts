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
    ...(record.localAi ? [`Local AI: ${record.localAi.model}`, `Model finding: ${record.localAi.findingId}`] : []),
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
    ...section('Request headers', Object.entries(graph.bundle?.requestHeaders ?? {}).map(([key, value]) => `${key}: ${value}`)),
    ...section('Response headers', Object.entries(graph.bundle?.responseHeaders ?? {}).map(([key, value]) => `${key}: ${value}`)),
    ...(graph.bundle?.requestBody ? ['', 'Request body', graph.bundle.requestBody] : []),
    ...(graph.bundle?.responseBody ? ['', 'Response body', graph.bundle.responseBody] : []),
    ...(graph.bundle?.runtimeEvents.some((event) => event.stack) ? ['', 'Stack traces', ...graph.bundle.runtimeEvents.flatMap((event) => event.stack ? [`${event.message}\n${event.stack}`] : [])] : []),
    ...(graph.bundle?.environment ? ['', 'Environment', ...Object.entries(graph.bundle.environment).map(([key, value]) => `- ${key}: ${value}`)] : []),
    ...section('Reproduction steps', graph.bundle?.reproductionSteps ?? []),
    '',
    `Sensitive data redacted: ${graph.redactionApplied ? 'yes' : 'no'}`,
  ].join('\n')
}

export function formatMarkdownReport(record: InvestigationRecord): string {
  return formatInvestigationReport(record)
    .replace(/^Chrome Runtime Investigator$/m, '# Chrome Runtime Investigator')
    .replace(/^(Likely cause|Evidence|Potential anomalies|Related runtime events|Response schema|Differences from successful request|Trace|Alternative explanations|Next actions|Request headers|Response headers|Request body|Response body|Stack traces|Environment|Reproduction steps)$/gm, '## $1')
}

export function formatJiraReport(record: InvestigationRecord): string {
  return formatInvestigationReport(record)
    .replace(/^Chrome Runtime Investigator$/m, 'h1. Chrome Runtime Investigator')
    .replace(/^(Likely cause|Evidence|Potential anomalies|Related runtime events|Response schema|Differences from successful request|Trace|Alternative explanations|Next actions|Request headers|Response headers|Request body|Response body|Stack traces|Environment|Reproduction steps)$/gm, 'h2. $1')
}

export function formatJsonReport(record: InvestigationRecord): string {
  return JSON.stringify(record, (key, value) => key === 'screenshot' && typeof value === 'string' ? '[captured separately]' : value, 2)
}
