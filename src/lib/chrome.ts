import type { ConsoleEvent, NetworkRequestSnapshot } from './types'

type ChromeRequest = {
  request: {
    method: string
    url: string
    headers?: Array<{ name: string; value?: string }>
    postData?: { text?: string }
  }
  response: {
    status: number
    statusText: string
    headers?: Array<{ name: string; value?: string }>
    content?: { mimeType?: string }
    timing?: { receiveHeadersEnd?: number }
  }
  startedDateTime: string
  time?: number
  initiator?: { stack?: { callFrames?: Array<{ url?: string; lineNumber?: number; functionName?: string }> } }
  getContent: (callback: (content: string, encoding: string) => void) => void
}

function headersToMap(headers: Array<{ name: string; value?: string }> | undefined): Record<string, string> {
  return (headers ?? []).reduce<Record<string, string>>((acc, header) => {
    acc[header.name] = header.value ?? ''
    return acc
  }, {})
}

export function hasChromeDevtools(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.devtools?.network
}

export async function captureRequests(limit = 200): Promise<NetworkRequestSnapshot[]> {
  if (!hasChromeDevtools()) {
    return []
  }

  return new Promise((resolve) => {
    chrome.devtools.network.getHAR(async (harLog) => {
      const entries = harLog.entries.slice(-limit)
      const output = await Promise.all(
        entries.map(
          (entry) =>
            new Promise<NetworkRequestSnapshot>((entryResolve) => {
              const startedAt = new Date(entry.startedDateTime).getTime()
              const requestRef = entry as unknown as ChromeRequest

              requestRef.getContent((content) => {
                const frame = requestRef.initiator?.stack?.callFrames?.[0]

                entryResolve({
                  id: `${entry.request.method}:${entry.request.url}:${startedAt}`,
                  startedAt,
                  endedAt: startedAt + Math.round(entry.time),
                  method: entry.request.method,
                  url: entry.request.url,
                  status: entry.response.status,
                  statusText: entry.response.statusText,
                  requestHeaders: headersToMap(entry.request.headers),
                  responseHeaders: headersToMap(entry.response.headers),
                  requestBody: entry.request.postData?.text,
                  responseBody: content,
                  initiator: {
                    source: frame?.url,
                    line: typeof frame?.lineNumber === 'number' ? frame.lineNumber + 1 : undefined,
                    functionName: frame?.functionName,
                  },
                  timingMs: entry.time,
                })
              })
            }),
        ),
      )

      resolve(output)
    })
  })
}

export async function captureConsoleEvents(limit = 50): Promise<ConsoleEvent[]> {
  if (!hasChromeDevtools()) {
    return []
  }

  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(
      `(() => {
        const logs = window.__runtimeInvestigatorConsoleBuffer || [];
        return logs.slice(-${limit});
      })()`,
      (result) => {
        if (chrome.runtime.lastError) {
          resolve([])
          return
        }

        const normalized = Array.isArray(result)
          ? result.map((event) => ({
              type: 'runtime.error' as const,
              message: String(event.message ?? 'Runtime error'),
              source: event.source ? String(event.source) : undefined,
              line: typeof event.line === 'number' ? event.line : undefined,
              stack: event.stack ? String(event.stack) : undefined,
              ts: typeof event.ts === 'number' ? event.ts : Date.now(),
            }))
          : []

        resolve(normalized)
      },
    )
  })
}

export function primeConsoleCapture(): void {
  if (!hasChromeDevtools()) return

  chrome.devtools.inspectedWindow.eval(`
    (() => {
      if (window.__runtimeInvestigatorPatched) return;
      window.__runtimeInvestigatorPatched = true;
      window.__runtimeInvestigatorConsoleBuffer = window.__runtimeInvestigatorConsoleBuffer || [];
      const push = (entry) => {
        window.__runtimeInvestigatorConsoleBuffer.push(entry);
        if (window.__runtimeInvestigatorConsoleBuffer.length > 300) {
          window.__runtimeInvestigatorConsoleBuffer = window.__runtimeInvestigatorConsoleBuffer.slice(-300);
        }
      };
      const originalError = console.error.bind(console);
      console.error = (...args) => {
        push({ message: args.map(String).join(' '), ts: Date.now(), source: 'console.error' });
        originalError(...args);
      };
      window.addEventListener('error', (event) => {
        push({
          message: event.message,
          source: event.filename,
          line: event.lineno,
          stack: event.error?.stack,
          ts: Date.now(),
        });
      }, true);
    })();
  `)
}
