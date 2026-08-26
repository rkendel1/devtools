/**
 * Firefox + Chrome Extension Service Worker / Background Script
 *
 * Handles:
 * - Event capture and storage
 * - FeltDB workspace connection (via test bootstrap)
 * - Message routing to content scripts and offscreen documents
 */

import { connectDevelopmentWorkspace } from '@feltdb/core/workspace'

type RuntimeMessage = {
  type: string
  target?: string
  payload?: unknown
  pairingCode?: string
  tabId?: number
  [key: string]: unknown
}

const eventQueues = new Map<number, Promise<void>>()
const RETENTION_MS = 24 * 60 * 60 * 1000

// Extension workspace state (from bootstrap or user connection)
let extensionWorkspace: {
  workspaceId: string
  connected: boolean
  workspace?: any
} | null = null

let creatingOffscreen: Promise<void> | null = null

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen.html')
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url],
  })
  if (contexts.length) return

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Run optional private WebLLM inference outside the DevTools panel.',
      })
      .finally(() => {
        creatingOffscreen = null
      })
  }

  await creatingOffscreen
}

/**
 * Handle FeltDB test bootstrap
 * Invoked by E2E test harness to connect extension to dev workspace
 */
async function handleFeltDBBootstrap(message: RuntimeMessage): Promise<{ connected: boolean; workspaceId?: string }> {
  if (!message.pairingCode) {
    return { connected: false }
  }

  try {
    // Use production connectDevelopmentWorkspace path
    // Extension doesn't know this is a test - it's the real connection
    const workspace = await connectDevelopmentWorkspace({
      pairingCode: message.pairingCode,
    })

    // Store connection in extension state
    extensionWorkspace = {
      workspaceId: workspace.workspaceId,
      connected: true,
      workspace: workspace,
    }

    console.info('[Firefox Bootstrap] Connected to workspace', workspace.workspaceId)

    return {
      connected: true,
      workspaceId: workspace.workspaceId,
    }
  } catch (error) {
    console.error('[Firefox Bootstrap] Connection failed', error)
    return { connected: false }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.info('[Runtime Investigator] Installed')
})

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) => {
    // Health check
    if (message?.type === 'runtime-investigator:health') {
      sendResponse({ ok: true })
      return false
    }

    // FeltDB test bootstrap (privileged, extension-only)
    if (message?.type === 'feltdb:test-bootstrap') {
      void handleFeltDBBootstrap(message).then(sendResponse).catch((error) => {
        sendResponse({ connected: false, error: String(error) })
      })
      return true
    }

    // AI generation delegation
    if (message?.type === 'runtime-investigator:ai-generate' && message.target !== 'offscreen') {
      void ensureOffscreen()
        .then(() => chrome.runtime.sendMessage({ ...message, target: 'offscreen' }, sendResponse))
        .catch((error) => sendResponse({ ok: false, error: String(error) }))
      return true
    }

    // AI interrupt
    if (message?.type === 'runtime-investigator:ai-interrupt' && message.target !== 'offscreen') {
      void ensureOffscreen().then(() => chrome.runtime.sendMessage({ ...message, target: 'offscreen' }, sendResponse))
      return true
    }

    // Event capture and storage
    if (message?.type === 'runtime-investigator:event' && sender.tab?.id != null) {
      const tabId = sender.tab.id
      const key = `events:${tabId}`
      const previous = eventQueues.get(tabId) ?? Promise.resolve()
      const next = previous
        .then(() => chrome.storage.session.get(key))
        .then((stored) => {
          const events = Array.isArray(stored[key]) ? stored[key] : []
          const cutoff = Date.now() - RETENTION_MS
          return chrome.storage.session.set({
            [key]: [...events.filter((event: any) => event.ts >= cutoff), message.payload].slice(-500),
          })
        })
        .then(() => sendResponse({ ok: true }))

      const queued = next.finally(() => {
        if (eventQueues.get(tabId) === queued) eventQueues.delete(tabId)
      })

      eventQueues.set(tabId, queued)
      return true
    }

    // Get stored events
    if (message?.type === 'runtime-investigator:get-events') {
      const tabId = message.tabId ?? sender.tab?.id
      if (tabId == null) {
        sendResponse({ events: [] })
        return false
      }

      const key = `events:${tabId}`
      void chrome.storage.session.get(key).then((stored: any) => {
        const cutoff = Date.now() - RETENTION_MS
        const events = (Array.isArray(stored[key]) ? stored[key] : []).filter((event: any) => event.ts >= cutoff)
        void chrome.storage.session.set({ [key]: events })
        sendResponse({ events })
      })
      return true
    }

    // Clear events
    if (message?.type === 'runtime-investigator:clear-events') {
      void chrome.storage.session.remove(`events:${message.tabId}`).then(() => sendResponse({ ok: true }))
      return true
    }

    return false
  }
)

chrome.tabs.onRemoved.addListener((tabId) => {
  eventQueues.delete(tabId)
  void chrome.storage.session.remove(`events:${tabId}`)
})
