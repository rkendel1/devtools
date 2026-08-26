/**
 * Selection Mode: Lightweight DOM selection for UI changes
 *
 * Phase 4.7: Real Select → Describe → Change → Verify UI
 *
 * Runs in the inspected page context.
 * Captures semantic properties, not entire DOM.
 */

export interface DOMElementContext {
  selector: string
  tagName: string
  role?: string
  textContent: string
  attributes: Record<string, string>
  classes: string[]
  parentSelector?: string
  siblingCount: number
}

export interface SourceHint {
  file: string
  line?: number
  column?: number
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE'
  reason?: string
}

export function findSelectorForElement(el: Element): string {
  if (el.id) {
    return `#${el.id}`
  }

  const path: string[] = []
  let current = el

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase()

    if (current.id) {
      path.unshift(`#${current.id}`)
      break
    }

    if (current.className) {
      const classes = (current.className as string).split(' ').filter((c) => c)
      if (classes.length > 0) {
        selector += `.${classes.join('.')}`
      }
    }

    const siblings = Array.from(current.parentElement?.children || [])
    const index = siblings.indexOf(current as Element)
    if (index > 0) {
      selector += `:nth-child(${index + 1})`
    }

    path.unshift(selector)
    current = current.parentElement as Element
  }

  return path.join(' > ')
}

export function findParentSelector(el: Element): string | undefined {
  const parent = el.parentElement
  if (!parent || parent === document.body) {
    return undefined
  }
  return findSelectorForElement(parent)
}

export function extractElementContext(el: Element): DOMElementContext {
  const textContent = el.textContent?.substring(0, 100).trim() || ''
  const rect = el.getBoundingClientRect()
  const siblings = el.parentElement?.children || []

  return {
    selector: findSelectorForElement(el),
    tagName: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || undefined,
    textContent,
    attributes: {
      id: el.id || '',
      class: el.className || '',
      'data-test': el.getAttribute('data-test') || '',
    },
    classes: el.className
      ? el.className.split(' ').filter((c) => c)
      : [],
    parentSelector: findParentSelector(el),
    siblingCount: siblings.length,
  }
}

export function findElementBySelector(selector: string): Element | null {
  try {
    return document.querySelector(selector)
  } catch {
    return null
  }
}

export function captureElementState(el: Element): {
  rect: DOMRect
  display: string
  position: string
  computed: Record<string, string>
} {
  const rect = el.getBoundingClientRect()
  const style = window.getComputedStyle(el)

  return {
    rect,
    display: style.display,
    position: style.position,
    computed: {
      width: style.width,
      height: style.height,
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      visibility: style.visibility,
      opacity: style.opacity,
    },
  }
}

export function isElementVisible(el: Element): boolean {
  const style = window.getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
}

export function guessSourceHint(el: Element): SourceHint {
  // Very simple heuristic: look for data-test or ID to hint at source location
  const testId = el.getAttribute('data-test')
  const id = el.id

  if (testId) {
    return {
      file: 'src/components/[unknown].tsx',
      confidence: 'MEDIUM',
      reason: `Found data-test="${testId}"`,
    }
  }

  if (id) {
    return {
      file: 'src/components/[unknown].tsx',
      confidence: 'LOW',
      reason: `Found id="${id}"`,
    }
  }

  return {
    file: '',
    confidence: 'UNAVAILABLE',
    reason: 'No test ID or stable identifier found',
  }
}

export function formatElementDescription(context: DOMElementContext): string {
  const parts = [
    `<${context.tagName}`,
    context.role ? ` role="${context.role}"` : '',
    context.classes.length > 0 ? ` class="${context.classes.join(' ')}"` : '',
    '>',
  ].filter(Boolean)

  const tag = parts.join('')
  const text = context.textContent ? ` "${context.textContent}"` : ''

  return `${tag}${text}`
}
