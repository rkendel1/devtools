import * as vscode from 'vscode'
import type { FeltWorkspaceClient, InvestigationItem, RuntimeInvestigation } from './workspace-client.js'
import type { InvestigationProvider, InvestigationTreeItem } from './investigation-provider.js'
import { InvestigationView, sourceLocation } from './investigation-view.js'

type CommandItem = InvestigationItem | InvestigationTreeItem | undefined

export function registerCommands(context: vscode.ExtensionContext, client: FeltWorkspaceClient, provider: InvestigationProvider): vscode.Disposable[] {
  let lastEnteredCode = context.globalState.get<string>('feltdb.lastPairingCode', '')
  const connect = vscode.commands.registerCommand('feltdb.connectWorkspace', async () => {
    const entered = await vscode.window.showInputBox({
      title: 'FeltDB Pairing Code',
      prompt: 'Enter the pairing code shown by `feltdb dev`.\nExample: FELT-F21DA3',
      placeHolder: 'FELT-XXXXXX',
      value: lastEnteredCode,
      ignoreFocusOut: true,
      validateInput: validatePairingCode,
    })
    if (entered === undefined) return
    const pairingCode = entered.trim().toUpperCase()
    lastEnteredCode = pairingCode
    await connectWithCode(pairingCode, context, client, provider, true)
  })
  const disconnect = vscode.commands.registerCommand('feltdb.disconnectWorkspace', async () => {
    await client.disconnect()
    provider.clear()
    await vscode.commands.executeCommand('setContext', 'feltdb.connected', false)
  })
  const reconnect = vscode.commands.registerCommand('feltdb.reconnectWorkspace', async () => {
    const pairingCode = context.globalState.get<string>('feltdb.lastPairingCode')
    if (!pairingCode) return void vscode.window.showErrorMessage('No previous FeltDB workspace configuration is available. Enter a pairing code to connect.')
    lastEnteredCode = pairingCode
    await connectWithCode(pairingCode, context, client, provider, true)
  })
  const refresh = vscode.commands.registerCommand('feltdb.refreshInvestigations', () => provider.refresh())
  const open = vscode.commands.registerCommand('feltdb.openInvestigation', (value: CommandItem) => {
    const item = resolveItem(value, provider)
    if (item) { provider.select(item); InvestigationView.show(context.extensionUri, item) }
  })
  const showSource = vscode.commands.registerCommand('feltdb.showSource', async (value: CommandItem) => {
    const item = resolveItem(value, provider)
    if (!item) return void vscode.window.showWarningMessage('Select a runtime investigation first.')
    const location = sourceLocation(item.envelope.investigation)
    if (!location) return void showResolutionError('(no runtime source path)')
    const uri = await resolveSourceUri(location.source)
    if (!uri) return void showResolutionError(location.source)
    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document)
    const line = Math.max(0, Math.min(document.lineCount - 1, location.line - 1))
    editor.selection = new vscode.Selection(line, 0, line, 0)
    editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter)
  })
  const trace = vscode.commands.registerCommand('feltdb.viewTrace', (value: CommandItem) => {
    const item = resolveItem(value, provider)
    if (item) InvestigationView.showTrace(context.extensionUri, item)
  })
  const compare = vscode.commands.registerCommand('feltdb.compareInvestigation', (value: CommandItem) => {
    const item = resolveItem(value, provider)
    if (item) InvestigationView.showComparison(context.extensionUri, item)
  })
  const investigate = vscode.commands.registerCommand('feltdb.investigateRuntimeIssue', async (value: CommandItem) => {
    const item = resolveItem(value, provider)
    if (!item) return void vscode.window.showWarningMessage('Select a runtime investigation first.')
    await client.markInvestigating(item)
    provider.updated(item)
    const prompt = agentPrompt(item)
    const available = await vscode.commands.getCommands(true)
    if (!available.includes('workbench.action.chat.open')) {
      await vscode.env.clipboard.writeText(prompt)
      return void vscode.window.showWarningMessage('No VS Code chat agent is available. The investigation context was copied to the clipboard.')
    }
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt, mode: 'agent' })
  })
  return [connect, disconnect, reconnect, refresh, open, showSource, trace, compare, investigate]
}

export async function restoreWorkspace(context: vscode.ExtensionContext, client: FeltWorkspaceClient, provider: InvestigationProvider): Promise<void> {
  const pairingCode = context.globalState.get<string>('feltdb.lastPairingCode')
  if (!pairingCode) return
  await connectWithCode(pairingCode, context, client, provider, false)
}

