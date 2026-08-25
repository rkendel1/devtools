/**
 * Replay Controller: Orchestrates replay execution across extension boundaries
 *
 * Routes messages:
 * DevTools Panel → Background/Offscreen → Chrome Replay Adapter → Inspected Tab
 *
 * Keeps replay engine platform-agnostic while respecting Chrome architecture
 */

import { ReplayEngine } from './replayEngine'
import { ChromeReplayAdapter } from './chromeReplayAdapter'
import type { ReplayFixture, ReplayRun, OutcomeSignature } from './replayContract'

export type ReplayMessage =
  | { type: 'start'; fixture: ReplayFixture; originalOutcome: OutcomeSignature }
  | { type: 'status'; id: string; phase: string; description: string }
  | { type: 'complete'; id: string; result: ReplayRun }
  | { type: 'error'; id: string; error: string }

export interface ReplayControllerOptions {
  tabId: number
  timeout?: number
}

export class ReplayController {
  private tabId: number
  private timeout: number
  private activeRuns = new Map<string, { promise: Promise<ReplayRun>; abort?: () => void }>()

  constructor(options: ReplayControllerOptions) {
    this.tabId = options.tabId
    this.timeout = options.timeout || 30000
    this.setupMessageListener()
  }

  private setupMessageListener(): void {
    // Listen for messages from DevTools panel
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'replay:start') {
        this.handleStartReplay(request.fixture, request.originalOutcome)
          .then((result) => {
            sendResponse({ type: 'replay:complete', result })
          })
          .catch((error) => {
            sendResponse({ type: 'replay:error', error: error.message })
          })

        // Return true to indicate async response
        return true
      }
    })
  }

  async startReplay(fixture: ReplayFixture, originalOutcome: OutcomeSignature): Promise<ReplayRun> {
    return this.handleStartReplay(fixture, originalOutcome)
  }

  private async handleStartReplay(fixture: ReplayFixture, originalOutcome: OutcomeSignature): Promise<ReplayRun> {
    const replayId = `replay:${fixture.id}:${Date.now()}`

    try {
      this.emitStatus(replayId, 'preparing', 'Initializing browser adapter...')

      // Create adapter for inspected tab
      const adapter = new ChromeReplayAdapter({
        tabId: this.tabId,
        targetUrl: fixture.target.requestUrl,
        targetMethod: fixture.target.requestMethod,
        timeout: this.timeout,
      })

      this.emitStatus(replayId, 'running', 'Starting replay...')

      // Create engine and execute
      const engine = new ReplayEngine(fixture, adapter, { timeout: this.timeout })
      const result = await engine.execute(originalOutcome)

      this.emitStatus(replayId, 'capturing', 'Capturing outcome...')

      return result
    } catch (error) {
      this.emitError(replayId, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async postMessage(tabId: number, message: any): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve()
        }
      })
    })
  }

  private emitStatus(replayId: string, phase: string, description: string): void {
    const message: ReplayMessage = {
      type: 'status',
      id: replayId,
      phase,
      description,
    }

    // Send to all DevTools panels
    chrome.runtime.sendMessage(message).catch(() => {
      // Ignore errors if no listeners
    })
  }

  private emitError(replayId: string, error: string): void {
    const message: ReplayMessage = {
      type: 'error',
      id: replayId,
      error,
    }

    chrome.runtime.sendMessage(message).catch(() => {
      // Ignore errors if no listeners
    })
  }
}

// Export message types for UI
export interface ReplayUIMessage {
  type: 'replay:start'
  fixture: ReplayFixture
  originalOutcome: OutcomeSignature
}

export interface ReplayUIResponse {
  type: 'replay:complete' | 'replay:error'
  result?: ReplayRun
  error?: string
}

/**
 * Send replay request from UI to background controller
 */
export async function sendReplayRequest(
  fixture: ReplayFixture,
  originalOutcome: OutcomeSignature
): Promise<ReplayRun> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'replay:start',
        fixture,
        originalOutcome,
      } as ReplayUIMessage,
      (response: ReplayUIResponse) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (response.type === 'replay:error') {
          reject(new Error(response.error))
        } else {
          resolve(response.result!)
        }
      }
    )
  })
}

/**
 * Listen for replay status updates from background
 */
export function onReplayStatus(callback: (replayId: string, phase: string, description: string) => void): () => void {
  const listener = (message: ReplayMessage) => {
    if (message.type === 'status') {
      callback(message.id, message.phase, message.description)
    }
  }

  chrome.runtime.onMessage.addListener(listener)

  return () => {
    chrome.runtime.onMessage.removeListener(listener)
  }
}

/**
 * Listen for replay errors from background
 */
export function onReplayError(callback: (replayId: string, error: string) => void): () => void {
  const listener = (message: ReplayMessage) => {
    if (message.type === 'error') {
      callback(message.id, message.error)
    }
  }

  chrome.runtime.onMessage.addListener(listener)

  return () => {
    chrome.runtime.onMessage.removeListener(listener)
  }
}
