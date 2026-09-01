import * as vscode from 'vscode'
import {
  LEGACY_RUNTIME_INVESTIGATION_COLLECTION, RUNTIME_INVESTIGATION_COLLECTION,
  type DevelopmentWorkspaceConnection, type RuntimeInvestigation as CanonicalRuntimeInvestigation,
  type RuntimeRequestObservation,
} from '@feltdb/core/workspace'
import { isCanonicalRuntimeInvestigation } from './runtime-contract.js'

export interface RuntimeEnvironment { pageUrl?: string; userAgent?: string; viewport?: string }
export interface RuntimeInvestigation {
  id: string; createdAt: number; requestUrl: string
  graph: {
    request: { method: string; url: string; status: number; timingMs?: number; protocol?: string }
    response?: { statusText?: string }; initiator?: { source?: string; line?: number }
    trace?: Array<{ label: string; source?: string; line?: number }>; redactionApplied?: boolean
    comparison?: { semanticDiff?: string[]; previousSuccess?: unknown; current?: unknown }; anomalies?: string[]
    relatedEvents?: Array<{ type: string; message: string; source?: string; line?: number }>
    bundle?: { environment?: RuntimeEnvironment; requestHeaders?: unknown; responseHeaders?: unknown; requestBody?: string; responseBody?: string; reproductionSteps?: string[] }
  }
  result: { diagnosis: string; confidence: number; evidence: string[]; alternatives?: string[]; nextActions: string[] }
}
export interface RuntimeInvestigationEnvelope {
  kind: 'runtime_investigation'; schemaVersion: number; workspaceId: string; entityId?: string
  lifecycle: 'NEW' | 'INVESTIGATING' | 'CHANGE_DETECTED' | 'PROPOSED' | 'APPLIED' | 'VERIFYING' | 'RESOLVED' | 'FIXED' | 'REGRESSION' | 'NOT_REPRODUCED' | 'VERIFICATION_FAILED' | 'INCONCLUSIVE'
  status?: 'OPEN' | 'INVESTIGATING' | 'CHANGE_DETECTED' | 'VERIFYING' | 'FIXED' | 'REGRESSION' | 'NOT_REPRODUCED' | 'VERIFICATION_FAILED' | 'INCONCLUSIVE'
  createdAt?: number; updatedAt?: number; originalObservationId?: string
  canonicalObservationId?: string; canonicalObservationIds?: string[]; canonicalInvestigationId?: string
  changeId?: string; verificationId?: string; history?: Array<{ type: string; at: number; data?: unknown }>
  sentAt: number; delivery?: 'manual' | 'automatic'; source: { clientId: string; clientType: string; product: string }
  investigation: RuntimeInvestigation; developmentActivity?: DevelopmentActivity[]
  verifications?: Array<{ entityId: string; observedAt: number; status: number; statusText?: string; outcome: 'FIXED' | 'IMPROVED' | 'REGRESSED' | 'NOT_REPRODUCED' }>
}
export interface InvestigationItem {
  entityId: string; kind: 'canonical' | 'legacy'; canonicalInvestigation?: CanonicalRuntimeInvestigation
  observations: RuntimeRequestObservation[]; envelope?: RuntimeInvestigationEnvelope
}
export interface DevelopmentActivity {
  changeId?: string; observedAt: number; changedFiles: Array<{ path: string; change: 'created' | 'changed' | 'deleted' }>
  git?: { branch?: string; commit?: string; author?: string; committedAt?: string; changedFiles?: string[]; diffStat?: string; diff?: string }
}

export class FeltWorkspaceClient implements vscode.Disposable {
  private connection: DevelopmentWorkspaceConnection | undefined
  private unsubscribers: Array<() => void> = []
  private readonly emitter = new vscode.EventEmitter<InvestigationItem>()
  private readonly connectionEmitter = new vscode.EventEmitter<void>()
  private currentPairingCode: string | undefined
  private activeItem: InvestigationItem | undefined
  private readonly activeItems = new Map<string, InvestigationItem>()
  readonly onInvestigation = this.emitter.event
  readonly onConnectionChanged = this.connectionEmitter.event
  get connected(): boolean { return Boolean(this.connection) }
  /** The shared workspace connection, reused by the proposal bridge. */
  get workspaceConnection(): DevelopmentWorkspaceConnection | undefined { return this.connection }
  get workspaceId(): string | undefined { return this.connection?.workspaceId }
  get pairingCode(): string | undefined { return this.currentPairingCode }
  get activeInvestigation(): InvestigationItem | undefined { return this.activeItem }
  get activeInvestigations(): InvestigationItem[] { return [...this.activeItems.values()] }

