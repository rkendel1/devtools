/**
 * Firefox + Chrome Extension Service Worker / Background Script
 *
 * Handles:
 * - Event capture and storage
 * - FeltDB workspace connection (via test bootstrap)
 * - Message routing to content scripts and offscreen documents
 */

import { connectDevelopmentWorkspace } from '@feltdb/core/workspace'
import { classifyInvestigationVerification } from './lib/investigationVerification'

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
const VERIFICATION_TIMEOUT_MINUTES = 2
const VERIFICATION_KEY_PREFIX = 'verification:'
const VERIFICATION_ALARM_PREFIX = 'feltdb-verification:'

// Extension workspace state (from bootstrap or user connection)
let extensionWorkspace: {
  workspaceId: string
  connected: boolean
  workspace?: any
} | null = null
let unsubscribeInvestigationChanges: (() => void) | null = null

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
  | { ok: true; workspaceId: string; clientId: string; clientType: string; activeVerification?: any }
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

    unsubscribeInvestigationChanges?.()
    unsubscribeInvestigationChanges = workspace.subscribe('investigation_changes', (event: any) => {
      const change = event?.value
      if (event?.type === 'deleted' || change?.type !== 'INVESTIGATION_CHANGE_APPLIED') return
      const key = `${VERIFICATION_KEY_PREFIX}${change.entityId}`
      void chrome.storage.session.set({ [key]: { ...change, runtimeObserved: false } })
      void chrome.alarms.create(`${VERIFICATION_ALARM_PREFIX}${change.entityId}`, { delayInMinutes: VERIFICATION_TIMEOUT_MINUTES })
      void chrome.runtime.sendMessage({ type: 'runtime-investigator:change-applied', change }).catch(() => undefined)
    })

    // Store connection in extension state
    extensionWorkspace = {
      workspaceId: workspace.workspaceId,
      connected: true,
      workspace: workspace,
    }

    console.info('[Runtime Investigator] Connected to workspace', workspace.workspaceId)

    const activeVerification = (await workspace.query('runtime_investigations'))
      .filter((candidate: any) => candidate?.status === 'VERIFYING' || candidate?.lifecycle === 'VERIFYING')
      .sort((a: any, b: any) => Number(b.updatedAt ?? b.sentAt ?? 0) - Number(a.updatedAt ?? a.sentAt ?? 0))[0]

    return {
      ok: true,
      workspaceId: workspace.workspaceId,
      clientId: workspace.clientId,
      clientType: workspace.clientType,
      activeVerification,
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
            && sameRuntimeContext(candidate?.investigation, incoming)
            && Date.now() - latestDevelopmentAt(candidate) < 60 * 60 * 1000)
          .sort((a: any, b: any) => latestDevelopmentAt(b) - latestDevelopmentAt(a))[0]
      : undefined
    const envelope = {
      kind: 'runtime_investigation',
      schemaVersion: 1,
      workspaceId: extensionWorkspace.workspaceId,
      lifecycle: 'NEW',
      status: 'OPEN',
      source: {
        clientId: connection.clientId,
        clientType: connection.clientType,
        product: 'chrome-runtime-investigator',
      },
      sentAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalObservationId: (message.investigation as any).requestId ?? (message.investigation as any).id,
      history: [{ type: 'OBSERVATION_CAPTURED', at: Date.now(), data: { observationId: (message.investigation as any).requestId } }],
      delivery: message.type === 'runtime-investigator:send-to-ide' ? 'manual' : 'automatic',
      investigation: structuredClone(message.investigation),
      ...(active?.entityId ? { verificationOf: active.entityId } : {}),
    }
    const entityId = await connection.publish('runtime_investigations', envelope)
    // FeltDB assigns the durable identity. Persist it back onto the same entity so
    // clients that reconnect and query retain that identity, not a local surrogate.
    await connection.update('runtime_investigations', entityId, { entityId })
    if (active?.entityId && request) {
      const outcome = classifyInvestigationVerification(
        {
          status: Number(active.investigation?.graph?.request?.status ?? 0),
          anomalies: active.investigation?.graph?.anomalies ?? [],
          protocol: active.investigation?.graph?.request?.protocol,
          scenarioExercised: true,
        },
        {
          status: Number(incoming.graph?.request?.status ?? 0),
          anomalies: (incoming as any).graph?.anomalies ?? [],
          protocol: (incoming as any).graph?.request?.protocol,
          runtimeAvailable: true,
          scenarioExercised: true,
        },
      )
      const verification = {
        entityId,
        observedAt: Date.now(),
        status: request.status ?? 0,
        statusText: incoming.graph?.response?.statusText,
        outcome,
      }
      await connection.update('runtime_investigations', active.entityId, {
        lifecycle: outcome === 'FIXED' ? 'RESOLVED' : outcome === 'REGRESSION' ? 'REGRESSION' : outcome,
        status: outcome,
        updatedAt: verification.observedAt,
        history: [...(active.history ?? []), { type: 'APPLICATION_RUNTIME_OBSERVABLE', at: verification.observedAt }, { type: 'VERIFICATION_OBSERVED', at: verification.observedAt, data: { verificationId: active.verificationId, changeId: active.changeId, observationEntityId: entityId, outcome } }],
        verifications: [...(active.verifications ?? []), verification],
      })
      const result = {
        type: 'INVESTIGATION_VERIFICATION_RESULT',
        investigationId: active.investigation?.id,
        entityId: active.entityId,
        observationEntityId: entityId,
        outcome,
        originalStatus: active.investigation?.graph?.request?.status ?? 0,
        verificationStatus: request.status ?? 0,
        observedAt: verification.observedAt,
      }
      await connection.publish('investigation_verifications', result)
      await chrome.storage.session.remove(`${VERIFICATION_KEY_PREFIX}${active.entityId}`)
      await chrome.alarms.clear(`${VERIFICATION_ALARM_PREFIX}${active.entityId}`)
      void chrome.runtime.sendMessage({ type: 'runtime-investigator:verification-result', result }).catch(() => undefined)
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

function sameRuntimeContext(original: any, current: any): boolean {
  const originalProtocol = original?.graph?.request?.protocol
  const currentProtocol = current?.graph?.request?.protocol
  if (originalProtocol && currentProtocol && originalProtocol !== currentProtocol) return false
  const originalPage = pageFingerprint(original?.graph?.bundle?.environment?.pageUrl)
  const currentPage = pageFingerprint(current?.graph?.bundle?.environment?.pageUrl)
  return !originalPage || !currentPage || originalPage === currentPage
}

function pageFingerprint(value: unknown): string {
  if (typeof value !== 'string') return ''
  try { const url = new URL(value); return `${url.origin}${url.pathname}` } catch { return value.split('?')[0] }
}

function latestDevelopmentAt(candidate: any): number {
  const activity = candidate?.developmentActivity
  return Array.isArray(activity) && activity.length ? Number(activity[activity.length - 1]?.observedAt ?? 0) : 0
}

async function markRuntimeObservable(): Promise<void> {
  const stored = await chrome.storage.session.get(null)
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith(VERIFICATION_KEY_PREFIX) && value && typeof value === 'object') {
      updates[key] = { ...(value as object), runtimeObserved: true }
    }
  }
  if (Object.keys(updates).length) await chrome.storage.session.set(updates)
}

