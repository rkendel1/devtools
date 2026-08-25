import type { ConsoleEvent, EvidenceGraph, JsonObject, NetworkRequestSnapshot, TraceStep } from './types'
import { redactHeaders, redactText } from './redaction'

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

function diffObjects(previous: JsonObject | undefined, current: JsonObject | undefined): string[] {
  if (!previous || !current) {
    return []
  }

  const changes: string[] = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])

  for (const key of keys) {
    const a = previous[key]
    const b = current[key]
    if (JSON.stringify(a) === JSON.stringify(b)) {
      continue
    }

    const aType = inferSchemaHint(a)
    const bType = inferSchemaHint(b)
    if (aType !== bType) {
      changes.push(`${key} changed type from ${aType} to ${bType}`)
    } else {
      changes.push(`${key} changed value from ${JSON.stringify(a)} to ${JSON.stringify(b)}`)
    }
  }

  return changes
}

function buildTrace(request: NetworkRequestSnapshot, relatedEvents: ConsoleEvent[]): TraceStep[] {
  const trace: TraceStep[] = [
    {
      label: 'Request started',
      source: request.initiator?.source,
      line: request.initiator?.line,
    },
    { label: `${request.method} ${request.url}` },
    { label: `Response ${request.status}` },
  ]

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
): string[] {
  const anomalies: string[] = []

  const duplicateCount = allRequests.filter((candidate) => candidate.url === request.url && candidate.method === request.method).length
  if (duplicateCount >= 5) {
    anomalies.push(`${request.url} requested ${duplicateCount} times in this session.`)
  }

  if (request.timingMs && request.timingMs > 3000) {
    anomalies.push(`Request latency is high (${Math.round(request.timingMs)} ms).`)
  }

  if (relatedEvents.length > 0 && request.status < 400) {
    anomalies.push('Request succeeded but runtime errors were captured immediately after response.')
  }

  if (semanticDiff.some((entry) => entry.includes('changed type'))) {
    anomalies.push('Payload shape changed compared with previous successful request.')
  }

  return anomalies
}

export function buildEvidenceGraph(
  request: NetworkRequestSnapshot,
  successfulPeer: NetworkRequestSnapshot | undefined,
  allRequests: NetworkRequestSnapshot[],
  consoleEvents: ConsoleEvent[],
): EvidenceGraph {
  const requestHeadersResult = redactHeaders(request.requestHeaders)
  const responseHeadersResult = redactHeaders(request.responseHeaders)
  const requestBodyResult = redactText(request.requestBody)
  const responseBodyResult = redactText(request.responseBody)

  const currentBodyJson = parseJsonObject(requestBodyResult.redacted)
  const successBodyJson = parseJsonObject(successfulPeer?.requestBody)

  const relatedEvents = consoleEvents
    .filter((event) => event.ts >= request.startedAt - 1000 && event.ts <= (request.endedAt ?? request.startedAt + 15_000))
    .slice(-6)

  const semanticDiff = diffObjects(successBodyJson, currentBodyJson)
  const anomalies = detectAnomalies(request, allRequests, relatedEvents, semanticDiff)

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
    trace: buildTrace(request, relatedEvents),
    redactionApplied:
      requestHeadersResult.changed ||
      responseHeadersResult.changed ||
      requestBodyResult.changed ||
      responseBodyResult.changed,
  }
}
