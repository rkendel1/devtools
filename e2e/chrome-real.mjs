import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromePath = process.env.CHROME_BIN || path.join(root, 'chrome/mac_arm-152.0.7977.64/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
const extensionPath = path.join(root, 'dist')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(fn, message, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await delay(100)
  }
  throw new Error(message)
}

async function startFixtureServer() {
  const page = await readFile(path.join(root, 'public/test-page.html'))
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.url === '/api/checkout' && request.method === 'POST') {
        request.resume()
        request.on('end', () => {
          response.writeHead(422, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'currency_required' }))
        })
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(page)
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const server = await startFixtureServer()
let browser
try {
  const testUrl = `http://127.0.0.1:${server.address().port}/`
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run', '--no-default-browser-check'],
  })
  const page = await browser.newPage()
  await page.goto(testUrl, { waitUntil: 'networkidle0' })
  assert.equal(await page.evaluate(() => window.__runtimeInvestigatorCaptureInstalled), true)

  const workerTarget = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().endsWith('/background.js'), { timeout: 15_000 })
  const extensionId = new URL(workerTarget.url()).hostname
  assert.match(extensionId, /^[a-p]{32}$/)
  await page.click('#checkout-btn')
  const status = await waitFor(() => page.$eval('#status', (element) => element.textContent).then((text) => text?.includes('currency_required') ? text : null), 'Real checkout did not produce the expected 422 error')
  assert.equal(status, 'Error 422: currency_required')

  const worker = await workerTarget.worker()
  assert.ok(worker, 'Could not attach to the real MV3 service worker')
  const capturedEvents = await waitFor(async () => {
    const events = await worker.evaluate(async () => {
      const stored = await chrome.storage.session.get(null)
      return Object.entries(stored).filter(([key]) => key.startsWith('events:')).flatMap(([, value]) => Array.isArray(value) ? value : [])
    })
    return events.some((event) => event.type === 'console.error' && event.message.includes('currency_required')) ? events : null
  }, 'Extension did not persist the captured console error')

  console.log(`PASS real Chrome extension E2E (${extensionId})`)
  console.log(`  artifact: ${extensionPath}`)
  console.log(`  status: ${status}`)
  console.log(`  captured events: ${capturedEvents.length}`)
} finally {
  if (browser) await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
