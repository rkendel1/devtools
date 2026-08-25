(() => {
  if (window.__runtimeInvestigatorCaptureInstalled) return
  window.__runtimeInvestigatorCaptureInstalled = true
  const emit = (payload) => window.dispatchEvent(new CustomEvent('runtime-investigator:event', { detail: JSON.stringify(payload) }))
  const originalError = console.error.bind(console)
  console.error = (...args) => {
    emit({ type: 'console.error', message: args.map(String).join(' '), source: location.href, ts: Date.now() })
    originalError(...args)
  }
  addEventListener('error', (event) => emit({
    type: 'runtime.error', message: event.message, source: event.filename, line: event.lineno,
    stack: event.error?.stack, ts: Date.now(),
  }), true)
  addEventListener('unhandledrejection', (event) => emit({
    type: 'runtime.error', message: `Unhandled rejection: ${String(event.reason?.message ?? event.reason)}`,
    source: location.href, stack: event.reason?.stack, ts: Date.now(),
  }), true)
})()
