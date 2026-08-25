import { useEffect, useMemo, useRef, useState } from 'react'
import {
  captureConsoleEvents, captureEnvironment, captureRequests, captureScreenshot, endpointKey,
  hasChromeDevtools, openSourceLocation, pingExtensionContext, subscribeToRequests,
} from '../lib/chrome'
import { buildEvidenceGraph } from '../lib/evidenceEngine'
import { reasonFromEvidence } from '../lib/reasoner'
import { redactText } from '../lib/redaction'
import { formatInvestigationReport, formatJiraReport, formatJsonReport, formatMarkdownReport } from '../lib/report'
import { durableRuntime, initializeDurableStore, loadHistory, loadPrivacy, savePrivacy, subscribeDurableHistory, updateHistory } from '../lib/store'
import { askLocalInvestigator, enhanceWithLocalAi, interruptLocalAi, isLocalAiAvailable, LOCAL_MODELS } from '../lib/localAi'
import { feltRepository } from '../lib/feltRepository'
import type { EvidenceNeighborhood } from '../lib/evidenceGraph'
import { MAINTENANCE_INTERVAL_MS, MAX_LIVE_REQUESTS, RETENTION_MS } from '../lib/retention'
import type { InvestigationRecord, NetworkRequestSnapshot, PrivacySettings } from '../lib/types'

type ExportFormat = 'text' | 'markdown' | 'jira' | 'json'
type Filters = { query: string; status: string; domain: string; type: string; timeframe: string }

const EMPTY_FILTERS: Filters = { query: '', status: 'all', domain: 'all', type: 'all', timeframe: 'all' }

function formatRequest(request: NetworkRequestSnapshot): string {
  const url = request.url.length > 90 ? `${request.url.slice(0, 90)}…` : request.url
  return `${request.status} ${request.method} ${url}`
}

function reportFor(record: InvestigationRecord, format: ExportFormat): string {
  if (format === 'json') return formatJsonReport(record)
  if (format === 'markdown') return formatMarkdownReport(record)
  if (format === 'jira') return formatJiraReport(record)
  return formatInvestigationReport(record)
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    return copied
  }
}

function download(name: string, contents: string, type = 'text/plain'): void {
  const href = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(href)
}

function downloadDataUrl(name: string, href: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = name
  anchor.click()
}

