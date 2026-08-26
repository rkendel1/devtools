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
  lifecycle: 'NEW' | 'INVESTIGATING'
  sentAt: number
  source: { clientId: string; clientType: string; product: string }
  investigation: RuntimeInvestigation
}

export interface InvestigationItem {
  entityId: string
  envelope: RuntimeInvestigationEnvelope
}

const COLLECTION = 'runtime_investigations'

export class FeltWorkspaceClient implements vscode.Disposable {
  private connection: DevelopmentWorkspaceConnection | undefined
  private unsubscribe: (() => void) | undefined
  private readonly emitter = new vscode.EventEmitter<InvestigationItem>()
  private readonly connectionEmitter = new vscode.EventEmitter<void>()
  private currentPairingCode: string | undefined
  readonly onInvestigation = this.emitter.event
  readonly onConnectionChanged = this.connectionEmitter.event

  get connected(): boolean { return Boolean(this.connection) }
  get workspaceId(): string | undefined { return this.connection?.workspaceId }
  get pairingCode(): string | undefined { return this.currentPairingCode }

  async connect(pairingCode: string, projectDir?: string): Promise<void> {
    await this.disconnect()
    const { connectDevelopmentWorkspace } = await import('@feltdb/core/workspace')
    const connection = await connectDevelopmentWorkspace({
      pairingCode: pairingCode,
      clientId: `vscode-${vscode.env.machineId.slice(0, 12)}`,
      clientType: 'ide',
      projectDir,
    })
    this.connection = connection
    this.currentPairingCode = pairingCode
    this.unsubscribe = connection.subscribe<RuntimeInvestigationEnvelope>(COLLECTION, (event) => {
      if (event.type === 'deleted' || !isEnvelope(event.value)) return
      this.emitter.fire({ entityId: event.entityId, envelope: event.value })
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
    if (!item.envelope.entityId) throw new Error('This legacy investigation does not contain its durable FeltDB entity ID.')
    await this.connection.update<RuntimeInvestigationEnvelope>(COLLECTION, item.entityId, { lifecycle: 'INVESTIGATING' })
    item.envelope.lifecycle = 'INVESTIGATING'
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    const connection = this.connection
    this.connection = undefined
    this.currentPairingCode = undefined
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
