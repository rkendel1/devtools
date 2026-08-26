import * as vscode from 'vscode'
import type { DevelopmentWorkspaceConnection, WorkspaceEventPayload } from '@feltdb/core/workspace'

export interface RuntimeEnvironment {
  pageUrl?: string
  userAgent?: string
  viewport?: string
}

export interface RuntimeInvestigation {
  id: string
  createdAt: number
  requestUrl: string
  graph: {
    request: { method: string; url: string; status: number; timingMs?: number; protocol?: string }
    response?: { statusText?: string }
    initiator?: { source?: string; line?: number }
    trace?: Array<{ label: string; source?: string; line?: number }>
    redactionApplied?: boolean
    comparison?: { semanticDiff?: string[]; previousSuccess?: unknown; current?: unknown }
    anomalies?: string[]
    relatedEvents?: Array<{ type: string; message: string; source?: string; line?: number }>
    bundle?: { environment?: RuntimeEnvironment; requestHeaders?: unknown; responseHeaders?: unknown; requestBody?: string; responseBody?: string; reproductionSteps?: string[] }
  }
  result: { diagnosis: string; confidence: number; evidence: string[]; alternatives?: string[]; nextActions: string[] }
}

export interface RuntimeInvestigationEnvelope {
  kind: 'runtime_investigation'
  schemaVersion: number
  workspaceId: string
  entityId?: string
  lifecycle: 'NEW' | 'INVESTIGATING' | 'CHANGE_DETECTED' | 'PROPOSED' | 'APPLIED' | 'VERIFYING' | 'RESOLVED' | 'FIXED' | 'REGRESSION' | 'NOT_REPRODUCED' | 'VERIFICATION_FAILED' | 'INCONCLUSIVE'
  status?: 'OPEN' | 'INVESTIGATING' | 'CHANGE_DETECTED' | 'VERIFYING' | 'FIXED' | 'REGRESSION' | 'NOT_REPRODUCED' | 'VERIFICATION_FAILED' | 'INCONCLUSIVE'
  createdAt?: number
  updatedAt?: number
  originalObservationId?: string
  changeId?: string
  verificationId?: string
  history?: Array<{ type: string; at: number; data?: unknown }>
  sentAt: number
  delivery?: 'manual' | 'automatic'
  source: { clientId: string; clientType: string; product: string }
  investigation: RuntimeInvestigation
  developmentActivity?: DevelopmentActivity[]
  verifications?: Array<{ entityId: string; observedAt: number; status: number; statusText?: string; outcome: 'FIXED' | 'IMPROVED' | 'REGRESSED' | 'NOT_REPRODUCED' }>
}

export interface InvestigationItem {
  entityId: string
  envelope: RuntimeInvestigationEnvelope
}

export interface DevelopmentActivity {
  changeId?: string
  observedAt: number
  changedFiles: Array<{ path: string; change: 'created' | 'changed' | 'deleted' }>
  git?: { branch?: string; commit?: string; author?: string; committedAt?: string; changedFiles?: string[]; diffStat?: string; diff?: string }
}

const COLLECTION = 'runtime_investigations'

export class FeltWorkspaceClient implements vscode.Disposable {
  private connection: DevelopmentWorkspaceConnection | undefined
  private unsubscribe: (() => void) | undefined
  private readonly emitter = new vscode.EventEmitter<InvestigationItem>()
  private readonly connectionEmitter = new vscode.EventEmitter<void>()
  private currentPairingCode: string | undefined
  private activeItem: InvestigationItem | undefined
  private readonly activeItems = new Map<string, InvestigationItem>()
  readonly onInvestigation = this.emitter.event
  readonly onConnectionChanged = this.connectionEmitter.event

  get connected(): boolean { return Boolean(this.connection) }
  get workspaceId(): string | undefined { return this.connection?.workspaceId }
  get pairingCode(): string | undefined { return this.currentPairingCode }
  get activeInvestigation(): InvestigationItem | undefined { return this.activeItem }
  get activeInvestigations(): InvestigationItem[] { return [...this.activeItems.values()] }