async function finishTimedOutVerification(entityId: string): Promise<void> {
  const connection = extensionWorkspace?.workspace
  if (!connection) return
  const key = `${VERIFICATION_KEY_PREFIX}${entityId}`
  const stored = await chrome.storage.session.get(key)
  const pending = stored[key] as any
  if (!pending) return
  const candidates = await connection.query('runtime_investigations')
  const active = candidates.find((candidate: any) => candidate?.entityId === entityId)
  if (!active || (active.status !== 'VERIFYING' && active.lifecycle !== 'VERIFYING')) {
    await chrome.storage.session.remove(key)
    return
  }
  const outcome = pending.runtimeObserved ? 'NOT_REPRODUCED' : 'VERIFICATION_FAILED'
  const observedAt = Date.now()
  await connection.update('runtime_investigations', entityId, {
    lifecycle: outcome,
    status: outcome,
    updatedAt: observedAt,
    history: [...(active.history ?? []), ...(pending.runtimeObserved ? [{ type: 'APPLICATION_RUNTIME_OBSERVABLE', at: observedAt }] : []), { type: 'VERIFICATION_TIMED_OUT', at: observedAt, data: { verificationId: pending.verificationId, changeId: pending.changeId, outcome } }],
  })
  const result = { type: 'INVESTIGATION_VERIFICATION_RESULT', investigationId: pending.investigationId, entityId, outcome, originalStatus: active.investigation?.graph?.request?.status ?? 0, observedAt }
  await connection.publish('investigation_verifications', result)
  await chrome.storage.session.remove(key)
  void chrome.runtime.sendMessage({ type: 'runtime-investigator:verification-result', result }).catch(() => undefined)
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(VERIFICATION_ALARM_PREFIX)) return
  void finishTimedOutVerification(alarm.name.slice(VERIFICATION_ALARM_PREFIX.length))
})

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

    if (message?.type === 'runtime-investigator:runtime-active') {
      void markRuntimeObservable().then(() => sendResponse({ ok: true }))
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
