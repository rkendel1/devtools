import * as vscode from 'vscode'
import type { FeltWorkspaceClient, InvestigationItem } from './workspace-client.js'

export class InvestigationTreeItem extends vscode.TreeItem {
  constructor(readonly item: InvestigationItem) {
    const investigation = item.envelope.investigation
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
    this.command = { command: 'feltdb.openInvestigation', title: 'Open Investigation', arguments: [item] }
  }
}

type FeltTreeItem = InvestigationTreeItem | vscode.TreeItem

export class InvestigationProvider implements vscode.TreeDataProvider<FeltTreeItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event
  private readonly items = new Map<string, InvestigationItem>()
  private readonly subscriptions: vscode.Disposable[]
  private selectedItem: InvestigationItem | undefined

  constructor(private readonly client: FeltWorkspaceClient) {
    this.subscriptions = [client.onInvestigation((item) => {
      this.items.set(item.envelope.investigation.id, item)
      this.changed.fire()
      void vscode.window.showInformationMessage(`FeltDB investigation received: ${summary(item)}`, 'Open').then((choice) => {
        if (choice === 'Open') void vscode.commands.executeCommand('feltdb.openInvestigation', item)
      })
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
        .sort((a, b) => b.envelope.sentAt - a.envelope.sentAt)
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
    for (const item of records) this.items.set(item.envelope.investigation.id, item)
    this.changed.fire()
  }

  select(item: InvestigationItem | undefined): void { this.selectedItem = item }
  selected(): InvestigationItem | undefined { return this.selectedItem }
  updated(item: InvestigationItem): void {
    this.items.set(item.envelope.investigation.id, item)
    this.changed.fire()
  }

  clear(): void { this.items.clear(); this.changed.fire() }
  dispose(): void { this.subscriptions.forEach((subscription) => subscription.dispose()); this.changed.dispose() }
}

function requestPath(url: string): string {
  try { return new URL(url).pathname || url } catch { return url }
}

function summary(item: InvestigationItem): string {
  const request = item.envelope.investigation.graph.request
  return `${request.method} ${requestPath(request.url)} → ${request.status}`
}
