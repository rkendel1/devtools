/**
 * Firefox + Chrome Extension Service Worker / Background Script
 *
 * Handles:
 * - Event capture and storage
 * - FeltDB workspace connection (via test bootstrap)
 * - Message routing to content scripts and offscreen documents
 */

import { connectDevelopmentWorkspace, resolvePairingCode } from '@feltdb/core/workspace'

type RuntimeMessage = {
  type: string
  target?: string
  payload?: unknown
  pairingCode?: string
  investigation?: unknown
  tabId?: number
  [key: string]: unknown
}

type CapturedEvent = {
  ts: number
  [key: string]: unknown
}

function capturedEvents(value: unknown): CapturedEvent[] {
  return Array.isArray(value)
    ? value.filter((event): event is CapturedEvent =>
        typeof event === 'object' && event !== null && typeof (event as { ts?: unknown }).ts === 'number'
      )
    : []
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
type WorkspaceBootstrapResult =
  | { ok: true; workspaceId: string; clientId: string; clientType: string }
  | { ok: false; error: string }

type InvestigationHandoffResult =
  | { ok: true; entityId: string; workspaceId: string }
  | { ok: false; error: string }

function isPairingCode(value: unknown): value is string {
  return typeof value === 'string' && /^FELT-[A-Z0-9]{6}$/i.test(value)
}

async function handleFeltDBBootstrap(message: RuntimeMessage): Promise<WorkspaceBootstrapResult> {
  if (!isPairingCode(message.pairingCode)) {
    return { ok: false, error: 'INVALID_PAIRING_CODE' }
  }

  try {
    const pairingCode = message.pairingCode.toUpperCase()
    // Resolve independently as proof that the human-facing token went through
    // FeltDB's production discovery path. Never treat it as a workspace ID.
    const resolution = await resolvePairingCode(pairingCode)
    const workspace = await connectDevelopmentWorkspace({
      pairingCode,
      clientId: 'firefox-extension',
      clientType: 'browser',
    })
    if (workspace.workspaceId !== resolution.workspaceId) {
      throw new Error('PAIRING_RESOLUTION_MISMATCH')
    }
    await workspace.connect()

    // Store connection in extension state
    extensionWorkspace = {
      workspaceId: workspace.workspaceId,
      connected: true,
      workspace: workspace,
    }

    console.info('[Runtime Investigator] Connected to workspace', workspace.workspaceId)

    return {
      ok: true,
      workspaceId: workspace.workspaceId,
      clientId: workspace.clientId,
      clientType: workspace.clientType,
    }
  } catch (error) {
    console.error('[Runtime Investigator] Connection failed', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function handleInvestigationHandoff(message: RuntimeMessage): Promise<InvestigationHandoffResult> {
  const connection = extensionWorkspace?.workspace
  if (!extensionWorkspace?.connected || !connection) {
    return { ok: false, error: 'WORKSPACE_NOT_CONNECTED' }
  }
  if (!message.investigation || typeof message.investigation !== 'object' || Array.isArray(message.investigation)) {
    return { ok: false, error: 'INVALID_INVESTIGATION' }
  }

  try {
    const envelope = {
      kind: 'runtime_investigation',
      schemaVersion: 1,
      workspaceId: extensionWorkspace.workspaceId,
      lifecycle: 'NEW',
      source: {
        clientId: connection.clientId,
        clientType: connection.clientType,
        product: 'chrome-runtime-investigator',
      },
      sentAt: Date.now(),
      investigation: structuredClone(message.investigation),
    }
    const entityId = await connection.publish('runtime_investigations', envelope)
    // FeltDB assigns the durable identity. Persist it back onto the same entity so
    // clients that reconnect and query retain that identity, not a local surrogate.
    await connection.update('runtime_investigations', entityId, { entityId })
    return { ok: true, entityId, workspaceId: extensionWorkspace.workspaceId }
  } catch (error) {
    console.error('[Runtime Investigator] Investigation handoff failed', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
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
        sendResponse({ ok: false, error: String(error) })
      })
      return true
    }

    if (message?.type === 'runtime-investigator:send-to-ide') {
      void handleInvestigationHandoff(message).then(sendResponse).catch((error) => {
        sendResponse({ ok: false, error: String(error) })
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
          const events = capturedEvents(stored[key])
          const cutoff = Date.now() - RETENTION_MS
          const payload = message.payload
          return chrome.storage.session.set({
            [key]: [...events.filter((event) => event.ts >= cutoff), payload].slice(-500),
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
        const events = capturedEvents(stored[key]).filter((event) => event.ts >= cutoff)
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