  async connect(pairingCode: string, projectDir?: string): Promise<void> {
    await this.disconnect()
    const { connectDevelopmentWorkspace } = await import('@feltdb/core/workspace')
    const options = { pairingCode, clientId: `vscode-${vscode.env.machineId.slice(0, 12)}`, clientType: 'ide' as const, projectDir }
    let connection: DevelopmentWorkspaceConnection
    try { connection = await connectDevelopmentWorkspace(options) }
    catch (error) {
      if (!projectDir || !/not found|expired/i.test(error instanceof Error ? error.message : String(error))) throw error
      connection = await connectDevelopmentWorkspace({ ...options, projectDir: undefined })
    }
    this.connection = connection; this.currentPairingCode = pairingCode
    this.unsubscribers = [
      connection.subscribe<CanonicalRuntimeInvestigation>(RUNTIME_INVESTIGATION_COLLECTION, (event) => {
        if (event.type !== 'deleted' && isCanonicalRuntimeInvestigation(event.value)) void this.canonicalItem(event.value).then((item) => this.emitter.fire(item))
      }),
      connection.subscribe<RuntimeInvestigationEnvelope>(LEGACY_RUNTIME_INVESTIGATION_COLLECTION, (event) => {
        if (event.type !== 'deleted' && isEnvelope(event.value)) this.emitter.fire(legacyItem(event.entityId, event.value))
      }),
    ]
    this.connectionEmitter.fire()
  }

  async query(): Promise<InvestigationItem[]> {
    if (!this.connection) throw new Error('Connect to a FeltDB development workspace first.')
    const [canonical, legacy] = await Promise.all([
      this.connection.query<CanonicalRuntimeInvestigation>(RUNTIME_INVESTIGATION_COLLECTION),
      this.connection.query<RuntimeInvestigationEnvelope>(LEGACY_RUNTIME_INVESTIGATION_COLLECTION),
    ])
    const legacyItems = legacy.filter(isEnvelope).map((value) => legacyItem(value.entityId ?? value.investigation.id, value))
    const canonicalItems = await Promise.all(canonical.filter(isCanonicalRuntimeInvestigation).map(async (value) => {
      const item = await this.canonicalItem(value)
      const localId = item.observations.map((observation) => observation.correlation?.source)
        .find((source) => source?.product === 'feltdb-devtools')?.investigationId
      item.envelope = localId ? legacyItems.find((legacyItem) => legacyItem.envelope?.investigation.id === localId)?.envelope : undefined
      return item
    }))
    const supplemental = new Set(canonicalItems.map((item) => item.envelope).filter(Boolean))
    const fallbackLegacyItems = legacyItems.filter((item) => !supplemental.has(item.envelope))
    for (const item of canonicalItems) {
      const value = item.canonicalInvestigation!
      if (['INVESTIGATING', 'FINDING', 'PROPOSED'].includes(value.investigationState) || value.verificationState === 'VERIFYING') this.activeItems.set(item.entityId, item)
    }
    for (const item of fallbackLegacyItems) if (item.envelope?.entityId && ['INVESTIGATING', 'CHANGE_DETECTED', 'VERIFYING'].includes(item.envelope.status ?? item.envelope.lifecycle)) this.activeItems.set(item.entityId, item)
    this.activeItem = [...this.activeItems.values()].sort((a, b) => itemUpdatedAt(b) - itemUpdatedAt(a))[0]
    return [...canonicalItems, ...fallbackLegacyItems]
  }

