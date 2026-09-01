/**
 * Proposal Bridge protocol.
 *
 * Studio and the IDE already share one FeltDB development workspace connection.
 * The bridge reuses it: requests and responses are ordinary workspace records,
 * so there is no second connection registry and no second proposal transport.
 *
 * The protocol carries proposal *identifiers*, never proposal bodies. The
 * repository side reads `_feltdb.Proposal` itself, which is what keeps DevTools
 * from ever holding its own copy of a proposal.
 *
 * Every request is a read of the repository. There is deliberately no request
 * kind that writes to the repository or to `_feltdb.Proposal`: not from Studio,
 * not from the Proposal API, not from the IDE connection. `bind_proposal` is the
 * one stateful kind, and the only state it touches is the DevTools session's own
 * `activeProposalId`. Application is `feltdb ai apply`.
 */

import type { ProposalReadiness, ProposalStatus } from './proposal.js'
import type { ContractFingerprint, RepositoryContext, RepositoryFile, RepositoryFingerprint, SourcePlanEntry } from './repositoryContext.js'
import { describePathRejection, resolveRepositoryPath } from './repositoryContext.js'

export const PROPOSAL_BRIDGE_REQUEST_COLLECTION = 'proposal_bridge_requests'
export const PROPOSAL_BRIDGE_RESPONSE_COLLECTION = 'proposal_bridge_responses'

/** The complete request surface. Read-only against the repository, by construction. */
export const BRIDGE_REQUEST_KINDS = [
  'bind_proposal',
  'repository_context',
  'read_file',
  'proposal_context',
  'proposal_readiness',
  'proposal_diagnostic',
  'open_in_ide',
] as const

export type BridgeRequestKind = typeof BRIDGE_REQUEST_KINDS[number]

export interface BridgeRequest {
  kind: 'proposal_bridge_request'
  requestId: string
  request: BridgeRequestKind
  /** Identifier only. The repository side resolves the proposal from FeltDB. */
  proposalId?: string
  path?: string
  issuedBy: string
  issuedAt: number
}

/** Requests that must name the proposal they act on. */
export function requiresProposalId(request: BridgeRequestKind): boolean {
  return request === 'proposal_context' || request === 'proposal_readiness'
    || request === 'proposal_diagnostic' || request === 'open_in_ide'
}

export interface BridgeError {
  code: 'unsupported_request' | 'not_connected' | 'proposal_not_found' | 'proposal_mismatch' | 'path_refused' | 'not_found' | 'failed'
  message: string
}

/**
 * The DevTools session's proposal binding.
 *
 * A bound session answers only for that proposal, so an IDE cannot drift from
 * "I am working on Proposal p_123" into arbitrary repository work without the
 * developer seeing it.
 */
export interface ProposalBinding {
  proposalId: string
  status: ProposalStatus
  boundAt: number
}

/** How long a proposal context snapshot may be treated as current. */
export const PROPOSAL_CONTEXT_TTL_MS = 30_000

/**
 * A refreshable view of a proposal against the repository.
 *
 * Carries the proposal's operational fields only — status, fingerprints, plan,
 * warnings. The narrative body (summary, intent, rationale) stays in
 * `_feltdb.Proposal` and never travels over the bridge, so no bridge record can
 * be mistaken for, or reassembled into, a proposal.
 *
 * The proposal is durable state; this snapshot is ephemeral context. It is
 * recomputed on every request and expires — never cache it indefinitely.
 */
export interface ProposalContextSnapshot {
  proposalId: string
  status: ProposalStatus
  contract: ContractFingerprint | null
  flow: RepositoryFingerprint | null
  repositoryCommit: string
  readiness: ProposalReadiness
  sourcePlan: SourcePlanEntry[]
  /** Paths only. Contents come from `read_file` or the local IDE handoff. */
  relevantFiles: string[]
  warnings: string[]
  refreshedAt: number
  expiresAt: number
}

/** True once a snapshot has aged past its TTL and must be refreshed. */
export function isProposalContextStale(snapshot: ProposalContextSnapshot, now = Date.now()): boolean {
  return now >= snapshot.expiresAt
}

export interface BridgeResponse {
  kind: 'proposal_bridge_response'
  requestId: string
  request: BridgeRequestKind
  ok: boolean
  error?: BridgeError
  /** The session's proposal binding at the time of the response, when bound. */
  binding?: ProposalBinding | null
  repository?: RepositoryContext
  file?: RepositoryFile
  /** True when a read landed outside the bound proposal's source plan. */
  outsideSourcePlan?: boolean
  context?: ProposalContextSnapshot
  readiness?: ProposalReadiness
  diagnostic?: string
  opened?: { proposalId: string; relevantFiles: string[] }
  respondedAt: number
}

export interface BridgeConnectionEvent<T> {
  type: 'created' | 'updated' | 'deleted'
  entityId: string
  value?: T
}

/**
 * The subset of `DevelopmentWorkspaceConnection` the bridge uses.
 *
 * Note what is absent: no filesystem, no repository writes, and no publish to
 * `_feltdb.Proposal`. The bridge can only read the proposal it is given.
 */
export interface BridgeConnection {
  publish(collection: string, entity: object): Promise<string>
  subscribe<T>(collection: string, handler: (event: BridgeConnectionEvent<T>) => void): () => void
  get<T>(collection: string, entityId: string): Promise<T | null>
}

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BridgeRequest>
  return candidate.kind === 'proposal_bridge_request'
    && typeof candidate.requestId === 'string'
    && BRIDGE_REQUEST_KINDS.includes(candidate.request as BridgeRequestKind)
}

