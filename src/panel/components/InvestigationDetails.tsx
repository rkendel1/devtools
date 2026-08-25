import { useState, useEffect } from 'react'
import { openSourceLocation } from '../../lib/chrome'
import { interruptLocalAi, isLocalAiAvailable, LOCAL_MODELS } from '../../lib/localAi'
import type { InvestigationRecord } from '../../lib/types'
import type { ExportFormat } from '../utils/export'
import { downloadDataUrl } from '../utils/export'
import { EvidenceGraphView } from './EvidenceGraphView'
import { EvidenceInspector } from './EvidenceInspector'
import { TestGenerator } from './TestGenerator'

export function InvestigationDetails({ record, exportFormat, setExportFormat, copyDetails, exportDetails, reinvestigate, runAction, contextValid, aiModel, setAiModel, aiStatus, aiLoading, aiQuestion, setAiQuestion, aiAnswer, enhanceCurrent, askCurrent }: {
  record: InvestigationRecord; exportFormat: ExportFormat; setExportFormat: (format: ExportFormat) => void
  copyDetails: () => Promise<string>; exportDetails: () => string; reinvestigate: () => string
  runAction: (action: 'compare' | 'source' | 'trace') => string; contextValid: boolean
  aiModel: string; setAiModel: (model: string) => void; aiStatus: string; aiLoading: boolean
  aiQuestion: string; setAiQuestion: (question: string) => void; aiAnswer: string
  enhanceCurrent: () => void; askCurrent: () => void
}) {
  const { graph, result } = record
  const [actionResult, setActionResult] = useState('')
  const [showEvidenceInspector, setShowEvidenceInspector] = useState(false)
  return <section className="result">
    <div className="result-heading"><div><h2>⚠ Likely cause</h2><p>{result.diagnosis}</p></div><div className="confidence">{Math.round(result.confidence * 100)}%<span>confidence</span></div></div>
    <div className="badges"><span className="badge">{graph.request.status} {graph.request.method}</span>{graph.redactionApplied && <span className="badge">Sensitive data redacted</span>}<span className="badge">{record.occurrenceCount ?? 1} occurrence(s)</span></div>
    <p className="request-url">{graph.request.url}</p>

    <h3>Evidence</h3><ul className="list">{result.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
    {!!graph.anomalies.length && <><h3>Potential anomalies</h3><ul className="list">{graph.anomalies.map((item) => <li key={item}>{item}</li>)}</ul></>}
    {!!graph.comparison?.semanticDiff?.length && <><h3>Compared with successful request</h3><ul className="list">{graph.comparison.semanticDiff.map((item) => <li key={item}>{item}</li>)}</ul></>}
    <h3>Causal Analysis</h3>
    <div className="actions">
      <button onClick={() => setShowEvidenceInspector(!showEvidenceInspector)} className="primary">
        {showEvidenceInspector ? '▼' : '▶'} Why did this fail? (Interactive)
      </button>
    </div>

    {showEvidenceInspector && <EvidenceInspectorWrapper investigationId={record.id} />}

    <TestGenerator record={record} />

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
