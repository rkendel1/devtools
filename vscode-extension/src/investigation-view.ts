import * as vscode from 'vscode'
import type { InvestigationItem, RuntimeInvestigation } from './workspace-client.js'

export class InvestigationView {
  static show(extensionUri: vscode.Uri, item: InvestigationItem): void {
    const panel = createPanel('feltdb.investigation', 'Runtime Investigation', extensionUri)
    panel.webview.html = renderInvestigation(panel.webview, item)
    panel.webview.onDidReceiveMessage((message: { command?: string }) => {
      const commands: Record<string, string> = { openSource: 'feltdb.showSource', viewTrace: 'feltdb.viewTrace', compare: 'feltdb.compareInvestigation', investigate: 'feltdb.investigateRuntimeIssue' }
      const command = message.command ? commands[message.command] : undefined
      if (command) void vscode.commands.executeCommand(command, item)
    })
  }

  static showTrace(extensionUri: vscode.Uri, item: InvestigationItem): void {
    const panel = createPanel('feltdb.requestTrace', 'Request Trace', extensionUri)
    panel.webview.html = documentHtml(panel.webview, 'Request Trace', renderTrace(item.envelope.investigation))
  }

  static showComparison(extensionUri: vscode.Uri, item: InvestigationItem): void {
    const panel = createPanel('feltdb.comparison', 'Runtime Comparison', extensionUri)
    const body = renderComparison(item.envelope.investigation)
    panel.webview.html = documentHtml(panel.webview, 'Comparison', body)
  }
}

function createPanel(viewType: string, title: string, extensionUri: vscode.Uri): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [extensionUri] })
}

function renderInvestigation(webview: vscode.Webview, item: InvestigationItem): string {
  const value = item.envelope.investigation
  const request = value.graph.request
  const environment = value.graph.bundle?.environment
  const duration = request.timingMs ?? durationFromTrace(value)
  const completed = request.status > 0 && request.status < 400
  const failure = hasObservedFailure(value)
  const nonce = crypto.randomUUID().replaceAll('-', '')
  return `<!doctype html><html><head>${head(webview, nonce)}</head><body>
  <h1>${failure ? 'Runtime Investigation' : 'Runtime Observation'}</h1><p>${escape(request.method)} ${escape(requestPath(request.url))}</p>
  <div class="hero"><h2>Runtime status</h2><div class="grid"><span class="label">Request</span><strong>${escape(request.method)} ${escape(requestPath(request.url))}</strong><span class="label">Response</span><strong>${request.status} ${escape(value.graph.response?.statusText ?? '')}</strong>${duration == null ? '' : `<span class="label">Duration</span><span>${duration}ms</span>`}<span class="label">Completion</span><span>${completed ? '✓ Request completed' : failure ? '⚠ Failure evidence recorded' : 'Runtime observation recorded'}</span><span class="label">Lifecycle</span><span>${escape(item.envelope.lifecycle ?? 'NEW')}</span></div></div>
  ${section('Diagnosis', `<p>${escape(value.result.diagnosis)}</p><p><strong>Confidence: ${Math.round(value.result.confidence * 100)}%</strong></p>`)}
  ${section('Observed Evidence', list(value.result.evidence))}
  ${section('Environment', `<div class="grid"><span class="label">Page</span><span>${escape(environment?.pageUrl ?? 'Unknown')}</span><span class="label">Browser</span><span>${escape(browserName(environment?.userAgent))}</span><span class="label">Viewport</span><span>${escape(environment?.viewport ?? 'Unknown')}</span></div>`)}
  <div class="actionbar"><button data-command="openSource">Open Source</button><button data-command="viewTrace">View Trace</button><button data-command="compare">Compare</button><button data-command="investigate">Investigate</button></div>
  <p class="identity">FeltDB entity: ${escape(item.entityId)}</p>
  <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({command:button.dataset.command})));</script>
  </body></html>`
}