export function isBridgeResponse(value: unknown): value is BridgeResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BridgeResponse>
  return candidate.kind === 'proposal_bridge_response' && typeof candidate.requestId === 'string'
}

export const DEFAULT_BRIDGE_TIMEOUT_MS = 15_000

export interface ProposalBridgeClientOptions {
  clientId?: string
  timeoutMs?: number
}

/**
 * Studio/DevTools side of the bridge.
 *
 * Issues bounded repository-context reads over the existing workspace
 * connection and resolves the matching response.
 */
export class ProposalBridgeClient {
  private readonly pending = new Map<string, { resolve: (value: BridgeResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private unsubscribe: (() => void) | undefined
  private sequence = 0

  private readonly connection: BridgeConnection
  private readonly options: ProposalBridgeClientOptions
  private currentBinding: ProposalBinding | null = null

  constructor(connection: BridgeConnection, options: ProposalBridgeClientOptions = {}) {
    this.connection = connection
    this.options = options
  }

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.connection.subscribe<BridgeResponse>(PROPOSAL_BRIDGE_RESPONSE_COLLECTION, (event) => {
      if (event.type === 'deleted' || !isBridgeResponse(event.value)) return
      const waiting = this.pending.get(event.value.requestId)
      if (!waiting) return
      clearTimeout(waiting.timer)
      this.pending.delete(event.value.requestId)
      waiting.resolve(event.value)
    })
  }

  /** The proposal this session is bound to, as last confirmed by the repository side. */
  get binding(): ProposalBinding | null { return this.currentBinding }

  /**
   * Bind this session to a proposal.
   *
   * Once bound, every request is evaluated against that proposal and the
   * repository side refuses requests naming a different one.
   */
  async bindProposal(proposalId: string): Promise<ProposalBinding> {
    const response = await this.send('bind_proposal', { proposalId })
    if (!response.binding) throw bridgeError(response, `The bridge did not bind proposal ${proposalId}.`)
    return response.binding
  }

  /** Release the binding, so the session answers for the repository generally again. */
  async unbindProposal(): Promise<void> {
    await this.send('bind_proposal', {})
  }

  async getRepositoryContext(): Promise<RepositoryContext> {
    const response = await this.send('repository_context', {})
    if (!response.repository) throw bridgeError(response, 'The bridge returned no repository context.')
    return response.repository
  }

  /**
   * Refresh the proposal's context against the repository.
   *
   * Always round-trips: the proposal is durable state and may have gone stale,
   * been rejected, or expired since the last call. Callers must not hold the
   * result past `expiresAt`.
   */
  async getProposalContext(proposalId: string): Promise<ProposalContextSnapshot> {
    const response = await this.send('proposal_context', { proposalId })
    if (!response.context) throw bridgeError(response, `The bridge returned no context for ${proposalId}.`)
    return response.context
  }

  async readFile(path: string): Promise<RepositoryFile> {
    const resolution = resolveRepositoryPath(path)
    if (!resolution.ok) throw new Error(describePathRejection(resolution.reason))
    const response = await this.send('read_file', { path: resolution.path })
    if (!response.file) throw bridgeError(response, `The bridge returned no contents for ${resolution.path}.`)
    return response.file
  }

  async getProposalReadiness(proposalId: string): Promise<ProposalReadiness> {
    const response = await this.send('proposal_readiness', { proposalId })
    if (!response.readiness) throw bridgeError(response, `The bridge returned no readiness result for ${proposalId}.`)
    return response.readiness
  }

  async proposalDiagnostic(proposalId: string): Promise<string> {
    const response = await this.send('proposal_diagnostic', { proposalId })
    if (response.diagnostic === undefined) throw bridgeError(response, `The bridge returned no diagnostic for ${proposalId}.`)
    return response.diagnostic
  }

  /** Hand the connected IDE the proposal context. The IDE reads the proposal itself. */
  async openInIde(proposalId: string): Promise<{ proposalId: string; relevantFiles: string[] }> {
    const response = await this.send('open_in_ide', { proposalId })
    if (!response.opened) throw bridgeError(response, `The connected IDE did not open proposal ${proposalId}.`)
    return response.opened
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.currentBinding = null
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer)
      waiting.reject(new Error('The proposal bridge was disconnected.'))
    }
    this.pending.clear()
  }

  private async send(request: BridgeRequestKind, fields: Pick<BridgeRequest, 'proposalId' | 'path'>): Promise<BridgeResponse> {
    this.start()
    const requestId = `pbr_${Date.now().toString(36)}_${(this.sequence += 1).toString(36)}`
    const envelope: BridgeRequest = {
      kind: 'proposal_bridge_request',
      requestId,
      request,
      ...fields,
      issuedBy: this.options.clientId ?? 'devtools',
      issuedAt: Date.now(),
    }
    const settled = new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`The connected repository did not answer ${request} within ${this.options.timeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS}ms.`))
      }, this.options.timeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, reject, timer })
    })
    await this.connection.publish(PROPOSAL_BRIDGE_REQUEST_COLLECTION, envelope)
    const response = await settled
    if (response.binding !== undefined) this.currentBinding = response.binding
    if (!response.ok) throw new Error(response.error?.message ?? `The proposal bridge refused ${request}.`)
    return response
  }
}

function bridgeError(response: BridgeResponse, fallback: string): Error {
  return new Error(response.error?.message ?? fallback)
}
