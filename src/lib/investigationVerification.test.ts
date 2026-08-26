import { describe, expect, it } from 'vitest'
import { classifyInvestigationVerification } from './investigationVerification'

describe('investigation verification semantics', () => {
  const failed = { status: 0, anomalies: ['No HTTP response received'], protocol: 'HTTP' as const, scenarioExercised: true }

  it('classifies status 0 to 204 as FIXED', () => {
    expect(classifyInvestigationVerification(failed, { status: 204, anomalies: [], protocol: 'HTTP', scenarioExercised: true })).toBe('FIXED')
  })

  it('classifies a persistent status 0 as REGRESSION, not NOT_REPRODUCED', () => {
    expect(classifyInvestigationVerification(failed, { status: 0, anomalies: ['No HTTP response received'], protocol: 'HTTP', scenarioExercised: true })).toBe('REGRESSION')
  })

  it('distinguishes no reproduction from a verification infrastructure failure', () => {
    expect(classifyInvestigationVerification(failed, { status: 0, anomalies: [], scenarioExercised: false })).toBe('NOT_REPRODUCED')
    expect(classifyInvestigationVerification(failed, { status: 0, anomalies: [], runtimeAvailable: false })).toBe('VERIFICATION_FAILED')
  })

  it('accepts a clean WebSocket 101 as fixed', () => {
    const original = { status: 101, anomalies: ['Request latency is high'], protocol: 'WebSocket' as const, scenarioExercised: true }
    expect(classifyInvestigationVerification(original, { status: 101, anomalies: [], protocol: 'WebSocket', scenarioExercised: true })).toBe('FIXED')
  })

  it('returns INCONCLUSIVE when neither observation establishes a failure', () => {
    expect(classifyInvestigationVerification({ status: 200, anomalies: [] }, { status: 200, anomalies: [] })).toBe('INCONCLUSIVE')
  })
})
