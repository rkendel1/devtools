/**
 * Proposal Bridge Service: the repository side of the DevTools bridge.
 *
 * Answers bounded repository-context requests from Studio and hands the local
 * agent proposal context when Studio opens a proposal in the IDE. It reads the
 * proposal from `_feltdb.Proposal` itself, so no proposal body ever travels
 * over the bridge and DevTools never holds a second copy of one.
 *
 * Every handler is a read. Nothing here writes to the repository, and nothing
 * here writes to `_feltdb.Proposal`: approval and application stay with FeltDB
 * and `feltdb ai apply`.
 */

import {
  PROPOSAL_BRIDGE_REQUEST_COLLECTION, PROPOSAL_BRIDGE_RESPONSE_COLLECTION, isBridgeRequest,
  type BridgeConnection, type BridgeError, type BridgeRequest, type BridgeResponse,
} from '../../src/lib/proposalBridge.js'
import {
  PROPOSAL_COLLECTION, compareProposalToRepository, isProposal, renderProposalDiagnostic,
  type Proposal,
} from '../../src/lib/proposal.js'
import { buildProposalIdeContext, type ProposalIdeContext } from '../../src/lib/proposalContext.js'
import { RepositoryAccessError, type RepositoryContextProvider } from './repository-context.js'

export interface ProposalBridgeServiceOptions {
  connection: BridgeConnection
  provider: RepositoryContextProvider
  /** Invoked when Studio opens a proposal in the connected IDE. */
  onOpenInIde?: (context: ProposalIdeContext) => void | Promise<void>
  /** Invoked when the active proposal's status changes in FeltDB. */
  onProposalChanged?: (proposal: Proposal) => void
}

export class ProposalBridgeService {
  private unsubscribers: Array<() => void> = []
  private active: Proposal | undefined

  constructor(private readonly options: ProposalBridgeServiceOptions) {}

  /** The proposal this IDE is currently connected to, if any. */
  get activeProposal(): Proposal | undefined { return this.active }

  start(): void {
    if (this.unsubscribers.length) return
    this.unsubscribers = [
      this.options.connection.subscribe<BridgeRequest>(PROPOSAL_BRIDGE_REQUEST_COLLECTION, (event) => {
        if (event.type === 'deleted' || !isBridgeRequest(event.value)) return
        void this.handle(event.value)
      }),
      // Proposal status awareness: a proposal that goes stale, rejected, or
      // expired while the IDE is working on it must be visible to the IDE.
      this.options.connection.subscribe<Proposal>(PROPOSAL_COLLECTION, (event) => {
        if (event.type === 'deleted' || !isProposal(event.value)) return
        if (this.active && event.value.proposal_id !== this.active.proposal_id) return
        this.active = event.value
        this.options.onProposalChanged?.(event.value)
      }),
    ]
  }

  stop(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.unsubscribers = []
    this.active = undefined
  }

  /** Assemble the proposal context the IDE agent works from. */
  async proposalContext(proposalId: string): Promise<ProposalIdeContext> {
    const proposal = await this.proposal(proposalId)
    const [repository, relevantFiles] = await Promise.all([
      this.options.provider.context(),
      this.options.provider.filesForSourcePlan(proposal.source_plan ?? []),
    ])
    this.active = proposal
    return buildProposalIdeContext(proposal, repository, relevantFiles)
  }

  /** The `feltdb ai proposal <proposal-id>` report, rendered from repository state. */
  async diagnostic(proposalId: string): Promise<string> {
    const [proposal, repository] = await Promise.all([this.proposal(proposalId), this.options.provider.context()])
    return renderProposalDiagnostic(proposal, repository)
  }

  private async proposal(proposalId: string): Promise<Proposal> {
    const value = await this.options.connection.get<unknown>(PROPOSAL_COLLECTION, proposalId)
    if (!isProposal(value)) throw new BridgeRequestError('proposal_not_found', `Proposal ${proposalId} was not found in FeltDB.`)
    return value
  }

  private async handle(request: BridgeRequest): Promise<void> {
    let response: BridgeResponse
    try { response = { ...await this.dispatch(request), kind: 'proposal_bridge_response', requestId: request.requestId, request: request.request, ok: true, respondedAt: Date.now() } }
    catch (error) { response = { kind: 'proposal_bridge_response', requestId: request.requestId, request: request.request, ok: false, error: bridgeError(error), respondedAt: Date.now() } }
    await this.options.connection.publish(PROPOSAL_BRIDGE_RESPONSE_COLLECTION, response)
  }

  private async dispatch(request: BridgeRequest): Promise<Partial<BridgeResponse>> {
    switch (request.request) {
      case 'repository_context':
        return { repository: await this.options.provider.context() }
      case 'read_file': {
        if (!request.path) throw new BridgeRequestError('path_refused', 'A repository-relative path is required.')
        return { file: await this.options.provider.readFile(request.path) }
      }
      case 'proposal_comparison': {
        const proposal = await this.proposal(requireProposalId(request))
        return { comparison: compareProposalToRepository(proposal, await this.options.provider.context()) }
      }
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