  async connect(pairingCode: string, projectDir?: string): Promise<void> {
    await this.disconnect()
    const { connectDevelopmentWorkspace } = await import('@feltdb/core/workspace')
    const options = {
      pairingCode: pairingCode,
      clientId: `vscode-${vscode.env.machineId.slice(0, 12)}`,
      clientType: 'ide' as const,
      projectDir,
    }
    let connection: DevelopmentWorkspaceConnection
    try {
      connection = await connectDevelopmentWorkspace(options)
    } catch (error) {
      // An open folder is a useful local hint, not a requirement. If the code did
      // not belong to that folder, let core resolve it through pairing discovery.
      if (!projectDir || !/not found|expired/i.test(error instanceof Error ? error.message : String(error))) throw error
      connection = await connectDevelopmentWorkspace({ ...options, projectDir: undefined })
    }
    this.connection = connection
    this.currentPairingCode = pairingCode
    this.unsubscribe = connection.subscribe<RuntimeInvestigationEnvelope>(COLLECTION, (event) => {
      if (event.type === 'deleted' || !isEnvelope(event.value)) return
      const item = { entityId: event.entityId, envelope: event.value }
      this.emitter.fire(item)
      if (this.activeItems.has(event.entityId)) { this.activeItems.set(event.entityId, item); this.activeItem = item }
    })
    this.connectionEmitter.fire()
  }

  async query(): Promise<InvestigationItem[]> {
    if (!this.connection) throw new Error('Connect to a FeltDB development workspace first.')
    const values = await this.connection.query<RuntimeInvestigationEnvelope>(COLLECTION)
    const items = values.filter(isEnvelope).map((envelope) => ({
      entityId: envelope.entityId ?? envelope.investigation.id,
      envelope,
    }))
    for (const item of items) {
      if (item.envelope.entityId && ['INVESTIGATING', 'CHANGE_DETECTED', 'VERIFYING'].includes(item.envelope.status ?? item.envelope.lifecycle)) this.activeItems.set(item.entityId, item)
    }
    this.activeItem = [...this.activeItems.values()].sort((a, b) => (b.envelope.updatedAt ?? b.envelope.sentAt) - (a.envelope.updatedAt ?? a.envelope.sentAt))[0]
    return items
  }

  async markInvestigating(item: InvestigationItem): Promise<void> {
    if (!this.connection) throw new Error('Connect to a FeltDB development workspace first.')
    if (!item.envelope.entityId) {
      const entityId = await this.connection.publish<RuntimeInvestigationEnvelope>(COLLECTION, item.envelope)
      await this.connection.update<RuntimeInvestigationEnvelope>(COLLECTION, entityId, { entityId })
      item.entityId = entityId
      item.envelope.entityId = entityId
    }
    const now = Date.now()
    const history = [...(item.envelope.history ?? []), { type: 'INVESTIGATING', at: now }]
    await this.connection.update<RuntimeInvestigationEnvelope>(COLLECTION, item.entityId, { lifecycle: 'INVESTIGATING', status: 'INVESTIGATING', updatedAt: now, history })
    item.envelope.lifecycle = 'INVESTIGATING'
    item.envelope.status = 'INVESTIGATING'
    item.envelope.history = history
    this.activeItem = item
    this.activeItems.set(item.entityId, item)
  }

