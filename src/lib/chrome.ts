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
    chrome.devtools.network.getHAR(async (harLog: { entries: Array<unknown> }) => {
      const entries = harLog.entries.slice(-limit)
      const output = await Promise.all(
        entries.map(
          (entry: unknown) =>
            new Promise<NetworkRequestSnapshot>((entryResolve) => {
              const requestRef = entry as ChromeRequest
              const startedAt = new Date(requestRef.startedDateTime).getTime()

              requestRef.getContent((content) => {
                const frame = requestRef.initiator?.stack?.callFrames?.[0]

                entryResolve({
                  id: `${requestRef.request.method}:${requestRef.request.url}:${startedAt}`,
                  startedAt,
                  endedAt: startedAt + Math.round(requestRef.time ?? 0),
                  method: requestRef.request.method,
                  url: requestRef.request.url,
                  status: requestRef.response.status,
                  statusText: requestRef.response.statusText,
                  requestHeaders: headersToMap(requestRef.request.headers),
                  responseHeaders: headersToMap(requestRef.response.headers),
                  requestBody: requestRef.request.postData?.text,
                  responseBody: content,
                  initiator: {
                    source: frame?.url,
                    line: typeof frame?.lineNumber === 'number' ? frame.lineNumber + 1 : undefined,
                    functionName: frame?.functionName,
                  },
                  timingMs: requestRef.time,
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
      (result: unknown) => {
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
