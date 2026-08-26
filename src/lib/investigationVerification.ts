import type { RuntimeProtocol } from './runtimeProtocol'

export type VerificationOutcome = 'FIXED' | 'REGRESSION' | 'NOT_REPRODUCED' | 'VERIFICATION_FAILED' | 'INCONCLUSIVE'

export interface VerificationObservation {
  status: number
  anomalies: string[]
  protocol?: RuntimeProtocol
  runtimeAvailable?: boolean
  scenarioExercised?: boolean
}

export function classifyInvestigationVerification(original: VerificationObservation, current: VerificationObservation): VerificationOutcome {
  if (current.runtimeAvailable === false) return 'VERIFICATION_FAILED'
  if (current.scenarioExercised === false) return 'NOT_REPRODUCED'
  const originalFailed = failed(original)
  const currentFailed = failed(current)
  if (originalFailed && !currentFailed && expectedSuccess(current)) return 'FIXED'
  if (currentFailed) return 'REGRESSION'
  if (originalFailed && !currentFailed) return 'NOT_REPRODUCED'
  return 'INCONCLUSIVE'
}

function failed(value: VerificationObservation): boolean {
  return value.status === 0 || value.status >= 400 || value.anomalies.length > 0
}

function expectedSuccess(value: VerificationObservation): boolean {
  if (value.protocol === 'WebSocket') return value.status === 101 && value.anomalies.length === 0
  return value.status > 0 && value.status < 400 && value.anomalies.length === 0
}
