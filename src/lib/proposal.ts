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

import type { RepositoryChange, RepositoryContext, SourcePlanEntry } from './repositoryContext.js'
import { isSecretPath } from './repositoryContext.js'

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

/** Authority. A fingerprint the proposal never recorded is `unrecorded`, never assumed current. */
export type FingerprintState = 'current' | 'stale' | 'unrecorded'

export type WorkingTreeState = 'clean' | 'modified' | 'unknown'

export interface SourcePlanConflict {
  path: string
  /** How the working tree changed the file. */
  change: RepositoryChange['change']
  /** What the proposal planned to do with it. */
  planned: NonNullable<SourcePlanEntry['action']>
}

/**
 * The one canonical readiness result.
 *
 * Studio, the IDE, and `feltdb ai proposal` all render this same structure —
 * there is no separate CLI model and no separate Studio model.
 *
 * Readiness is decided by the contract hash, the flow hash, the working tree,
 * and the source-plan conflicts. The repository commit is carried as evidence
 * and is structurally incapable of deciding anything: it can only ever appear
 * in `notes`.
 */
export interface ProposalReadiness {
  proposalId: string
  status: ProposalStatus
  /** Authority. */
  contract: FingerprintState
  /** Authority. */
  flow: FingerprintState
  repository: {
    state: WorkingTreeState
    branch: string
    commit: string
    changedFileCount: number
  }
  /** Evidence only. Git history never determines whether a proposal is applicable. */
  commitEvidence: { proposal?: string; current: string; matches: boolean | null }
  sourceConflicts: SourcePlanConflict[]
  /** Credential paths that reached the context. Always empty; asserted, not assumed. */
  secretsExposed: string[]
  ready: boolean
  /** Why `ready` is false. Empty when ready. */
  blockers: string[]
  /** Observations that do not affect readiness, including commit drift. */
  notes: string[]
  evaluatedAt: number
}

/**
 * Evaluate a proposal against the current repository.
 *
 * Contract and flow hashes are the application-level staleness mechanism. The
 * repository commit is contextual evidence: a proposal generated at a different
 * commit is still applicable when the contract and flow it was generated
 * against are unchanged.
 */
export function evaluateProposalReadiness(
  proposal: Proposal,
  context: RepositoryContext,
): ProposalReadiness {
  const contract = fingerprintState(proposal.base_contract_hash, context.contract?.hash)
  const flow = fingerprintState(proposal.base_flow_hash, context.flow?.hash)
  const state: WorkingTreeState = !context.repository.gitAvailable ? 'unknown' : context.repository.dirty ? 'modified' : 'clean'
  const sourceConflicts = detectSourcePlanConflicts(proposal, context)
  const secretsExposed = context.files.filter(isSecretPath)

  const blockers: string[] = []
  const notes: string[] = []
  if (proposal.status !== 'APPROVED') blockers.push(`Proposal status is ${proposal.status}; approval is required before applying.`)
  if (contract === 'stale') blockers.push('The application contract changed after this proposal was generated.')
  if (flow === 'stale') blockers.push('feltdb.flow changed after this proposal was generated.')
  if (state === 'unknown') blockers.push('The connected workspace is not a git checkout, so repository state cannot be verified.')
  if (sourceConflicts.length) blockers.push('Repository has uncommitted changes that conflict with the proposal source plan.')
  if (secretsExposed.length) blockers.push('Repository context exposed a credential path. Refusing to report the proposal ready.')

  if (contract === 'unrecorded') notes.push('The proposal does not record a base contract hash.')
  if (flow === 'unrecorded') notes.push('The proposal does not record a base flow hash.')
  if (state === 'modified' && !sourceConflicts.length) notes.push('The working tree has changes, none of which touch the source plan.')

  const commitEvidence = {
    proposal: proposal.repository_commit,
    current: context.repository.commit,
    matches: proposal.repository_commit && context.repository.commit ? proposal.repository_commit === context.repository.commit : null,
  }
  if (commitEvidence.matches === false) {
    notes.push(`The repository moved to ${shortCommit(commitEvidence.current)} since the proposal recorded ${shortCommit(commitEvidence.proposal ?? '')}. Evidence only; the contract and flow hashes decide staleness.`)
  }

  return {
    proposalId: proposal.proposal_id,
    status: proposal.status,
    contract,
    flow,
    repository: { state, branch: context.repository.branch, commit: context.repository.commit, changedFileCount: context.repository.changedFiles.length },
    commitEvidence,
    sourceConflicts,
    secretsExposed,
    ready: !blockers.length,
    blockers,
    notes,
    evaluatedAt: Date.now(),
  }
}

/**
 * Working-tree changes that land on a path the proposal plans to touch.
 *
 * The bridge only establishes that a conflict exists. It does not merge, and it
 * does not decide what happens next: that is the CLI's call at apply time.
 */
