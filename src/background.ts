/**
 * Firefox + Chrome Extension Service Worker / Background Script
 *
 * Handles:
 * - Event capture and storage
 * - FeltDB workspace connection (via test bootstrap)
 * - Message routing to content scripts and offscreen documents
 */

import {
  connectDevelopmentWorkspace,
  LEGACY_RUNTIME_INVESTIGATION_COLLECTION,
  type DevelopmentWorkspaceConnection,
  type RuntimeInvestigation,
  type RuntimeRequestObservation,
} from '@feltdb/core/workspace'
import type { RuntimeObservationInput } from './lib/runtimeObservation'
import {
  createFeltSessionHandoff,
  FELT_SESSION_HANDOFF_COLLECTION,
  feltSessionRequestKey,
  type FeltSessionHandoff,
} from './lib/feltSessionHandoff'

type RuntimeMessage = {
  type: string
  target?: string
  payload?: unknown
  pairingCode?: string
  investigation?: unknown
  runtimeObservationInput?: unknown
  selection?: unknown
  task?: unknown
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
  | { ok: true; entityId: string; workspaceId: string; canonicalObservationId?: string; canonicalInvestigationId?: string; queueRequestId?: string }
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

    const activeVerification = (await workspace.query(LEGACY_RUNTIME_INVESTIGATION_COLLECTION))
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
    const runtimeObservationInput = isRuntimeObservationInput(message.runtimeObservationInput)
      ? message.runtimeObservationInput
      : undefined
    if (message.runtimeObservationInput != null && !runtimeObservationInput) return { ok: false, error: 'INVALID_RUNTIME_OBSERVATION_INPUT' }
    const devtoolsInvestigation = message.investigation as any
    if (!connection.sessionId || !connection.runtimeInstanceId) {
      return { ok: false, error: 'Canonical runtime investigation unavailable: FeltDB did not provide session/runtime identity.' }
    }
    let canonicalInvestigation = await resolveCanonicalInvestigation(connection, devtoolsInvestigation)
    if (message.type === 'runtime-investigator:send-to-ide' || message.type === 'runtime-investigator:queue-in-felt-session') {
      if (!canonicalInvestigation) {
        return { ok: false, error: 'Canonical runtime investigation unavailable: capture a canonical runtime observation first.' }
      }
      if (message.type === 'runtime-investigator:queue-in-felt-session') {
        const repositoryId = 'devtools'
        const requestKey = feltSessionRequestKey(canonicalInvestigation.id, repositoryId)
        const handoffs = await connection.query(FELT_SESSION_HANDOFF_COLLECTION) as FeltSessionHandoff[]
        const existing = handoffs.find((candidate) => candidate.requestKey === requestKey)
        let queueRequestId = existing?.entityId
        if (!existing) {
          queueRequestId = await connection.publish(FELT_SESSION_HANDOFF_COLLECTION, createFeltSessionHandoff({
              workspaceId: extensionWorkspace.workspaceId,
              investigationId: canonicalInvestigation.id,
              repositoryId,
              clientId: connection.clientId,
              localInvestigationId: devtoolsInvestigation.id,
            }))
          await connection.update(FELT_SESSION_HANDOFF_COLLECTION, queueRequestId, { entityId: queueRequestId })
        }
        queueRequestId ??= requestKey
        return {
          ok: true,
          entityId: canonicalInvestigation.id,
          workspaceId: extensionWorkspace.workspaceId,
          canonicalInvestigationId: canonicalInvestigation.id,
          queueRequestId,
        }
      }
      return {
        ok: true,
        entityId: canonicalInvestigation.id,
        workspaceId: extensionWorkspace.workspaceId,
        canonicalInvestigationId: canonicalInvestigation.id,
      }
    }
    if (!runtimeObservationInput) return { ok: false, error: 'INVALID_RUNTIME_OBSERVATION_INPUT' }
    const runtimeObservation = await connection.recordRuntimeObservation({
      ...runtimeObservationInput,
      correlation: { source: { product: 'feltdb-devtools', clientId: connection.clientId, investigationId: devtoolsInvestigation.id } },
    })
    const resultingInvestigation = canonicalInvestigation
      ? await connection.linkRuntimeObservationToInvestigation(runtimeObservation.observationId, canonicalInvestigation.id)
      : await connection.createRuntimeInvestigation({ observationId: runtimeObservation.observationId })
    return {
      ok: true,
      entityId: resultingInvestigation.id,
      workspaceId: extensionWorkspace.workspaceId,
      canonicalObservationId: runtimeObservation.observationId,
      canonicalInvestigationId: resultingInvestigation.id,
    }
  } catch (error) {
    console.error('[Runtime Investigator] Investigation handoff failed', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function handleSelectionTask(message: RuntimeMessage): Promise<{ ok: true; selectionId: string; taskId: string } | { ok: false; error: string }> {
  const connection = extensionWorkspace?.workspace
  if (!extensionWorkspace?.connected || !connection) return { ok: false, error: 'WORKSPACE_NOT_CONNECTED' }
  if (!isVisualSelection(message.selection) || !isSelectionTask(message.task)) return { ok: false, error: 'INVALID_SELECTION_TASK' }
  if (message.selection.workspaceId !== extensionWorkspace.workspaceId || message.task.workspaceId !== extensionWorkspace.workspaceId) {
    return { ok: false, error: 'WORKSPACE_ID_MISMATCH' }
  }
  if (message.task.selectionId !== message.selection.id) return { ok: false, error: 'SELECTION_ID_MISMATCH' }
  try {
    await connection.publish('visual_selection', message.selection)
    await connection.publish('selection_task', message.task)
    return { ok: true, selectionId: message.selection.id, taskId: message.task.id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function isVisualSelection(value: unknown): value is { id: string; workspaceId: string; selector: string; url: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return candidate.kind === 'visual_selection' && typeof candidate.id === 'string' && typeof candidate.workspaceId === 'string'
    && typeof candidate.selector === 'string' && typeof candidate.url === 'string'
}

function isSelectionTask(value: unknown): value is { id: string; workspaceId: string; selectionId: string; userInstruction: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return candidate.kind === 'selection_task' && typeof candidate.id === 'string' && typeof candidate.workspaceId === 'string'
    && typeof candidate.selectionId === 'string' && typeof candidate.userInstruction === 'string'
}

function isRuntimeObservationInput(value: unknown): value is RuntimeObservationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<RuntimeObservationInput>
  return typeof candidate.method === 'string'
    && typeof candidate.url === 'string'
    && typeof candidate.status === 'number'
    && typeof candidate.startedAt === 'number'
    && typeof candidate.completedAt === 'number'
}

async function resolveCanonicalInvestigation(
  connection: DevelopmentWorkspaceConnection,
  investigation: { canonicalInvestigationId?: string; canonicalObservationIds?: string[]; id?: string },
): Promise<RuntimeInvestigation | undefined> {
  if (investigation.canonicalInvestigationId) {
    const direct = await connection.getRuntimeInvestigation(investigation.canonicalInvestigationId)
    if (direct) return direct
  }
  for (const observationId of investigation.canonicalObservationIds ?? []) {
    const linked = await connection.getRuntimeInvestigationForObservation(observationId)
    if (linked) return linked
  }
  if (!investigation.id) return undefined
  const observations = await connection.query<RuntimeRequestObservation>('runtime_observation')
  for (const observation of observations) {
    if (observation.correlation?.source?.product !== 'feltdb-devtools'
      || observation.correlation.source.investigationId !== investigation.id) continue
    const linked = await connection.getRuntimeInvestigationForObservation(observation.observationId)
    if (linked) return linked
  }
  return undefined
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
  const candidates = await connection.query(LEGACY_RUNTIME_INVESTIGATION_COLLECTION)
  const active = candidates.find((candidate: any) => candidate?.entityId === entityId)
  if (!active || (active.status !== 'VERIFYING' && active.lifecycle !== 'VERIFYING')) {
    await chrome.storage.session.remove(key)
    return
  }
  const outcome = pending.runtimeObserved ? 'NOT_REPRODUCED' : 'VERIFICATION_FAILED'
  const observedAt = Date.now()
  await connection.update(LEGACY_RUNTIME_INVESTIGATION_COLLECTION, entityId, {
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

    if (message?.type === 'runtime-investigator:queue-in-felt-session') {
      void handleInvestigationHandoff(message).then(sendResponse).catch((error) => {
        sendResponse({ ok: false, error: String(error) })
      })
      return true
    }

    if (message?.type === 'runtime-investigator:publish-selection-task') {
      void handleSelectionTask(message).then(sendResponse).catch((error) => {
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
