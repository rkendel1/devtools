let wasm: { normalize_json: (input: string) => string; normalize_evidence: (input: string) => string } | null = null
let loadAttempted = false

async function loadWasm(): Promise<void> {
  if (loadAttempted || wasm) return
  loadAttempted = true
  try {
    // @ts-ignore - vite alias resolves at build time to wasm-engine/pkg
    const mod = await import('runtime_investigator_wasm')
    await (mod as unknown as { default?: () => Promise<void> }).default?.()
    wasm = mod as unknown as typeof wasm
  } catch {
    wasm = null
  }
}

// Fire-and-forget preload; synchronous fallback is used until ready.
void loadWasm()

export function normalizeJsonDeterministic(input: string): string {
  if (wasm?.normalize_json) {
    try {
      return wasm.normalize_json(input)
    } catch {
      // fall through to JS
    }
  }
  try {
    const parsed = JSON.parse(input)
    return stableStringify(parsed)
  } catch {
    return input
  }
}

export function normalizeEvidenceDeterministic(payload: unknown): string {
  const raw = JSON.stringify(payload)
  if (wasm?.normalize_evidence) {
    try {
      return wasm.normalize_evidence(raw)
    } catch {
      // fall through
    }
  }
  try {
    return JSON.stringify(JSON.parse(raw), Object.keys(JSON.parse(raw)).sort())
  } catch {
    return raw
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export function isWasmReady(): boolean {
  return wasm !== null
}