function validatePairingCode(value: string): string | undefined {
  if (!value.trim()) return 'Pairing code is required.'
  if (!/^FELT-[A-Z0-9]{6}$/i.test(value.trim())) return 'Invalid FeltDB pairing code. Expected format: FELT-XXXXXX'
  return undefined
}

async function connectWithCode(pairingCode: string, context: vscode.ExtensionContext, client: FeltWorkspaceClient, provider: InvestigationProvider, showErrors: boolean): Promise<void> {
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Connecting to FeltDB…' }, async () => {
      await client.connect(pairingCode, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)
      await context.globalState.update('feltdb.lastPairingCode', pairingCode)
      provider.clear()
      await provider.refresh()
    })
    await vscode.commands.executeCommand('setContext', 'feltdb.connected', true)
    if (showErrors) void vscode.window.showInformationMessage(`Connected to FeltDB workspace ${client.workspaceId}`)
  } catch (error) {
    await vscode.commands.executeCommand('setContext', 'feltdb.connected', false)
    if (showErrors) await vscode.window.showErrorMessage(connectionError(pairingCode, error), { modal: true })
  }
}

function connectionError(pairingCode: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  if (/not found|expired|development workspace not found/i.test(detail)) {
    return `Could not connect to FeltDB workspace.\nPairing code ${pairingCode} was not found or has expired.\nMake sure \`feltdb dev\` is running and use the current pairing code displayed by the development server.\n\n${detail}`
  }
  if (/unavailable|ECONNREFUSED|fetch failed|failed to fetch|reach|connect/i.test(detail)) {
    return `Unable to reach the FeltDB development workspace.\nMake sure \`feltdb dev\` is running.\n\n${detail}`
  }
  return `Could not connect to FeltDB workspace.\n${detail}`
}

function resolveItem(value: CommandItem, provider: InvestigationProvider): InvestigationItem | undefined {
  if (!value) return provider.selected()
  return 'item' in value ? value.item : value
}

async function resolveSourceUri(source: string): Promise<vscode.Uri | undefined> {
  if (source.startsWith('file:')) return existing(vscode.Uri.parse(source))
  if (source.startsWith('/')) {
    const absolute = await existing(vscode.Uri.file(source))
    if (absolute) return absolute
  }
  const normalized = source.replace(/^https?:\/\/[^/]+/, '').replace(/^webpack:\/\//, '').replace(/^vite:\/\//, '').replace(/^\/+/, '')
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const candidate = await existing(vscode.Uri.joinPath(folder.uri, normalized))
    if (candidate) return candidate
  }
  return undefined
}

async function existing(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
  try { await vscode.workspace.fs.stat(uri); return uri } catch { return undefined }
}

async function showResolutionError(runtimePath: string): Promise<void> {
  const projects = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath).join('\n') || '(no project is open)'
  await vscode.window.showErrorMessage(`Source file could not be resolved.\nRuntime path: ${runtimePath}\nProject: ${projects}`, { modal: true })
}

function agentPrompt(item: InvestigationItem): string {
  const value = item.envelope.investigation
  const request = value.graph.request
  const environment = value.graph.bundle?.environment
  const location = sourceLocation(value)
  return `You are investigating a runtime observation from a FeltDB development workspace.

Do not edit files. Initially respond only with analysis and proposed next steps. Do not assume the reported diagnosis is correct; determine whether the observed behavior actually represents a defect.

IDENTITY
FeltDB entity ID: ${item.entityId}
Investigation ID: ${value.id}
Workspace ID: ${item.envelope.workspaceId}

OBSERVED RUNTIME EVIDENCE
Request:
${request.method} ${request.url}
Status:
${request.status} ${value.graph.response?.statusText ?? ''}
Page:
${environment?.pageUrl ?? 'Unknown'}
Environment:
Browser: ${browserName(environment?.userAgent)}
Viewport: ${environment?.viewport ?? 'Unknown'}
Trace:
${formatLines((value.graph.trace ?? []).map((step) => step.label))}
Evidence:
${formatLines(value.result.evidence)}
Reproduction:
${formatLines(value.graph.bundle?.reproductionSteps ?? [])}
Relevant source:
${location?.source ?? 'Unknown'}${location ? `:${location.line}` : ''}

AI-GENERATED DIAGNOSIS
Reported diagnosis:
${value.result.diagnosis}
Confidence:
${Math.round(value.result.confidence * 100)}%
Alternatives:
${formatLines(value.result.alternatives ?? [])}`
}

function formatLines(lines: string[]): string { return lines.length ? lines.map((line) => `- ${line}`).join('\n') : '- None recorded' }
function browserName(userAgent?: string): string { return userAgent?.match(/(?:Chrome|Firefox|Version)\/[\d.]+/)?.[0] ?? userAgent ?? 'Unknown' }