export default function App() {
  const [requests, setRequests] = useState<NetworkRequestSnapshot[]>([])
  const requestsRef = useRef<NetworkRequestSnapshot[]>([])
  const [selectedRequestId, setSelectedRequestId] = useState('')
  const [investigation, setInvestigation] = useState<InvestigationRecord | null>(null)
  const [history, setHistory] = useState<InvestigationRecord[]>(() => loadHistory())
  const historyRef = useRef(history)
  const [privacy, setPrivacy] = useState<PrivacySettings>(() => loadPrivacy())
  const privacyRef = useRef(privacy)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [historyQuery, setHistoryQuery] = useState('')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('text')
  const [autoInvestigate, setAutoInvestigate] = useState(true)
  const [includeScreenshot, setIncludeScreenshot] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [redactionPreview, setRedactionPreview] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('Live capture ready')
  const [storageStatus, setStorageStatus] = useState(() => durableRuntime()?.storage ?? 'local fallback')
  const [lastCleanup, setLastCleanup] = useState<number | null>(null)
  const [contextValid, setContextValid] = useState(true)
  const [aiModel, setAiModel] = useState<string>(LOCAL_MODELS.smallest)
  const [aiStatus, setAiStatus] = useState('Local AI idle')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const lastRuntimeEvent = useRef(0)

  useEffect(() => { requestsRef.current = requests }, [requests])
  useEffect(() => { historyRef.current = history }, [history])
  useEffect(() => { privacyRef.current = privacy }, [privacy])

  useEffect(() => {
    let cancelled = false
    let unsubscribe: () => void = () => undefined
    void initializeDurableStore().then((state) => {
      if (cancelled) return
      historyRef.current = state.history
      privacyRef.current = state.privacy
      setHistory(state.history)
      setPrivacy(state.privacy)
      setStorageStatus(durableRuntime()?.storage ?? 'local fallback')
      unsubscribe = subscribeDurableHistory((records) => {
        historyRef.current = records
        setHistory(records)
      })
    }).catch((error) => setMessage(`FeltDB unavailable; using local fallback: ${String(error)}`))
    return () => { cancelled = true; unsubscribe() }
  }, [])

  useEffect(() => {
    const check = () => void pingExtensionContext().then(setContextValid)
    check()
    const timer = window.setInterval(check, 10_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const maintain = () => void feltRepository.runMaintenance(true).then((result) => {
      const cutoff = Date.now() - RETENTION_MS
      const retained = requestsRef.current.filter((request) => request.startedAt >= cutoff).slice(-MAX_LIVE_REQUESTS)
      if (retained.length !== requestsRef.current.length) {
        requestsRef.current = retained
        setRequests(retained)
        setSelectedRequestId((current) => retained.some((request) => request.id === current) ? current : '')
      }
      if (Object.values(result).some((count) => count > 0)) setLastCleanup(Date.now())
    }).catch((error) => setMessage(`Retention maintenance failed: ${String(error)}`))
    const timer = window.setInterval(maintain, MAINTENANCE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const listener = (progress: { type?: string; target?: string; progress?: number; text?: string }) => {
      if (progress.type === 'runtime-investigator:ai-progress' && progress.target === 'panel') {
        setAiStatus(`${Math.round((progress.progress ?? 0) * 100)}% ${progress.text ?? 'Loading local model'}`)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const selectedRequest = requests.find((request) => request.id === selectedRequestId) ?? null
  const domains = useMemo(() => [...new Set(requests.flatMap((request) => {
    try { return [new URL(request.url).hostname] } catch { return [] }
  }))].sort(), [requests])
  const types = useMemo(() => [...new Set(requests.map((request) => request.mimeType).filter(Boolean) as string[])].sort(), [requests])
  const filteredRequests = useMemo(() => requests.filter((request) => {
    const query = filters.query.toLowerCase()
    if (query && !`${request.method} ${request.url} ${request.status}`.toLowerCase().includes(query)) return false
    if (filters.status === 'errors' && request.status < 400) return false
    if (filters.status === '4xx' && (request.status < 400 || request.status >= 500)) return false
    if (filters.status === '5xx' && request.status < 500) return false
    if (filters.domain !== 'all') {
      try { if (new URL(request.url).hostname !== filters.domain) return false } catch { return false }
    }
    if (filters.type !== 'all' && request.mimeType !== filters.type) return false
    const windowMs = filters.timeframe === '1m' ? 60_000 : filters.timeframe === '5m' ? 300_000 : 0
    return !windowMs || request.startedAt >= Date.now() - windowMs
  }), [requests, filters])
  const visibleHistory = useMemo(() => history.filter((record) =>
    `${record.name ?? ''} ${record.result.diagnosis} ${record.requestUrl}`.toLowerCase().includes(historyQuery.toLowerCase()),
  ), [history, historyQuery])

  function addRequests(incoming: NetworkRequestSnapshot[]): void {
    const map = new Map(requestsRef.current.map((request) => [request.id, request]))
    for (const request of incoming) map.set(request.id, request)
    const next = [...map.values()].sort((a, b) => a.startedAt - b.startedAt).slice(-MAX_LIVE_REQUESTS)
    requestsRef.current = next
    setRequests(next)
    if (hasChromeDevtools()) void feltRepository.persistRequests(chrome.devtools.inspectedWindow.tabId, incoming, privacyRef.current).catch(
      (error) => setMessage(`FeltDB request persistence failed: ${String(error)}`),
    )
    if (!selectedRequestId && next.length) setSelectedRequestId((next.find((request) => request.status >= 400) ?? next.at(-1))!.id)
  }

  async function investigateRequest(request: NetworkRequestSnapshot, automatic = false): Promise<void> {
    if (!automatic) setLoading(true)
    try {
      const [events, environment, screenshot] = await Promise.all([
        captureConsoleEvents(500), captureEnvironment(), includeScreenshot ? captureScreenshot() : undefined,
      ])
      const peer = [...requestsRef.current].reverse().find((candidate) =>
        endpointKey(candidate) === endpointKey(request) && candidate.status < 400 && candidate.id !== request.id,
      )
      const graph = buildEvidenceGraph(request, peer, requestsRef.current, events, privacyRef.current, environment, screenshot)
      const result = reasonFromEvidence(graph)
      const fingerprint = `${endpointKey(request)}|${request.status}|${result.diagnosis}`
      const now = Date.now()
      const existing = historyRef.current.find((record) => record.fingerprint === fingerprint)
      const record: InvestigationRecord = {
        id: existing?.id ?? crypto.randomUUID(), createdAt: existing?.createdAt ?? now,
        requestId: request.id, requestUrl: request.url, graph, result, fingerprint,
        name: existing?.name, pinned: existing?.pinned,
        occurrenceCount: existing ? (existing.occurrenceCount ?? 1) + (automatic ? 1 : 0) : 1,
        firstSeenAt: existing?.firstSeenAt ?? existing?.createdAt ?? now, lastSeenAt: now,
      }
      const next = updateHistory([record, ...historyRef.current.filter((item) => item.id !== record.id)])
      historyRef.current = next
      setHistory(next)
      setInvestigation(record)
      setMessage(automatic ? `Automatically investigated ${request.status} ${request.url}` : 'Investigation complete.')
    } catch (error) {
      setMessage(`Investigation failed: ${String(error)}`)
    } finally {
      if (!automatic) setLoading(false)
    }
  }

  useEffect(() => {
    if (!hasChromeDevtools()) return
    void captureRequests(MAX_LIVE_REQUESTS).then(addRequests)
    return subscribeToRequests((request) => {
      addRequests([request])
      if (autoInvestigate && request.status >= 400) void investigateRequest(request, true)
    })
  // The listener reads current values from refs; resubscribe only when auto mode changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInvestigate])

  useEffect(() => {
    const timer = window.setInterval(() => void captureConsoleEvents(500).then((events) => {
      const newest = events.at(-1)
      if (!newest || newest.ts <= lastRuntimeEvent.current) return
      const unseen = events.filter((event) => event.ts > lastRuntimeEvent.current)
      void feltRepository.persistRuntimeEvents(chrome.devtools.inspectedWindow.tabId, unseen, privacyRef.current).catch(
        (error) => setMessage(`FeltDB runtime persistence failed: ${String(error)}`),
      )
      lastRuntimeEvent.current = newest.ts
      if (!autoInvestigate) return
      const request = requestsRef.current.filter((item) => item.startedAt <= newest.ts).at(-1) ?? {
        id: `runtime:${newest.ts}`, startedAt: newest.ts, endedAt: newest.ts, method: 'RUNTIME',
        url: newest.source ?? 'runtime://inspected-page', status: 0, statusText: 'Runtime error',
        requestHeaders: {}, responseHeaders: {}, initiator: { source: newest.source, line: newest.line },
      }
      if (request.status < 400) void investigateRequest(request, true)
    }), 2000)
    return () => window.clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInvestigate])

  function mutateHistory(mutator: (records: InvestigationRecord[]) => InvestigationRecord[]): void {
    const next = updateHistory(mutator(historyRef.current))
    historyRef.current = next
    setHistory(next)
  }

  async function copyDetails(): Promise<string> {
    if (!investigation) return 'No investigation is selected.'
    const result = await writeClipboard(reportFor(investigation, exportFormat)) ? `Copied ${exportFormat} report.` : 'Could not copy report.'
    setMessage(result)
    return result
  }

  function exportDetails(): string {
    if (!investigation) return 'No investigation is selected.'
    const extension = exportFormat === 'json' ? 'json' : exportFormat === 'markdown' ? 'md' : 'txt'
    download(`runtime-investigation-${investigation.id}.${extension}`, reportFor(investigation, exportFormat), exportFormat === 'json' ? 'application/json' : 'text/plain')
    const result = `Downloaded ${exportFormat} report.`
    setMessage(result)
    return result
  }

  function updatePrivacy(next: PrivacySettings): void {
    setPrivacy(next)
    privacyRef.current = next
    savePrivacy(next)
  }

  async function enhanceCurrent(): Promise<void> {
    if (!investigation) return
    setAiLoading(true)
    setAiStatus('Preparing bounded evidence graph…')
    try {
      const enhanced = await enhanceWithLocalAi(investigation, aiModel)
      const updated = { ...investigation, result: enhanced.result, localAi: { model: aiModel, findingId: enhanced.findingId, generatedAt: Date.now() } }
      setInvestigation(updated)
      mutateHistory((records) => records.map((record) => record.id === updated.id ? updated : record))
      setAiStatus(`Local diagnosis complete · provenance ${enhanced.findingId}`)
    } catch (error) {
      const text = String(error)
      if (text.includes('Close and reopen DevTools')) setContextValid(false)
      setAiStatus(`Local AI failed: ${text}`)
    } finally {
      setAiLoading(false)
    }
  }

  async function askCurrent(): Promise<void> {
    if (!investigation || !aiQuestion.trim()) return
    setAiLoading(true)
    setAiAnswer('')
    setAiStatus('Querying the bounded evidence graph…')
    try {
      setAiAnswer(await askLocalInvestigator(investigation, aiQuestion.trim(), aiModel))
      setAiStatus('Answer complete and provenance saved.')
    } catch (error) {
      const text = String(error)
      if (text.includes('Close and reopen DevTools')) setContextValid(false)
      setAiStatus(`Local AI failed: ${text}`)
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="app">
      <main className="card">
        <header className="panel-header">
          <div><h1>Investigate</h1><p className="meta">Live evidence · FeltDB {storageStatus} · 24-hour automatic retention{lastCleanup ? ` · cleaned ${new Date(lastCleanup).toLocaleTimeString()}` : ''} · sensitive values redacted locally</p></div>
          <div className="header-actions">
            <label className="toggle"><input type="checkbox" checked={autoInvestigate} onChange={(event) => setAutoInvestigate(event.target.checked)} /> Auto-investigate</label>
            <button onClick={() => setShowPrivacy((value) => !value)}>Privacy</button>
          </div>
        </header>

        {!hasChromeDevtools() && <p className="badge warn">Open this page inside the Chrome DevTools Investigate panel.</p>}
        {!contextValid && <div className="context-invalid"><strong>Extension was reloaded.</strong> This DevTools panel is stale, so its buttons cannot contact the extension. Close DevTools completely and reopen it.</div>}

        {showPrivacy && <section className="settings">
          <h3>Privacy and bundle settings</h3>
          <label>Additional sensitive fields<input value={privacy.sensitiveKeys.join(', ')} onChange={(event) => updatePrivacy({ ...privacy, sensitiveKeys: event.target.value.split(',').map((key) => key.trim()).filter(Boolean) })} placeholder="accountId, secret" /></label>
          <label><input type="checkbox" checked={privacy.includeHeaders} onChange={(event) => updatePrivacy({ ...privacy, includeHeaders: event.target.checked })} /> Include redacted headers</label>
          <label><input type="checkbox" checked={privacy.includeBodies} onChange={(event) => updatePrivacy({ ...privacy, includeBodies: event.target.checked })} /> Include redacted bodies</label>
          <label><input type="checkbox" checked={includeScreenshot} onChange={(event) => setIncludeScreenshot(event.target.checked)} /> Include page screenshot when Chrome permits it</label>
          <label>Redaction preview<input value={redactionPreview} onChange={(event) => setRedactionPreview(event.target.value)} placeholder={'{"accountId":"secret"}'} /><pre>{redactText(redactionPreview, privacy.sensitiveKeys).redacted || 'Enter sample text to preview redaction.'}</pre></label>
        </section>}

        <section className="filters" aria-label="Request filters">
          <input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Search requests" />
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="all">All statuses</option><option value="errors">Errors only</option><option value="4xx">4xx</option><option value="5xx">5xx</option></select>
          <select value={filters.domain} onChange={(event) => setFilters({ ...filters, domain: event.target.value })}><option value="all">All domains</option>{domains.map((domain) => <option key={domain}>{domain}</option>)}</select>
          <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="all">All types</option>{types.map((type) => <option key={type}>{type}</option>)}</select>
          <select value={filters.timeframe} onChange={(event) => setFilters({ ...filters, timeframe: event.target.value })}><option value="all">All time</option><option value="1m">Last minute</option><option value="5m">Last 5 minutes</option></select>
          <button onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>
        </section>

        <div className="controls">
          <select className="request-select" value={selectedRequestId} onChange={(event) => setSelectedRequestId(event.target.value)} disabled={!filteredRequests.length}>
            <option value="">Select a request ({filteredRequests.length})</option>
            {filteredRequests.map((request) => <option key={request.id} value={request.id}>{formatRequest(request)}</option>)}
          </select>
          <button onClick={() => void captureRequests(MAX_LIVE_REQUESTS).then(addRequests)} disabled={loading}>Refresh</button>
          <button className="primary" onClick={() => selectedRequest && void investigateRequest(selectedRequest)} disabled={loading || !selectedRequest}>Investigate</button>
        </div>
        <p className="status" aria-live="polite">{message}</p>

        {investigation ? <InvestigationDetails record={investigation} exportFormat={exportFormat} setExportFormat={setExportFormat} copyDetails={copyDetails} exportDetails={exportDetails} reinvestigate={() => {
          const request = requestsRef.current.find((item) => item.id === investigation.requestId)
          if (!request) return 'The original request has expired from live memory. Select a current request above to investigate it again.'
          void investigateRequest(request)
          return 'Investigation started with current browser evidence.'
        }} runAction={(action) => {
          if (action === 'compare') return investigation.graph.comparison?.semanticDiff?.length ? investigation.graph.comparison.semanticDiff.join('\n') : 'No comparable successful request was captured for this endpoint.'
          if (action === 'source') {
            const source = investigation.graph.initiator?.source
            if (!source) return 'No source location was captured for this request.'
            openSourceLocation(source, investigation.graph.initiator?.line)
            return `Opened ${source}${investigation.graph.initiator?.line ? `:${investigation.graph.initiator.line}` : ''} in Sources.`
          }
          return investigation.graph.trace.length ? investigation.graph.trace.map((step, index) => `${index + 1}. ${step.label}${step.source ? ` — ${step.source}:${step.line ?? 1}` : ''}`).join('\n') : 'No trace steps were captured.'
        }} contextValid={contextValid} aiModel={aiModel} setAiModel={setAiModel} aiStatus={aiStatus} aiLoading={aiLoading} aiQuestion={aiQuestion} setAiQuestion={setAiQuestion} aiAnswer={aiAnswer} enhanceCurrent={enhanceCurrent} askCurrent={askCurrent} /> : <p className="empty">Waiting for a failed request or runtime error. You can also select any request manually.</p>}
      </main>

      <aside className="card history">
        <h2>Issue groups <span className="count">{history.length}</span></h2>
        <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Search history" />
        {visibleHistory.length === 0 ? <p className="meta">No saved investigations yet.</p> : <ul className="history-list">
          {visibleHistory.map((item) => <li key={item.id} className={item.id === investigation?.id ? 'active' : ''}>
            <button className="history-title" onClick={() => setInvestigation(item)}>{item.pinned ? '📌 ' : ''}{item.name ?? item.result.diagnosis}</button>
            <div className="meta">{item.occurrenceCount ?? 1} occurrence(s) · first {new Date(item.firstSeenAt ?? item.createdAt).toLocaleString()} · last {new Date(item.lastSeenAt ?? item.createdAt).toLocaleString()}</div>
            <div className="mini-actions">
              <button onClick={() => mutateHistory((records) => records.map((record) => record.id === item.id ? { ...record, pinned: !record.pinned } : record))}>{item.pinned ? 'Unpin' : 'Pin'}</button>
              <button onClick={() => { const name = prompt('Investigation name', item.name ?? ''); if (name !== null) mutateHistory((records) => records.map((record) => record.id === item.id ? { ...record, name: name.trim() || undefined } : record)) }}>Rename</button>
              <button onClick={() => download(`runtime-investigation-${item.id}.json`, formatJsonReport(item), 'application/json')}>JSON</button>
              <button onClick={() => { if (confirm('Delete this investigation group?')) { mutateHistory((records) => records.filter((record) => record.id !== item.id)); if (investigation?.id === item.id) setInvestigation(null) } }}>Delete</button>
            </div>
          </li>)}
        </ul>}
      </aside>
    </div>
  )
}

function InvestigationDetails({ record, exportFormat, setExportFormat, copyDetails, exportDetails, reinvestigate, runAction, contextValid, aiModel, setAiModel, aiStatus, aiLoading, aiQuestion, setAiQuestion, aiAnswer, enhanceCurrent, askCurrent }: {
  record: InvestigationRecord; exportFormat: ExportFormat; setExportFormat: (format: ExportFormat) => void
  copyDetails: () => Promise<string>; exportDetails: () => string; reinvestigate: () => string
  runAction: (action: 'compare' | 'source' | 'trace') => string; contextValid: boolean
  aiModel: string; setAiModel: (model: string) => void; aiStatus: string; aiLoading: boolean
  aiQuestion: string; setAiQuestion: (question: string) => void; aiAnswer: string
  enhanceCurrent: () => void; askCurrent: () => void
}) {
  const { graph, result } = record
  const [actionResult, setActionResult] = useState('')
  return <section className="result">
    <div className="result-heading"><div><h2>⚠ Likely cause</h2><p>{result.diagnosis}</p></div><div className="confidence">{Math.round(result.confidence * 100)}%<span>confidence</span></div></div>
    <div className="badges"><span className="badge">{graph.request.status} {graph.request.method}</span>{graph.redactionApplied && <span className="badge">Sensitive data redacted</span>}<span className="badge">{record.occurrenceCount ?? 1} occurrence(s)</span></div>
    <p className="request-url">{graph.request.url}</p>

    <h3>Evidence</h3><ul className="list">{result.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
    {!!graph.anomalies.length && <><h3>Potential anomalies</h3><ul className="list">{graph.anomalies.map((item) => <li key={item}>{item}</li>)}</ul></>}
    {!!graph.comparison?.semanticDiff?.length && <><h3>Compared with successful request</h3><ul className="list">{graph.comparison.semanticDiff.map((item) => <li key={item}>{item}</li>)}</ul></>}
    <h3>Trace and source lines</h3><div className="trace">{graph.trace.map((step, index) => <div className="trace-item" key={`${step.label}:${index}`}><div><span className="step-number">{index + 1}</span>{step.label}</div>{step.source && <button className="source-link" onClick={() => openSourceLocation(step.source!, step.line)}>{step.source}{step.line ? `:${step.line}` : ''}</button>}</div>)}</div>

    <EvidenceGraphView investigationId={record.id} />

    {graph.bundle && <details><summary>Evidence bundle</summary><div className="bundle-grid">
      <Bundle title="Request headers" value={graph.bundle.requestHeaders} />
      <Bundle title="Response headers" value={graph.bundle.responseHeaders} />
      <Bundle title="Request body" value={graph.bundle.requestBody} />
      <Bundle title="Response body" value={graph.bundle.responseBody} />
      <Bundle title="Runtime events and stacks" value={graph.bundle.runtimeEvents} />
      <Bundle title="Environment" value={graph.bundle.environment} />
      <Bundle title="Reproduction steps" value={graph.bundle.reproductionSteps} />
    </div>{graph.bundle.screenshot && <><img className="screenshot" src={graph.bundle.screenshot} alt="Captured inspected page" /><button onClick={() => downloadDataUrl(`runtime-investigation-${record.id}.png`, graph.bundle!.screenshot!)}>Save screenshot</button></>}</details>}

    <h3>Investigation actions</h3><div className="actions"><button onClick={() => setActionResult(runAction('compare'))}>Compare successful request</button><button onClick={() => setActionResult(runAction('source'))}>Show source</button><button onClick={() => setActionResult(runAction('trace'))}>Trace request</button><button onClick={() => setActionResult(reinvestigate())}>Investigate again</button></div>
    {actionResult && <pre className="action-result">{actionResult}</pre>}
    {!!result.nextActions.length && <><h3>Recommended follow-ups</h3><ul className="list">{result.nextActions.map((item) => <li key={item}>{item}</li>)}</ul></>}
    <section className="local-ai">
      <div className="local-ai-heading"><div><h3>Private local investigator</h3><p className="meta">WebLLM receives only a bounded redacted graph. The first run downloads the selected model.</p></div><select value={aiModel} onChange={(event) => setAiModel(event.target.value)} disabled={aiLoading}><option value={LOCAL_MODELS.smallest}>SmolLM2 360M · ~580 MB VRAM</option><option value={LOCAL_MODELS.balanced}>SmolLM2 1.7B · stronger</option></select></div>
      {!isLocalAiAvailable() ? <p className="badge warn">WebGPU is unavailable. Deterministic diagnosis remains active.</p> : <div className="actions"><button className="primary" onClick={enhanceCurrent} disabled={aiLoading || !contextValid}>Enhance diagnosis locally</button>{aiLoading && <button onClick={interruptLocalAi}>Stop</button>}</div>}
      <p className="status">{aiStatus}</p>
      <div className="ask-row"><input value={aiQuestion} onChange={(event) => setAiQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') askCurrent() }} placeholder="Ask about this evidence graph" disabled={aiLoading || !isLocalAiAvailable() || !contextValid} /><button onClick={askCurrent} disabled={aiLoading || !aiQuestion.trim() || !isLocalAiAvailable() || !contextValid}>Ask</button></div>
      {aiAnswer && <pre className="ai-answer">{aiAnswer}</pre>}
    </section>
    <div className="actions"><select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}><option value="text">Plain text</option><option value="markdown">Markdown / GitHub</option><option value="jira">Jira</option><option value="json">JSON</option></select><button className="primary" onClick={() => void copyDetails().then(setActionResult)}>Copy all details</button><button onClick={() => setActionResult(exportDetails())}>Download report</button></div>
  </section>
}

function EvidenceGraphView({ investigationId }: { investigationId: string }) {
  const [neighborhood, setNeighborhood] = useState<EvidenceNeighborhood | null>(null)
  useEffect(() => {
    let active = true
    const unsubscribe = feltRepository.subscribeNeighborhood(investigationId, (value) => { if (active) setNeighborhood(value) })
    return () => { active = false; unsubscribe() }
  }, [investigationId])
  if (!neighborhood?.nodes.length) return null
  const width = 680
  const height = 300
  const positions = new Map(neighborhood.nodes.map((node, index) => {
    const angle = (index / neighborhood.nodes.length) * Math.PI * 2 - Math.PI / 2
    const radius = node.id === neighborhood.rootId ? 0 : Math.min(width, height) * 0.36
    return [node.id, { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius }]
  }))
  return <details className="graph-details"><summary>Evidence graph · {neighborhood.nodes.length} nodes · {neighborhood.edges.length} edges</summary>
    <svg className="evidence-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Causal evidence graph">
      {neighborhood.edges.map((edge) => { const from = positions.get(edge.from); const to = positions.get(edge.to); return from && to ? <g key={edge.id}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2}>{edge.kind}</text></g> : null })}
      {neighborhood.nodes.map((node) => { const point = positions.get(node.id)!; return <g key={node.id} transform={`translate(${point.x} ${point.y})`}><circle r={node.id === neighborhood.rootId ? 28 : 21} className={`node-${node.kind}`} /><text y="4" textAnchor="middle">{node.kind.slice(0, 8)}</text><title>{node.label}</title></g> })}
    </svg>
    {neighborhood.truncated && <p className="meta">Graph was bounded to protect responsiveness and model context.</p>}
    <table className="edge-table"><thead><tr><th>Relationship</th><th>Evidence</th><th>Confidence</th></tr></thead><tbody>{neighborhood.edges.map((edge) => <tr key={edge.id}><td>{edge.kind}</td><td>{edge.evidence.join(', ')}</td><td>{Math.round(edge.confidence * 100)}%</td></tr>)}</tbody></table>
  </details>
}

function Bundle({ title, value }: { title: string; value: unknown }) {
  if (value == null || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) return null
  return <div><h4>{title}</h4><pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></div>
}
