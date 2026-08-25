import type { EvidenceGraph, InvestigationResult } from './types'

function isCorsLike(message: string): boolean {
  return /cors|access-control|failed to fetch|networkerror|network error|aborted/i.test(message)
}

function isTimeoutLike(message: string, statusText: string): boolean {
  return /timeout|timed out|abort|504|gateway timeout/i.test(`${message} ${statusText}`)
}

export function reasonFromEvidence(graph: EvidenceGraph): InvestigationResult {
  const evidence: string[] = []
  evidence.push(`${graph.request.method} ${graph.request.url} returned ${graph.request.status} ${graph.response.statusText}`.trim())

  const semanticDiff = graph.comparison?.semanticDiff ?? []
  for (const finding of semanticDiff) evidence.push(finding)
  for (const anomaly of graph.anomalies) evidence.push(`Anomaly: ${anomaly}`)
  if (graph.relatedEvents.length > 0) {
    const first = graph.relatedEvents[0]
    evidence.push(`Related runtime event: ${first.message}${first.source ? ` (${first.source}:${first.line ?? 1})` : ''}`)
    if (graph.relatedEvents.length > 1) evidence.push(`${graph.relatedEvents.length - 1} additional runtime event(s) correlated within window`)
  }
  if (graph.redactionApplied) evidence.push('Sensitive fields were redacted before analysis')
  if (Object.keys(graph.response.schemaHint).length) evidence.push(`Response schema hint: ${Object.entries(graph.response.schemaHint).map(([k,v])=>`${k}:${v}`).join(', ')}`)

  const status = graph.request.status
  const statusText = graph.response.statusText ?? ''
  const typeDiff = semanticDiff.find((entry) => entry.includes('changed type'))
  const valueDiff = semanticDiff.find((entry) => entry.includes('changed value'))
  const firstEventMsg = graph.relatedEvents[0]?.message ?? ''
  const hasCorsSignal = graph.relatedEvents.some((e) => isCorsLike(e.message)) || isCorsLike(statusText)
  const hasTimeoutSignal = isTimeoutLike(firstEventMsg, statusText) || graph.anomalies.some((a) => /latency|timeout/i.test(a))

  let diagnosis = 'Request failure likely caused by an API or server-side issue.'
  let confidence = 0.62
  let alternatives: string[] = []
  let nextActions: string[] = []

  if (status === 0) {
    if (hasCorsSignal) {
      diagnosis = 'Likely cause: CORS or network failure blocked the request before a response was received.'
      confidence = 0.91
      alternatives = ['Transient network partition or offline state.', 'Mixed-content or CSP block.']
      nextActions = ['Check DevTools Network > Headers for CORS errors', 'Verify Access-Control-Allow-Origin on the endpoint', 'Retry with network throttling disabled']
    } else if (hasTimeoutSignal || graph.anomalies.some((a)=>a.includes('latency'))) {
      diagnosis = 'Likely cause: client-side timeout or abort interrupted the request.'
      confidence = 0.87
      alternatives = ['Unhandled runtime exception before fetch completed.', 'Service worker aborted the request.']
      nextActions = ['Inspect initiator source line', 'Increase timeout and retry', 'Check runtime events for abort signal']
    } else if (graph.relatedEvents.length) {
      diagnosis = 'Likely cause: an unhandled client-side runtime failure interrupted the page.'
      confidence = 0.88
      alternatives = ['Extension or service worker interfered with the request.', 'Page navigation cancelled the request.']
      nextActions = ['Show source', 'Trace request', 'Inspect runtime stack']
    } else {
      diagnosis = 'Likely cause: network failure with no response (status 0).'
      confidence = 0.72
      alternatives = ['DNS or connectivity issue.', 'Request blocked by browser.']
      nextActions = ['Trace request', 'Check Network panel for (failed) entry', 'Verify endpoint URL']
    }
  } else if (status === 429) {
    diagnosis = 'Likely cause: rate limiting - server rejected request due to quota.'
    confidence = 0.92
    alternatives = ['Client retry loop without backoff.', 'Misconfigured throttle headers.']
    nextActions = ['Inspect Retry-After / RateLimit headers', 'Compare successful request', 'Implement exponential backoff']
  } else if (status === 401 || status === 403) {
    diagnosis = 'Likely cause: authentication or authorization problem.'
    confidence = 0.9
    alternatives = typeDiff ? ['Token payload shape changed (type diff).'] : ['Token expired or scope insufficient.']
    nextActions = ['Compare successful request', 'Show source for auth header construction', 'Verify token in Application > Storage']
  } else if (status === 404) {
    diagnosis = 'Likely cause: endpoint not found - routing or URL construction error.'
    confidence = 0.86
    alternatives = ['Resource deleted between requests.', 'Base URL or path param mismatch.']
    nextActions = ['Compare successful request URL', 'Show source', 'Verify route registration on server']
  } else if (status === 408 || status === 504 || hasTimeoutSignal) {
    diagnosis = 'Likely cause: gateway timeout while processing the request.'
    confidence = 0.84
    alternatives = ['Backend dependency is slow.', 'Payload too large causing timeout.']
    nextActions = ['Check request timingMs', 'Inspect server logs for slow query', 'Retry with smaller payload']
  } else if (status === 413) {
    diagnosis = 'Likely cause: payload too large - server rejected body size.'
    confidence = 0.89
    alternatives = ['Client sent uncompressed payload.', 'Server maxBodySize recently lowered.']
    nextActions = ['Compare successful request body size', 'Check Content-Length header', 'Truncate or compress payload']
  } else if ((status === 422 || status === 400) && semanticDiff.length) {
    diagnosis = typeDiff
      ? 'Likely cause: API contract mismatch between expected and actual payload schema.'
      : 'Likely cause: validation failure - payload values rejected by server.'
    confidence = typeDiff ? 0.94 : 0.88
    alternatives = ['Backend validation rule changed for this endpoint.', 'Client-side request construction mutated field values before sending.']
    nextActions = ['Compare successful request', 'Show source', 'Inspect response body for validation errors']
  } else if (typeDiff && status >= 400) {
    diagnosis = 'Likely cause: API contract mismatch between expected and actual payload schema.'
    confidence = 0.94
    alternatives = ['Schema migration without client update.', 'Feature flag changed field type.']
    nextActions = ['Compare successful request', 'Trace request', 'Check API changelog']
  } else if (valueDiff && status >= 400) {
    diagnosis = 'Likely cause: semantic payload drift - values differ from last successful request.'
    confidence = 0.82
    alternatives = ['Data-dependent bug only on certain inputs.', 'Environment-specific fixture mismatch.']
    nextActions = ['Compare successful request', 'Inspect reproduction steps', 'Diff headers for auth/context changes']
  } else if (status >= 500) {
    const isGateway = status === 502 || status === 503
    diagnosis = isGateway
      ? 'Likely cause: upstream service unavailable (gateway/proxy failure).'
      : 'Likely cause: backend service failure while processing the request.'
    confidence = isGateway ? 0.83 : 0.85
    alternatives = ['Database or downstream dependency failure.', 'Deploy or config rollout in progress.']
    nextActions = ['Trace request', 'Check server logs around request time', 'Retry and compare if idempotent']
  } else if (status >= 400) {
    diagnosis = 'Likely cause: client error - server rejected the request.'
    confidence = 0.68
    alternatives = ['Missing required header or field.', 'Stale client cache.']
    nextActions = ['Compare successful request', 'Inspect response body', 'Show source']
  }

  // Confidence adjustment from evidence strength
  if (semanticDiff.length >= 2) confidence = Math.min(0.97, confidence + 0.04)
  if (graph.anomalies.length >= 2) confidence = Math.min(0.97, confidence + 0.02)
  if (graph.relatedEvents.length >= 2) confidence = Math.min(0.97, confidence + 0.02)
  if (!graph.comparison?.previousSuccess && status >= 400) confidence = Math.max(0.55, confidence - 0.06)

  // Fallbacks if not set
  if (!alternatives.length) {
    alternatives = [
      'Backend validation rule changed for this endpoint.',
      'Client-side request construction mutated field values before sending.',
    ]
  }
  if (!nextActions.length) nextActions = ['Compare successful request', 'Trace request', 'Show source', 'Investigate further']

  return { diagnosis, confidence: Math.round(confidence * 100) / 100, evidence, alternatives, nextActions }
}
