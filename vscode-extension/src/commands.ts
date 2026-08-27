import * as vscode from 'vscode'
import { displayInvestigation, itemWorkspaceId, type FeltWorkspaceClient, type InvestigationItem, type RuntimeInvestigation } from './workspace-client.js'
import type { InvestigationProvider, InvestigationTreeItem } from './investigation-provider.js'
import { InvestigationView, sourceLocation } from './investigation-view.js'

type CommandItem = InvestigationItem | InvestigationTreeItem | undefined
const announcedConnections = new WeakMap<FeltWorkspaceClient, string>()

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
    announcedConnections.delete(client)
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
    const investigation = displayInvestigation(item)
    const location = sourceLocation(investigation)
    const exactSource = location ? await resolveSourceUri(location.source) : undefined
    const requestSource = exactSource ? undefined : await resolveRequestedSource(investigation.graph.request.url)
    if (!exactSource && !requestSource) {
      if (location) return void showResolutionError(location.source)
      return void vscode.window.showWarningMessage('Source location unavailable\nThe runtime investigation did not identify an exact local source file.', { modal: true })
    }
    const uri = exactSource ?? requestSource!
    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document)
    const line = Math.max(0, Math.min(document.lineCount - 1, (location?.line ?? 1) - 1))
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
    if (available.includes('workbench.action.chat.open')) {
      try {
        // The unified chat command preserves the active session's selected agent
        // (Claude, Copilot, Codex, or another registered provider). Do not call
        // openagent here: that command creates a built-in/Copilot-biased session.
        await vscode.commands.executeCommand('workbench.action.chat.open', {
          query: prompt,
          isPartialQuery: false,
          focus: true,
        })
        return
      } catch { /* Fall through to an explicit, provider-neutral handoff. */ }
    }
    await handoffThroughAgentPicker(prompt, available)
  })
  return [connect, disconnect, reconnect, refresh, open, showSource, trace, compare, investigate]
}

async function handoffThroughAgentPicker(prompt: string, availableCommands: string[]): Promise<void> {
  await vscode.env.clipboard.writeText(prompt)
  const choice = await vscode.window.showWarningMessage(
    'VS Code could not send this investigation to the active agent. The complete task was copied to the clipboard.',
    'Choose Agent',
  )
  if (choice !== 'Choose Agent') return
  if (availableCommands.includes('workbench.action.openAgentsWindow')) {
    await vscode.commands.executeCommand('workbench.action.openAgentsWindow')
    return
  }
  if (availableCommands.includes('workbench.action.chat.openModePicker') && availableCommands.includes('workbench.action.chat.open')) {
    await vscode.commands.executeCommand('workbench.action.chat.open')
    await vscode.commands.executeCommand('workbench.action.chat.openModePicker')
  }
}

export async function restoreWorkspace(context: vscode.ExtensionContext, client: FeltWorkspaceClient, provider: InvestigationProvider): Promise<void> {
  const pairingCode = context.globalState.get<string>('feltdb.lastPairingCode')
  if (!pairingCode) return
  await connectWithCode(pairingCode, context, client, provider, false)
}

function validatePairingCode(value: string): string | undefined {
  if (!value.trim()) return 'Pairing code is required.'
  if (!/^FELT-[A-Z0-9]{6}$/i.test(value.trim())) return 'Invalid FeltDB pairing code.\nExpected format:\nFELT-XXXXXX'
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
    const workspaceId = client.workspaceId
    if (showErrors && workspaceId && announcedConnections.get(client) !== workspaceId) {
      announcedConnections.set(client, workspaceId)
      void vscode.window.showInformationMessage(`Connected to FeltDB workspace ${workspaceId}`, 'Open Investigations').then((choice) => {
      if (choice === 'Open Investigations') void vscode.commands.executeCommand('feltdb.runtimeInvestigations.focus')
      })
    }
  } catch (error) {
    try { await client.disconnect() } catch { /* Preserve the original connection error. */ }
    announcedConnections.delete(client)
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

async function resolveRequestedSource(requestUrl: string): Promise<vscode.Uri | undefined> {
  let pathname: string
  try { pathname = decodeURIComponent(new URL(requestUrl).pathname) } catch { return undefined }
  // A request URL is only a source location when it names a source file and that
  // exact path exists locally. Endpoint paths such as /api/telemetry never qualify.
  if (!/\.(?:[cm]?[jt]sx?|vue|svelte|astro|css|scss|less|html)$/i.test(pathname)) return undefined
  if (pathname.startsWith('/@fs/')) return existing(vscode.Uri.file(pathname.slice('/@fs'.length)))
  return resolveSourceUri(pathname)
}

async function existing(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
  try { await vscode.workspace.fs.stat(uri); return uri } catch { return undefined }
}

async function showResolutionError(runtimePath: string): Promise<void> {
  const projects = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath).join('\n') || '(no project is open)'
  await vscode.window.showErrorMessage(`Source file could not be resolved.\nRuntime path: ${runtimePath}\nProject: ${projects}`, { modal: true })
}

