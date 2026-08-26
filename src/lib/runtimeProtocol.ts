import type { NetworkRequestSnapshot } from './types'

export type RuntimeProtocol = 'HTTP' | 'WebSocket' | 'SSE' | 'streaming' | 'polling' | 'other'

export function classifyRuntimeProtocol(request: Pick<NetworkRequestSnapshot, 'url' | 'status' | 'requestHeaders' | 'responseHeaders' | 'mimeType'>): RuntimeProtocol {
  const requestHeaders = lowerHeaders(request.requestHeaders)
  const responseHeaders = lowerHeaders(request.responseHeaders)
  const upgrade = `${requestHeaders.upgrade ?? ''} ${responseHeaders.upgrade ?? ''}`.toLowerCase()
  if (request.status === 101 || upgrade.includes('websocket') || requestHeaders['sec-websocket-protocol']) return 'WebSocket'
  const contentType = `${responseHeaders['content-type'] ?? ''} ${request.mimeType ?? ''}`.toLowerCase()
  if (contentType.includes('text/event-stream')) return 'SSE'
  if (responseHeaders['transfer-encoding']?.toLowerCase().includes('chunked') && !responseHeaders['content-length']) return 'streaming'
  if (/(?:\/|[?&])(?:long-?poll|polling)(?:\/|[?&=]|$)|[?&]transport=polling\b/i.test(request.url)) return 'polling'
  if (/^https?:/i.test(request.url)) return 'HTTP'
  return 'other'
}

export function isExpectedLongLivedProtocol(protocol: RuntimeProtocol): boolean {
  return protocol === 'WebSocket' || protocol === 'SSE' || protocol === 'streaming' || protocol === 'polling'
}

export function isViteHmr(request: Pick<NetworkRequestSnapshot, 'requestHeaders' | 'responseHeaders'>): boolean {
  const headers = { ...lowerHeaders(request.requestHeaders), ...lowerHeaders(request.responseHeaders) }
  return headers['sec-websocket-protocol']?.toLowerCase().includes('vite-hmr') ?? false
}

function lowerHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
}
