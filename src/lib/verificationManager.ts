/**
 * Verification Manager: Chrome-side verification of code changes
 *
 * Phase 4.5: CodeChange → Verification
 *
 * Flow:
 * 1. Chrome subscribes to CodeChange events in workspace
 * 2. When CodeChange status = READY_FOR_VERIFICATION, start verification
 * 3. Execute ReplayFixture against codebase with change applied
 * 4. Compare outcome (before vs after)
 * 5. Check for new runtime errors
 * 6. Store VerificationResult in FeltDB
 * 7. Agent discovers result via FeltDB query
 */

import type { ReplayFixture, ReplayRun, Observation } from './replayEngine'
import type { CodeChange, VerificationRun, VerificationResult } from './developmentWorkspace'
import {
  createVerificationRunId,
  createVerificationResultId,
} from './developmentWorkspace'

export interface VerificationContext {
  originalFixture: ReplayFixture
  originalRun: ReplayRun
  changeFixture: ReplayFixture
  changeRun?: ReplayRun
}

export function createChangeFixture(
  originalFixture: ReplayFixture,
  change: CodeChange,
): ReplayFixture {
  return {
    ...originalFixture,
    id: `fixture:change:${change.id}`,
    label: `Fixture with change: ${change.label}`,
  }
}

export function classifyVerificationOutcome(
  originalOutcome: number,
  newOutcome: number,
  newErrors: string[],
): 'FIXED' | 'NOT_FIXED' | 'REGRESSION' | 'INCONCLUSIVE' {
  const originalFailed = originalOutcome >= 400
  const newFailed = newOutcome >= 400

  if (newErrors.length > 0) {
    return 'REGRESSION'
  }

  if (originalFailed && !newFailed) {
    return 'FIXED'
  }

  if (!originalFailed && newFailed) {
    return 'REGRESSION'
  }

  if (originalOutcome === newOutcome) {
    return 'NOT_FIXED'
  }

  return 'INCONCLUSIVE'
}

export function buildVerificationResult(
  workspaceId: string,
  taskId: string,
  codeChangeId: string,
  investigationId: string,
  verificationRunId: string,
  originalOutcome: number,
  newOutcome: number,
  newErrors: string[],
  evidenceNodeIds: string[],
): VerificationResult {
  const status = classifyVerificationOutcome(originalOutcome, newOutcome, newErrors)

  const confidence = (() => {
    if (newErrors.length > 0) return 1.0
    if (originalOutcome === newOutcome) return 0.3
    return 0.9
  })()

  return {
    id: createVerificationResultId(),
    workspaceId,
    taskId,
    verificationRunId,
    codeChangeId,
    investigationId,
    kind: 'verification_result',
    originalOutcome,
    newOutcome,
    newErrors,
    status,
    confidence,
    createdAt: Date.now(),
    evidence: evidenceNodeIds.map((nodeId) => ({
      nodeId,
      type: 'replay' as const,
    })),
  }
}

export function formatVerificationResult(result: VerificationResult): string {
  const lines = [
    `VERIFICATION #${result.verificationRunId.split(':')[1]}`,
    `Status: ${result.status}`,
    `Original: ${result.originalOutcome}`,
    `After change: ${result.newOutcome}`,
  ]

  if (result.newErrors.length > 0) {
    lines.push(`New errors: ${result.newErrors.length}`)
    for (const err of result.newErrors.slice(0, 3)) {
      lines.push(`  • ${err}`)
    }
  } else {
    lines.push('New errors: 0')
  }

  lines.push(`Confidence: ${Math.round(result.confidence * 100)}%`)

  return lines.join('\n')
}

export function getVerificationStatusIcon(status: string): string {
  return {
    FIXED: '✓',
    NOT_FIXED: '✗',
    REGRESSION: '⚠',
    INCONCLUSIVE: '~',
  }[status] || '?'
}

export function buildVerificationRun(
  workspaceId: string,
  taskId: string,
  codeChangeId: string,
  investigationId: string,
  replayFixtureId: string,
): VerificationRun {
  return {
    id: createVerificationRunId(),
    workspaceId,
    taskId,
    codeChangeId,
    investigationId,
    replayFixtureId,
    kind: 'verification_run',
    label: `Verification for change: ${codeChangeId}`,
    status: 'pending',
    startedAt: Date.now(),
  }
}