function detectSourcePlanConflicts(proposal: Proposal, context: RepositoryContext): SourcePlanConflict[] {
  const planned = new Map<string, NonNullable<SourcePlanEntry['action']>>()
  for (const entry of proposal.source_plan ?? []) {
    const path = normalizePath(entry?.path)
    if (path) planned.set(path, entry.action ?? 'modify')
  }
  if (!planned.size) return []
  return context.repository.changedFiles
    .map((change) => ({ path: normalizePath(change.path), change: change.change }))
    .filter((change): change is { path: string; change: RepositoryChange['change'] } => Boolean(change.path) && planned.has(change.path))
    .map((change) => ({ path: change.path, change: change.change, planned: planned.get(change.path)! }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function normalizePath(value: string | undefined): string {
  return value ? value.replaceAll('\\', '/').replace(/^\.\//, '') : ''
}

function fingerprintState(expected: string | undefined, actual: string | undefined): FingerprintState {
  if (!expected || !actual) return 'unrecorded'
  return expected === actual ? 'current' : 'stale'
}

/** Studio's proposal freshness block. */
export function renderProposalReadiness(readiness: ProposalReadiness): string {
  const mark = (value: FingerprintState) => value === 'current' ? '✓ matches' : value === 'stale' ? '⚠ stale' : '· not recorded'
  const repository = readiness.repository.state === 'clean' ? '✓ clean' : readiness.repository.state === 'modified' ? '⚠ working tree modified' : '· unknown'
  return ['PROPOSAL', 'Contract', mark(readiness.contract), 'Flow', mark(readiness.flow), 'Repository', repository].join('\n')
}

/** The source-plan conflict block, shown before the developer reaches apply. */
export function renderSourcePlanConflicts(readiness: ProposalReadiness): string {
  if (!readiness.sourceConflicts.length) return 'No source plan conflicts.'
  return ['⚠ Proposal conflict', ...readiness.sourceConflicts.map((conflict) => `${conflict.path}\n  ${describeConflict(conflict)}`)].join('\n')
}

function describeConflict(conflict: SourcePlanConflict): string {
  const local = conflict.change === 'untracked' ? 'added locally' : conflict.change === 'deleted' ? 'deleted locally' : conflict.change === 'created' ? 'created locally' : conflict.change === 'renamed' ? 'renamed locally' : 'modified locally'
  return `${local}, proposal plans to ${conflict.planned}`
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
 * The `feltdb ai proposal <proposal-id>` report.
 *
 * Rendered from the readiness result, so the CLI and Studio show the same
 * verdict from the same structure. Read-only: it states whether the repository
 * is in a position to apply the proposal, never applies it.
 */
export function renderProposalDiagnostic(readiness: ProposalReadiness): string {
  const fingerprint = (value: FingerprintState) => value === 'current' ? '  ✓ current' : value === 'stale' ? '  ⚠ stale' : '  · not recorded'
  const lines = [
    `Proposal: ${readiness.proposalId}`,
    `Status: ${readiness.status}`,
    'Contract:', fingerprint(readiness.contract),
    'Flow:', fingerprint(readiness.flow),
    'Repository:',
    `  Branch: ${readiness.repository.branch || 'unknown'}`,
    `  Commit: ${shortCommit(readiness.repository.commit)}`,
    `  Working tree: ${readiness.repository.state === 'unknown' ? 'unknown' : readiness.repository.state === 'modified' ? `${readiness.repository.changedFileCount} modified` : 'clean'}`,
  ]
  if (readiness.commitEvidence.matches === false) lines.push(`  Proposal commit: ${shortCommit(readiness.commitEvidence.proposal ?? '')} (evidence only)`)
  lines.push('Source plan conflicts:')
  if (readiness.sourceConflicts.length) for (const conflict of readiness.sourceConflicts) lines.push(`  ⚠ ${conflict.path} — ${describeConflict(conflict)}`)
  else lines.push('  none')
  lines.push('Secrets exposed:')
  if (readiness.secretsExposed.length) for (const path of readiness.secretsExposed) lines.push(`  ⚠ ${path}`)
  else lines.push('  none')

  if (readiness.ready) return [...lines, 'Ready to apply.'].join('\n')
  if (readiness.sourceConflicts.length) {
    return [...lines, 'Repository has uncommitted changes that conflict', 'with the proposal source plan.', 'Apply aborted.'].join('\n')
  }
  lines.push('Not ready to apply.')
  for (const blocker of readiness.blockers) lines.push(`  ${blocker}`)
  return lines.join('\n')
}

function shortCommit(commit: string): string {
  return commit ? commit.slice(0, 7) : 'unknown'
}
