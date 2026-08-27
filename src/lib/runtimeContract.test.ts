import { describe, expect, it } from 'vitest'
import type { RuntimeInvestigation } from '@feltdb/core/workspace'
import {
  canonicalObservationIds,
  isCanonicalRuntimeInvestigation,
  resolveCanonicalInvestigation,
} from '../../vscode-extension/src/runtime-contract'

const canonical: RuntimeInvestigation = {
  id: 'inv_canonical',
  workspaceId: 'ws_test',
  observationId: 'obs_canonical',
  remediationContractId: 'remediation_test',
  investigationState: 'INVESTIGATING',
  remediationState: 'CHANGES_DETECTED',
  verificationState: 'VERIFYING',
  createdAt: 1,
  updatedAt: 2,
}

describe('runtime investigation contract correlation', () => {
  it('resolves a canonical investigation in both directions by canonical observation ID', () => {
    const envelope = { canonicalObservationIds: ['obs_other', 'obs_canonical'] }
    expect(resolveCanonicalInvestigation(envelope, [canonical])).toBe(canonical)
    expect(canonicalObservationIds(envelope)).toContain(canonical.observationId)
  })

  it('resolves through a secondary canonical observation', () => {
    const multiObservation = { ...canonical, observationIds: ['obs_canonical', 'obs_later'] }
    expect(resolveCanonicalInvestigation({ canonicalObservationId: 'obs_later' }, [multiObservation])).toBe(multiObservation)
  })

  it('supports multiple independent observations without collapsing them', () => {
    expect(canonicalObservationIds({
      canonicalObservationId: 'obs_c',
      canonicalObservationIds: ['obs_a', 'obs_b', 'obs_c'],
    })).toEqual(['obs_a', 'obs_b', 'obs_c'])
  })

  it('never promotes a historical originalObservationId', () => {
    const legacy = { originalObservationId: 'GET:https://example.test:123' }
    expect(canonicalObservationIds(legacy)).toEqual([])
    expect(resolveCanonicalInvestigation(legacy, [canonical])).toBeUndefined()
  })

  it('distinguishes the canonical contract from legacy envelopes', () => {
    expect(isCanonicalRuntimeInvestigation(canonical)).toBe(true)
    expect(isCanonicalRuntimeInvestigation({ kind: 'runtime_investigation', schemaVersion: 1, originalObservationId: 'local' })).toBe(false)
  })

  it('retains canonical change and verification identities across a serialized restart', () => {
    const restarted = JSON.parse(JSON.stringify({
      ...canonical,
      remediation: {
        investigationId: canonical.id,
        gitBefore: { head: 'abc', workingTreeDigest: 'before', dirty: false, capturedAt: 1 },
        gitAfter: { head: 'def', workingTreeDigest: 'after', dirty: false, capturedAt: 2 },
        changedPaths: ['src/app.ts'],
        changeIdentity: 'def',
        changeKind: 'commit',
      },
      verificationAttempt: {
        id: 'attempt_1', verificationId: 'verification_1', investigationId: canonical.id,
        observationId: 'obs_verify', criterionId: 'criterion_1', method: 'GET', url: '/api',
        originalStatus: 500, observedStatus: 200, timestamp: 3, result: 'VERIFIED', summary: 'fixed',
      },
    })) as RuntimeInvestigation
    expect(restarted.observationId).toBe('obs_canonical')
    expect(restarted.remediation?.changeIdentity).toBe('def')
    expect(restarted.verificationAttempt?.verificationId).toBe('verification_1')
  })
})
