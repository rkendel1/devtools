import type { ConsoleEvent, EvidenceGraph, JsonObject, NetworkRequestSnapshot, PrivacySettings, TraceStep } from './types'
import { redactHeaders, redactText } from './redaction'
import { normalizeJsonDeterministic } from './wasm'

function parseJsonObject(input: string | undefined): JsonObject | undefined {
  if (!input) return undefined
  try {
    const parsed = JSON.parse(input)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject
    }
  } catch {
    return undefined
  }
  return undefined
}

function inferSchemaHint(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function inferResponseSchema(responseBody: string | undefined): Record<string, string> {
  const json = parseJsonObject(responseBody)
  if (!json) {
    return {}
  }

  return Object.fromEntries(Object.entries(json).slice(0, 12).map(([key, value]) => [key, inferSchemaHint(value)]))
}

function stableStringify(value: unknown): string {
  // Prefer WASM deterministic normalization when available, fallback to JS.
  try {
    return normalizeJsonDeterministic(JSON.stringify(value))
  } catch {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${(value as unknown[]).map((v) => stableStringify(v)).join(',')}]`
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
  }
}

function diffObjects(previous: JsonObject | undefined, current: JsonObject | undefined, prefix = ''): string[] {
  if (!previous || !current) {
    return []
  }

  const changes: string[] = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])

  for (const key of keys) {
    const a = previous[key]
    const b = current[key]
    if (stableStringify(a) === stableStringify(b)) {
      continue
    }

    const aType = inferSchemaHint(a)
    const bType = inferSchemaHint(b)
    const label = prefix ? `${prefix}${key}` : key
    if (aType !== bType) {
      changes.push(`${label} changed type from ${aType} to ${bType}`)
    } else {
      changes.push(`${label} changed value from ${JSON.stringify(a)} to ${JSON.stringify(b)}`)
    }
  }

  return changes
}

function diffHeaders(previous: Record<string, string> | undefined, current: Record<string, string> | undefined): string[] {
  if (!previous || !current) return []
  const changes: string[] = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)].map((k) => k.toLowerCase()))
  const lowerPrev = Object.fromEntries(Object.entries(previous).map(([k, v]) => [k.toLowerCase(), v]))
  const lowerCurr = Object.fromEntries(Object.entries(current).map(([k, v]) => [k.toLowerCase(), v]))
  for (const key of keys) {
    const a = lowerPrev[key]
    const b = lowerCurr[key]
    if (a === b) continue
    if (a === undefined) changes.push(`header ${key} added with value ${JSON.stringify(b)}`)
    else if (b === undefined) changes.push(`header ${key} removed (was ${JSON.stringify(a)})`)
    else changes.push(`header ${key} changed from ${JSON.stringify(a)} to ${JSON.stringify(b)}`)
  }
  return changes.slice(0, 8)
}

function buildTrace(request: NetworkRequestSnapshot, relatedEvents: ConsoleEvent[], diffCount: number): TraceStep[] {
  const trace: TraceStep[] = [
    {
      label: `Request started${request.initiator?.functionName ? ` (${request.initiator.functionName})` : ''}`,
      source: request.initiator?.source,
      line: request.initiator?.line,
    },
    { label: `${request.method} ${request.url}${request.timingMs ? ` — ${Math.round(request.timingMs)}ms` : ''}` },
    { label: `Response ${request.status} ${request.statusText}`.trim() },
  ]
  if (diffCount) trace.push({ label: `${diffCount} payload field(s) differ from last successful request` })

  for (const event of relatedEvents.slice(0, 3)) {
    trace.push({
      label: event.message,
      source: event.source,
      line: event.line,
    })
  }

  return trace
}

function detectAnomalies(
  request: NetworkRequestSnapshot,
  allRequests: NetworkRequestSnapshot[],
  relatedEvents: ConsoleEvent[],
  semanticDiff: string[],
  headerDiff: string[],
): string[] {
  const anomalies: string[] = []

  const duplicateCount = allRequests.filter((candidate) => candidate.url === request.url && candidate.method === request.method).length
  if (duplicateCount >= 5) {
    anomalies.push(`${request.url} requested ${duplicateCount} times in this session.`)
  }

  if (request.timingMs && request.timingMs > 3000) {
    anomalies.push(`Request latency is high (${Math.round(request.timingMs)} ms).`)
  }
  if (request.timingMs && request.timingMs > 8000) {
    anomalies.push('Request exceeded 8s — likely timeout or stalled connection.')
  }

  if (relatedEvents.length > 0 && request.status < 400) {
    anomalies.push('Request succeeded but runtime errors were captured immediately after response.')
  }

  if (semanticDiff.some((entry) => entry.includes('changed type'))) {
    anomalies.push('Payload shape changed compared with previous successful request.')
  }
  if (headerDiff.length) {
    anomalies.push(`Headers differ from successful peer: ${headerDiff.slice(0,2).join('; ')}`)
  }
  if (request.status >= 400 && !request.responseBody) {
    anomalies.push('Error response has empty body - missing server error details.')
  }
  if (request.requestBody && request.requestBody.length > 64 * 1024) {
    anomalies.push(`Request body is large (${Math.round(request.requestBody.length/1024)} KiB) - possible 413 risk.`)
  }
  if (request.status === 0) {
    anomalies.push('No HTTP response received (status 0) - CORS, network, or abort.')
  }
  if (request.status === 429) {
    anomalies.push('Rate-limited (429) - check Retry-After header and backoff.')
  }
  const contentType = request.requestHeaders['content-type'] ?? request.requestHeaders['Content-Type']
  if (contentType?.includes('application/json') && request.requestBody) {
    try { JSON.parse(request.requestBody) } catch { anomalies.push('Content-Type is JSON but request body is not valid JSON.') }
  }
  if (relatedEvents.some((e) => /cors|access-control/i.test(e.message))) {
    anomalies.push('CORS-related runtime event detected near request window.')
  }

  return anomalies
}

export function buildEvidenceGraph(
  request: NetworkRequestSnapshot,
  successfulPeer: NetworkRequestSnapshot | undefined,
  allRequests: NetworkRequestSnapshot[],
  consoleEvents: ConsoleEvent[],
  privacy: PrivacySettings = { sensitiveKeys: [], includeHeaders: true, includeBodies: true },
  environment?: { pageUrl?: string; userAgent?: string; viewport?: string },
  screenshot?: string,
): EvidenceGraph {
  const requestHeadersResult = redactHeaders(request.requestHeaders, privacy.sensitiveKeys)
  const responseHeadersResult = redactHeaders(request.responseHeaders, privacy.sensitiveKeys)
  const requestBodyResult = redactText(request.requestBody, privacy.sensitiveKeys)
  const responseBodyResult = redactText(request.responseBody, privacy.sensitiveKeys)

  const currentBodyJson = parseJsonObject(requestBodyResult.redacted)
  const successBodyJson = parseJsonObject(successfulPeer?.requestBody)
  const currentResponseJson = parseJsonObject(responseBodyResult.redacted)
  const successResponseJson = parseJsonObject(successfulPeer?.responseBody)

  const relatedEvents = consoleEvents
    .filter((event) => event.ts >= request.startedAt - 1000 && event.ts <= (request.endedAt ?? request.startedAt) + 15_000)
    .slice(-6)

  const requestDiff = diffObjects(successBodyJson, currentBodyJson)
  const responseDiff = diffObjects(successResponseJson, currentResponseJson, 'response.')
  const headerDiff = diffHeaders(successfulPeer?.requestHeaders, request.requestHeaders)
  const responseHeaderDiff = diffHeaders(successfulPeer?.responseHeaders, request.responseHeaders)
  const semanticDiff = [...requestDiff, ...responseDiff, ...headerDiff, ...responseHeaderDiff].slice(0, 16)
  const anomalies = detectAnomalies(request, allRequests, relatedEvents, semanticDiff, headerDiff)

  return {
    request: {
      method: request.method,
      url: request.url,
      status: request.status,
    },
    initiator: {
      source: request.initiator?.source,
      line: request.initiator?.line,
    },
    response: {
      statusText: request.statusText,
      schemaHint: inferResponseSchema(responseBodyResult.redacted),
    },
    relatedEvents: relatedEvents.map((event) => ({
      type: event.type,
      message: event.message,
      source: event.source,
      line: event.line,
    })),
    comparison: {
      previousSuccess: successBodyJson,
      current: currentBodyJson,
      semanticDiff,
    },
    anomalies,
    trace: buildTrace(request, relatedEvents, semanticDiff.length),
    redactionApplied:
      requestHeadersResult.changed ||
      responseHeadersResult.changed ||
      requestBodyResult.changed ||
      responseBodyResult.changed,
    bundle: {
      requestHeaders: privacy.includeHeaders ? requestHeadersResult.redacted : undefined,
      responseHeaders: privacy.includeHeaders ? responseHeadersResult.redacted : undefined,
      requestBody: privacy.includeBodies ? requestBodyResult.redacted : undefined,
      responseBody: privacy.includeBodies ? responseBodyResult.redacted : undefined,
      runtimeEvents: relatedEvents.map((event) => ({ ...event, stack: redactText(event.stack, privacy.sensitiveKeys).redacted })),
      environment,
      screenshot,
      reproductionSteps: [
        `Open ${environment?.pageUrl ?? 'the inspected page'}.`,
        `Trigger ${request.method} ${request.url}.`,
        `Observe response ${request.status} ${request.statusText}${relatedEvents.length ? ` and runtime event: ${relatedEvents[0].message}` : ''}.`,
      ],
    },
  }
}
