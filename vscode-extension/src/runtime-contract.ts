import type { RuntimeInvestigation } from '@feltdb/core/workspace'

export interface CanonicallyLinkedEnvelope {
  canonicalObservationId?: string
  canonicalObservationIds?: string[]
  originalObservationId?: string
}

export function isCanonicalRuntimeInvestigation(value: unknown): value is RuntimeInvestigation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<RuntimeInvestigation>
  return typeof candidate.id === 'string'
    && typeof candidate.observationId === 'string'
    && typeof candidate.investigationState === 'string'
    && typeof candidate.remediationState === 'string'
    && typeof candidate.verificationState === 'string'
}

export function canonicalObservationIds(envelope: CanonicallyLinkedEnvelope): string[] {
  return [...new Set([
    ...(envelope.canonicalObservationIds ?? []),
    ...(envelope.canonicalObservationId ? [envelope.canonicalObservationId] : []),
  ])]
}

export function resolveCanonicalInvestigation(
  envelope: CanonicallyLinkedEnvelope,
  investigations: Iterable<RuntimeInvestigation>,
): RuntimeInvestigation | undefined {
  const references = new Set(canonicalObservationIds(envelope))
  if (!references.size) return undefined
  return [...investigations].find((investigation) => [
    investigation.observationId,
    ...(investigation.observationIds ?? []),
  ].some((observationId) => references.has(observationId)))
}