  async markInvestigating(item: InvestigationItem): Promise<void> {
    if (!this.connection) throw new Error('Connect to a FeltDB development workspace first.')
    if (item.kind === 'canonical') { this.activeItem = item; this.activeItems.set(item.entityId, item); return }
    const envelope = item.envelope!
    if (!envelope.entityId) {
      const entityId = await this.connection.publish(LEGACY_RUNTIME_INVESTIGATION_COLLECTION, envelope)
      await this.connection.update(LEGACY_RUNTIME_INVESTIGATION_COLLECTION, entityId, { entityId })
      item.entityId = entityId; envelope.entityId = entityId
    }
    const now = Date.now(); const history = [...(envelope.history ?? []), { type: 'INVESTIGATING', at: now }]
    await this.connection.update(LEGACY_RUNTIME_INVESTIGATION_COLLECTION, item.entityId, { lifecycle: 'INVESTIGATING', status: 'INVESTIGATING', updatedAt: now, history })
    envelope.lifecycle = 'INVESTIGATING'; envelope.status = 'INVESTIGATING'; envelope.history = history
    this.activeItem = item; this.activeItems.set(item.entityId, item)
  }

  async recordDevelopmentActivity(item: InvestigationItem, activity: DevelopmentActivity): Promise<void> {
    if (!this.connection) return
    if (item.kind === 'canonical') {
      const value = item.canonicalInvestigation!
      await this.connection.publish('investigation_changes', {
        type: 'WORKSPACE_CHANGE_OBSERVED', investigationId: value.id, workspaceId: value.workspaceId,
        files: activity.changedFiles, git: activity.git, observedAt: activity.observedAt, source: 'workspace-filesystem',
        ...(value.changeId ? { changeId: value.changeId } : {}), ...(value.verificationId ? { verificationId: value.verificationId } : {}),
      })
      return
    }
    const envelope = item.envelope!
    const changeId = activity.changeId ?? envelope.changeId ?? `change_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    const verificationId = envelope.verificationId ?? `verification_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    activity.changeId = changeId
    const developmentActivity = [...(envelope.developmentActivity ?? []), activity].slice(-50)
    const history = [...(envelope.history ?? []), { type: 'CHANGE_DETECTED', at: activity.observedAt, data: { changeId, files: activity.changedFiles } }, { type: 'VERIFYING', at: activity.observedAt, data: { verificationId, changeId } }]
    await this.connection.update(LEGACY_RUNTIME_INVESTIGATION_COLLECTION, item.entityId, { developmentActivity, lifecycle: 'VERIFYING', status: 'VERIFYING', changeId, verificationId, updatedAt: activity.observedAt, history })
    await this.connection.publish('investigation_changes', {
      type: 'INVESTIGATION_CHANGE_APPLIED', investigationId: envelope.investigation.id, entityId: item.entityId, workspaceId: envelope.workspaceId,
      files: activity.changedFiles, git: activity.git, observedAt: activity.observedAt, changeId, verificationId, verificationRequired: true,
      source: 'workspace-filesystem', originalContext: { method: envelope.investigation.graph.request.method, url: envelope.investigation.graph.request.url, protocol: envelope.investigation.graph.request.protocol, pageUrl: envelope.investigation.graph.bundle?.environment?.pageUrl },
    })
    await this.connection.publish('investigation_verifications', { type: 'INVESTIGATION_VERIFICATION_STARTED', investigationId: envelope.investigation.id, entityId: item.entityId, workspaceId: envelope.workspaceId, changeId, verificationId, startedAt: activity.observedAt, status: 'RUNNING' })
    Object.assign(envelope, { developmentActivity, lifecycle: 'VERIFYING', status: 'VERIFYING', changeId, verificationId, history })
  }

  correlateActiveInvestigation(paths: string[]): InvestigationItem | undefined {
    const scored = this.activeInvestigations.map((item) => ({ item, score: relevanceScore(item, paths) })).filter((value) => value.score > 0).sort((a, b) => b.score - a.score)
    return scored[0] && scored[0].score > (scored[1]?.score ?? 0) ? scored[0].item : undefined
  }
  async recordUnassociatedActivity(activity: DevelopmentActivity): Promise<void> { if (this.connection) await this.connection.publish('investigation_changes', { type: 'WORKSPACE_CHANGE_UNASSOCIATED', workspaceId: this.workspaceId, ...activity, source: 'workspace-filesystem' }) }
  async disconnect(): Promise<void> {
    this.unsubscribers.forEach((value) => value()); this.unsubscribers = []
    const connection = this.connection; this.connection = undefined; this.currentPairingCode = undefined; this.activeItem = undefined; this.activeItems.clear()
    if (connection) await connection.disconnect(); this.connectionEmitter.fire()
  }
  dispose(): void { void this.disconnect(); this.emitter.dispose(); this.connectionEmitter.dispose() }
  private async canonicalItem(value: CanonicalRuntimeInvestigation): Promise<InvestigationItem> {
    const observations = this.connection
      ? (await Promise.all(canonicalObservationIds(value).map((id) => this.connection!.getRuntimeObservation(id)))).filter((item): item is RuntimeRequestObservation => Boolean(item)) : []
    return { entityId: value.id, kind: 'canonical', canonicalInvestigation: value, observations }
  }
}

