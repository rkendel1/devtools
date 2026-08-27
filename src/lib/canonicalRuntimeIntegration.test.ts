import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LEGACY_RUNTIME_INVESTIGATION_COLLECTION,
  RUNTIME_INVESTIGATION_COLLECTION,
  connectDevelopmentWorkspace,
  startLocalDevelopmentAuthority,
  type DevelopmentWorkspaceConnection,
  type RuntimeInvestigation,
} from '@feltdb/core/workspace'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()!() })

describe('canonical FeltDB runtime path', () => {
  it('retains one investigation across runtime restart and a VS Code reconnect', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'devtools-canonical-'))
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }))
    const authority = await startLocalDevelopmentAuthority({ dataDir, port: await freePort() })
    cleanups.push(() => authority.close())
    const connected: DevelopmentWorkspaceConnection[] = []
    cleanups.push(async () => { await Promise.all(connected.splice(0).map((value) => value.disconnect())) })
    const connect = async (clientId: string, runtimeInstanceId: string, clientType: 'browser' | 'ide' = 'browser') => {
      const value = await connectDevelopmentWorkspace({
        workspaceId: 'ws_restart_test', endpoint: authority.endpoint, clientId, clientType,
        sessionId: 'session_test', runtimeInstanceId,
      })
      connected.push(value)
      return value
    }

    const browserA = await connect('devtools-a', 'runtime_A')
    const observationA = await browserA.recordRuntimeObservation(input('local-investigation', 1))
    const investigation = await browserA.createRuntimeInvestigation({ observationId: observationA.observationId })
    await browserA.disconnect(); connected.splice(connected.indexOf(browserA), 1)

    const browserB = await connect('devtools-b', 'runtime_B')
    const observationB = await browserB.recordRuntimeObservation(input('local-investigation', 2))
    await browserB.linkRuntimeObservationToInvestigation(observationB.observationId, investigation.id)
    const observationC = await browserB.recordRuntimeObservation(input('local-investigation', 3))
    const linked = await browserB.linkRuntimeObservationToInvestigation(observationC.observationId, investigation.id)
    expect(linked.id).toBe(investigation.id)
    expect(new Set(linked.observationIds)).toEqual(new Set([observationA.observationId, observationB.observationId, observationC.observationId]))
    expect(observationA.runtimeInstanceId).toBe('runtime_A')
    expect(observationB.runtimeInstanceId).toBe('runtime_B')
    expect(observationA.correlation?.source?.investigationId).toBe('local-investigation')
    expect(observationA.observationId).not.toBe('local-investigation')
    expect(investigation.id).not.toBe('local-investigation')

    const ide = await connect('vscode-test', 'ide_runtime', 'ide')
    const records = await ide.query<RuntimeInvestigation>(RUNTIME_INVESTIGATION_COLLECTION)
    const legacyRecords = await ide.query(LEGACY_RUNTIME_INVESTIGATION_COLLECTION)
    expect(records).toHaveLength(1)
    expect(legacyRecords).toHaveLength(0)
    expect(records[0]?.id).toBe(investigation.id)
    expect(new Set(records[0]?.observationIds)).toEqual(new Set([observationA.observationId, observationB.observationId, observationC.observationId]))

    const serialized = JSON.stringify([observationA, observationB, observationC])
    for (const forbidden of ['Authorization', 'Cookie', 'Bearer secret', 'requestBody', 'responseBody', 'screenshot', 'evidenceGraph', 'diagnosis']) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(serialized).toContain('%5Bredacted%5D')
  })
})

function input(investigationId: string, startedAt: number) {
  return {
    method: 'POST', url: 'https://example.test/api/orders?token=secret', status: 500,
    startedAt, completedAt: startedAt + 10, page: 'https://example.test/?session=secret',
    correlation: { source: { product: 'feltdb-devtools', clientId: 'devtools-local', investigationId } },
    responseCharacteristics: { statusText: 'Failure', contentType: 'application/json' },
  }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}
