/**
 * Visual Selection & UI Change Verification
 *
 * Phase 4.6: Select → Describe → Change → Verify
 *
 * Flow:
 * 1. User clicks element on live page (Select Mode)
 * 2. Extension captures VisualSelection
 * 3. User describes intent: "Make this smaller", "Move above button", etc.
 * 4. Extension creates SelectionTask with instruction
 * 5. Agent discovers task and modifies code (existing CodeChange mechanism)
 * 6. Browser reloads and recaptures element
 * 7. Compare before/after element state
 * 8. Report VerificationResult
 */

import type { VisualSelection, SelectionTask } from './developmentWorkspace'
import {
  createSelectionId,
  createSelectionTaskId,
} from './developmentWorkspace'

export interface ElementMetrics {
  width: number
  height: number
  x: number
  y: number
  computedStyle: {
    display: string
    fontSize?: string
    color?: string
    backgroundColor?: string
  }
}

export function captureElementMetrics(
  boundingBox: { x: number; y: number; width: number; height: number },
  style: Record<string, string> = {},
): ElementMetrics {
  return {
    width: boundingBox.width,
    height: boundingBox.height,
    x: boundingBox.x,
    y: boundingBox.y,
    computedStyle: {
      display: style.display || 'block',
      fontSize: style.fontSize,
      color: style.color,
      backgroundColor: style.backgroundColor,
    },
  }
}

export interface VisualChangeComparison {
  size: {
    changed: boolean
    before: { width: number; height: number }
    after: { width: number; height: number }
  }
  position: {
    changed: boolean
    before: { x: number; y: number }
    after: { x: number; y: number }
  }
  visibility: {
    changed: boolean
    visible: boolean
  }
  textContent: {
    changed: boolean
    before: string
    after: string
  }
}

export function compareVisualState(
  before: ElementMetrics,
  after: ElementMetrics,
  beforeText: string,
  afterText: string,
): VisualChangeComparison {
  return {
    size: {
      changed: before.width !== after.width || before.height !== after.height,
      before: { width: before.width, height: before.height },
      after: { width: after.width, height: after.height },
    },
    position: {
      changed: before.x !== after.x || before.y !== after.y,
      before: { x: before.x, y: before.y },
      after: { x: after.x, y: after.y },
    },
    visibility: {
      changed: before.computedStyle.display !== after.computedStyle.display,
      visible: after.computedStyle.display !== 'none',
    },
    textContent: {
      changed: beforeText !== afterText,
      before: beforeText,
      after: afterText,
    },
  }
}

export function classifyVisualVerification(
  comparison: VisualChangeComparison,
  expectedChanges?: string[],
): 'VERIFIED' | 'NOT_CHANGED' | 'UNEXPECTED_CHANGE' | 'INCOMPLETE' {
  const changes: string[] = []

  if (comparison.size.changed) changes.push('size')
  if (comparison.position.changed) changes.push('position')
  if (comparison.textContent.changed) changes.push('text')

  if (changes.length === 0) {
    return 'NOT_CHANGED'
  }

  if (!expectedChanges || expectedChanges.length === 0) {
    return 'UNEXPECTED_CHANGE'
  }

  const allExpectedFound = expectedChanges.every((exp) =>
    changes.some((c) => c.toLowerCase().includes(exp.toLowerCase())),
  )

  return allExpectedFound ? 'VERIFIED' : 'INCOMPLETE'
}

export function buildVisualSelection(
  workspaceId: string,
  url: string,
  selector: string,
  textContent: string,
  boundingBox: { x: number; y: number; width: number; height: number },
  domPath: string,
  nearbyElements: Array<{ selector: string; text: string }> = [],
  sourceHints?: Array<{ file: string; line?: number }>,
  investigationId?: string,
): VisualSelection {
  return {
    id: createSelectionId(),
    workspaceId,
    kind: 'visual_selection',
    url,
    selector,
    elementRole: 'button', // simplified - would extract from DOM
    textContent,
    boundingBox,
    domPath,
    nearbyElements,
    sourceHints,
    capturedAt: Date.now(),
    properties: {
      investigationId,
    },
  }
}

export function buildSelectionTask(
  workspaceId: string,
  selectionId: string,
  userInstruction: string,
  taskType: 'UI_CHANGE' | 'DEBUG_QUESTION' | 'CONTENT_CHANGE' = 'UI_CHANGE',
): SelectionTask {
  return {
    id: createSelectionTaskId(),
    workspaceId,
    kind: 'selection_task',
    selectionId,
    userInstruction,
    taskType,
    createdAt: Date.now(),
    status: 'open',
    properties: {},
  }
}

export function formatVisualComparison(comparison: VisualChangeComparison): string {
  const lines = ['VISUAL COMPARISON', '']

  if (comparison.size.changed) {
    lines.push(
      `SIZE: ${comparison.size.before.width}×${comparison.size.before.height} → ` +
      `${comparison.size.after.width}×${comparison.size.after.height} ✓`,
    )
  }

  if (comparison.position.changed) {
    lines.push(
      `POSITION: (${comparison.position.before.x}, ${comparison.position.before.y}) → ` +
      `(${comparison.position.after.x}, ${comparison.position.after.y}) ✓`,
    )
  }

  if (comparison.textContent.changed) {
    lines.push(`CONTENT: "${comparison.textContent.before}" → "${comparison.textContent.after}" ✓`)
  }

  if (!comparison.size.changed && !comparison.position.changed && !comparison.textContent.changed) {
    lines.push('(no visual changes detected)')
  }

  return lines.join('\n')
}
