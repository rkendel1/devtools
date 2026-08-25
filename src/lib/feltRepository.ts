import { createFeltDB, type Collection, type StateFirstDB } from '@feltdb/core'
import { boundedNeighborhood, investigationRootId, normalizeEvidenceGraph, type EvidenceNeighborhood, type StoredEvidenceEdge, type StoredEvidenceNode } from './evidenceGraph'
import type { ConsoleEvent, InvestigationRecord, NetworkRequestSnapshot, PrivacySettings } from './types'
import { redactHeaders, redactText } from './redaction'
import {
  MAINTENANCE_INTERVAL_MS, MAX_STORED_INVESTIGATIONS, MAX_STORED_REQUESTS, MAX_STORED_RUNTIME_EVENTS,
  MAX_STORED_SESSIONS, RETENTION_MS, truncateHeaders, truncateText,
} from './retention'

type StoredRecord<T> = T & { id: string; __version?: number }

export interface ModelFinding {
  id: string
  investigationId: string
  model: string
  promptVersion: string
  createdAt: number
  diagnosis?: string
  confidence?: number
  supportingNodeIds: string[]
  answer?: string
  question?: string
}

interface CapturedRequestRecord extends NetworkRequestSnapshot { sessionId: string }
interface CapturedRuntimeRecord extends ConsoleEvent { id: string; sessionId: string }
interface CaptureSession { id: string; tabId: number; startedAt: number; lastSeenAt: number }

export interface MaintenanceResult {
  sessions: number
  requests: number
  runtimeEvents: number
  investigations: number
  graphRecords: number
  modelFindings: number
}

class FeltRepository {
  private db: StateFirstDB | null = null
  private histories: Collection<InvestigationRecord> | null = null
  private nodes: Collection<StoredEvidenceNode> | null = null
  private edges: Collection<StoredEvidenceEdge> | null = null
  private findings: Collection<ModelFinding> | null = null
  private settings: Collection<PrivacySettings> | null = null
  private sessions: Collection<CaptureSession> | null = null
  private requests: Collection<CapturedRequestRecord> | null = null
  private runtimeEvents: Collection<CapturedRuntimeRecord> | null = null
  private historyQueue: Promise<void> = Promise.resolve()
  private maintenanceQueue: Promise<MaintenanceResult> | null = null
  private lastMaintenanceAt = 0

  private ensure(): StateFirstDB {
    if (!this.db) {
      this.db = createFeltDB({ namespace: 'chrome-runtime-investigator-v2', browser: true })
      this.histories = this.db.collection<InvestigationRecord>('investigations')
      this.nodes = this.db.collection<StoredEvidenceNode>('evidence_nodes')
      this.edges = this.db.collection<StoredEvidenceEdge>('evidence_edges')
      this.findings = this.db.collection<ModelFinding>('model_findings')
      this.settings = this.db.collection<PrivacySettings>('settings')
      this.sessions = this.db.collection<CaptureSession>('sessions')
      this.requests = this.db.collection<CapturedRequestRecord>('requests')
      this.runtimeEvents = this.db.collection<CapturedRuntimeRecord>('runtime_events')
      // FeltDB restores persisted index definitions asynchronously in Collection's
      // constructor. Creating the same indexes here races that restore. Our bounded
      // collections make the current exact-match scans inexpensive, so initialization
      // intentionally leaves index ownership entirely to FeltDB.
    }
    return this.db
  }

  runtime(): ReturnType<StateFirstDB['runtime']> | null {
    if (typeof indexedDB === 'undefined') return null
    return this.ensure().runtime()
  }

  async initializeHistory(legacy: InvestigationRecord[]): Promise<InvestigationRecord[]> {
    if (typeof indexedDB === 'undefined') return legacy
    this.ensure()
    const stored = await this.histories!.all()
    if (stored.length === 0 && legacy.length) await this.syncHistory(legacy)
    await this.runMaintenance(true)
    const records = await this.histories!.all()
    return this.sort(records.map(stripDatabaseFields))
  }

