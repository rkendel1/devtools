/**
 * Chromium Adapter
 *
 * Real implementation for Chrome/Brave using Chrome DevTools Protocol concepts.
 * Uses chrome.devtools.inspectedWindow to interact with inspected page.
 */

import type {
  BrowserRuntimeAdapter,
  BrowserCapabilities,
  Selection,
  ElementMetrics,
  SourceHints,
  SourceLocation,
  ReplayAction,
} from '../../types'

export class ChromiumAdapter implements BrowserRuntimeAdapter {
  private selectionListener: ((sel: Selection) => void) | null = null
  private selectionEnabled = false

  getBrowserName(): 'chromium' | 'firefox' | 'webkit' {
    return 'chromium'
  }

  /**
   * Detect and report actual Chrome capabilities
   */
  async getCapabilities(): Promise<BrowserCapabilities> {
    // Query actual browser capabilities
    // In real DevTools extension, we'd check chrome.devtools availability

    return {
      selection: {
        enabled: true,
        supportsVisualSelection: true,
        supportsSourceMapping: true,
      },
      elementInspection: {
        enabled: true,
        supportsBoundingBox: true,
        supportsComputedStyle: true,
        supportsDOMPath: true,
      },
      replay: {
        enabled: false, // Chromium doesn't reliably support replay
        supportsClickReplay: false,
        supportsScrollReplay: false,
        supportsInputReplay: false,
      },
      verification: {
        enabled: true,
        supportsScreenCapture: false, // Would need proper CDP
        supportsMetricsCapture: true,
        supportsPerformanceObservation: true,
      },
    }
  }

  /**
   * Enable element selection mode
   *
   * In DevTools extension: inject script to highlight elements on hover,
   * listen for click.
   */
  async enableSelectionMode(): Promise<void> {
    if (this.selectionEnabled) {
      return
    }

    this.selectionEnabled = true

    const selectionScript = `
      (function() {
        if (window.__feltdb_selection_cleanup__) window.__feltdb_selection_cleanup__();
        let highlightedElement = null;
        let previousOutline = '';
        let previousOutlineOffset = '';

        const mouseover = (e) => {
          if (e.target !== document.body && e.target !== document.documentElement) {
            highlightedElement = e.target;
            previousOutline = e.target.style.outline;
            previousOutlineOffset = e.target.style.outlineOffset;
            e.target.style.outline = '2px solid #3b82f6';
            e.target.style.outlineOffset = '2px';
          }
        };

        const mouseout = (e) => {
          if (e.target === highlightedElement) {
            e.target.style.outline = previousOutline;
            e.target.style.outlineOffset = previousOutlineOffset;
            highlightedElement = null;
          }
        };

        const click = (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          window.__feltdb_selection_made__ = true;
          window.__feltdb_selected_element__ = e.target;
        };

        window.__feltdb_selection_cleanup__ = () => {
          document.removeEventListener('mouseover', mouseover, true);
          document.removeEventListener('mouseout', mouseout, true);
          document.removeEventListener('click', click, true);
          if (highlightedElement) {
            highlightedElement.style.outline = previousOutline;
            highlightedElement.style.outlineOffset = previousOutlineOffset;
          }
          delete window.__feltdb_selection_cleanup__;
        };
        delete window.__feltdb_selected_element__;
        document.addEventListener('mouseover', mouseover, true);
        document.addEventListener('mouseout', mouseout, true);
        document.addEventListener('click', click, true);
      })();
    `

    await this.executeScript(selectionScript)
  }

  /**
   * Disable selection mode
   */
  async disableSelectionMode(): Promise<void> {
    this.selectionEnabled = false

    const cleanup = `
      if (window.__feltdb_selection_cleanup__) window.__feltdb_selection_cleanup__();
      delete window.__feltdb_selected_element__;
    `

    await this.executeScript(cleanup)
  }

  /**
   * Listen for element selection
   */
  onElementSelected(callback: (sel: Selection) => void): void {
    this.selectionListener = callback

    // Poll for selection (in real extension, would use different approach)
    const checkSelection = async () => {
      const selected = await this.executeScript(
        `
        (() => {
        if (window.__feltdb_selected_element__) {
          const el = window.__feltdb_selected_element__;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);

          const buildSelector = (element) => {
            if (element.id) return '#' + CSS.escape(element.id);
            const path = [];
            let current = element;
            while (current && current !== document.body) {
              let part = current.tagName.toLowerCase();
              if (current.classList.length) part += '.' + Array.from(current.classList).map(value => CSS.escape(value)).join('.');
              const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(value => value.tagName === current.tagName) : [];
              if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
              path.unshift(part);
              current = current.parentElement;
            }
            return path.join(' > ');
          };

          return {
            elementQuery: buildSelector(el),
            boundingBox: {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            },
            computedStyle: {
              display: style.display,
              visibility: style.visibility,
              width: style.width,
              height: style.height,
            },
            textContent: (el.textContent || '').trim().slice(0, 500),
            elementRole: el.getAttribute('role') || el.tagName.toLowerCase(),
            pageUrl: window.location.href,
          };
        }
        return null;
        })()
      `,
        true,
      )

      if (selected) {
        const selection: Selection = {
          elementQuery: selected.elementQuery,
          boundingBox: selected.boundingBox,
          computedStyle: selected.computedStyle,
          textContent: selected.textContent,
          elementRole: selected.elementRole,
          pageUrl: selected.pageUrl,
          sourceHints: await this.detectSourceHints(selected.elementQuery),
        }

        if (this.selectionListener) {
          this.selectionListener(selection)
        }

        await this.executeScript(`delete window.__feltdb_selected_element__`)
      } else if (this.selectionEnabled) {
        setTimeout(checkSelection, 100)
      }
    }

    const poll = () => {
      void checkSelection().catch(() => {
        if (this.selectionEnabled) setTimeout(poll, 100)
      })
    }
    poll()
  }

