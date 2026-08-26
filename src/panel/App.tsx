import { useEffect, useMemo, useRef, useState } from 'react'
import {
  captureConsoleEvents, captureEnvironment, captureRequests, endpointKey,
  hasChromeDevtools, openSourceLocation, pingExtensionContext, subscribeToRequests,
} from '../lib/chrome'
import { buildEvidenceGraph } from '../lib/evidenceEngine'
import { reasonFromEvidence } from '../lib/reasoner'
import { redactText } from '../lib/redaction'
import { formatJsonReport } from '../lib/report'
import { durableRuntime, initializeDurableStore, loadHistory, loadPrivacy, savePrivacy, subscribeDurableHistory, updateHistory } from '../lib/store'
import { askLocalInvestigator, enhanceWithLocalAi, LOCAL_MODELS } from '../lib/localAi'
import { feltRepository } from '../lib/feltRepository'
import { MAX_LIVE_REQUESTS } from '../lib/retention'
import type { InvestigationRecord, NetworkRequestSnapshot, PrivacySettings } from '../lib/types'
import { download, formatRequest, reportFor, writeClipboard } from './utils/export'
import { useMaintenance } from './hooks/useMaintenance'
import { useScreenshots } from './hooks/useScreenshots'
import { ScreenshotGallery } from './components/ScreenshotGallery'
import { InvestigationDetails } from './components/InvestigationDetails'
import { WorkspaceConnection } from './components/WorkspaceConnection'

type ExportFormat = 'text' | 'markdown' | 'jira' | 'json'
type Filters = { query: string; status: string; domain: string; type: string; timeframe: string }

const EMPTY_FILTERS: Filters = { query: '', status: 'all', domain: 'all', type: 'all', timeframe: 'all' }

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
  const [workspaceConnected, setWorkspaceConnected] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [workspaceError, setWorkspaceError] = useState<string>('')
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const lastRuntimeEvent = useRef(0)

  const { screenshots, setScreenshots, recordingScreens, setRecordingScreens, captureFrame, copyScreenshot } = useScreenshots(setMessage)

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

  useMaintenance(requestsRef, setRequests, setSelectedRequestId, setLastCleanup, setMessage)

  useEffect(() => {
    const listener = (progress: { type?: string; target?: string; progress?: number; text?: string }) => {
      if (progress.type === 'runtime-investigator:ai-progress' && progress.target === 'panel') {
        setAiStatus(`${Math.round((progress.progress ?? 0) * 100)}% ${progress.text ?? 'Loading local model'}`)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const handleWorkspaceConnect = async (pairingCode: string) => {
    setWorkspaceLoading(true)
    setWorkspaceError('')

    try {
      // Send bootstrap message to extension background script
      const response = await chrome.runtime.sendMessage({
        type: 'feltdb:test-bootstrap',
        pairingCode,
      })

      if (response?.ok) {
        setWorkspaceConnected(true)
        setWorkspaceId(response.workspaceId || '')
        setMessage(`Connected to workspace: ${response.workspaceId}`)
      } else {
        throw new Error(response?.error || 'Failed to connect to workspace')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to connect to workspace'
      setWorkspaceError(errorMessage)
      setMessage(`Workspace connection failed: ${errorMessage}`)
      throw error
    } finally {
      setWorkspaceLoading(false)
    }
  }

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
      const [events, environment] = await Promise.all([captureConsoleEvents(500), captureEnvironment()])
      const peer = [...requestsRef.current].reverse().find((candidate) =>
        endpointKey(candidate) === endpointKey(request) && candidate.status < 400 && candidate.id !== request.id,
      )
      const graph = buildEvidenceGraph(request, peer, requestsRef.current, events, privacyRef.current, environment)
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
      if (workspaceConnected) {
        void chrome.runtime.sendMessage({ type: 'runtime-investigator:observe', investigation: record }).catch(() => undefined)
      }
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

  async function sendToIde(record: InvestigationRecord): Promise<{ entityId: string; workspaceId: string }> {
    const response = await chrome.runtime.sendMessage({
      type: 'runtime-investigator:send-to-ide',
      investigation: record,
    })
    if (!response?.ok) throw new Error(response?.error || 'Failed to send investigation to IDE')
    setMessage(`Sent investigation to IDE · ${response.entityId}`)
    return { entityId: response.entityId, workspaceId: response.workspaceId }
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

        <WorkspaceConnection
          onConnect={handleWorkspaceConnect}
          isConnected={workspaceConnected}
          workspaceId={workspaceId}
          error={workspaceError}
          loading={workspaceLoading}
        />

        {showPrivacy && <section className="settings">
          <h3>Privacy and bundle settings</h3>
          <label>Additional sensitive fields<input value={privacy.sensitiveKeys.join(', ')} onChange={(event) => updatePrivacy({ ...privacy, sensitiveKeys: event.target.value.split(',').map((key) => key.trim()).filter(Boolean) })} placeholder="accountId, secret" /></label>
          <label><input type="checkbox" checked={privacy.includeHeaders} onChange={(event) => updatePrivacy({ ...privacy, includeHeaders: event.target.checked })} /> Include redacted headers</label>
          <label><input type="checkbox" checked={privacy.includeBodies} onChange={(event) => updatePrivacy({ ...privacy, includeBodies: event.target.checked })} /> Include redacted bodies</label>
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

        <ScreenshotGallery
          frames={screenshots}
          recording={recordingScreens}
          capture={() => void captureFrame()}
          toggleRecording={() => setRecordingScreens((value) => !value)}
          copy={(frame) => void copyScreenshot(frame)}
          remove={(id) => setScreenshots((current) => current.filter((frame) => frame.id !== id))}
          clear={() => { setRecordingScreens(false); setScreenshots([]); setMessage('In-memory screenshots cleared.') }}
        />

        {investigation ? <InvestigationDetails key={investigation.id} record={investigation} workspaceConnected={workspaceConnected} sendToIde={sendToIde} exportFormat={exportFormat} setExportFormat={setExportFormat} copyDetails={copyDetails} exportDetails={exportDetails} reinvestigate={() => {
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