  subscribeHistory(callback: (records: InvestigationRecord[]) => void): () => void {
    if (typeof indexedDB === 'undefined') return () => undefined
    this.ensure()
    return this.histories!.subscribe((records) => callback(this.sort(records.map(stripDatabaseFields))))
  }

  syncHistory(records: InvestigationRecord[]): Promise<void> {
    const snapshot = structuredClone(records)
    const job = this.historyQueue.then(() => this.performHistorySync(snapshot))
    this.historyQueue = job.catch(() => undefined)
    return job
  }

  private async performHistorySync(records: InvestigationRecord[]): Promise<void> {
    if (typeof indexedDB === 'undefined') return
    this.ensure()
    const current = await this.histories!.all() as StoredRecord<InvestigationRecord>[]
    const desired = new Map(records.map((record) => [record.id, withoutScreenshot(record)]))
    for (const existing of current) {
      if (!desired.has(existing.id)) await this.histories!.delete(existing.id)
    }
    for (const record of desired.values()) {
      const existing = current.find((item) => item.id === record.id)
      if (existing) await this.histories!.update(record.id, record)
      else await this.histories!.insert(record, record.id)
      await this.syncGraph(record)
    }
    await this.runMaintenance()
  }

  async loadPrivacy(fallback: PrivacySettings): Promise<PrivacySettings> {
    if (typeof indexedDB === 'undefined') return fallback
    this.ensure()
    const settings = await this.settings!.get('privacy')
    if (settings) return stripDatabaseFields(settings as StoredRecord<PrivacySettings>)
    await this.settings!.insert(fallback, 'privacy')
    return fallback
  }

  async savePrivacy(settings: PrivacySettings): Promise<void> {
    if (typeof indexedDB === 'undefined') return
    this.ensure()
    if (await this.settings!.exists('privacy')) await this.settings!.update('privacy', settings)
    else await this.settings!.insert(settings, 'privacy')
  }

  async persistRequests(tabId: number, requests: NetworkRequestSnapshot[], privacy: PrivacySettings): Promise<void> {
    if (typeof indexedDB === 'undefined' || requests.length === 0) return
    this.ensure()
    const sessionId = `tab:${tabId}`
    await this.touchSession(sessionId, tabId)
    for (const request of requests) {
      const requestHeaders = truncateHeaders(redactHeaders(request.requestHeaders, privacy.sensitiveKeys).redacted)
      const responseHeaders = truncateHeaders(redactHeaders(request.responseHeaders, privacy.sensitiveKeys).redacted)
      const requestBody = truncateText(redactText(request.requestBody, privacy.sensitiveKeys).redacted)
      const responseBody = truncateText(redactText(request.responseBody, privacy.sensitiveKeys).redacted)
      const record: CapturedRequestRecord = {
        ...request, sessionId,
        requestHeaders: privacy.includeHeaders ? requestHeaders : {}, responseHeaders: privacy.includeHeaders ? responseHeaders : {},
        requestBody: privacy.includeBodies ? requestBody : undefined, responseBody: privacy.includeBodies ? responseBody : undefined,
      }
      if (await this.requests!.exists(request.id)) await this.requests!.update(request.id, record)
      else await this.requests!.insert(record, request.id)
    }
    await this.runMaintenance()
  }

  async persistRuntimeEvents(tabId: number, events: ConsoleEvent[], privacy: PrivacySettings): Promise<void> {
    if (typeof indexedDB === 'undefined' || events.length === 0) return
    this.ensure()
    const sessionId = `tab:${tabId}`
    await this.touchSession(sessionId, tabId)
    for (const [index, event] of events.entries()) {
      const id = `${sessionId}:${event.ts}:${index}`
      const record: CapturedRuntimeRecord = {
        ...event, id, sessionId,
        message: redactText(event.message, privacy.sensitiveKeys).redacted ?? event.message,
        stack: redactText(event.stack, privacy.sensitiveKeys).redacted,
      }
      if (await this.runtimeEvents!.exists(id)) await this.runtimeEvents!.update(id, record)
      else await this.runtimeEvents!.insert(record, id)
    }
    await this.runMaintenance()
  }

