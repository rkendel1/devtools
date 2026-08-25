import type { InvestigationRecord } from './types'
import type { EvidenceGraph } from './types'

export interface VerificationSnapshot {
  investigationId: string
  timestamp: number
  graph: EvidenceGraph
  result: InvestigationRecord['result']
  status: 'fixed' | 'regressed' | 'changed'
  changes: VerificationChange[]
}

export interface VerificationChange {
  type: 'status' | 'timing' | 'payload' | 'error' | 'new_error' | 'missing_error'
  before: string | number | null
  after: string | number | null
  severity: 'success' | 'warning' | 'danger'
  description: string
}

export function compareInvestigations(before: InvestigationRecord, after: InvestigationRecord): VerificationSnapshot {
  const changes: VerificationChange[] = []

  // Compare HTTP status
  if (before.graph.request.status !== after.graph.request.status) {
    changes.push({
      type: 'status',
      before: `${before.graph.request.status} ${before.graph.response.statusText}`,
      after: `${after.graph.request.status} ${after.graph.response.statusText}`,
      severity: after.graph.request.status >= 400 ? 'danger' : 'success',
      description: `Status changed from ${before.graph.request.status} to ${after.graph.request.status}`,
    })
  }

  // Compare request timing
  const beforeTiming = before.graph.bundle?.responseBody ? estimateTimingMs(before.graph.bundle.responseBody) : 0
  const afterTiming = after.graph.bundle?.responseBody ? estimateTimingMs(after.graph.bundle.responseBody) : 0
  if (Math.abs(beforeTiming - afterTiming) > 100) {
    changes.push({
      type: 'timing',
      before: beforeTiming,
      after: afterTiming,
      severity: afterTiming > beforeTiming * 1.5 ? 'warning' : 'success',
      description: `Request timing ${afterTiming > beforeTiming ? 'increased' : 'decreased'} ${Math.abs(afterTiming - beforeTiming)}ms`,
    })
  }

  // Compare response shape
  const beforePayload = before.graph.bundle?.responseBody ? safeParseJson(before.graph.bundle.responseBody) : null
  const afterPayload = after.graph.bundle?.responseBody ? safeParseJson(after.graph.bundle.responseBody) : null

  if (beforePayload && afterPayload) {
    const payloadDiff = comparePayloads(beforePayload, afterPayload)
    if (payloadDiff.length > 0) {
      changes.push({
        type: 'payload',
        before: JSON.stringify(beforePayload).length,
        after: JSON.stringify(afterPayload).length,
        severity: 'warning',
        description: `Response payload changed (${payloadDiff.length} fields differ)`,
      })
    }
  }

  // Compare errors
  const beforeErrors = before.graph.relatedEvents.filter((e) => e.type === 'runtime.error' || e.type === 'console.error')
  const afterErrors = after.graph.relatedEvents.filter((e) => e.type === 'runtime.error' || e.type === 'console.error')

  if (beforeErrors.length > 0 && afterErrors.length === 0) {
    changes.push({
      type: 'missing_error',
      before: beforeErrors.length,
      after: 0,
      severity: 'success',
      description: `Errors resolved: ${beforeErrors.length} error(s) no longer occur`,
    })
  } else if (beforeErrors.length === 0 && afterErrors.length > 0) {
    changes.push({
      type: 'new_error',
      before: 0,
      after: afterErrors.length,
      severity: 'danger',
      description: `New errors detected: ${afterErrors.length} error(s) appeared`,
    })
  }

  // Determine overall status
  let status: 'fixed' | 'regressed' | 'changed' = 'changed'
  if (changes.length === 0) {
    status = 'changed' // No observable difference
  } else if (before.graph.request.status >= 400 && after.graph.request.status < 400) {
    status = 'fixed'
  } else if (before.graph.request.status < 400 && after.graph.request.status >= 400) {
    status = 'regressed'
  } else if (changes.some((c) => c.severity === 'danger')) {
    status = 'regressed'
  } else if (changes.some((c) => c.severity === 'success')) {
    status = 'fixed'
  }

  return {
    investigationId: before.id,
    timestamp: Date.now(),
    graph: after.graph,
    result: after.result,
    status,
    changes,
  }
}

function comparePayloads(before: unknown, after: unknown): Array<{ path: string; beforeValue: unknown; afterValue: unknown }> {
  const diffs: Array<{ path: string; beforeValue: unknown; afterValue: unknown }> = []

  function traverse(b: unknown, a: unknown, path: string) {
    if (typeof b !== typeof a) {
      diffs.push({ path, beforeValue: b, afterValue: a })
      return
    }

    if (typeof b === 'object' && b !== null && typeof a === 'object' && a !== null) {
      const bKeys = Object.keys(b as Record<string, unknown>)
      const aKeys = Object.keys(a as Record<string, unknown>)

      for (const key of new Set([...bKeys, ...aKeys])) {
        const newPath = path ? `${path}.${key}` : key
        const bVal = (b as Record<string, unknown>)[key]
        const aVal = (a as Record<string, unknown>)[key]

        if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
          if (typeof bVal === 'object' && typeof aVal === 'object') {
            traverse(bVal, aVal, newPath)
          } else {
            diffs.push({ path: newPath, beforeValue: bVal, afterValue: aVal })
          }
        }
      }
    }
  }

  traverse(before, after, '')
  return diffs.slice(0, 5) // Limit to first 5 differences
}

function safeParseJson(text: string | unknown): unknown {
  if (typeof text === 'string') {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
  return text
}

function estimateTimingMs(responseBody: string | unknown): number {
  const bodyStr = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
  // Very rough estimate: 1ms per 1KB
  return Math.max(50, Math.round(bodyStr.length / 1024))
}

export function formatVerificationSummary(snapshot: VerificationSnapshot): string {
  const lines = [
    `Verification Results: ${snapshot.status.toUpperCase()}`,
    `Timestamp: ${new Date(snapshot.timestamp).toISOString()}`,
    '',
    'Changes Detected:',
  ]

  if (snapshot.changes.length === 0) {
    lines.push('  (no observable changes)')
  } else {
    for (const change of snapshot.changes) {
      const icon = change.severity === 'success' ? '✓' : change.severity === 'warning' ? '⚠' : '✗'
      lines.push(`  ${icon} ${change.description}`)
      if (change.before !== null && change.after !== null) {
        lines.push(`    Before: ${change.before} → After: ${change.after}`)
      }
    }
  }

  return lines.join('\n')
}

export function getVerificationStatusColor(status: 'fixed' | 'regressed' | 'changed'): string {
  return {
    fixed: '#10b981', // green
    regressed: '#ef4444', // red
    changed: '#f59e0b', // amber
  }[status]
}

export function getVerificationStatusIcon(status: 'fixed' | 'regressed' | 'changed'): string {
  return {
    fixed: '✓',
    regressed: '✗',
    changed: '~',
  }[status]
}
