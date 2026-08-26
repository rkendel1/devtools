/**
 * Investigation Envelope: Clean context extraction
 *
 * Converts raw FeltDB investigation data into a development-context artifact.
 * Agent never sees Chrome telemetry, ReplayRun internals, or evidence-graph details.
 *
 * Only provides:
 * - Problem diagnosis + confidence
 * - Reproduction proof (replay status)
 * - Counterfactual findings (what variable isolates cause)
 * - Source locations
 * - Evidence reference IDs (for future detailed inspection)
 */

import type {
  InvestigationContextEnvelope,
  Investigation,
  ReplayRunReference,
  CounterfactualFinding,
} from './developmentWorkspace'
import type { ReplayRun } from './replayContract'
import { formatReplayStatus } from './replayFeltDB'

export interface EnvelopeSource {
  investigation: Investigation
  replayRun?: ReplayRun
  counterfactualFindings?: CounterfactualFinding[]
  sourceLocations?: Array<{ file: string; line?: number; column?: number }>
  evidenceNodeIds?: string[]
}

export function extractInvestigationEnvelope(
  workspaceId: string,
  source: EnvelopeSource,
  taskDescription?: string
): InvestigationContextEnvelope {
  const { investigation, replayRun, counterfactualFindings = [], sourceLocations = [], evidenceNodeIds = [] } = source

  return {
    workspaceId,
    investigationId: investigation.id,
    task: taskDescription
      ? {
          id: `inline:${investigation.id}`,
          description: taskDescription,
        }
      : undefined,
    problem: {
      diagnosis: investigation.diagnosis,
      confidence: investigation.confidence,
      sourceLocations: sourceLocations.length > 0 ? sourceLocations : undefined,
    },
    reproduction: {
      pageUrl: investigation.properties.pageUrl,
      targetRequest: investigation.properties.targetRequest || {
        method: 'GET',
        url: '',
      },
      status: investigation.properties.status || 0,
      errorCount: investigation.properties.errorCount || 0,
      reproductionSteps: investigation.properties.reproductionSteps,
    },
    replay: replayRun
      ? {
          id: replayRun.id,
          status: replayRun.outcome.status as 'REPRODUCED' | 'PARTIAL' | 'NOT_REPRODUCED',
          confidence: replayRun.outcome.confidence,
          observationCount: replayRun.observations.length,
        }
      : undefined,
    counterfactuals: counterfactualFindings.filter((f) => f.status === 'ISOLATES_CAUSE'),
    evidence: {
      nodeIds: evidenceNodeIds,
    },
  }
}

export function summarizeEnvelope(envelope: InvestigationContextEnvelope): string {
  const lines: string[] = []

  lines.push(`Task: ${envelope.problem.diagnosis}`)
  lines.push(`Workspace: ${envelope.workspaceId}`)
  lines.push(`Investigation: ${envelope.investigationId}`)

  lines.push('')
  lines.push('Problem:')
  lines.push(`  ${envelope.problem.diagnosis}`)
  lines.push(`  Confidence: ${Math.round(envelope.problem.confidence * 100)}%`)

  if (envelope.problem.sourceLocations?.length) {
    lines.push(`  Likely source:`)
    for (const loc of envelope.problem.sourceLocations) {
      lines.push(`    ${loc.file}${loc.line ? `:${loc.line}` : ''}`)
    }
  }

  lines.push('')
  lines.push('Reproduction:')
  lines.push(`  ${envelope.reproduction.targetRequest.method} ${envelope.reproduction.targetRequest.url}`)
  lines.push(`  Status: ${envelope.reproduction.status}`)
  lines.push(`  Errors: ${envelope.reproduction.errorCount}`)

  if (envelope.replay) {
    lines.push('')
    lines.push('Confirmation:')
    lines.push(`  Replay #${envelope.replay.id.split(':')[2]?.slice(0, 6) || 'unknown'}`)
    lines.push(`  Status: ${envelope.replay.status}`)
    lines.push(`  Confidence: ${Math.round(envelope.replay.confidence * 100)}%`)
    lines.push(`  Observations: ${envelope.replay.observationCount}`)
  }

  if (envelope.counterfactuals.length > 0) {
    lines.push('')
    lines.push('Isolated Causal Variables:')
    for (const finding of envelope.counterfactuals) {
      lines.push(`  ${finding.variable}: ${finding.reasoning}`)
      lines.push(`    ${finding.baselineOutcome} → ${finding.experimentOutcome}`)
      lines.push(`    Confidence: ${Math.round(finding.confidence * 100)}%`)
    }
  }

  return lines.join('\n')
}
