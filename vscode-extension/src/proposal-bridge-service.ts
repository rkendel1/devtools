/**
 * Proposal Bridge Service: the repository side of the DevTools bridge.
 *
 * Answers bounded repository-context requests from Studio and hands the local
 * agent proposal context when Studio opens a proposal in the IDE. It reads the
 * proposal from `_feltdb.Proposal` itself, so no proposal body ever travels
 * over the bridge and DevTools never holds a second copy of one.
 *
 * Every handler is a read of the repository. Nothing here writes to the
 * repository, and nothing here writes to `_feltdb.Proposal`: approval and
 * application stay with FeltDB and `feltdb ai apply`.
 *
 * A session may be bound to one proposal. While it is, requests naming another
 * proposal are refused and reads outside the proposal's source plan are flagged,
 * so the IDE cannot drift off the proposal it was opened for.
 */

import {
  PROPOSAL_BRIDGE_REQUEST_COLLECTION, PROPOSAL_BRIDGE_RESPONSE_COLLECTION, isBridgeRequest, requiresProposalId,
  type BridgeConnection, type BridgeError, type BridgeRequest, type BridgeResponse,
  type ProposalBinding, type ProposalContextSnapshot,
} from '../../src/lib/proposalBridge.js'
import {
  PROPOSAL_COLLECTION, evaluateProposalReadiness, isProposal, renderProposalDiagnostic,
  type Proposal, type ProposalReadiness,
} from '../../src/lib/proposal.js'
import {
  buildProposalContextSnapshot, buildProposalIdeContext,
  type ProposalIdeContext,
} from '../../src/lib/proposalContext.js'
import { resolveRepositoryPath } from '../../src/lib/repositoryContext.js'
import { RepositoryAccessError, type RepositoryContextProvider } from './repository-context.js'

export interface ProposalBridgeServiceOptions {
  connection: BridgeConnection
  provider: RepositoryContextProvider
  /** Invoked when Studio opens a proposal in the connected IDE. */
  onOpenInIde?: (context: ProposalIdeContext) => void | Promise<void>
  /** Invoked when the bound proposal's status changes in FeltDB. */
  onProposalChanged?: (proposal: Proposal) => void
  /** Invoked when a bound session reads a file outside the proposal's source plan. */
  onSourcePlanDrift?: (path: string, proposalId: string) => void
}

export class ProposalBridgeService {
  private unsubscribers: Array<() => void> = []
  private active: Proposal | undefined
  private boundAt = 0

  constructor(private readonly options: ProposalBridgeServiceOptions) {}

  /** The proposal this IDE is currently connected to, if any. */
  get activeProposal(): Proposal | undefined { return this.active }

  /** The session's proposal binding: `DevTools session └── activeProposalId`. */
  get activeProposalId(): string | undefined { return this.active?.proposal_id }

  get binding(): ProposalBinding | null {
    return this.active ? { proposalId: this.active.proposal_id, status: this.active.status, boundAt: this.boundAt } : null
  }

  /** Bind the session to a proposal, so every later request is evaluated against it. */
  async bind(proposalId: string): Promise<ProposalBinding> {
    this.active = await this.proposal(proposalId)
    this.boundAt = Date.now()
    return this.binding!
  }

  unbind(): void {
    this.active = undefined
    this.boundAt = 0
  }

  start(): void {
    if (this.unsubscribers.length) return
    this.unsubscribers = [
      this.options.connection.subscribe<BridgeRequest>(PROPOSAL_BRIDGE_REQUEST_COLLECTION, (event) => {
        if (event.type === 'deleted' || !isBridgeRequest(event.value)) return
        void this.handle(event.value)
      }),
      // Proposal status awareness: a proposal that goes stale, rejected, or
      // expired while the IDE is working on it must be visible to the IDE.
      // Only the bound proposal is tracked — an unbound session never adopts
      // whichever proposal happens to appear in the workspace.
      this.options.connection.subscribe<Proposal>(PROPOSAL_COLLECTION, (event) => {
        if (event.type === 'deleted' || !isProposal(event.value)) return
        if (event.value.proposal_id !== this.activeProposalId) return
        this.active = event.value
        this.options.onProposalChanged?.(event.value)
      }),
    ]
  }

  stop(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.unsubscribers = []
    this.unbind()
  }

  /** Assemble the proposal context the IDE agent works from, binding the session to it. */
  async proposalContext(proposalId: string): Promise<ProposalIdeContext> {
    const proposal = await this.proposal(proposalId)
    const [repository, relevantFiles] = await Promise.all([
      this.options.provider.context(),
      this.options.provider.filesForSourcePlan(proposal.source_plan ?? []),
    ])
    this.active = proposal
    this.boundAt = Date.now()
    return buildProposalIdeContext(proposal, repository, relevantFiles)
  }

