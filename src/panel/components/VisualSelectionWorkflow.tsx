import { useEffect, useState } from 'react'
import { DevelopmentRuntime, createChromiumAdapter } from '@feltdb/development-runtime'
import type { VisualSelection } from '../../lib/developmentWorkspace'
import { buildSelectionTask } from '../../lib/visualSelection'
import { SelectionModeUI } from '../devtools/components/SelectionModeUI'

export function VisualSelectionWorkflow({ workspaceConnected, workspaceId, onMessage }: {
  workspaceConnected: boolean
  workspaceId: string
  onMessage: (message: string) => void
}) {
  const [runtime] = useState(() => new DevelopmentRuntime({ browserAdapter: createChromiumAdapter() }))
  const [selection, setSelection] = useState<VisualSelection | null>(null)
  const [instruction, setInstruction] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [result, setResult] = useState('')

  useEffect(() => () => { void runtime.disconnect() }, [runtime])

  const publish = async () => {
    if (!selection || !instruction.trim()) return
    setPublishing(true)
    setResult('')
    try {
      const task = buildSelectionTask(workspaceId, selection.id, instruction.trim())
      const response = await chrome.runtime.sendMessage({ type: 'runtime-investigator:publish-selection-task', selection, task })
      if (!response?.ok) throw new Error(response?.error || 'Failed to publish selection task')
      setResult(`✓ UI task published · ${task.id}`)
      onMessage(`UI change task published · ${task.id}`)
      setInstruction('')
    } catch (error) {
      setResult(`Publish failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setPublishing(false)
    }
  }

  const reset = () => { setSelection(null); setInstruction(''); setResult('') }

  return <section className="visual-selection-workflow">
    {!selection ? <>
      <SelectionModeUI runtime={runtime} workspaceId={workspaceId} onSelectionCaptured={(value) => {
        setSelection(value)
        setResult('')
        onMessage('Element selected · describe the requested change')
      }} />
      {!workspaceConnected && <p className="meta">Connect a workspace before publishing the selected change.</p>}
    </> : <>
      <div className="selected-element-summary">
        <strong>Selected element</strong>
        <code>{selection.selector}</code>
        <span>{selection.textContent || selection.elementRole || 'Element'} · {Math.round(selection.boundingBox.width)}×{Math.round(selection.boundingBox.height)}px</span>
      </div>
      <label className="selection-instruction">
        <span>What should change?</span>
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={3} placeholder="Move this text to the right" autoFocus />
      </label>
      <div className="actions">
        <button className="primary" disabled={!workspaceConnected || !instruction.trim() || publishing} onClick={() => void publish()}>{publishing ? 'Publishing…' : 'Publish UI task'}</button>
        <button onClick={reset} disabled={publishing}>Cancel</button>
      </div>
    </>}
    {result && <p className={result.startsWith('✓') ? 'status' : 'action-result'}>{result}</p>}
  </section>
}
