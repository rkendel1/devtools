/**
 * Replay Contract: Immutable interface for reproducing observed failures
 *
 * Phase 4 contract: Define what a replay needs and what it produces
 * Phase 5 will mutate fixtures to run counterfactuals
 * Phase 6 will isolate root causes by testing variants
 */

export type ReplayOutcomeStatus = 'REPRODUCED' | 'PARTIAL' | 'NOT_REPRODUCED' | 'UNDETERMINED'

export interface ReplayFixture {
  id: string
  investigationId: string

  // What we're trying to reproduce
  target: {
    pageUrl: string
    requestId: string
    requestMethod: string
    requestUrl: string
  }

  // Initial browser state (captured from investigation)
  initialState: {
    url: string
    viewport?: { width: number; height: number }
    cookies?: Array<{ name: string; value: string }>
    localStorage?: Record<string, string>
  }

  // User interactions to perform
  interactions: UserInteraction[]

  // Captured network responses to mock
  networkFixtures: NetworkFixture[]

  // Expected outcome (from original investigation)
  expectedOutcome: {
    requestStatus: number
    responseStatusText: string
    errorCount: number
    timing?: { min: number; max: number }
  }

  // Back-references to evidence nodes in FeltDB
  evidenceRefs: {
    capturiedAt: number
    investigationNodeId: string
    requestNodeIds: string[]
    responseNodeIds: string[]
    eventNodeIds: string[]
  }

  // What capabilities this fixture requires
  capabilities: {
    navigation: boolean
    clicks: boolean
    inputs: boolean
    networkInterception: boolean
    timing: boolean
    localStorage: boolean
    cookies: boolean
  }

  createdAt: number
}

export type UserInteraction = NavigateInteraction | ClickInteraction | InputInteraction | WaitInteraction

export interface NavigateInteraction {
  type: 'navigate'
  url: string
  waitForNavigation?: boolean
}

export interface ClickInteraction {
  type: 'click'
  selector: string
  waitForNavigation?: boolean
  delayMs?: number
}

export interface InputInteraction {
  type: 'input'
  selector: string
  value: string
  delayMs?: number
}

export interface WaitInteraction {
  type: 'wait'
  delayMs: number
}

export interface NetworkFixture {
  id: string
  pattern: string // URL pattern or exact URL
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  responseStatus: number
  responseHeaders: Record<string, string>
  responseBody: string
  timing?: { delayMs: number }
  priority?: number // Higher priority matches first
  matchCount?: number // How many times this was captured
}

export interface OutcomeSignature {
  // The key request we're tracking
  targetRequest: {
    method: string
    url: string
  }

  // HTTP outcome
  status: number
  statusText: string

  // Did the response have expected shape?
  responseFingerprint: string // Hash of key response fields
  responseSize?: number

  // Errors that occurred
  errorFingerprints: string[] // Hashes of error messages
  errorCount: number

  // Runtime events relevant to the failure
  relevantRuntimeEvents: Array<{
    type: 'console.error' | 'runtime.error'
    message: string
    fingerprint: string
  }>

  // Timing information
  timing: {
    requestDuration: number
    totalTime: number
  }

  // Which evidence nodes support this outcome
  causalEvidence: string[] // FeltDB node IDs
}

export interface ReplayRun {
  id: string
  fixtureId: string
  investigationId: string

  // Execution record
  startedAt: number
  completedAt: number
  durationMs: number

  // What happened during replay
  observations: ReplayObservation[]

  // Outcome classification
  outcome: {
    status: ReplayOutcomeStatus
    confidence: number // 0-1: how confident are we in this classification?
    signature: OutcomeSignature
    unsupportedCapabilities: string[] // Features we couldn't test
    notes: string
  }

  // Back-reference: what evidence does this replay produce?
  producedEvidence: {
    observationNodeIds: string[] // New evidence nodes created in FeltDB
    timestampRange: { start: number; end: number }
  }

  // Was this a successful reproduction?
  matches: {
    status: boolean // Same HTTP status?
    errorCount: boolean // Same number of errors?
    timing: boolean // Within timing envelope?
    behavior: boolean // Qualitative match?
    overall: boolean // Would we call this "reproduced"?
  }
}

export interface ReplayObservation {
  timestamp: number
  type: 'navigation' | 'network' | 'interaction' | 'event' | 'outcome'
  description: string
  success: boolean
  details?: Record<string, unknown>
}

export function createReplayFixture(
  investigationId: string,
  targetRequestId: string,
  targetUrl: string,
  targetMethod: string,
  pageUrl: string
): ReplayFixture {
  return {
    id: `replay:${investigationId}:${Date.now()}`,
    investigationId,
    target: {
      pageUrl,
      requestId: targetRequestId,
      requestMethod: targetMethod,
      requestUrl: targetUrl,
    },
    initialState: {
      url: pageUrl,
    },
    interactions: [],
    networkFixtures: [],
    expectedOutcome: {
      requestStatus: 0,
      responseStatusText: '',
      errorCount: 0,
    },
    evidenceRefs: {
      capturiedAt: Date.now(),
      investigationNodeId: investigationId,
      requestNodeIds: [],
      responseNodeIds: [],
      eventNodeIds: [],
    },
    capabilities: {
      navigation: true,
      clicks: true,
      inputs: true,
      networkInterception: true,
      timing: true,
      localStorage: false,
      cookies: false,
    },
    createdAt: Date.now(),
  }
}

export function classifyOutcome(
  original: OutcomeSignature,
  replay: OutcomeSignature
): ReplayOutcomeStatus {
  // REPRODUCED: Same status + error count + behavior
  if (original.status === replay.status && original.errorCount === replay.errorCount) {
    if (original.responseFingerprint === replay.responseFingerprint) {
      return 'REPRODUCED'
    }
    // Status matches but response differs slightly
    if (original.errorFingerprints.length === replay.errorFingerprints.length) {
      return 'REPRODUCED'
    }
  }

  // PARTIAL: Same error pattern but different timing/payload
  if (original.status === replay.status && original.errorCount === replay.errorCount) {
    return 'PARTIAL'
  }

  // NOT_REPRODUCED: Different outcome
  if (original.status !== replay.status || original.errorCount !== replay.errorCount) {
    return 'NOT_REPRODUCED'
  }

  // UNDETERMINED: Couldn't determine due to missing data
  return 'UNDETERMINED'
}

export function createResponseFingerprint(
  status: number,
  headers: Record<string, string>,
  body: string | null
): string {
  // Create a semantic hash of response structure, not exact bytes
  const parts = [
    status.toString(),
    Object.keys(headers)
      .sort()
      .join(','),
    body ? Math.round(Buffer.byteLength(body) / 100).toString() : '0', // Size bucket
  ]

  // Simple hash
  let hash = 0
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const char = part.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
  }

  return `fp:${Math.abs(hash)}`
}

export function createErrorFingerprint(message: string): string {
  // Hash error message to detect equivalent errors
  let hash = 0
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return `err:${Math.abs(hash)}`
}
