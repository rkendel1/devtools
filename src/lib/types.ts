export type JsonObject = Record<string, unknown>

export interface NetworkRequestSnapshot {
  id: string
  startedAt: number
  endedAt?: number
  method: string
  url: string
  status: number
  statusText: string
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  requestBody?: string
  responseBody?: string
  initiator?: {
    source?: string
    line?: number
    functionName?: string
  }
  timingMs?: number
}

export interface ConsoleEvent {
  type: 'console.error' | 'runtime.error'
  message: string
  source?: string
  line?: number
  stack?: string
  ts: number
}

export interface TraceStep {
  label: string
  source?: string
  line?: number
}

export interface EvidenceGraph {
  request: {
    method: string
    url: string
    status: number
  }
  initiator?: {
    source?: string
    line?: number
  }
  response: {
    statusText: string
    schemaHint: Record<string, string>
  }
  relatedEvents: Array<{
    type: string
    message: string
    source?: string
    line?: number
  }>
  comparison?: {
    previousSuccess?: JsonObject
    current?: JsonObject
    semanticDiff?: string[]
  }
  anomalies: string[]
  trace: TraceStep[]
  redactionApplied: boolean
}

export interface InvestigationResult {
  diagnosis: string
  confidence: number
  evidence: string[]
  alternatives: string[]
  nextActions: string[]
}

export interface InvestigationRecord {
  id: string
  createdAt: number
  requestId: string
  requestUrl: string
  graph: EvidenceGraph
  result: InvestigationResult
}