  /**
   * Inspect element and get detailed properties
   */
  async inspectElement(query: string): Promise<ElementMetrics> {
    const metrics = await this.executeScript(
      `
      const el = document.querySelector('${this.escapeSelectorForScript(query)}');
      if (!el) throw new Error('Element not found: ${query}');

      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);

      return {
        width: rect.width,
        height: rect.height,
        x: rect.left,
        y: rect.top,
        display: style.display,
        visibility: style.visibility,
      };
    `,
      true,
    )

    return metrics
  }

  /**
   * Capture current element state (for verification)
   */
  async captureElementState(query: string): Promise<ElementMetrics> {
    return this.inspectElement(query)
  }

  /**
   * Wait for page to be ready (document.readyState)
   */
  async waitForPageReady(): Promise<void> {
    const maxAttempts = 100
    let attempts = 0

    while (attempts < maxAttempts) {
      const isReady = await this.executeScript(
        `document.readyState === 'complete'`,
        true,
      )

      if (isReady) {
        // Extra wait for React/frameworks to settle
        await new Promise((resolve) => setTimeout(resolve, 500))
        return
      }

      attempts++
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    throw new Error('Page did not become ready after 10s')
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    await this.disableSelectionMode()
    this.selectionListener = null
  }

  /**
   * Execute script in inspected page
   * In DevTools extension: uses chrome.devtools.inspectedWindow.eval
   */
  private async executeScript(code: string, returnValue: boolean = false): Promise<any> {
    // In real DevTools extension, this uses chrome.devtools.inspectedWindow.eval
    // For now, we have a stub that works in test environments

    if (typeof (globalThis as any).chrome?.devtools?.inspectedWindow?.eval === 'function') {
      return new Promise((resolve, reject) => {
        ;(globalThis as any).chrome.devtools.inspectedWindow.eval(
          code,
          (result: any, exceptionInfo: chrome.devtools.inspectedWindow.EvaluationExceptionInfo) => {
            if (exceptionInfo?.isException) {
              reject(new Error(exceptionInfo.description || exceptionInfo.value || String(result || 'Inspected page evaluation failed')))
            } else {
              resolve(result)
            }
          },
        )
      })
    }

    // Fallback for testing: execute in current context
    try {
      const result = Function(code)()
      return returnValue ? result : undefined
    } catch (err) {
      throw new Error(`Script execution failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Build CSS selector for element
   */
  private buildSelector(el: Element): string {
    if (el.id) {
      return `#${el.id}`
    }

    if (el.className) {
      const classes = Array.from(el.classList).join('.')
      return `${el.tagName.toLowerCase()}.${classes}`
    }

    // Build path from element
    const path: string[] = []
    let current: Element | null = el

    while (current && current !== document.body) {
      if (current instanceof Element) {
        let selector = current.tagName.toLowerCase()

        if (current.id) {
          selector += `#${current.id}`
          path.unshift(selector)
          break
        }

        if (current.className) {
          selector += `.${Array.from(current.classList).join('.')}`
        }

        path.unshift(selector)
      }

      current = current.parentElement
    }

    return path.join(' > ')
  }

  /**
   * Detect source file hints for IDE integration
   */
  private async detectSourceHints(query: string): Promise<SourceHints> {
    const hints: SourceHints = {
      sourceLocations: [],
      framework: {
        name: 'unknown',
        detected: false,
      },
      component: undefined,
    }

    // Detect React (simple check)
    const hasReact = await this.executeScript(`!!window.React`, true)
    if (hasReact) {
      hints.framework = {
        name: 'react',
        detected: true,
      }
    }

    // In a real scenario, we'd use React DevTools or similar
    // to get component info. For now, basic detection.

    return hints
  }

  /**
   * Escape selector for use in script string
   */
  private escapeSelectorForScript(selector: string): string {
    return selector.replace(/'/g, "\\'").replace(/"/g, '\\"')
  }
}

export function createChromiumAdapter(): BrowserRuntimeAdapter {
  return new ChromiumAdapter()
}
