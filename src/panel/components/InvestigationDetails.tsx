import { useState, useEffect } from 'react'
import { openSourceLocation } from '../../lib/chrome'
import { interruptLocalAi, isLocalAiAvailable, LOCAL_MODELS } from '../../lib/localAi'
import type { InvestigationRecord } from '../../lib/types'
import type { ExportFormat } from '../utils/export'
import { downloadDataUrl } from '../utils/export'
import { EvidenceGraphView } from './EvidenceGraphView'
import { EvidenceInspector } from './EvidenceInspector'
import { TestGenerator } from './TestGenerator'
import { VerificationPanel } from './VerificationPanel'
import { useReplay } from '../../hooks/useReplay'
import { ReplayPanel } from '../../components/ReplayPanel'
import { createReplayEvidenceNodes } from '../../lib/replayFeltDB'

export function InvestigationDetails({ record, workspaceConnected, sendToIde, queueInFeltSession, exportFormat, setExportFormat, copyDetails, exportDetails, reinvestigate, runAction, contextValid, aiModel, setAiModel, aiStatus, aiLoading, aiQuestion, setAiQuestion, aiAnswer, enhanceCurrent, askCurrent }: {
  record: InvestigationRecord; exportFormat: ExportFormat; setExportFormat: (format: ExportFormat) => void
  workspaceConnected: boolean
  sendToIde: (record: InvestigationRecord) => Promise<{ entityId: string; workspaceId: string }>
  queueInFeltSession: (record: InvestigationRecord) => Promise<{ entityId: string; workspaceId: string; queueRequestId: string }>
  copyDetails: () => Promise<string>; exportDetails: () => string; reinvestigate: () => string
  runAction: (action: 'compare' | 'source' | 'trace') => string; contextValid: boolean
  aiModel: string; setAiModel: (model: string) => void; aiStatus: string; aiLoading: boolean
  aiQuestion: string; setAiQuestion: (question: string) => void; aiAnswer: string
  enhanceCurrent: () => void; askCurrent: () => void
}) {
  const { graph, result } = record
  const [actionResult, setActionResult] = useState('')
  const [showEvidenceInspector, setShowEvidenceInspector] = useState(false)
  const [comparisonInvestigation, setComparisonInvestigation] = useState<InvestigationRecord | null>(null)
  const replay = useReplay()
  const [showReplayButton, setShowReplayButton] = useState(true)
  const [handoffState, setHandoffState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [handoffMessage, setHandoffMessage] = useState('')
  const [feltSessionState, setFeltSessionState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [detailTab, setDetailTab] = useState<'summary' | 'evidence' | 'tools'>('summary')

  const handleSendToIde = async () => {
    setHandoffState('sending')
    setHandoffMessage('')
    try {
      const result = await sendToIde(record)
      setHandoffState('sent')
      setHandoffMessage(`✓ Sent to IDE · ${result.entityId}`)
    } catch (error) {
      setHandoffState('idle')
      setHandoffMessage(`Send failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleQueueInFeltSession = async () => {
    setFeltSessionState('sending')
    setHandoffMessage('')
    try {
      const result = await queueInFeltSession(record)
      setFeltSessionState('sent')
      setHandoffMessage(`✓ Queued in Felt Session · ${result.entityId}`)
    } catch (error) {
      setFeltSessionState('idle')
      setHandoffMessage(`Queue failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleReplay = async () => {
    setShowReplayButton(false)

    const interactions = graph.bundle?.reproductionSteps?.map((step) => ({
      type: 'interaction',
      description: step,
      selector: '#checkout-btn',
    })) || []

    const fixture = replay.createFixture(
      record.id,
      graph.request.url.split('/').pop() || 'unknown',
      graph.request.url,
      graph.request.method,
      graph.bundle?.environment?.pageUrl || 'http://localhost',
      interactions,
      []
    )

    const originalOutcome = {
      targetRequest: {
        method: graph.request.method,
        url: graph.request.url,
      },
      status: graph.request.status,
      statusText: graph.response.statusText,
      responseFingerprint: record.fingerprint || 'fp:unknown',
      errorFingerprints: graph.bundle?.runtimeEvents?.map((e) => `err:${e.message}`) || [],
      errorCount: graph.bundle?.runtimeEvents?.filter((e) => e.type === 'runtime.error').length || 0,
      relevantRuntimeEvents: (graph.bundle?.runtimeEvents || []).map((event) => ({
        type: event.type === 'runtime.error' ? 'runtime.error' as const : 'console.error' as const,
        message: event.message,
        fingerprint: `err:${event.message}`,
      })),
      timing: { requestDuration: 0, totalTime: 0 },
      causalEvidence: [record.id],
    }

    const run = await replay.executeReplay(fixture, originalOutcome)

    if (run) {
      await ReplayResultWrapper({ run, investigationId: record.id })
    }
  }

  return <section className="result">
    <div className="result-heading"><div><h2>⚠ Likely cause</h2><p>{result.diagnosis}</p></div><div className="confidence">{Math.round(result.confidence * 100)}%<span>confidence</span></div></div>
    <div className="badges"><span className="badge">{graph.request.status} {graph.request.method}</span>{graph.redactionApplied && <span className="badge">Sensitive data redacted</span>}<span className="badge">{record.occurrenceCount ?? 1} occurrence(s)</span></div>
    <p className="request-url">{graph.request.url}</p>

    <div className="actions">
      <button className="primary" onClick={() => void handleSendToIde()} disabled={!workspaceConnected || handoffState !== 'idle'}>
        {handoffState === 'sending' ? 'Sending…' : handoffState === 'sent' ? '✓ Sent to IDE' : 'Send to IDE'}
      </button>
      <button className="primary" onClick={() => void handleQueueInFeltSession()} disabled={!workspaceConnected || feltSessionState !== 'idle'}>
        {feltSessionState === 'sending' ? 'Queueing…' : feltSessionState === 'sent' ? '✓ Queued in Felt Session' : 'Queue in Felt Session'}
      </button>
      {!workspaceConnected && <span className="meta">Connect a workspace in Settings to send this issue.</span>}
    </div>
    {handoffMessage && <p className={handoffState === 'sent' ? 'status' : 'action-result'}>{handoffMessage}</p>}

    <nav className="detail-tabs" aria-label="Investigation details">
      {(['summary', 'evidence', 'tools'] as const).map((tab) => <button key={tab} className={detailTab === tab ? 'active' : ''} onClick={() => setDetailTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}
    </nav>

    <div hidden={detailTab !== 'summary'}>
    <h3>Evidence</h3><ul className="list">{result.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
    {!!graph.anomalies.length && <><h3>Potential anomalies</h3><ul className="list">{graph.anomalies.map((item) => <li key={item}>{item}</li>)}</ul></>}
    {!!graph.comparison?.semanticDiff?.length && <><h3>Compared with successful request</h3><ul className="list">{graph.comparison.semanticDiff.map((item) => <li key={item}>{item}</li>)}</ul></>}
    {!!result.nextActions.length && <><h3>Recommended next steps</h3><ul className="list">{result.nextActions.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul></>}
    </div>

    <div hidden={detailTab !== 'tools'}>
    <h3>Causal Analysis</h3>
    <div className="actions">
      {showReplayButton && (
        <button
          onClick={handleReplay}
          className="primary"
          disabled={replay.loading}
        >
          {replay.loading ? '⏳ Replaying...' : '▶ Replay'}
        </button>
      )}
      <button onClick={() => setShowEvidenceInspector(!showEvidenceInspector)} className="primary">
        {showEvidenceInspector ? '▼' : '▶'} Why did this fail? (Interactive)
      </button>
    </div>

    {replay.run && (
      <ReplayPanel
        run={replay.run}
        onInspectEvidence={() => {
          setShowEvidenceInspector(true)
        }}
      />
    )}

    {replay.error && (
      <div className="action-result" style={{ color: '#ef4444', fontWeight: 'bold' }}>
        Replay error: {replay.error}
      </div>
    )}

    {showEvidenceInspector && <EvidenceInspectorWrapper investigationId={record.id} />}

    <TestGenerator record={record} />

    {comparisonInvestigation && <VerificationPanel before={comparisonInvestigation} after={record} />}

    <div className="actions">
      <button onClick={() => setComparisonInvestigation(comparisonInvestigation ? null : record)}>
        {comparisonInvestigation ? '✓' : 'Set as'} Before for Verification
      </button>
    </div>
    </div>

    <div hidden={detailTab !== 'evidence'}>
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
    </div>

    <div hidden={detailTab !== 'tools'}>
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
    </div>
  </section>
}

function Bundle({ title, value }: { title: string; value: unknown }) {
  if (value == null || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) return null
  return <div><h4>{title}</h4><pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></div>
}

function EvidenceInspectorWrapper({ investigationId }: { investigationId: string }) {
  const [neighborhood, setNeighborhood] = useState<unknown>(null)

  useEffect(() => {
    let active = true
    // Lazy load to avoid circular imports
    void import('../../lib/feltRepository').then(({ feltRepository }) => {
      if (active) {
        const unsubscribe = feltRepository.subscribeNeighborhood(investigationId, (value: unknown) => {
          if (active) setNeighborhood(value)
        })
        return () => {
          active = false
          unsubscribe()
        }
      }
    })
    return () => {
      active = false
    }
  }, [investigationId])

  if (!neighborhood) return <p className="meta">Loading evidence chain...</p>
  return <EvidenceInspector neighborhood={neighborhood as any} />
}

async function ReplayResultWrapper({ run, investigationId }: { run: any; investigationId: string }) {
  const { feltRepository } = await import('../../lib/feltRepository')
  const { nodes, edges } = createReplayEvidenceNodes(run)

  for (const node of nodes) {
    feltRepository.addNode(node)
  }

  for (const edge of edges) {
    feltRepository.addEdge(edge)
  }
}
