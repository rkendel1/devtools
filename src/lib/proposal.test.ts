import { describe, expect, it } from 'vitest'
import {
  PROPOSAL_COLLECTION, evaluateProposalReadiness, isProposal, isProposalActionable,
  proposalRequiresApproval, renderProposalDiagnostic, renderProposalReadiness,
  renderProposalStatus, renderRepositoryState, renderSourcePlanConflicts, type Proposal,
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

describe('proposal readiness', () => {
  it('reports a fresh proposal against a clean repository as ready', () => {
    const readiness = evaluateProposalReadiness(proposal(), repository())
    expect(readiness).toMatchObject({
      proposalId: 'p_123', contract: 'current', flow: 'current',
      repository: { state: 'clean', branch: 'main' }, sourceConflicts: [], secretsExposed: [], ready: true, blockers: [],
    })
    expect(renderProposalReadiness(readiness)).toBe('PROPOSAL\nContract\n✓ matches\nFlow\n✓ matches\nRepository\n✓ clean')
  })

  it('treats the contract hash as authority', () => {
    const readiness = evaluateProposalReadiness(proposal({ base_contract_hash: 'sha256:old' }), repository())
    expect(readiness.contract).toBe('stale')
    expect(readiness.ready).toBe(false)
    expect(readiness.blockers.join(' ')).toMatch(/contract changed/i)
  })

  it('treats the flow hash as authority', () => {
    const readiness = evaluateProposalReadiness(proposal({ base_flow_hash: 'sha256:old' }), repository())
    expect(readiness.flow).toBe('stale')
    expect(readiness.ready).toBe(false)
  })

  it('treats the repository commit as evidence, never as authority', () => {
    const readiness = evaluateProposalReadiness(proposal({ repository_commit: 'f00ba4c0ffee' }), repository())
    expect(readiness.commitEvidence).toMatchObject({ proposal: 'f00ba4c0ffee', current: '8d91abc1234567', matches: false })
    // Git history moved, contract and flow did not: still ready.
    expect(readiness.ready).toBe(true)
    expect(readiness.blockers).toEqual([])
    expect(readiness.notes.join(' ')).toMatch(/evidence only/i)
  })

  it('does not assume a fingerprint the proposal never recorded', () => {
    const readiness = evaluateProposalReadiness(proposal({ base_flow_hash: undefined }), repository())
    expect(readiness.flow).toBe('unrecorded')
    expect(readiness.notes.join(' ')).toMatch(/does not record a base flow hash/i)
  })

  it('detects source plan conflicts with the local working tree', () => {
    const dirty = repository({
      repository: {
        root: '/w/app', branch: 'main', commit: '8d91abc', dirty: true, gitAvailable: true,
        changedFiles: [{ path: 'src/auth.ts', change: 'changed' }, { path: 'README.md', change: 'changed' }],
      },
    })
    const readiness = evaluateProposalReadiness(proposal(), dirty)
    expect(readiness.sourceConflicts).toEqual([{ path: 'src/auth.ts', change: 'changed', planned: 'modify' }])
    expect(readiness.ready).toBe(false)
    expect(renderSourcePlanConflicts(readiness)).toBe('⚠ Proposal conflict\nsrc/auth.ts\n  modified locally, proposal plans to modify')
  })

  it('carries the local change kind into the conflict', () => {
    const dirty = repository({
      repository: {
        root: '/w/app', branch: 'main', commit: '8d91abc', dirty: true, gitAvailable: true,
        changedFiles: [{ path: 'src/auth.ts', change: 'deleted' }],
      },
    })
    expect(evaluateProposalReadiness(proposal(), dirty).sourceConflicts[0]).toEqual({ path: 'src/auth.ts', change: 'deleted', planned: 'modify' })
  })

  it('treats a modified but non-conflicting working tree as ready, with a note', () => {
    const dirty = repository({
      repository: { root: '/w/app', branch: 'main', commit: '8d91abc', dirty: true, gitAvailable: true, changedFiles: [{ path: 'README.md', change: 'changed' }] },
    })
    const readiness = evaluateProposalReadiness(proposal(), dirty)
    expect(readiness.ready).toBe(true)
    expect(readiness.sourceConflicts).toEqual([])
    expect(readiness.notes.join(' ')).toMatch(/none of which touch the source plan/i)
    expect(renderSourcePlanConflicts(readiness)).toBe('No source plan conflicts.')
  })

  it('will not call an unapproved proposal ready', () => {
    const readiness = evaluateProposalReadiness(proposal({ status: 'PREVIEWED' }), repository())
    expect(readiness.ready).toBe(false)
    expect(readiness.blockers.join(' ')).toMatch(/approval is required/i)
  })

  it('refuses to report ready when a credential path reached the context', () => {
    const leaking = repository({ files: ['feltdb.flow', '.env'] })
    const readiness = evaluateProposalReadiness(proposal(), leaking)
    expect(readiness.secretsExposed).toEqual(['.env'])
    expect(readiness.ready).toBe(false)
  })

  it('reports unknown repository state outside a git checkout', () => {
    const detached = repository({ repository: { root: '/w/app', branch: '', commit: '', dirty: false, changedFiles: [], gitAvailable: false } })
    const readiness = evaluateProposalReadiness(proposal(), detached)
    expect(readiness.repository.state).toBe('unknown')
    expect(readiness.ready).toBe(false)
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

  it('renders the ready-to-apply diagnostic from the readiness result', () => {
    expect(renderProposalDiagnostic(evaluateProposalReadiness(proposal(), repository()))).toBe([
      'Proposal: p_123', 'Status: APPROVED', 'Contract:', '  ✓ current', 'Flow:', '  ✓ current',
      'Repository:', '  Branch: main', '  Commit: 8d91abc', '  Working tree: clean',
      'Source plan conflicts:', '  none', 'Secrets exposed:', '  none', 'Ready to apply.',
    ].join('\n'))
  })

  it('reports commit drift as evidence in the diagnostic', () => {
    const report = renderProposalDiagnostic(evaluateProposalReadiness(proposal({ repository_commit: 'f00ba4c0ffee' }), repository()))
    expect(report).toContain('  Proposal commit: f00ba4c (evidence only)')
    expect(report.endsWith('Ready to apply.')).toBe(true)
  })

  it('aborts the diagnostic when uncommitted changes conflict with the source plan', () => {
    const dirty = repository({
      repository: { root: '/w/app', branch: 'main', commit: '8d91abc', dirty: true, gitAvailable: true, changedFiles: [{ path: 'src/auth.ts', change: 'changed' }] },
    })
    const report = renderProposalDiagnostic(evaluateProposalReadiness(proposal(), dirty))
    expect(report).toContain('Source plan conflicts:\n  ⚠ src/auth.ts — modified locally, proposal plans to modify')
    expect(report).toContain('Repository has uncommitted changes that conflict')
    expect(report).toContain('with the proposal source plan.')
    expect(report.endsWith('Apply aborted.')).toBe(true)
  })

  it('explains a stale proposal instead of aborting on conflicts', () => {
    const report = renderProposalDiagnostic(evaluateProposalReadiness(proposal({ base_flow_hash: 'sha256:old' }), repository()))
    expect(report).toContain('Flow:\n  ⚠ stale')
    expect(report).toContain('Not ready to apply.')
  })
})