function agentPrompt(item: InvestigationItem): string {
  const value = displayInvestigation(item)
  const request = value.graph.request
  const environment = value.graph.bundle?.environment
  const location = sourceLocation(value)
  const duration = request.timingMs ?? durationFromTrace(value.graph.trace ?? [])
  return `Runtime Investigation

Entity:
${item.entityId}
Investigation:
${value.id}
Workspace:
${itemWorkspaceId(item)}
Request:
${request.method} ${request.url}
Status:
${request.status}${value.graph.response?.statusText ? ` ${value.graph.response.statusText}` : ''}
Duration:
${duration == null ? 'Not recorded' : `${duration}ms`}
Runtime observations:
${formatLines(value.graph.anomalies ?? [])}
Possible causes recorded by the runtime investigator:
${formatLines(value.result.alternatives ?? [])}
Page:
${environment?.pageUrl ?? 'Unknown'}
Browser:
${browserName(environment?.userAgent)}
Viewport:
${environment?.viewport ?? 'Unknown'}
Observed evidence:
${formatLines(value.result.evidence)}
Persisted request trace:
${formatLines((value.graph.trace ?? []).map((step) => `${step.label}${step.source ? ` (${step.source}:${step.line ?? 1})` : ''}`))}
Related runtime events:
${formatLines((value.graph.relatedEvents ?? []).map((event) => `${event.type}: ${event.message}${event.source ? ` (${event.source}:${event.line ?? 1})` : ''}`))}
Reproduction:
${formatLines(value.graph.bundle?.reproductionSteps ?? [])}
Relevant source:
${location ? `${location.source}:${location.line}` : 'No exact source location was persisted.'}
Comparison with previous successful observation:
${formatComparison(value.graph.comparison)}
Persisted request headers:
${formatValue(value.graph.bundle?.requestHeaders)}
Persisted response headers:
${formatValue(value.graph.bundle?.responseHeaders)}
Persisted request body:
${formatValue(value.graph.bundle?.requestBody)}
Persisted response body:
${formatValue(value.graph.bundle?.responseBody)}
Redaction applied:
${value.graph.redactionApplied ? 'Yes' : 'No'}

AI-generated diagnosis:
${value.result.diagnosis}
Confidence:
${Math.round(value.result.confidence * 100)}%
Suggested next actions from the runtime investigator:
${formatLines(value.result.nextActions)}

IMPORTANT:
The diagnosis is an inference, not an established fact. Determine the actual cause from the available evidence and source.

Your job:
Investigate this runtime observation. Determine whether it represents an actual defect, identify the most likely root cause, inspect the relevant source, and propose a fix. Do not modify files yet.

Respond with these sections: Finding, Evidence, Relevant source, Recommended change, and Confidence.

FeltDB observes workspace changes independently. Follow the active agent's normal permission model; no FeltDB-specific response or tool call is required.`
}

function formatLines(lines: string[]): string { return lines.length ? lines.map((line) => `- ${line}`).join('\n') : '- None recorded' }
function browserName(userAgent?: string): string { return userAgent?.match(/(?:Chrome|Firefox|Version)\/[\d.]+/)?.[0] ?? userAgent ?? 'Unknown' }
function durationFromTrace(trace: Array<{ label: string }>): number | undefined { for (const step of trace) { const match = step.label.match(/(?:—|-|in)\s*(\d+(?:\.\d+)?)ms/i); if (match?.[1]) return Number(match[1]) } return undefined }
function formatValue(value: unknown): string { return value == null || value === '' ? 'Not recorded' : typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
function formatComparison(comparison: RuntimeInvestigation['graph']['comparison']): string {
  if (!comparison?.previousSuccess && !comparison?.semanticDiff?.length) return 'No comparable successful observation is available.'
  return `Previous successful data:\n${formatValue(comparison.previousSuccess)}\nCurrent data:\n${formatValue(comparison.current)}\nDifferences:\n${formatLines(comparison.semanticDiff ?? [])}`
}
