import { describe, expect, it } from 'vitest'
import { toRuntimeObservationInput } from './runtimeObservation'
import type { NetworkRequestSnapshot } from './types'

function capture(overrides: Partial<NetworkRequestSnapshot> = {}): NetworkRequestSnapshot {
  return {
    id: 'GET:https://example.test/api/orders?token=secret:1000',
    method: 'GET',
    url: 'https://example.test/api/orders?token=secret&view=full',
    status: 503,
    statusText: 'Unavailable',
    startedAt: 1_000,
    endedAt: 1_125,
    timingMs: 125,
    mimeType: 'application/json',
    requestHeaders: { Authorization: 'Bearer secret', Cookie: 'sid=secret' },
    responseHeaders: { 'Set-Cookie': 'sid=other' },
    requestBody: '{"password":"secret"}',
    responseBody: '{"token":"secret"}',
    ...overrides,
  }
}

describe('toRuntimeObservationInput', () => {
  it('maps only the factual capture and leaves identity/redaction to FeltDB', () => {
    const observation = toRuntimeObservationInput(capture(), {
      pageUrl: 'https://example.test/checkout?session=secret',
      userAgent: 'Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36',
      correlatedEvents: [{ type: 'runtime.error', message: 'failed token=secret', ts: 1_126 }],
    })

    expect(observation.method).toBe('GET')
    expect(observation.status).toBe(503)
    expect(observation.completedAt - observation.startedAt).toBe(125)
    expect(observation.url).toContain('token=secret')
    expect(observation.page).toContain('session=secret')
    expect(observation).not.toHaveProperty('workspaceId')
    expect(observation).not.toHaveProperty('sessionId')
    expect(observation).not.toHaveProperty('runtimeInstanceId')
  })

  it('never copies headers or bodies into the canonical observation', () => {
    const serialized = JSON.stringify(toRuntimeObservationInput(capture(), {}))
    expect(serialized).not.toContain('Bearer secret')
    expect(serialized).not.toContain('sid=secret')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('Set-Cookie')
    expect(serialized).not.toContain('responseBody')
  })

  it('marks status zero as a network failure', () => {
    expect(toRuntimeObservationInput(capture({ status: 0 }), {}).networkFailure).toBe(true)
  })
})
