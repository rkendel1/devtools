#!/usr/bin/env node

import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { connectDevelopmentWorkspace } from '@feltdb/core/workspace'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensionPath = path.join(root, 'dist')
const chromePath = process.env.CHROME_BIN || path.join(root, 'chrome/mac_arm-152.0.7977.64/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
const pairingCode = process.env.FELTDB_PAIRING_CODE

if (!pairingCode || !/^FELT-[A-Z0-9]{6}$/i.test(pairingCode)) {
  throw new Error('Set FELTDB_PAIRING_CODE to the live FELT-XXXXXX code printed by `feltdb dev`.')
}

let browser
let ideConnection
try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run', '--no-default-browser-check'],
  })
  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'),
    { timeout: 15_000 },
  )
  const worker = await workerTarget.worker()
  assert.ok(worker, 'Could not attach to the real MV3 service worker')

  const invalid = await worker.evaluate(() => chrome.runtime.sendMessage({
    type: 'feltdb:test-bootstrap',
    pairingCode: 'ws_broken_shortcut',
  }))
  assert.deepEqual(invalid, { ok: false, error: 'INVALID_PAIRING_CODE' })

  const result = await worker.evaluate((code) => chrome.runtime.sendMessage({
    type: 'feltdb:test-bootstrap',
    pairingCode: code,
  }), pairingCode.toUpperCase())

  assert.equal(result.ok, true, result.error || 'Pairing bootstrap failed')
  assert.match(result.workspaceId, /^ws_/)
  assert.equal(result.clientId, 'firefox-extension')
  assert.equal(result.clientType, 'browser')

  ideConnection = await connectDevelopmentWorkspace({
    pairingCode: pairingCode.toUpperCase(),
    clientId: 'ide-e2e-listener',
    clientType: 'ide',
  })
  const correlationId = `handoff-e2e-${Date.now()}`
  const received = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('IDE subscription did not receive the investigation')), 10_000)
    const unsubscribe = ideConnection.subscribe('runtime_investigations', (event) => {
      if (event.value?.investigation?.id !== correlationId) return
      clearTimeout(timeout)
      unsubscribe()
      resolve(event)
    })
  })
  const handoff = await worker.evaluate((investigationId) => chrome.runtime.sendMessage({
    type: 'runtime-investigator:send-to-ide',
    investigation: {
      id: investigationId,
      createdAt: Date.now(),
      requestId: 'request-e2e',
      requestUrl: 'http://127.0.0.1/e2e',
      graph: { request: { method: 'POST', url: 'http://127.0.0.1/e2e', status: 422 } },
      result: { diagnosis: 'Pairing handoff certification' },
    },
  }), correlationId)
  assert.equal(handoff.ok, true, handoff.error || 'Investigation handoff failed')
  assert.match(handoff.entityId, /^entity_/)
  const event = await received
  assert.equal(event.entityId, handoff.entityId)
  const durable = await ideConnection.query('runtime_investigations')
  assert.ok(durable.some((item) => item.investigation?.id === correlationId), 'Published investigation was not durable')

  console.log('PASS real Chrome FeltDB pairing E2E')
  console.log(`  pairing code: ${pairingCode.toUpperCase()}`)
  console.log(`  workspace: ${result.workspaceId}`)
  console.log(`  client: ${result.clientId} (${result.clientType})`)
  console.log(`  handoff: ${handoff.entityId} (subscription received; durable query verified)`)
} finally {
  if (ideConnection) await ideConnection.disconnect()
  if (browser) await browser.close()
}