  async recordDevelopmentActivity(item: InvestigationItem, activity: DevelopmentActivity): Promise<void> {
    if (!this.connection) return
    const changeId = activity.changeId ?? `change_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    const verificationId = `verification_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    activity.changeId = changeId
    const developmentActivity = [...(item.envelope.developmentActivity ?? []), activity].slice(-50)
    const history = [...(item.envelope.history ?? []), { type: 'CHANGE_DETECTED', at: activity.observedAt, data: { changeId, files: activity.changedFiles } }, { type: 'VERIFYING', at: activity.observedAt, data: { verificationId, changeId } }]
    await this.connection.update<RuntimeInvestigationEnvelope>(COLLECTION, item.entityId, { developmentActivity, lifecycle: 'VERIFYING', status: 'VERIFYING', changeId, verificationId, updatedAt: activity.observedAt, history })
    await this.connection.publish('investigation_changes', {
      type: 'INVESTIGATION_CHANGE_APPLIED',
      investigationId: item.envelope.investigation.id,
      entityId: item.entityId,
      workspaceId: item.envelope.workspaceId,
      files: activity.changedFiles,
      git: activity.git,
      observedAt: activity.observedAt,
      changeId,
      verificationId,
      verificationRequired: true,
      source: 'workspace-filesystem',
      originalContext: {
        method: item.envelope.investigation.graph.request.method,
        url: item.envelope.investigation.graph.request.url,
        protocol: item.envelope.investigation.graph.request.protocol,
        pageUrl: item.envelope.investigation.graph.bundle?.environment?.pageUrl,
      },
    })
    await this.connection.publish('investigation_verifications', {
      type: 'INVESTIGATION_VERIFICATION_STARTED',
      investigationId: item.envelope.investigation.id,
      entityId: item.entityId,
      workspaceId: item.envelope.workspaceId,
      changeId,
      verificationId,
      startedAt: activity.observedAt,
      status: 'RUNNING',
    })
    item.envelope.developmentActivity = developmentActivity
    item.envelope.lifecycle = 'VERIFYING'
    item.envelope.status = 'VERIFYING'
    item.envelope.changeId = changeId
    item.envelope.verificationId = verificationId
    item.envelope.history = history
  }

  correlateActiveInvestigation(paths: string[]): InvestigationItem | undefined {
    const scored = this.activeInvestigations.map((item) => ({ item, score: relevanceScore(item, paths) })).filter((value) => value.score > 0).sort((a, b) => b.score - a.score)
    return scored[0] && scored[0].score > (scored[1]?.score ?? 0) ? scored[0].item : undefined
  }

  async recordUnassociatedActivity(activity: DevelopmentActivity): Promise<void> {
    if (!this.connection) return
    await this.connection.publish('investigation_changes', { type: 'WORKSPACE_CHANGE_UNASSOCIATED', workspaceId: this.workspaceId, ...activity, source: 'workspace-filesystem' })
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    const connection = this.connection
    this.connection = undefined
    this.currentPairingCode = undefined
    this.activeItem = undefined
    this.activeItems.clear()
    if (connection) await connection.disconnect()
    this.connectionEmitter.fire()
  }

  dispose(): void {
    void this.disconnect()
    this.emitter.dispose()
    this.connectionEmitter.dispose()
  }
}

function relevanceScore(item: InvestigationItem, paths: string[]): number {
  const graph = item.envelope.investigation.graph
  const sources = [graph.initiator?.source, ...(graph.trace ?? []).map((step) => step.source)].filter((value): value is string => Boolean(value)).map(sourcePath)
  const endpointTokens = (() => { try { return new URL(graph.request.url).pathname.split(/[/_.-]/).filter((token) => token.length > 3) } catch { return [] } })()
  return Math.max(0, ...paths.map((path) => {
    const normalized = path.replaceAll('\\', '/').toLowerCase()
    if (sources.some((source) => normalized.endsWith(source) || source.endsWith(normalized))) return 10
    if (sources.some((source) => source.split('/').at(-1) === normalized.split('/').at(-1))) return 6
    if (endpointTokens.some((token) => normalized.includes(token.toLowerCase()))) return 2
    return 0
  }))
}

function sourcePath(value: string): string {
  try { return decodeURIComponent(new URL(value).pathname).replace(/^\/+/, '').toLowerCase() } catch { return value.replace(/^\/+/, '').toLowerCase() }
}

function isEnvelope(value: unknown): value is RuntimeInvestigationEnvelope {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RuntimeInvestigationEnvelope>
  return candidate.kind === 'runtime_investigation'
    && Boolean(candidate.investigation?.id)
    && Boolean(candidate.investigation?.graph?.request)
    && Boolean(candidate.investigation?.result)
}
