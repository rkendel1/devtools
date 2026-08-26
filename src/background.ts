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
    const workspace = await connectDevelopmentWorkspace({
      pairingCode,
      clientId: `browser-extension-${chrome.runtime.id.slice(0, 12)}`,
      clientType: 'browser',
    })

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
    const detail = error instanceof Error ? error.message : String(error)
    const pairingCode = String(message.pairingCode).trim().toUpperCase()
    const friendly = /not found|expired|404/i.test(detail)
      ? `Pairing code ${pairingCode} was not found or has expired. Use the current code displayed by \`feltdb dev\`.`
      : detail
    return { ok: false, error: friendly }
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
    const incoming = message.investigation as { graph?: { request?: { method?: string; url?: string; status?: number }; response?: { statusText?: string } } }
    const request = incoming.graph?.request
    const active = request?.method && request.url
      ? (await connection.query('runtime_investigations'))
          .filter((candidate: any) =>
            ['INVESTIGATING', 'VERIFYING'].includes(candidate?.lifecycle)
            && candidate?.developmentActivity?.length > 0
            && candidate?.investigation?.graph?.request?.method === request.method
            && requestFingerprint(candidate?.investigation?.graph?.request?.url) === requestFingerprint(request.url)
            && isFailedStatus(candidate?.investigation?.graph?.request?.status)
            && Date.now() - latestDevelopmentAt(candidate) < 60 * 60 * 1000)
          .sort((a: any, b: any) => latestDevelopmentAt(b) - latestDevelopmentAt(a))[0]
      : undefined
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
      delivery: message.type === 'runtime-investigator:send-to-ide' ? 'manual' : 'automatic',
      investigation: structuredClone(message.investigation),
      ...(active?.entityId ? { verificationOf: active.entityId } : {}),
    }
    const entityId = await connection.publish('runtime_investigations', envelope)
    // FeltDB assigns the durable identity. Persist it back onto the same entity so
    // clients that reconnect and query retain that identity, not a local surrogate.
    await connection.update('runtime_investigations', entityId, { entityId })
    if (active?.entityId && request) {
      const fixed = request.status != null && request.status > 0 && request.status < 400
      const verification = {
        entityId,
        observedAt: Date.now(),
        status: request.status ?? 0,
        statusText: incoming.graph?.response?.statusText,
        outcome: fixed ? 'FIXED' : 'NOT_FIXED',
      }
      await connection.update('runtime_investigations', active.entityId, {
        lifecycle: fixed ? 'RESOLVED' : 'VERIFYING',
        verifications: [...(active.verifications ?? []), verification],
      })
    }
    return { ok: true, entityId, workspaceId: extensionWorkspace.workspaceId }
  } catch (error) {
    console.error('[Runtime Investigator] Investigation handoff failed', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function requestFingerprint(url: unknown): string {
  if (typeof url !== 'string') return ''
  try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}` } catch { return url.split('?')[0] }
}

function isFailedStatus(status: unknown): boolean { return typeof status === 'number' && (status === 0 || status >= 400) }

function latestDevelopmentAt(candidate: any): number {
  const activity = candidate?.developmentActivity
  return Array.isArray(activity) && activity.length ? Number(activity[activity.length - 1]?.observedAt ?? 0) : 0
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

    if (message?.type === 'runtime-investigator:observe') {
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
