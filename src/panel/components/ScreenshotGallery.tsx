import type { ScreenshotFrame } from '../hooks/useScreenshots'
import { MAX_SCREENSHOTS, SCREENSHOT_INTERVAL_MS } from '../hooks/useScreenshots'

export function ScreenshotGallery({ frames, recording, capture, toggleRecording, copy, remove, clear }: {
  frames: ScreenshotFrame[]; recording: boolean; capture: () => void; toggleRecording: () => void
  copy: (frame: ScreenshotFrame) => void; remove: (id: string) => void; clear: () => void
}) {
  const latest = frames.at(-1)
  const downloadDataUrl = (name: string, href: string) => {
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = name
    anchor.click()
  }
  return <section className="screenshot-panel">
    <div className="screenshot-toolbar">
      <div><h3>Screenshots <span className="count">{frames.length}/{MAX_SCREENSHOTS}</span></h3><p className="meta">Memory only · sequence captures every {SCREENSHOT_INTERVAL_MS / 1000} seconds</p></div>
      <div className="actions">
        <button onClick={capture}>Capture screen</button>
        <button className={recording ? 'recording' : ''} onClick={toggleRecording}>{recording ? 'Stop sequence' : 'Start sequence'}</button>
        <button onClick={() => latest && copy(latest)} disabled={!latest}>Copy latest</button>
        <button onClick={clear} disabled={!frames.length}>Clear</button>
      </div>
    </div>
    {!!frames.length && <div className="screenshot-strip">{[...frames].reverse().map((frame) => <article key={frame.id} className="screenshot-card">
      <button className="screenshot-preview" onClick={() => copy(frame)} title="Copy screenshot"><img src={frame.dataUrl} alt={`${frame.label} at ${new Date(frame.capturedAt).toLocaleTimeString()}`} /></button>
      <div className="meta">{new Date(frame.capturedAt).toLocaleTimeString()} · {frame.label}</div>
      <div className="mini-actions"><button onClick={() => copy(frame)}>Copy image</button><button onClick={() => downloadDataUrl(`runtime-screen-${frame.capturedAt}.png`, frame.dataUrl)}>Download</button><button onClick={() => remove(frame.id)}>Delete</button></div>
    </article>)}</div>}
  </section>
}