  /**
   * Recompute the proposal's context against the repository.
   *
   * Never served from a cache: the proposal is durable state that may have gone
   * stale, been rejected, or expired since the last call.
   */
  async refreshProposalContext(proposalId: string): Promise<ProposalContextSnapshot> {
    const proposal = await this.proposal(proposalId)
    const [repository, relevantFiles] = await Promise.all([
      this.options.provider.context(),
      this.options.provider.filesForSourcePlan(proposal.source_plan ?? []),
    ])
    if (this.active?.proposal_id === proposalId) this.active = proposal
    return buildProposalContextSnapshot(proposal, repository, relevantFiles.map((file) => file.path))
  }

  /** The canonical readiness result Studio, the IDE, and the CLI all render. */
  async readiness(proposalId: string): Promise<ProposalReadiness> {
    const [proposal, repository] = await Promise.all([this.proposal(proposalId), this.options.provider.context()])
    return evaluateProposalReadiness(proposal, repository)
  }

  /** The `feltdb ai proposal <proposal-id>` report, rendered from that same result. */
  async diagnostic(proposalId: string): Promise<string> {
    return renderProposalDiagnostic(await this.readiness(proposalId))
  }

  private async proposal(proposalId: string): Promise<Proposal> {
    const value = await this.options.connection.get<unknown>(PROPOSAL_COLLECTION, proposalId)
    if (!isProposal(value)) throw new BridgeRequestError('proposal_not_found', `Proposal ${proposalId} was not found in FeltDB.`)
    return value
  }

  private async handle(request: BridgeRequest): Promise<void> {
    let response: BridgeResponse
    try {
      this.assertBinding(request)
      response = { ...await this.dispatch(request), kind: 'proposal_bridge_response', requestId: request.requestId, request: request.request, ok: true, binding: this.binding, respondedAt: Date.now() }
    }
    catch (error) { response = { kind: 'proposal_bridge_response', requestId: request.requestId, request: request.request, ok: false, error: bridgeError(error), binding: this.binding, respondedAt: Date.now() } }
    await this.options.connection.publish(PROPOSAL_BRIDGE_RESPONSE_COLLECTION, response)
  }

  /**
   * A bound session answers only for its proposal.
   *
   * Without this, an IDE opened for one proposal could quietly serve context
   * for another, and the developer would have no way to see it happen.
   */
  private assertBinding(request: BridgeRequest): void {
    const bound = this.activeProposalId
    if (!bound || request.request === 'bind_proposal') return
    if (requiresProposalId(request.request) && request.proposalId && request.proposalId !== bound) {
      throw new BridgeRequestError('proposal_mismatch', `This DevTools session is bound to proposal ${bound}. Rebind before requesting ${request.proposalId}.`)
    }
  }

  /** Whether a read landed outside the bound proposal's source plan. */
  private isOutsideSourcePlan(path: string): boolean {
    const plan = this.active?.source_plan
    if (!plan?.length) return false
    const resolution = resolveRepositoryPath(path)
    if (!resolution.ok) return true
    return !plan.some((entry) => resolveRepositoryPath(entry.path ?? '').ok && normalize(entry.path) === resolution.path)
  }

  private async dispatch(request: BridgeRequest): Promise<Partial<BridgeResponse>> {
    switch (request.request) {
      case 'bind_proposal': {
        if (!request.proposalId) { this.unbind(); return {} }
        await this.bind(request.proposalId)
        return {}
      }
      case 'repository_context':
        return { repository: await this.options.provider.context() }
      case 'read_file': {
        if (!request.path) throw new BridgeRequestError('path_refused', 'A repository-relative path is required.')
        const file = await this.options.provider.readFile(request.path)
        const outsideSourcePlan = this.isOutsideSourcePlan(file.path)
        if (outsideSourcePlan && this.activeProposalId) this.options.onSourcePlanDrift?.(file.path, this.activeProposalId)
        return { file, outsideSourcePlan }
      }
      case 'proposal_context':
        return { context: await this.refreshProposalContext(requireProposalId(request)) }
      case 'proposal_readiness':
        return { readiness: await this.readiness(requireProposalId(request)) }
      case 'proposal_diagnostic':
        return { diagnostic: await this.diagnostic(requireProposalId(request)) }
      case 'open_in_ide': {
        const context = await this.proposalContext(requireProposalId(request))
        await this.options.onOpenInIde?.(context)
        return { opened: { proposalId: context.proposalId, relevantFiles: context.relevantFiles.map((file) => file.path) } }
      }
    }
  }
}

function normalize(value: string | undefined): string {
  return value ? value.replaceAll('\\', '/').replace(/^\.\//, '') : ''
}

function requireProposalId(request: BridgeRequest): string {
  if (!request.proposalId) throw new BridgeRequestError('proposal_not_found', 'A proposal id is required.')
  return request.proposalId
}

class BridgeRequestError extends Error {
  constructor(readonly code: BridgeError['code'], message: string) {
    super(message)
    this.name = 'BridgeRequestError'
  }
}

function bridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeRequestError) return { code: error.code, message: error.message }
  if (error instanceof RepositoryAccessError) {
    return { code: error.reason === 'not_found' ? 'not_found' : 'path_refused', message: error.message }
  }
  return { code: 'failed', message: error instanceof Error ? error.message : String(error) }
}