function renderTrace(value: RuntimeInvestigation): string {
  const request = value.graph.request
  const duration = request.timingMs ?? durationFromTrace(value)
  const persisted = value.graph.trace ?? []
  const heading = `<h2>${escape(request.method)} ${escape(request.url)}</h2>${duration == null ? '' : `<p class="duration">${duration}ms</p>`}`
  if (!persisted.length) return `${heading}<p>No persisted request trace is available.</p>`
  return `${heading}<ol>${persisted.map((step) => `<li><strong>${escape(step.label)}</strong>${step.source ? `<br><code>${escape(step.source)}:${step.line ?? 1}</code>` : ''}</li>`).join('')}</ol>`
}

function renderComparison(value: RuntimeInvestigation): string {
  const comparison = value.graph.comparison
  if (!comparison?.previousSuccess && !comparison?.semanticDiff?.length) return '<p>No comparable successful observation is available.</p>'
  const request = value.graph.request
  return `<h2>Previous observation</h2><p>Successful observation data captured by FeltDB</p>${data(comparison.previousSuccess)}<hr><h2>Current observation</h2><p><strong>${escape(request.method)} ${escape(request.url)}</strong><br>Status ${request.status} ${escape(value.graph.response?.statusText ?? '')}</p>${data(comparison.current)}<hr><h2>Difference</h2>${comparison.semanticDiff?.length ? list(comparison.semanticDiff.map((difference) => `⚠ ${difference}`)) : '<p>No persisted semantic differences.</p>'}`
}

function data(value: unknown): string { return value == null ? '<p>No payload data persisted.</p>' : `<pre>${escape(JSON.stringify(value, null, 2))}</pre>` }

function documentHtml(webview: vscode.Webview, title: string, body: string): string { return `<!doctype html><html><head>${head(webview)}</head><body><h1>${escape(title)}</h1><section class="section">${body}</section></body></html>` }
function head(webview: vscode.Webview, nonce?: string): string { return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';${nonce ? ` script-src 'nonce-${nonce}';` : ''}"><style>body{font-family:var(--vscode-font-family);padding:24px;max-width:900px;color:var(--vscode-foreground)}h1{margin-bottom:4px}.hero,.section{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:16px;margin:14px 0}.grid{display:grid;grid-template-columns:140px 1fr;gap:8px}.label,.identity,.duration{color:var(--vscode-descriptionForeground)}li{margin:9px 0}.actionbar{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}button{padding:7px 12px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;border-radius:3px}hr{border:0;border-top:1px solid var(--vscode-panel-border);margin:24px 0}code,pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>` }
function hasObservedFailure(value: RuntimeInvestigation): boolean { return value.graph.request.status >= 400 || (value.graph.relatedEvents ?? []).some((event) => event.type.includes('error')) }
function durationFromTrace(value: RuntimeInvestigation): number | undefined { for (const step of value.graph.trace ?? []) { const match = step.label.match(/(?:—|-|in)\s*(\d+(?:\.\d+)?)ms/i); if (match?.[1]) return Number(match[1]) } return undefined }
function requestPath(url: string): string { try { return new URL(url).pathname || url } catch { return url } }
function section(title: string, body: string): string { return `<section class="section"><h2>${escape(title)}</h2>${body}</section>` }
function list(items: string[]): string { return items.length ? `<ul>${items.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>` : '<p>None recorded.</p>' }
function escape(value: unknown): string { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!) }
function browserName(userAgent?: string): string { return userAgent?.match(/(?:Chrome|Firefox|Version)\/[\d.]+/)?.[0] ?? userAgent ?? 'Unknown' }

export function sourceLocation(value: RuntimeInvestigation): { source: string; line: number } | undefined {
  const direct = value.graph.initiator
  if (direct?.source) return { source: direct.source, line: direct.line ?? 1 }
  const trace = value.graph.trace?.find((step) => step.source)
  if (trace?.source) return { source: trace.source, line: trace.line ?? 1 }
  return undefined
}
