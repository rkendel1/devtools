/**
 * ReplayBrowser: Abstract interface for browser automation
 *
 * ReplayEngine is platform-agnostic. It consumes this interface.
 * Implementations: ChromeReplayAdapter, PlaywrightReplayAdapter, RemoteReplayAdapter
 */

export interface ReplayBrowserCapabilities {
  navigation: boolean
  clicks: boolean
  inputs: boolean
  networkInterception: boolean
  timing: boolean
  localStorage: boolean
  cookies: boolean
}

export type NetworkEventType = 'FIXTURE_MATCHED' | 'UNMATCHED' | 'IGNORED'

export interface NetworkEvent {
  type: NetworkEventType
  url: string
  method: string
  status?: number
  timestamp: number
  details?: Record<string, unknown>
}

export interface InteractionEvent {
  type: 'navigate' | 'click' | 'input' | 'wait'
  selector?: string
  url?: string
  value?: string
  delayMs?: number
  success: boolean
  timestamp: number
  error?: string
}

export interface RuntimeErrorEvent {
  message: string
  fingerprint: string
  timestamp: number
  source: 'console.error' | 'runtime.error' | 'unhandledRejection'
}

export interface TargetRequestEvent {
  method: string
  url: string
  status: number
  statusText: string
  headers: Record<string, string>
  body: string | null
  requestTime: number
  responseTime: number
  timestamp: number
}

export interface ReplayBrowserObservation {
  type: 'navigation' | 'interaction' | 'network' | 'event' | 'runtime_error' | 'target_request' | 'outcome'
  description: string
  success: boolean
  timestamp: number
  event?: NetworkEvent | InteractionEvent | RuntimeErrorEvent | TargetRequestEvent
  details?: Record<string, unknown>
}

export interface ReplayBrowser {
  // Navigation
  navigate(url: string): Promise<void>

  // Evaluation (for assertions, etc.)
  evaluate(expression: string): Promise<unknown>

  // Interactions
  click(selector: string): Promise<void>
  input(selector: string, value: string): Promise<void>
  wait(ms: number): Promise<void>

  // Network management
  enableNetworkCapture(fixtures: any[]): Promise<void>
  getNetworkEvents(): Promise<NetworkEvent[]>
  getTargetRequest(): Promise<TargetRequestEvent | null>

  // Runtime state
  getRuntimeErrors(): Promise<RuntimeErrorEvent[]>

  // Collection
  collectObservations(): Promise<ReplayBrowserObservation[]>

  // Lifecycle
  dispose(): Promise<void>
}
