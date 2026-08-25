/**
 * CDP Bridge: Chrome DevTools Protocol communication layer
 *
 * Wraps chrome.debugger API (available in extension context)
 * Provides methods for navigation, network interception, evaluation
 */

export interface CDPSession {
  tabId: number
  version: string
}

export interface DebuggerEvent {
  method: string
  params: Record<string, any>
}

export class CDPBridge {
  private tabId: number
  private version: string = '1.3' // Chrome DevTools Protocol version
  private messageId = 0
  private pendingRequests = new Map<number, (result: any) => void>()
  private eventListeners = new Map<string, ((data: any) => void)[]>()
  private networkRequests = new Map<string, any>()
  private runtimeErrors: Array<{ message: string; timestamp: number; source: string }> = []

  constructor(tabId: number) {
    this.tabId = tabId
    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    // Listen for Chrome debugger events
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId === this.tabId) {
        this.handleDebuggerEvent(method, params)
      }
    })
  }

  private handleDebuggerEvent(method: string, params: any): void {
    // Network events
    if (method === 'Network.responseReceived') {
      const requestId = params.requestId
      this.networkRequests.set(requestId, {
        type: 'responseReceived',
        response: params.response,
        timestamp: Date.now(),
      })
    }

    if (method === 'Network.loadingFinished') {
      const requestId = params.requestId
      const entry = this.networkRequests.get(requestId)
      if (entry) {
        entry.finished = true
        entry.finishedTime = Date.now()
      }
    }

    // Runtime errors
    if (method === 'Runtime.exceptionThrown') {
      this.runtimeErrors.push({
        message: params.exceptionDetails?.text || 'Unknown error',
        timestamp: Date.now(),
        source: 'runtime.error',
      })
    }

    if (method === 'Runtime.consoleAPICalled') {
      if (params.type === 'error') {
        this.runtimeErrors.push({
          message: params.args?.[0]?.value || 'Console error',
          timestamp: Date.now(),
          source: 'console.error',
        })
      }
    }

    // Notify listeners
    const listeners = this.eventListeners.get(method) || []
    for (const listener of listeners) {
      listener(params)
    }
  }

  async attach(): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId: this.tabId }, this.version, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Failed to attach debugger: ${chrome.runtime.lastError.message}`))
        } else {
          resolve()
        }
      })
    })
  }

  async detach(): Promise<void> {
    return new Promise((resolve) => {
      chrome.debugger.detach({ tabId: this.tabId }, () => {
        resolve()
      })
    })
  }

  async sendCommand(method: string, params?: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId: this.tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`CDP command failed: ${chrome.runtime.lastError.message}`))
        } else {
          resolve(result)
        }
      })
    })
  }

  async navigate(url: string): Promise<void> {
    await this.sendCommand('Page.navigate', { url })
    // Wait for page load
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  async evaluate(expression: string): Promise<any> {
    const result = await this.sendCommand('Runtime.evaluate', { expression })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text)
    }
    return result.result?.value
  }

  async click(selector: string): Promise<void> {
    const expression = `
      (function() {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) throw new Error('Element not found: ${selector}');
        el.click();
      })()
    `
    await this.evaluate(expression)
  }

  async type(selector: string, value: string): Promise<void> {
    const expression = `
      (function() {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) throw new Error('Element not found: ${selector}');
        el.focus();
        el.value = '${value.replace(/'/g, "\\'")}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `
    await this.evaluate(expression)
  }

  async waitForSelector(selector: string, timeout = 5000): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      try {
        const result = await this.evaluate(`!!document.querySelector('${selector.replace(/'/g, "\\'")}')`)
        if (result) return
      } catch {
        // Continue waiting
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Timeout waiting for selector: ${selector}`)
  }

  async enableNetworkCapture(): Promise<void> {
    await this.sendCommand('Network.enable', {})
  }

  async setRequestInterception(enabled: boolean): Promise<void> {
    await this.sendCommand('Network.setRequestInterceptionEnabled', { enabled })
  }

  async getNetworkRequests(): Promise<any[]> {
    return Array.from(this.networkRequests.values())
  }

  getRuntimeErrors(): Array<{ message: string; timestamp: number; source: string }> {
    return [...this.runtimeErrors]
  }

  clearRuntimeErrors(): void {
    this.runtimeErrors = []
  }

  clearNetworkRequests(): void {
    this.networkRequests.clear()
  }

  addEventListener(method: string, listener: (data: any) => void): () => void {
    const listeners = this.eventListeners.get(method) || []
    listeners.push(listener)
    this.eventListeners.set(method, listeners)

    // Return unsubscribe function
    return () => {
      const idx = listeners.indexOf(listener)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  }
}
