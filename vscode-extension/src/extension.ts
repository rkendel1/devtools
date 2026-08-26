import * as vscode from 'vscode'
import { registerCommands, restoreWorkspace } from './commands.js'
import { InvestigationProvider, InvestigationTreeItem } from './investigation-provider.js'
import { FeltWorkspaceClient } from './workspace-client.js'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const client = new FeltWorkspaceClient()
  const provider = new InvestigationProvider(client)
  context.subscriptions.push(client, provider)
  const tree = vscode.window.createTreeView('feltdb.runtimeInvestigations', { treeDataProvider: provider })
  context.subscriptions.push(tree)
  context.subscriptions.push(tree.onDidChangeSelection((event) => {
    const selected = event.selection[0]
    provider.select(selected instanceof InvestigationTreeItem ? selected.item : undefined)
  }))
  context.subscriptions.push(...registerCommands(context, client, provider))
  await vscode.commands.executeCommand('setContext', 'feltdb.connected', false)
  await restoreWorkspace(context, client, provider)
}

export function deactivate(): void {}
