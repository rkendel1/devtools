import { describe, expect, it } from 'vitest'
import {
  PROPOSAL_COLLECTION, compareProposalToRepository, isProposal, isProposalActionable,
  proposalRequiresApproval, renderProposalComparison, renderProposalDiagnostic,
  renderProposalStatus, renderRepositoryState, type Proposal,
} from './proposal'
import type { RepositoryContext } from './repositoryContext'

function repository(overrides: Partial<RepositoryContext> = {}): RepositoryContext {
  return {
    repository: { root: '/w/app', branch: 'main', commit: '8d91abc1234567', dirty: false, changedFiles: [], gitAvailable: true },
    flow: { path: 'feltdb.flow', hash: 'sha256:flow' },
    contract: { version: 'v1.4', hash: 'sha256:contract' },
    files: ['feltdb.flow', 'src/auth.ts'],
    secrets: { names: ['STRIPE_SECRET_KEY'] },
    truncated: false,
    capturedAt: 1,
    ...overrides,
  }
}

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    proposal_id: 'p_123',
    status: 'APPROVED',
    summary: 'Implement Stripe',
    base_contract_hash: 'sha256:contract',
    base_flow_hash: 'sha256:flow',
    source_plan: [{ path: 'src/auth.ts', action: 'modify' }],
    ...overrides,
  }
}

describe('proposal contract', () => {
  it('reads proposals from the canonical FeltDB collection', () => {
    expect(PROPOSAL_COLLECTION).toBe('_feltdb.Proposal')
  })

  it('recognizes a persisted proposal', () => {
    expect(isProposal(proposal())).toBe(true)
    expect(isProposal({ proposal_id: 'p_1' })).toBe(false)
    expect(isProposal(null)).toBe(false)
  })

  it('knows which proposals still need approval and which are finished', () => {
    expect(proposalRequiresApproval(proposal({ status: 'PREVIEWED' }))).toBe(true)
    expect(proposalRequiresApproval(proposal({ status: 'APPROVED' }))).toBe(false)
    expect(isProposalActionable(proposal({ status: 'APPROVED' }))).toBe(true)
    for (const status of ['APPLIED', 'REJECTED', 'EXPIRED', 'STALE'] as const) {
      expect(isProposalActionable(proposal({ status })), status).toBe(false)
    }
  })
})

describe('proposal versus repository', () => {
  it('reports a fresh proposal against a clean repository as applicable', () => {
    const comparison = compareProposalToRepository(proposal(), repository())
    expect(comparison).toMatchObject({ contract: 'matches', flow: 'matches', repository: 'clean', conflicts: [], applicable: true })
    expect(renderProposalComparison(comparison)).toBe('PROPOSAL\nContract\n✓ matches\nFlow\n✓ matches\nRepository\n✓ clean')
  })

  it('detects a contract or flow that moved after the proposal was generated', () => {
    const comparison = compareProposalToRepository(proposal({ base_contract_hash: 'sha256:old' }), repository())
    expect(comparison.contract).toBe('stale')
    expect(comparison.applicable).toBe(false)
    expect(comparison.reasons.join(' ')).toMatch(/contract changed/i)
  })

  it('does not assume a fingerprint the proposal never recorded', () => {
    const comparison = compareProposalToRepository(proposal({ base_flow_hash: undefined }), repository())
    expect(comparison.flow).toBe('unknown')
  })

  it('flags working-tree changes that overlap the source plan', () => {
    const dirty = repository({
      repository: { root: '/w/app', branch: 'main', commit: '8d91abc', dirty: true, gitAvailable: true, changedFiles: [{ path: 'src/auth.ts', change: 'changed' }, { path: 'README.md', change: 'changed' }] },
    })
    const comparison = compareProposalToRepository(proposal(), dirty)
    expect(comparison.repository).toBe('modified')
    expect(comparison.conflicts).toEqual(['src/auth.ts'])
    expect(comparison.applicable).toBe(false)
    expect(renderProposalComparison(comparison)).toContain('⚠ working tree modified')
  })

  it('treats a modified but non-conflicting working tree as applicable', () => {
    const dirty = repository({
      repository: { root: '/w/app', branch: 'main', commit: '8d91abc', dirty: true, gitAvailable: true, changedFiles: [{ path: 'README.md', change: 'changed' }] },
    })
    expect(compareProposalToRepository(proposal(), dirty).applicable).toBe(true)
  })

  it('will not call an unapproved proposal applicable', () => {
    const comparison = compareProposalToRepository(proposal({ status: 'PREVIEWED' }), repository())
    expect(comparison.applicable).toBe(false)
    expect(comparison.reasons.join(' ')).toMatch(/approval is required/i)
  })

  it('reports unknown repository state outside a git checkout', () => {
    const detached = repository({ repository: { root: '/w/app', branch: '', commit: '', dirty: false, changedFiles: [], gitAvailable: false } })
    const comparison = compareProposalToRepository(proposal(), detached)
    expect(comparison.repository).toBe('unknown')
    expect(comparison.applicable).toBe(false)
    expect(renderRepositoryState(detached)).toContain('not a git checkout')
  })
})

describe('proposal reporting', () => {
  it('renders the repository block read-only', () => {
    expect(renderRepositoryState(repository())).toBe('Repository\nBranch: main\nCommit: 8d91abc\nWorking tree:\n  ✓ clean')
  })

  it('renders proposal status with the approval requirement', () => {
    expect(renderProposalStatus(proposal({ status: 'APPROVED' }))).toBe('PROPOSAL p_123\nStatus: APPROVED')
    expect(renderProposalStatus(proposal({ status: 'PREVIEWED' }))).toBe('PROPOSAL p_123\nStatus: PREVIEWED\nApproval required.')
  })

  it('renders the ready-to-apply diagnostic', () => {
    expect(renderProposalDiagnostic(proposal(), repository())).toBe([
      'Proposal: p_123', 'Status: APPROVED', 'Contract:', '  ✓ current', 'Flow:', '  ✓ current',
      'Repository:', '  Branch: main', '  Commit: 8d91abc', '  Working tree: clean', 'Ready to apply.',
    ].join('\n'))
  })

  it('aborts the diagnostic when uncommitted changes conflict with the source plan', () => {
    const dirty = repository({
      repository: { root: '/w/app', branch: 'main', commit: '8d91abc', dirty: true, gitAvailable: true, changedFiles: [{ path: 'src/auth.ts', change: 'changed' }] },
    })
    const report = renderProposalDiagnostic(proposal(), dirty)
    expect(report).toContain('Repository has uncommitted changes that conflict')
    expect(report).toContain('with the proposal source plan.')
    expect(report).toContain('  src/auth.ts')
    expect(report.endsWith('Apply aborted.')).toBe(true)
  })

  it('explains a stale proposal instead of aborting on conflicts', () => {
    const report = renderProposalDiagnostic(proposal({ base_flow_hash: 'sha256:old' }), repository())
    expect(report).toContain('Flow:\n  ⚠ stale')
    expect(report).toContain('Not ready to apply.')
  })
})