export function canonicalObservationIds(value: CanonicalRuntimeInvestigation): string[] { return [...new Set([value.observationId, ...(value.observationIds ?? [])].filter(Boolean))] }
export function displayInvestigation(item: InvestigationItem): RuntimeInvestigation {
  if (item.kind === 'legacy' && item.envelope) return item.envelope.investigation
  const observation = item.observations[0] ?? item.canonicalInvestigation?.originalObservation
  if (!observation) throw new Error(`Canonical investigation ${item.entityId} has no resolvable observation`)
  const events = observation.correlatedEvents ?? []; const source = events.find((event) => event.source)?.source
  return {
    id: item.canonicalInvestigation!.id, createdAt: item.canonicalInvestigation!.createdAt, requestUrl: observation.url,
    graph: {
      request: { method: observation.method, url: observation.url, status: observation.status, timingMs: observation.durationMs },
      response: { statusText: String(observation.responseCharacteristics?.statusText ?? '') }, initiator: source ? { source: source.file, line: source.line } : undefined,
      relatedEvents: events.map((event) => ({ type: event.kind, message: event.message, source: event.source?.file, line: event.source?.line })),
      anomalies: observation.networkFailure ? ['Network failure'] : [], trace: [{ label: `${observation.method} ${observation.url} — ${observation.durationMs ?? 0}ms` }],
      redactionApplied: true, bundle: { environment: { pageUrl: observation.page, userAgent: [observation.browser, observation.engine].filter(Boolean).join(' / ') } },
    },
    result: { diagnosis: item.canonicalInvestigation?.finding?.statement ?? 'Canonical FeltDB runtime observation', confidence: 1, evidence: events.map((event) => `${event.kind}: ${event.message}`), nextActions: [] },
  }
}
export function itemUpdatedAt(item: InvestigationItem): number { return item.canonicalInvestigation?.updatedAt ?? item.envelope?.updatedAt ?? item.envelope?.sentAt ?? 0 }
export function itemWorkspaceId(item: InvestigationItem): string { return item.canonicalInvestigation?.workspaceId ?? item.envelope?.workspaceId ?? '' }
function legacyItem(entityId: string, envelope: RuntimeInvestigationEnvelope): InvestigationItem { return { entityId, kind: 'legacy', envelope, observations: [] } }
function relevanceScore(item: InvestigationItem, paths: string[]): number {
  const graph = displayInvestigation(item).graph
  const sources = [graph.initiator?.source, ...(graph.trace ?? []).map((step) => step.source)].filter((value): value is string => Boolean(value)).map(sourcePath)
  const tokens = (() => { try { return new URL(graph.request.url).pathname.split(/[/_.-]/).filter((value) => value.length > 3) } catch { return [] } })()
  return Math.max(0, ...paths.map((path) => { const normalized = path.replaceAll('\\', '/').toLowerCase(); if (sources.some((value) => normalized.endsWith(value) || value.endsWith(normalized))) return 10; if (sources.some((value) => value.split('/').at(-1) === normalized.split('/').at(-1))) return 6; if (tokens.some((value) => normalized.includes(value.toLowerCase()))) return 2; return 0 }))
}
function sourcePath(value: string): string { try { return decodeURIComponent(new URL(value).pathname).replace(/^\/+/, '').toLowerCase() } catch { return value.replace(/^\/+/, '').toLowerCase() } }
function isEnvelope(value: unknown): value is RuntimeInvestigationEnvelope {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RuntimeInvestigationEnvelope>
  return candidate.kind === 'runtime_investigation' && Boolean(candidate.investigation?.id) && Boolean(candidate.investigation?.graph?.request) && Boolean(candidate.investigation?.result)
}
