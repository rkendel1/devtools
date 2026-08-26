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
    request: { method: string; url: string; status: number; timingMs?: number }
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
  lifecycle: 'NEW' | 'INVESTIGATING' | 'PROPOSED' | 'APPLIED' | 'VERIFYING' | 'RESOLVED'
  sentAt: number
  delivery?: 'manual' | 'automatic'
  source: { clientId: string; clientType: string; product: string }
  investigation: RuntimeInvestigation
  developmentActivity?: DevelopmentActivity[]
  verifications?: Array<{ entityId: string; observedAt: number; status: number; statusText?: string; outcome: 'FIXED' | 'NOT_FIXED' }>
}

export interface InvestigationItem {
  entityId: string
  envelope: RuntimeInvestigationEnvelope
}

export interface DevelopmentActivity {
  observedAt: number
  changedFiles: Array<{ path: string; change: 'created' | 'changed' | 'deleted' }>
  git?: { branch?: string; commit?: string; author?: string; committedAt?: string; changedFiles?: string[]; diffStat?: string }
}

const COLLECTION = 'runtime_investigations'

export class FeltWorkspaceClient implements vscode.Disposable {
  private connection: DevelopmentWorkspaceConnection | undefined
  private unsubscribe: (() => void) | undefined
  private readonly emitter = new vscode.EventEmitter<InvestigationItem>()
  private readonly connectionEmitter = new vscode.EventEmitter<void>()
  private currentPairingCode: string | undefined
  private activeItem: InvestigationItem | undefined
  readonly onInvestigation = this.emitter.event
  readonly onConnectionChanged = this.connectionEmitter.event

  get connected(): boolean { return Boolean(this.connection) }
  get workspaceId(): string | undefined { return this.connection?.workspaceId }
  get pairingCode(): string | undefined { return this.currentPairingCode }
  get activeInvestigation(): InvestigationItem | undefined { return this.activeItem }

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
      if (this.activeItem?.entityId === event.entityId) this.activeItem = item
    })
    this.connectionEmitter.fire()
  }

  async query(): Promise<InvestigationItem[]> {
    if (!this.connection) throw new Error('Connect to a FeltDB development workspace first.')
    const values = await this.connection.query<RuntimeInvestigationEnvelope>(COLLECTION)
    return values.filter(isEnvelope).map((envelope) => ({
      entityId: envelope.entityId ?? envelope.investigation.id,
      envelope,
    }))
  }

  async markInvestigating(item: InvestigationItem): Promise<void> {
    if (!this.connection) throw new Error('Connect to a FeltDB development workspace first.')
    if (!item.envelope.entityId) {
      const entityId = await this.connection.publish<RuntimeInvestigationEnvelope>(COLLECTION, item.envelope)
      await this.connection.update<RuntimeInvestigationEnvelope>(COLLECTION, entityId, { entityId })
      item.entityId = entityId
      item.envelope.entityId = entityId
    }
    await this.connection.update<RuntimeInvestigationEnvelope>(COLLECTION, item.entityId, { lifecycle: 'INVESTIGATING' })
    item.envelope.lifecycle = 'INVESTIGATING'
    this.activeItem = item
  }

  async recordDevelopmentActivity(item: InvestigationItem, activity: DevelopmentActivity): Promise<void> {
    if (!this.connection) return
    const developmentActivity = [...(item.envelope.developmentActivity ?? []), activity].slice(-50)
    await this.connection.update<RuntimeInvestigationEnvelope>(COLLECTION, item.entityId, { developmentActivity })
    item.envelope.developmentActivity = developmentActivity
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    const connection = this.connection
    this.connection = undefined
    this.currentPairingCode = undefined
    this.activeItem = undefined
    if (connection) await connection.disconnect()
    this.connectionEmitter.fire()
  }

  dispose(): void {
    void this.disconnect()
    this.emitter.dispose()
    this.connectionEmitter.dispose()
  }
}

function isEnvelope(value: unknown): value is RuntimeInvestigationEnvelope {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RuntimeInvestigationEnvelope>
  return candidate.kind === 'runtime_investigation'
    && Boolean(candidate.investigation?.id)
    && Boolean(candidate.investigation?.graph?.request)
    && Boolean(candidate.investigation?.result)
}
