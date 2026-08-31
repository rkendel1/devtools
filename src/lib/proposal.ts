/**
 * Proposal: the read-only view DevTools holds of a persisted `_feltdb.Proposal`.
 *
 * A Proposal is an intended application change. It is authored, persisted, and
 * approved by FeltDB. DevTools reads one to give Studio and the IDE repository
 * context for it, and never stores, mirrors, or mutates it — `.feltdb/` stays
 * connection, pairing, and workspace state.
 *
 * Authoritative lifecycle: Proposal → Approved → `feltdb ai apply` → Applied.
 * Neither Studio, the DevTools bridge, nor the IDE connection applies anything.
 */

import type { RepositoryContext, SourcePlanEntry } from './repositoryContext.js'

/** The canonical FeltDB collection. DevTools reads from it and never writes to it. */
export const PROPOSAL_COLLECTION = '_feltdb.Proposal'

export type ProposalStatus =
  | 'DRAFT' | 'PREVIEWED' | 'APPROVED' | 'APPLIED' | 'REJECTED' | 'EXPIRED' | 'STALE'

/** Statuses after which no repository work should start from this proposal. */
export const TERMINAL_PROPOSAL_STATUSES: ProposalStatus[] = ['APPLIED', 'REJECTED', 'EXPIRED', 'STALE']

export interface ProposalContractDiff {
  path: string
  kind: 'added' | 'removed' | 'modified'
  detail?: string
}

/**
 * The proposal fields the bridge reads. FeltDB owns the full record; this is
 * deliberately the minimum needed to locate repository context for it.
 */
export interface Proposal {
  proposal_id: string
  application_id?: string
  status: ProposalStatus
  summary: string
  intent?: string
  module?: { name: string; version: string }
  base_contract_hash?: string
  base_flow_hash?: string
  repository_commit?: string
  contract_diff?: ProposalContractDiff[]
  source_plan?: SourcePlanEntry[]
  warnings?: string[]
  created_at?: number
  updated_at?: number
}

export function isProposal(value: unknown): value is Proposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<Proposal>
  return typeof candidate.proposal_id === 'string'
    && typeof candidate.status === 'string'
    && typeof candidate.summary === 'string'
}

export function isProposalActionable(proposal: Proposal): boolean {
  return !TERMINAL_PROPOSAL_STATUSES.includes(proposal.status)
}

export function proposalRequiresApproval(proposal: Proposal): boolean {
  return proposal.status === 'DRAFT' || proposal.status === 'PREVIEWED'
}

export type FingerprintMatch = 'matches' | 'stale' | 'unknown'
export type WorkingTreeState = 'clean' | 'modified' | 'unknown'

export interface ProposalRepositoryComparison {
  proposalId: string
  status: ProposalStatus
  contract: FingerprintMatch
  flow: FingerprintMatch
  repository: WorkingTreeState
  /** Working-tree changes that overlap the proposal source plan. */
  conflicts: string[]
  /** True when the repository is in a state where `feltdb ai apply` should succeed. */
  applicable: boolean
  reasons: string[]
}

/**
 * Compare a proposal's fingerprints against the current repository.
 *
 * Contract and flow hashes are the application-level staleness mechanism; the
 * repository commit is contextual evidence, not an authority. A hash the
 * proposal does not carry is reported `unknown` rather than assumed current.
 */
export function compareProposalToRepository(
  proposal: Proposal,
  context: RepositoryContext,
): ProposalRepositoryComparison {
  const contract = matchFingerprint(proposal.base_contract_hash, context.contract?.hash)
  const flow = matchFingerprint(proposal.base_flow_hash, context.flow?.hash)
  const repository: WorkingTreeState = !context.repository.gitAvailable ? 'unknown' : context.repository.dirty ? 'modified' : 'clean'
  const planned = new Set((proposal.source_plan ?? []).map((entry) => entry.path?.replaceAll('\\', '/')).filter(Boolean))
  const conflicts = context.repository.changedFiles
    .map((change) => change.path.replaceAll('\\', '/'))
    .filter((path) => planned.has(path))
    .sort()

  const reasons: string[] = []
  if (contract === 'stale') reasons.push('The application contract changed after this proposal was generated.')
  if (flow === 'stale') reasons.push('feltdb.flow changed after this proposal was generated.')
  if (contract === 'unknown') reasons.push('The proposal does not record a base contract hash.')
  if (flow === 'unknown') reasons.push('The proposal does not record a base flow hash.')
  if (repository === 'unknown') reasons.push('The connected workspace is not a git checkout, so repository state cannot be verified.')
  if (conflicts.length) reasons.push('Repository has uncommitted changes that conflict with the proposal source plan.')
  if (proposal.status !== 'APPROVED') reasons.push(`Proposal status is ${proposal.status}; approval is required before applying.`)

  return {
    proposalId: proposal.proposal_id,
    status: proposal.status,
    contract,
    flow,
    repository,
    conflicts,
    applicable: proposal.status === 'APPROVED' && contract !== 'stale' && flow !== 'stale' && !conflicts.length && repository !== 'unknown',
    reasons,
  }
}

