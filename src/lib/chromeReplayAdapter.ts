/**
 * Chrome Replay Adapter: Implements ReplayBrowser interface using CDP
 *
 * Operates against currently inspected tab
 * Produces event sequence for FeltDB evidence nodes
 */

import type { ReplayBrowser, ReplayBrowserObservation, NetworkEvent, RuntimeErrorEvent, TargetRequestEvent } from './replayBrowser'
import { CDPBridge } from './cdpBridge'
import type { NetworkFixture } from './replayContract'

export interface ChromeReplayAdapterOptions {
  tabId: number
  targetUrl?: string
  targetMethod?: string
  timeout?: number
}

export class ChromeReplayAdapter implements ReplayBrowser {
  private cdp: CDPBridge
  private observations: ReplayBrowserObservation[] = []
  private networkEvents: NetworkEvent[] = []
  private runtimeErrors: RuntimeErrorEvent[] = []
  private targetRequest: TargetRequestEvent | null = null
  private fixtures: NetworkFixture[] = []
  private options: ChromeReplayAdapterOptions
  private attached = false

  constructor(options: ChromeReplayAdapterOptions) {
    this.options = { timeout: 30000, ...options }
    this.cdp = new CDPBridge(options.tabId)
  }

  async navigate(url: string): Promise<void> {
    if (!this.attached) {
      await this.cdp.attach()
      this.attached = true

      // Enable Network and Runtime domains
      await this.cdp.enableNetworkCapture()
      await this.cdp.sendCommand('Runtime.enable', {})
      await this.cdp.sendCommand('Console.enable', {})

      this.observation('navigation', `CDP attached to tab ${this.options.tabId}`, true)
    }

    await this.cdp.navigate(url)
    this.observation('navigation', `Navigated to ${url}`, true)
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.cdp.evaluate(expression)
    this.observation('interaction', `Evaluated: ${expression.substring(0, 50)}...`, true)
    return result
  }

  async click(selector: string): Promise<void> {
    await this.cdp.click(selector)
    this.observation('interaction', `Clicked ${selector}`, true)
  }

  async input(selector: string, value: string): Promise<void> {
    await this.cdp.type(selector, value)
    this.observation('interaction', `Input ${value} to ${selector}`, true)
  }

  async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
    this.observation('interaction', `Waited ${ms}ms`, true)
  }

  async enableNetworkCapture(fixtures: NetworkFixture[]): Promise<void> {
    this.fixtures = fixtures

    // Clear previous requests
    this.cdp.clearNetworkRequests()
    this.networkEvents = []

    // Start capturing network
    await this.cdp.setRequestInterception(true)

    this.observation('network', `Enabled network capture for ${fixtures.length} fixtures`, true)
  }

  async getNetworkEvents(): Promise<NetworkEvent[]> {
    // Poll for network requests
    const requests = await this.cdp.getNetworkRequests()

    for (const req of requests) {
      const url = req.response?.url || ''
      const method = req.response?.requestHeaders?.['method'] || 'GET'
      const status = req.response?.status || 0

      // Determine event type
      let eventType: 'FIXTURE_MATCHED' | 'UNMATCHED' | 'IGNORED' = 'UNMATCHED'

      // Check if matches fixture
      if (this.fixtures.some((f) => this.urlMatches(url, f.pattern) && f.method === method)) {
        eventType = 'FIXTURE_MATCHED'
        this.observation('network', `Fixture matched: ${method} ${url} → ${status}`, true, {
          event: { type: eventType, url, method, status, timestamp: Date.now() },
        })
      } else if (this.isIgnoredRequest(url)) {
        eventType = 'IGNORED'
      } else {
        this.observation('network', `Unmatched: ${method} ${url}`, true, {
          event: { type: eventType, url, method, status, timestamp: Date.now() },
        })
      }

      this.networkEvents.push({
        type: eventType,
        url,
        method,
        status,
        timestamp: Date.now(),
      })
    }

    return this.networkEvents
  }

  async getTargetRequest(): Promise<TargetRequestEvent | null> {
    // Find request matching target
    const targetUrl = this.options.targetUrl
    const targetMethod = this.options.targetMethod || 'POST'

    const requests = await this.cdp.getNetworkRequests()

    for (const req of requests) {
      const url = req.response?.url || ''
      const method = req.response?.requestHeaders?.['method'] || 'GET'

      if (url === targetUrl && method === targetMethod) {
        this.targetRequest = {
          method,
          url,
          status: req.response?.status || 0,
          statusText: req.response?.statusText || 'Unknown',
          headers: req.response?.headers || {},
          body: null, // Would need Network.getResponseBody to get actual body
          requestTime: req.timestamp || Date.now(),
          responseTime: req.finishedTime || Date.now(),
          timestamp: Date.now(),
        }

        this.observation('target_request', `Target request captured: ${method} ${url} → ${this.targetRequest.status}`, true, {
          event: this.targetRequest,
        })

        return this.targetRequest
      }
    }

    return null
  }

  async getRuntimeErrors(): Promise<RuntimeErrorEvent[]> {
    const cdpErrors = this.cdp.getRuntimeErrors()

    for (const error of cdpErrors) {
      // Hash error message
      let hash = 0
      for (let i = 0; i < error.message.length; i++) {
        const char = error.message.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash
      }

      const fingerprint = `err:${Math.abs(hash)}`

      const runtimeError: RuntimeErrorEvent = {
        message: error.message,
        fingerprint,
        timestamp: error.timestamp,
        source: (error.source as 'console.error' | 'runtime.error' | 'unhandledRejection') || 'runtime.error',
      }

      this.runtimeErrors.push(runtimeError)

      this.observation('runtime_error', `Runtime error: ${error.message}`, true, {
        event: runtimeError,
      })
    }

    return this.runtimeErrors
  }

  async collectObservations(): Promise<ReplayBrowserObservation[]> {
    // Capture final network state
    await this.getNetworkEvents()

    // Capture target request
    await this.getTargetRequest()

    // Capture runtime errors
    await this.getRuntimeErrors()

    return this.observations
  }

  async dispose(): Promise<void> {
    if (this.attached) {
      try {
        await this.cdp.detach()
        this.attached = false
      } catch (error) {
        console.error('Failed to detach CDP:', error)
      }
    }
  }

  private urlMatches(url: string, pattern: string): boolean {
    // Simple URL matching: exact match or pattern match
    if (url === pattern) return true

    // Support wildcards
    const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(url)
  }

  private isIgnoredRequest(url: string): boolean {
    // Ignore analytics, tracking, etc.
    const ignoredPatterns = [
      /analytics/i,
      /segment/i,
      /mixpanel/i,
      /gtag/i,
      /google-analytics/i,
      /sentry/i,
      /intercom/i,
      /rollbar/i,
      /hotjar/i,
      /logrocket/i,
    ]

    return ignoredPatterns.some((p) => p.test(url))
  }

  private observation(
    type: 'navigation' | 'interaction' | 'network' | 'runtime_error' | 'target_request' | 'outcome',
    description: string,
    success: boolean,
    details?: Record<string, unknown>
  ): void {
    this.observations.push({
      type,
      description,
      success,
      timestamp: Date.now(),
      event: details?.event as any,
      details: details ? Object.fromEntries(Object.entries(details).filter(([k]) => k !== 'event')) : undefined,
    })
  }
}
