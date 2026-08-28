import { describe, expect, it } from 'vitest'
import { createFeltSessionHandoff, feltSessionRequestKey } from './feltSessionHandoff'

describe('Felt Session handoff contract', () => {
  it('uses a deterministic key for idempotent queueing', () => {
    expect(feltSessionRequestKey('inv_123', 'devtools')).toBe('felt-session:devtools:inv_123')
  })

  it('routes a canonical investigation to a queued task in devtools', () => {
    expect(createFeltSessionHandoff({
      workspaceId: 'ws_123', investigationId: 'inv_123', repositoryId: 'devtools',
      clientId: 'browser-extension', localInvestigationId: 'local_123', createdAt: 42,
    })).toEqual({
      requestKey: 'felt-session:devtools:inv_123',
      kind: 'runtime_investigation_handoff', schemaVersion: 1,
      workspaceId: 'ws_123', investigationId: 'inv_123',
      target: { product: 'felt-session', repositoryId: 'devtools', disposition: 'queued_task' },
      source: { product: 'feltdb-devtools', clientId: 'browser-extension', localInvestigationId: 'local_123' },
      status: 'pending', createdAt: 42,
    })
  })
})
