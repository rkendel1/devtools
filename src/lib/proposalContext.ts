/**
 * Proposal IDE Context: what an IDE agent is given when a Proposal is opened.
 *
 * Assembled on the repository side from a proposal read directly out of
 * `_feltdb.Proposal` and the bounded repository context. The agent gets enough
 * to reason about the proposal against real source; it gets no authority to
 * apply it.
 */

import type { Proposal, ProposalReadiness } from './proposal.js'
import { evaluateProposalReadiness, renderProposalStatus, renderRepositoryState, renderSourcePlanConflicts } from './proposal.js'
import type { ProposalContextSnapshot } from './proposalBridge.js'
import { PROPOSAL_CONTEXT_TTL_MS } from './proposalBridge.js'
import type { RepositoryContext, RepositoryFile, SourcePlanEntry } from './repositoryContext.js'

export interface ProposalIdeContext {
  proposalId: string
  status: Proposal['status']
  summary: string
  intent?: string
  applicationId?: string
  module?: { name: string; version: string }
  contractDiff: Proposal['contract_diff']
  sourcePlan: SourcePlanEntry[]
  warnings: string[]
  repository: RepositoryContext
  readiness: ProposalReadiness
  /** Resolved repository files named by the source plan. Never the whole repository. */
  relevantFiles: RepositoryFile[]
  assembledAt: number
}

export function buildProposalIdeContext(
  proposal: Proposal,
  repository: RepositoryContext,
  relevantFiles: RepositoryFile[],
  readiness = evaluateProposalReadiness(proposal, repository),
): ProposalIdeContext {
  return {
    proposalId: proposal.proposal_id,
    status: proposal.status,
    summary: proposal.summary,
    intent: proposal.intent,
    applicationId: proposal.application_id,
    module: proposal.module,
    contractDiff: proposal.contract_diff ?? [],
    sourcePlan: proposal.source_plan ?? [],
    warnings: proposal.warnings ?? [],
    repository,
    readiness,
    relevantFiles,
    assembledAt: Date.now(),
  }
}

/**
 * The refreshable proposal context snapshot.
 *
 * Operational fields only: the proposal's narrative body stays in
 * `_feltdb.Proposal`. Recomputed on every request and stamped with an
 * expiry, because the proposal is durable state and this is not.
 */
export function buildProposalContextSnapshot(
  proposal: Proposal,
  repository: RepositoryContext,
  relevantFiles: string[],
  readiness = evaluateProposalReadiness(proposal, repository),
  now = Date.now(),
): ProposalContextSnapshot {
  return {
    proposalId: proposal.proposal_id,
    status: proposal.status,
    contract: repository.contract,
    flow: repository.flow,
    repositoryCommit: repository.repository.commit,
    readiness,
    sourcePlan: proposal.source_plan ?? [],
    relevantFiles,
    warnings: proposal.warnings ?? [],
    refreshedAt: now,
    expiresAt: now + PROPOSAL_CONTEXT_TTL_MS,
  }
}

/**
 * The agent handoff for a proposal.
 *
 * The framing matters as much as the content: an agent told only "implement
 * Stripe" invents an implementation, while an agent told which proposal it is
 * working on reasons about that proposal against the contract it was generated
 * from. The final section is the standing prohibition — the agent inspects and
 * reasons, the CLI applies.
 */
export function renderProposalAgentPrompt(context: ProposalIdeContext): string {
  return `${renderProposalStatus({ proposal_id: context.proposalId, status: context.status, summary: context.summary })}

You are working on Proposal ${context.proposalId}.
Do not treat this as an independent coding task.

Proposal intent:
${context.intent || context.summary}
Application:
${context.applicationId ?? 'Not recorded'}
Application contract:
${context.repository.contract ? `${context.repository.contract.version} / ${shortHash(context.repository.contract.hash)}` : 'Not recorded in the repository'}
Module:
${context.module ? `${context.module.name} ${context.module.version}` : 'None'}
Proposed application changes:
${lines((context.contractDiff ?? []).map((change) => `${change.kind} ${change.path}${change.detail ? ` — ${change.detail}` : ''}`))}
Source plan:
${lines(context.sourcePlan.map((entry) => `${entry.action ?? 'modify'} ${entry.path}${entry.reason ? ` — ${entry.reason}` : ''}`))}
Warnings:
${lines(context.warnings)}
Relevant files:
${lines(context.relevantFiles.map((file) => `${file.path}${file.truncated ? ' (truncated)' : ''}`))}
Flow:
${context.repository.flow ? `${context.repository.flow.path} / ${shortHash(context.repository.flow.hash)}` : 'No feltdb.flow in the repository'}
Required secret names (values are never exposed):
${lines(context.repository.secrets.names)}

${renderRepositoryState(context.repository)}
${renderSourcePlanConflicts(context.readiness)}
Proposal readiness:
${lines(readinessLines(context.readiness))}

Your job:
Review this proposal against the actual repository. Confirm whether the source
plan matches the code that exists, identify anything the proposal missed, and
report what applying it would change.

IMPORTANT:
Do not apply this proposal and do not write the proposal's changes yourself.
Application is performed by the developer from the repository:
feltdb ai apply ${context.proposalId}
${context.status === 'APPROVED' ? '' : '\nThis proposal is not approved yet. Review only.'}`
}

/**
 * Blockers first, then evidence. The repository commit can only ever appear
 * among the notes: git history never decides whether a proposal is applicable.
 */
function readinessLines(readiness: ProposalReadiness): string[] {
  if (readiness.ready) return ['Ready to apply.', ...readiness.notes]
  return [...readiness.blockers, ...readiness.notes]
}

function lines(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join('\n') : '- None recorded'
}

function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, '').slice(0, 12)
}
