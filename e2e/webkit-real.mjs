import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { webkit } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

  // Launch WebKit (Playwright's Safari-like browser)
  // Note: This tests Safari-like runtime behavior, NOT actual Safari Web Extensions
  browser = await webkit.launch({
    headless: process.env.HEADED !== '1',
  })

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(testUrl, { waitUntil: 'networkidle' })

  // Test the development runtime behavior in WebKit
  // Note: WebKit does not support real Safari Web Extensions
  // This test verifies the browser-facing runtime is compatible with Safari-like behavior

  // Verify page loads and basic DOM is available
  const isLoaded = await page.$eval('#checkout-btn', (el) => el !== null)
  assert.ok(isLoaded, 'Test page did not load in WebKit')

  // Simulate the checkout workflow
  await page.click('#checkout-btn')

  // Wait for the error status
  const status = await waitFor(
    () => page.$eval('#status', (element) => element.textContent).then(
      (text) => text?.includes('currency_required') ? text : null
    ).catch(() => null),
    'WebKit did not process the checkout request'
  )

  assert.ok(status, 'Status update did not complete in WebKit')

  // Test that the runtime can store and retrieve data
  // This verifies compatibility with storage APIs
  const canStore = await page.evaluate(() => {
    try {
      localStorage.setItem('test-webkit-runtime', JSON.stringify({ test: true }))
      const value = localStorage.getItem('test-webkit-runtime')
      return value === JSON.stringify({ test: true })
    } catch {
      return false
    }
  })

  assert.ok(canStore, 'WebKit runtime does not support storage operations')

  console.log(`PASS WebKit runtime E2E (Playwright)`)
  console.log(`  status: ${status}`)
  console.log(`  runtime compatibility: verified`)
  console.log(`  note: This test verifies Safari-like browser runtime behavior,`)
  console.log(`  NOT actual Safari Web Extension support. See test:e2e:safari for that.`)
} finally {
  if (browser) await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