function matchFingerprint(expected: string | undefined, actual: string | undefined): FingerprintMatch {
  if (!expected || !actual) return 'unknown'
  return expected === actual ? 'matches' : 'stale'
}

/** Studio's proposal freshness block. */
export function renderProposalComparison(comparison: ProposalRepositoryComparison): string {
  const mark = (value: FingerprintMatch) => value === 'matches' ? '✓ matches' : value === 'stale' ? '⚠ stale' : '· unknown'
  const repository = comparison.repository === 'clean' ? '✓ clean' : comparison.repository === 'modified' ? '⚠ working tree modified' : '· unknown'
  return ['PROPOSAL', 'Contract', mark(comparison.contract), 'Flow', mark(comparison.flow), 'Repository', repository].join('\n')
}

/** The proposal status the IDE displays for the connected proposal. */
export function renderProposalStatus(proposal: Proposal): string {
  const lines = [`PROPOSAL ${proposal.proposal_id}`, `Status: ${proposal.status}`]
  if (proposalRequiresApproval(proposal)) lines.push('Approval required.')
  if (proposal.status === 'STALE') lines.push('Regenerate the proposal against the current contract.')
  if (proposal.status === 'EXPIRED') lines.push('This proposal expired and can no longer be applied.')
  if (proposal.status === 'REJECTED') lines.push('This proposal was rejected.')
  if (proposal.status === 'APPLIED') lines.push('This proposal was already applied.')
  return lines.join('\n')
}

/** The read-only repository block, as shown in Studio and the IDE. */
export function renderRepositoryState(context: RepositoryContext): string {
  const lines = ['Repository', `Branch: ${context.repository.branch || 'unknown'}`, `Commit: ${shortCommit(context.repository.commit)}`, 'Working tree:']
  if (!context.repository.gitAvailable) return [...lines, '  · unknown (not a git checkout)'].join('\n')
  if (!context.repository.dirty) return [...lines, '  ✓ clean'].join('\n')
  const changed = context.repository.changedFiles
  lines.push(`  ⚠ ${changed.length} modified file${changed.length === 1 ? '' : 's'}`)
  for (const change of changed.slice(0, 20)) lines.push(`  ${change.path}`)
  if (changed.length > 20) lines.push(`  … ${changed.length - 20} more`)
  return lines.join('\n')
}

/**
 * The `feltdb ai proposal <proposal-id>` diagnostic.
 *
 * A read-only report: it states whether the repository is in a position to
 * apply the proposal. Application itself remains `feltdb ai apply`.
 */
export function renderProposalDiagnostic(
  proposal: Proposal,
  context: RepositoryContext,
  comparison = compareProposalToRepository(proposal, context),
): string {
  const fingerprint = (value: FingerprintMatch) => value === 'matches' ? '  ✓ current' : value === 'stale' ? '  ⚠ stale' : '  · not recorded'
  const lines = [
    `Proposal: ${proposal.proposal_id}`,
    `Status: ${proposal.status}`,
    'Contract:', fingerprint(comparison.contract),
    'Flow:', fingerprint(comparison.flow),
    'Repository:',
    `  Branch: ${context.repository.branch || 'unknown'}`,
    `  Commit: ${shortCommit(context.repository.commit)}`,
    `  Working tree: ${!context.repository.gitAvailable ? 'unknown' : context.repository.dirty ? `${context.repository.changedFiles.length} modified` : 'clean'}`,
  ]
  if (comparison.applicable) return [...lines, 'Ready to apply.'].join('\n')
  if (comparison.conflicts.length) {
    lines.push('Repository has uncommitted changes that conflict', 'with the proposal source plan.')
    for (const path of comparison.conflicts) lines.push(`  ${path}`)
    lines.push('Apply aborted.')
    return lines.join('\n')
  }
  lines.push('Not ready to apply.')
  for (const reason of comparison.reasons) lines.push(`  ${reason}`)
  return lines.join('\n')
}

function shortCommit(commit: string): string {
  return commit ? commit.slice(0, 7) : 'unknown'
}
