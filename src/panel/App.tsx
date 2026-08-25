import { useMemo, useState } from 'react'
import { captureConsoleEvents, captureRequests, hasChromeDevtools, primeConsoleCapture } from '../lib/chrome'
import { buildEvidenceGraph } from '../lib/evidenceEngine'
import { reasonFromEvidence } from '../lib/reasoner'
import { formatInvestigationReport } from '../lib/report'
import { appendHistory, loadHistory } from '../lib/store'
import type { InvestigationRecord, NetworkRequestSnapshot } from '../lib/types'

function formatReq(request: NetworkRequestSnapshot): string {
  const url = request.url.length > 90 ? `${request.url.slice(0, 90)}…` : request.url
  return `${request.status} ${request.method} ${url}`
}

function prettyPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export default function App() {
  const [requests, setRequests] = useState<NetworkRequestSnapshot[]>([])
  const [selectedRequestId, setSelectedRequestId] = useState<string>('')
  const [investigation, setInvestigation] = useState<InvestigationRecord | null>(null)
  const [history, setHistory] = useState<InvestigationRecord[]>(() => loadHistory())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string>('Ready')

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) ?? null,
    [requests, selectedRequestId],
  )

  const canUseDevtools = hasChromeDevtools()

  async function refreshRequests() {
    setLoading(true)
    try {
      const captured = await captureRequests(300)
      setRequests(captured)

      if (!selectedRequestId && captured.length > 0) {
        const fallback = captured.find((request) => request.status >= 400) ?? captured[captured.length - 1]
        setSelectedRequestId(fallback.id)
      }

      setMessage(`Loaded ${captured.length} request(s).`)
    } catch (error) {
      setMessage(`Failed to load requests: ${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function runInvestigation() {
    if (!selectedRequest) {
      setMessage('Select a request first.')
      return
    }

    setLoading(true)
    try {
      primeConsoleCapture()
      const consoleEvents = await captureConsoleEvents(120)
      const successfulPeer = [...requests]
        .reverse()
        .find((candidate) => candidate.url === selectedRequest.url && candidate.status < 400 && candidate.id !== selectedRequest.id)

      const graph = buildEvidenceGraph(selectedRequest, successfulPeer, requests, consoleEvents)
      const result = reasonFromEvidence(graph)

      const record: InvestigationRecord = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        requestId: selectedRequest.id,
        requestUrl: selectedRequest.url,
        graph,
        result,
      }

      setInvestigation(record)
      setHistory(appendHistory(record))
      setMessage('Investigation complete.')
    } catch (error) {
      setMessage(`Investigation failed: ${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  function openSource() {
    const source = investigation?.graph.initiator?.source
    const line = investigation?.graph.initiator?.line
    if (!source) {
      setMessage('No source location available for this request.')
      return
    }

    chrome.devtools.inspectedWindow.eval(`window.open(${JSON.stringify(source)}, '_blank')`)
    setMessage(`Opened source ${source}${line ? `:${line}` : ''}`)
  }

  function compareView() {
    if (!investigation?.graph.comparison?.semanticDiff?.length) {
      setMessage('No semantic diff found for this request.')
      return
    }
    setMessage(`Most significant difference: ${investigation.graph.comparison.semanticDiff[0]}`)
  }

  function traceView() {
    if (!investigation?.graph.trace?.length) {
      setMessage('No trace available.')
      return
    }
    setMessage(`Trace has ${investigation.graph.trace.length} step(s).`)
  }

  async function copyDetails() {
    if (!investigation) {
      setMessage('Run an investigation first.')
      return
    }

    const report = formatInvestigationReport(investigation)
    try {
      await navigator.clipboard.writeText(report)
      setMessage('Investigation details copied to clipboard.')
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = report
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand('copy')
      textarea.remove()
      setMessage(copied ? 'Investigation details copied to clipboard.' : 'Could not copy details.')
    }
  }

  return (
    <div className="app">
      <div className="card">
        <h1>Investigate</h1>
        <p className="meta">Select request → Investigate → causal explanation from browser evidence.</p>

        {!canUseDevtools && (
          <p className="badge warn">Open this page inside Chrome DevTools panel to access network and runtime evidence.</p>
        )}

        <div className="controls">
          <button onClick={refreshRequests} disabled={loading}>
            Refresh requests
          </button>

          <select
            value={selectedRequestId}
            onChange={(event) => setSelectedRequestId(event.target.value)}
            disabled={loading || requests.length === 0}
          >
            <option value="">Selected request</option>
            {requests.map((request) => (
              <option key={request.id} value={request.id}>
                {formatReq(request)}
              </option>
            ))}
          </select>

          <button className="primary" onClick={runInvestigation} disabled={loading || !selectedRequest}>
            Investigate
          </button>
        </div>

        <p className="small">{message}</p>

        {investigation ? (
          <div>
            <h2>⚠ Likely cause</h2>
            <p>{investigation.result.diagnosis}</p>
            <p>
              Confidence <strong>{prettyPercent(investigation.result.confidence)}</strong>
            </p>
            {investigation.graph.redactionApplied && <p className="badge">Sensitive data detected and redacted</p>}

            <h3>Evidence</h3>
            <ul className="list">
              {investigation.result.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            {investigation.graph.anomalies.length > 0 && (
              <>
                <h3>Potential anomalies</h3>
                <ul className="list">
                  {investigation.graph.anomalies.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            )}

            <h3>Trace</h3>
            <div className="trace">
              {investigation.graph.trace.map((step, index) => (
                <div className="trace-item" key={`${step.label}:${index}`}>
                  <div>{step.label}</div>
                  {(step.source || step.line) && (
                    <div className="meta">
                      {step.source ?? 'Unknown source'}
                      {step.line ? `:${step.line}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="actions">
              <button className="primary" onClick={copyDetails}>Copy details</button>
              <button onClick={compareView}>Compare successful request</button>
              <button onClick={openSource}>Show source</button>
              <button onClick={traceView}>Trace request</button>
              <button onClick={runInvestigation}>Investigate further</button>
            </div>
          </div>
        ) : (
          <p>No investigation yet.</p>
        )}
      </div>

      <div className="card">
        <h2>Investigation history</h2>
        {history.length === 0 ? (
          <p className="meta">No saved investigations yet.</p>
        ) : (
          <ul className="list">
            {history.slice(0, 20).map((item) => (
              <li key={item.id}>
                <div>{item.result.diagnosis}</div>
                <div className="meta">{new Date(item.createdAt).toLocaleString()} · {item.requestUrl}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
