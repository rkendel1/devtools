import { describe, expect, it } from 'vitest'
import { buildEvidenceGraph } from './evidenceEngine'
import { classifyRuntimeProtocol, isViteHmr } from './runtimeProtocol'
import type { NetworkRequestSnapshot } from './types'

function request(overrides: Partial<NetworkRequestSnapshot> = {}): NetworkRequestSnapshot {
  return { id: 'r1', startedAt: 1, endedAt: 30_001, method: 'GET', url: 'ws://127.0.0.1:5173/', status: 101, statusText: 'Switching Protocols', requestHeaders: { 'Sec-WebSocket-Protocol': 'vite-hmr' }, responseHeaders: { Upgrade: 'websocket' }, timingMs: 30_000, ...overrides }
}

describe('runtime protocol classification', () => {
  it('recognizes a Vite HMR WebSocket upgrade', () => {
    expect(classifyRuntimeProtocol(request())).toBe('WebSocket')
    expect(isViteHmr(request())).toBe(true)
  })

  it('does not classify a long-lived WebSocket as slow HTTP', () => {
    const value = request()
    const graph = buildEvidenceGraph(value, undefined, [value], [])
    expect(graph.request.protocol).toBe('WebSocket')
    expect(graph.anomalies.join(' ')).not.toMatch(/latency|timeout|stalled/i)
  })

  it('recognizes SSE and streaming responses', () => {
    expect(classifyRuntimeProtocol(request({ status: 200, url: 'https://app/events', responseHeaders: { 'Content-Type': 'text/event-stream' }, requestHeaders: {} }))).toBe('SSE')
    expect(classifyRuntimeProtocol(request({ status: 200, url: 'https://app/download', responseHeaders: { 'Transfer-Encoding': 'chunked' }, requestHeaders: {} }))).toBe('streaming')
  })
})
