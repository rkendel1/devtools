/**
 * E2E Test Contract: Development Workflow
 *
 * All browsers must satisfy this contract:
 * The extension enables users to:
 * 1. Connect to a FeltDB workspace
 * 2. Select an element on a web page
 * 3. Capture that element's properties
 * 4. Publish the selection to FeltDB
 * 5. Receive a code change from FeltDB
 * 6. Verify the change resolves the captured element
 * 7. Publish verification result
 *
 * Each browser implements this contract via:
 * - Chrome: MV3 service worker + content script + chrome.storage.session
 * - Firefox: WebExtension background script + content script + browser.storage.local
 * - Safari: Safari Web Extension + content script + Safari storage
 *
 * The contract doesn't prescribe HOW each browser implements,
 * only WHAT must work end-to-end.
 */

export const developmentWorkflowContract = {
  description: 'User can select an element and capture it to FeltDB',
  steps: [
    {
      name: 'connect',
      action: 'extension connects to workspace',
      verification: 'workspace accepts connection',
    },
    {
      name: 'select',
      action: 'user selects element via DevTools',
      verification: 'element is highlighted in page',
    },
    {
      name: 'capture',
      action: 'extension captures element properties',
      verification: 'capture includes selector, DOM query, visual bounds',
    },
    {
      name: 'publish-selection',
      action: 'extension publishes selection to workspace',
      verification: 'workspace receives and stores selection',
    },
    {
      name: 'receive-change',
      action: 'workspace requests code change for captured element',
      verification: 'extension receives change request',
    },
    {
      name: 'apply-change',
      action: 'extension applies code change to page',
      verification: 'page DOM reflects the change',
    },
    {
      name: 'verify',
      action: 'extension verifies element state after change',
      verification: 'verification result matches expectation',
    },
    {
      name: 'publish-verification',
      action: 'extension publishes verification to workspace',
      verification: 'workspace confirms task completion',
    },
  ],
}

/**
 * Browser-specific implementations
 *
 * Chrome E2E (chrome-real.mjs):
 * Tests MV3 service worker + persistent context
 * Uses Chrome for Testing + puppeteer
 * Verifies: 422 error capture + service worker storage
 *
 * Firefox E2E (firefox-real.mjs):
 * Tests WebExtension background script + temporary addon
 * Uses Firefox + WebDriver
 * Verifies: 422 error capture + firefox storage
 *
 * WebKit E2E (webkit-real.mjs):
 * Tests browser runtime behavior (NOT extension)
 * Uses Playwright WebKit
 * Verifies: Safari-like runtime compatibility
 *
 * Safari E2E (safari-real.mjs):
 * Tests actual Safari Web Extension
 * Uses Safari + native extension mechanism (macOS only)
 * Verifies: Safari Web Extension loading + communication
 */

export const browserTests = {
  chrome: {
    name: 'Chrome Extension E2E',
    script: 'chrome-real.mjs',
    browser: 'Chrome for Testing',
    runner: 'puppeteer-core',
    extension: 'unpacked MV3',
    storage: 'chrome.storage.session',
    regression: '422 error capture in service worker',
  },
  firefox: {
    name: 'Firefox Extension E2E',
    script: 'firefox-real.mjs',
    browser: 'real Firefox',
    runner: 'WebDriver + geckodriver',
    extension: 'temporary WebExtension',
    storage: 'browser.storage.local',
    regression: '422 error capture in background script',
  },
  webkit: {
    name: 'WebKit Runtime E2E',
    script: 'webkit-real.mjs',
    browser: 'Playwright WebKit',
    runner: 'Playwright',
    extension: 'NOT TESTED (WebKit ≠ Safari)',
    storage: 'localStorage',
    regression: 'Safari-like runtime compatibility',
  },
  safari: {
    name: 'Safari Web Extension E2E',
    script: 'safari-real.mjs',
    browser: 'Safari (macOS)',
    runner: 'native Safari',
    extension: 'Safari Web Extension',
    storage: 'Safari storage',
    regression: 'Safari Web Extension communication',
  },
}

export function printTestPyramid() {
  console.log(`
                  FeltDB Workspace
                        │
              ┌──────────┼──────────┐
              │          │          │
            Chrome    Firefox      Safari
              │          │          │
          Extension   Extension   Extension
              │          │          │
          Chromium    Firefox      Safari
           (MV3)    (WebExt)   (Web Ext)
              └──────────┼──────────┘
                         │
              DevelopmentRuntime
                         │
                   Product Contract
                         │
  (Browser identity is irrelevant here)
  `)
}