  async captureStats(tabId: number): Promise<{ requests: number; runtimeEvents: number }> {
    this.ensure()
    const sessionId = `tab:${tabId}`
    const [requests, runtimeEvents] = await Promise.all([
      this.requests!.find({ sessionId }), this.runtimeEvents!.find({ sessionId }),
    ])
    return { requests: requests.length, runtimeEvents: runtimeEvents.length }
  }

  runMaintenance(force = false, now = Date.now()): Promise<MaintenanceResult> {
    if (this.maintenanceQueue) return this.maintenanceQueue
    if (!force && now - this.lastMaintenanceAt < MAINTENANCE_INTERVAL_MS) return Promise.resolve(emptyMaintenance())
    this.maintenanceQueue = this.performMaintenance(now).finally(() => {
      this.lastMaintenanceAt = now
      this.maintenanceQueue = null
    })
    return this.maintenanceQueue
  }

  private async performMaintenance(now: number): Promise<MaintenanceResult> {
    this.ensure()
    const cutoff = now - RETENTION_MS
    const result = emptyMaintenance()
    const [sessions, requests, runtimeEvents, investigations] = await Promise.all([
      this.sessions!.all() as Promise<StoredRecord<CaptureSession>[]>,
      this.requests!.all() as Promise<StoredRecord<CapturedRequestRecord>[]>,
      this.runtimeEvents!.all() as Promise<StoredRecord<CapturedRuntimeRecord>[]>,
      this.histories!.all() as Promise<StoredRecord<InvestigationRecord>[]>,
    ])

    const staleSessions = selectExpiredAndOverflow(sessions, (item) => item.lastSeenAt, cutoff, MAX_STORED_SESSIONS)
    const staleSessionIds = new Set(staleSessions.map((item) => item.id))
    const staleRequests = selectExpiredAndOverflow(requests, (item) => item.startedAt, cutoff, MAX_STORED_REQUESTS)
      .concat(requests.filter((item) => staleSessionIds.has(item.sessionId)))
    const staleEvents = selectExpiredAndOverflow(runtimeEvents, (item) => item.ts, cutoff, MAX_STORED_RUNTIME_EVENTS)
      .concat(runtimeEvents.filter((item) => staleSessionIds.has(item.sessionId)))
    const staleInvestigations = selectExpiredAndOverflow(
      investigations.filter((item) => !item.pinned), (item) => item.lastSeenAt ?? item.createdAt, cutoff, MAX_STORED_INVESTIGATIONS,
    )

    result.sessions = await deleteUnique(this.sessions!, staleSessions)
    result.requests = await deleteUnique(this.requests!, staleRequests)
    result.runtimeEvents = await deleteUnique(this.runtimeEvents!, staleEvents)
    result.investigations = await deleteUnique(this.histories!, staleInvestigations)

    const retainedInvestigations = await this.histories!.all()
    const retainedInvestigationIds = new Set(retainedInvestigations.map((item) => item.id))
    const retainedById = new Map(retainedInvestigations.map((item) => [item.id, item]))
    const [nodes, edges, findings] = await Promise.all([this.nodes!.all(), this.edges!.all(), this.findings!.all()])
    result.graphRecords += await deleteUnique(this.nodes!, nodes.filter((item) => !retainedInvestigationIds.has(item.investigationId)) as StoredRecord<StoredEvidenceNode>[])
    result.graphRecords += await deleteUnique(this.edges!, edges.filter((item) => !retainedInvestigationIds.has(item.investigationId)) as StoredRecord<StoredEvidenceEdge>[])
    result.modelFindings = await deleteUnique(this.findings!, findings.filter((item) => {
      const owner = retainedById.get(item.investigationId)
      return !owner || (item.createdAt < cutoff && !owner.pinned)
    }) as StoredRecord<ModelFinding>[])
    return result
  }

  private async touchSession(id: string, tabId: number): Promise<void> {
    const current = await this.sessions!.get(id)
    if (current) await this.sessions!.update(id, { lastSeenAt: Date.now() })
    else await this.sessions!.insert({ id, tabId, startedAt: Date.now(), lastSeenAt: Date.now() }, id)
  }

