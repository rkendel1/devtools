import type { ConsoleEvent, NetworkRequestSnapshot } from './types'
import { truncateHeaders, truncateText } from './retention'

type ChromeRequest = {
  request: {
    method: string
    url: string
    headers?: Array<{ name: string; value?: string }>
    postData?: { text?: string }
  }
  response: {
    status: number
    statusText: string
    headers?: Array<{ name: string; value?: string }>
    content?: { mimeType?: string }
    timing?: { receiveHeadersEnd?: number }
  }
  startedDateTime: string
  time?: number
  initiator?: { stack?: { callFrames?: Array<{ url?: string; lineNumber?: number; functionName?: string }> } }
  getContent: (callback: (content: string, encoding: string) => void) => void
}

function requestToSnapshot(entry: unknown): Promise<NetworkRequestSnapshot> {
  return new Promise((resolve) => {
    const requestRef = entry as ChromeRequest
    const startedAt = new Date(requestRef.startedDateTime).getTime()
    requestRef.getContent((content) => {
      const frame = requestRef.initiator?.stack?.callFrames?.[0]
      resolve({
        id: `${requestRef.request.method}:${requestRef.request.url}:${startedAt}`,
        startedAt,
        endedAt: startedAt + Math.round(requestRef.time ?? 0),
        method: requestRef.request.method,
        url: requestRef.request.url,
        status: requestRef.response.status,
        statusText: requestRef.response.statusText,
        requestHeaders: truncateHeaders(headersToMap(requestRef.request.headers)),
        responseHeaders: truncateHeaders(headersToMap(requestRef.response.headers)),
        requestBody: truncateText(requestRef.request.postData?.text),
        responseBody: truncateText(content),
        initiator: {
          source: frame?.url,
          line: typeof frame?.lineNumber === 'number' ? frame.lineNumber + 1 : undefined,
          functionName: frame?.functionName,
        },
        timingMs: requestRef.time,
        mimeType: requestRef.response.content?.mimeType,
      })
    })
  })
}

function headersToMap(headers: Array<{ name: string; value?: string }> | undefined): Record<string, string> {
  return (headers ?? []).reduce<Record<string, string>>((acc, header) => {
    acc[header.name] = header.value ?? ''
    return acc
  }, {})
}

export function hasChromeDevtools(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.devtools?.network
}

export async function captureRequests(limit = 200): Promise<NetworkRequestSnapshot[]> {
  if (!hasChromeDevtools()) {
    return []
  }

  return new Promise((resolve) => {
    chrome.devtools.network.getHAR(async (harLog: { entries: Array<unknown> }) => {
      const entries = harLog.entries.slice(-limit)
      const output = await Promise.all(entries.map(requestToSnapshot))

      resolve(output)
    })
  })
}

export async function captureConsoleEvents(limit = 50): Promise<ConsoleEvent[]> {
  if (!hasChromeDevtools()) {
    return []
  }

  return new Promise((resolve) => {
    try {
      if (!chrome.runtime?.id) return resolve([])
      chrome.runtime.sendMessage(
        { type: 'runtime-investigator:get-events', tabId: chrome.devtools.inspectedWindow.tabId },
        (response) => resolve(chrome.runtime.lastError ? [] : (response?.events ?? []).slice(-limit)),
      )
    } catch {
      resolve([])
    }
  })
}

export function primeConsoleCapture(): void {
  // Capture is installed at document_start by page-capture.js.
}

export function subscribeToRequests(onRequest: (request: NetworkRequestSnapshot) => void): () => void {
  if (!hasChromeDevtools()) return () => undefined
  const listener = (request: unknown) => void requestToSnapshot(request).then(onRequest)
  chrome.devtools.network.onRequestFinished.addListener(listener)
  return () => chrome.devtools.network.onRequestFinished.removeListener(listener)
}

export async function captureEnvironment(): Promise<{ pageUrl?: string; userAgent?: string; viewport?: string }> {
  if (!hasChromeDevtools()) return {}
  return new Promise((resolve) => chrome.devtools.inspectedWindow.eval(
    `({ pageUrl: location.href, userAgent: navigator.userAgent, viewport: innerWidth + 'x' + innerHeight })`,
    (result) => resolve((result as { pageUrl?: string; userAgent?: string; viewport?: string }) ?? {}),
  ))
}

export async function captureScreenshot(): Promise<string | undefined> {
  if (!hasChromeDevtools() || !chrome.tabs?.captureVisibleTab) return undefined
  return new Promise((resolve) => chrome.tabs.get(chrome.devtools.inspectedWindow.tabId, (tab) => {
    if (chrome.runtime.lastError || tab.windowId == null) return resolve(undefined)
    chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
      resolve(chrome.runtime.lastError ? undefined : dataUrl)
    })
  }))
}

export function openSourceLocation(source: string, line?: number): void {
  chrome.devtools.panels.openResource(source, Math.max(0, (line ?? 1) - 1))
}

export function endpointKey(request: Pick<NetworkRequestSnapshot, 'method' | 'url'>): string {
  try {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:id')
    return `${request.method} ${url.origin}${path}`
  } catch {
    return `${request.method} ${request.url.replace(/\/\d+(?=\/|$)/g, '/:id')}`
  }
}

export function pingExtensionContext(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime?.id) return resolve(false)
      chrome.runtime.sendMessage({ type: 'runtime-investigator:health' }, (response) => {
        resolve(!chrome.runtime.lastError && response?.ok === true)
      })
    } catch {
      resolve(false)
    }
  })
}
