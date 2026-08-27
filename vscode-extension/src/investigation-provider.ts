import * as vscode from 'vscode'
import { displayInvestigation, itemUpdatedAt, type FeltWorkspaceClient, type InvestigationItem } from './workspace-client.js'
import { InvestigationView } from './investigation-view.js'

export class InvestigationTreeItem extends vscode.TreeItem {
  constructor(readonly item: InvestigationItem) {
    const investigation = displayInvestigation(item)
    const request = investigation.graph.request
    super(requestPath(request.url), vscode.TreeItemCollapsibleState.None)
    this.id = investigation.id
    this.description = `${request.status} ${investigation.graph.response?.statusText ?? ''}`.trim()
    this.tooltip = new vscode.MarkdownString([
      `**${request.method} ${request.url}**`,
      '',
      `HTTP ${request.status} ${investigation.graph.response?.statusText ?? ''}`,
      '',
      `Confidence: ${Math.round(investigation.result.confidence * 100)}%`,
    ].join('\n'))
    this.iconPath = new vscode.ThemeIcon(request.status >= 400 ? 'error' : 'search')
    this.contextValue = 'runtimeInvestigation'
    const sourceBacked = hasSourceCandidate(item)
    if (sourceBacked) this.iconPath = new vscode.ThemeIcon('file-code')
    this.command = { command: sourceBacked ? 'feltdb.showSource' : 'feltdb.openInvestigation', title: sourceBacked ? 'Open Source' : 'Open Investigation', arguments: [item] }
  }
}

type FeltTreeItem = InvestigationTreeItem | vscode.TreeItem

export class InvestigationProvider implements vscode.TreeDataProvider<FeltTreeItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event
  private readonly items = new Map<string, InvestigationItem>()
  private readonly notifiedEntities = new Set<string>()
  private readonly subscriptions: vscode.Disposable[]
  private selectedItem: InvestigationItem | undefined

  constructor(private readonly client: FeltWorkspaceClient) {
    this.subscriptions = [client.onInvestigation((item) => {
      const previous = this.items.get(item.entityId)
      this.items.set(item.entityId, item)
      this.changed.fire()
      InvestigationView.update(item)
      if (previous && !isResolved(previous) && isResolved(item)) {
        void vscode.window.showInformationMessage(`FeltDB investigation resolved and verified in browser: ${summary(item)}`, 'Open').then((choice) => {
          if (choice === 'Open') void vscode.commands.executeCommand('feltdb.openInvestigation', item)
        })
      } else if ((item.envelope?.delivery === 'manual' || !previous) && !this.notifiedEntities.has(item.entityId)) {
        this.notifiedEntities.add(item.entityId)
        void vscode.window.showInformationMessage(`FeltDB investigation received: ${summary(item)}`, ...(hasSourceCandidate(item) ? ['Open Source', 'Open Investigation'] as const : ['Open Investigation'] as const)).then((choice) => {
        if (choice === 'Open Source') void vscode.commands.executeCommand('feltdb.showSource', item)
        if (choice === 'Open Investigation') void vscode.commands.executeCommand('feltdb.openInvestigation', item)
      })
      }
    }), client.onConnectionChanged(() => this.changed.fire())]
  }

  getTreeItem(element: FeltTreeItem): vscode.TreeItem { return element }
  getChildren(element?: FeltTreeItem): FeltTreeItem[] {
    if (!this.client.connected) {
      const message = new vscode.TreeItem('No workspace connected.')
      message.iconPath = new vscode.ThemeIcon('circle-slash')
      const connect = new vscode.TreeItem('Connect to Workspace')
      connect.iconPath = new vscode.ThemeIcon('plug')
      connect.command = { command: 'feltdb.connectWorkspace', title: 'Connect to Workspace' }
      return [message, connect]
    }
    if (element?.contextValue === 'runtimeInvestigationsGroup') {
      return [...this.items.values()]
        .sort((a, b) => itemUpdatedAt(b) - itemUpdatedAt(a))
        .map((item) => new InvestigationTreeItem(item))
    }
    if (element) return []
    const connected = new vscode.TreeItem('Connected')
    connected.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
    const workspaceLabel = new vscode.TreeItem('Workspace')
    workspaceLabel.description = this.client.workspaceId
    const pairingLabel = new vscode.TreeItem('Pairing')
    pairingLabel.description = this.client.pairingCode
    const investigations = new vscode.TreeItem('Runtime Investigations', vscode.TreeItemCollapsibleState.Expanded)
    investigations.contextValue = 'runtimeInvestigationsGroup'
    investigations.iconPath = new vscode.ThemeIcon('search')
    const disconnect = new vscode.TreeItem('Disconnect')
    disconnect.iconPath = new vscode.ThemeIcon('debug-disconnect')
    disconnect.command = { command: 'feltdb.disconnectWorkspace', title: 'Disconnect' }
    return [connected, workspaceLabel, pairingLabel, investigations, disconnect]
  }

  async refresh(): Promise<void> {
    const records = await this.client.query()
    for (const item of records) this.items.set(item.entityId, item)
    this.changed.fire()
  }

  select(item: InvestigationItem | undefined): void { this.selectedItem = item }
  selected(): InvestigationItem | undefined { return this.selectedItem }
  findEntity(entityId: string): InvestigationItem | undefined { return [...this.items.values()].find((item) => item.entityId === entityId) }
  updated(item: InvestigationItem): void {
    this.items.set(item.entityId, item)
    this.changed.fire()
  }

  clear(): void { this.items.clear(); this.changed.fire() }
  dispose(): void { this.subscriptions.forEach((subscription) => subscription.dispose()); this.changed.dispose() }
}

function requestPath(url: string): string {
  try { return new URL(url).pathname || url } catch { return url }
}

function summary(item: InvestigationItem): string {
  const request = displayInvestigation(item).graph.request
  return `${request.method} ${requestPath(request.url)} → ${request.status}`
}

function hasSourceCandidate(item: InvestigationItem): boolean {
  const graph = displayInvestigation(item).graph
  if (graph.initiator?.source || graph.trace?.some((step) => step.source)) return true
  try { return /\.(?:[cm]?[jt]sx?|vue|svelte|astro|css|scss|less|html)$/i.test(new URL(graph.request.url).pathname) } catch { return false }
}

function isResolved(item: InvestigationItem): boolean {
  return item.canonicalInvestigation?.verificationState === 'VERIFIED' || item.envelope?.lifecycle === 'RESOLVED'
}