  private async syncGraph(record: InvestigationRecord): Promise<void> {
    const graph = normalizeEvidenceGraph(record)
    await this.syncCollection(this.nodes!, record.id, graph.nodes)
    await this.syncCollection(this.edges!, record.id, graph.edges)
  }

  private async syncCollection<T extends { id: string; investigationId: string }>(collection: Collection<T>, investigationId: string, desired: T[]): Promise<void> {
    const current = await collection.find({ investigationId } as Partial<T>) as StoredRecord<T>[]
    const ids = new Set(desired.map((item) => item.id))
    for (const existing of current) if (!ids.has(existing.id)) await collection.delete(existing.id)
    for (const item of desired) {
      if (current.some((existing) => existing.id === item.id)) await collection.update(item.id, item)
      else await collection.insert(item, item.id)
    }
  }

  async getNeighborhood(investigationId: string, depth = 2, limit = 80): Promise<EvidenceNeighborhood> {
    this.ensure()
    const [nodes, edges] = await Promise.all([
      this.nodes!.find({ investigationId }), this.edges!.find({ investigationId }),
    ])
    return boundedNeighborhood(investigationRootId(investigationId), nodes, edges, depth, limit)
  }

  subscribeNeighborhood(investigationId: string, callback: (value: EvidenceNeighborhood) => void): () => void {
    this.ensure()
    const refresh = () => void this.getNeighborhood(investigationId, 4, 80).then(callback)
    const unsubscribeNodes = this.nodes!.subscribe(refresh)
    const unsubscribeEdges = this.edges!.subscribe(refresh)
    refresh()
    return () => { unsubscribeNodes(); unsubscribeEdges() }
  }

  async searchSimilar(investigationId: string, limit = 5): Promise<InvestigationRecord[]> {
    this.ensure()
    const current = await this.histories!.get(investigationId)
    if (!current) return []
    const all = await this.histories!.all()
    return all.filter((record) => record.id !== investigationId && (
      record.fingerprint === current.fingerprint || record.requestUrl === current.requestUrl
    )).slice(0, limit).map(stripDatabaseFields)
  }

  async saveFinding(finding: ModelFinding): Promise<void> {
    this.ensure()
    await this.findings!.insert(finding, finding.id)
  }

  async findingsFor(investigationId: string): Promise<ModelFinding[]> {
    this.ensure()
    return (await this.findings!.find({ investigationId })).map(stripDatabaseFields)
  }

  private sort(records: InvestigationRecord[]): InvestigationRecord[] {
    return records.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt - a.createdAt)
  }
}

function stripDatabaseFields<T>(record: T & { __version?: number }): T {
  const { __version: _version, ...clean } = record
  return clean as T
}

function withoutScreenshot(record: InvestigationRecord): InvestigationRecord {
  if (!record.graph.bundle?.screenshot) return record
  return { ...record, graph: { ...record.graph, bundle: { ...record.graph.bundle, screenshot: undefined } } }
}

function selectExpiredAndOverflow<T>(records: T[], timestamp: (item: T) => number, cutoff: number, limit: number): T[] {
  const expired = records.filter((item) => timestamp(item) < cutoff)
  const expiredSet = new Set(expired)
  const retained = records.filter((item) => !expiredSet.has(item)).sort((a, b) => timestamp(b) - timestamp(a))
  return [...expired, ...retained.slice(limit)]
}

async function deleteUnique<T>(collection: Collection<T>, records: Array<T & { id: string }>): Promise<number> {
  const ids = [...new Set(records.map((record) => record.id))]
  for (const id of ids) await collection.delete(id)
  return ids.length
}

function emptyMaintenance(): MaintenanceResult {
  return { sessions: 0, requests: 0, runtimeEvents: 0, investigations: 0, graphRecords: 0, modelFindings: 0 }
}

export const feltRepository = new FeltRepository()

export const graphTools = {
  getIssueNeighborhood: (investigationId: string, depth = 4) => feltRepository.getNeighborhood(investigationId, depth),
  searchSimilarInvestigations: (investigationId: string, limit = 5) => feltRepository.searchSimilar(investigationId, limit),
}
