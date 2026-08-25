import { WebLLMProvider } from '@feltdb/webllm'

let provider: WebLLMProvider | null = null
let activeModel = ''
let activeBackend: 'indexeddb' | 'opfs' = 'indexeddb'
let generationQueue: Promise<void> = Promise.resolve()
let legacyCacheCleaned = false

function reportProgress(model: string, progress: number, text: string): void {
  void chrome.runtime.sendMessage({ type: 'runtime-investigator:ai-progress', target: 'panel', model, progress, text })
}

async function getProvider(model: string, backend: 'indexeddb' | 'opfs' = 'indexeddb'): Promise<WebLLMProvider> {
  if (provider && activeModel === model && activeBackend === backend) {
    reportProgress(model, 1, `Model is already loaded in GPU memory — reusing it (${backend} cache).`)
    return provider
  }
  if (provider) await provider.shutdown().catch(() => undefined)
  if (!legacyCacheCleaned && typeof caches !== 'undefined') {
    legacyCacheCleaned = true
    await Promise.all(['webllm/model', 'webllm/config', 'webllm/wasm'].map((name) => caches.delete(name).catch(() => false)))
  }
  const webllm = await import('@mlc-ai/web-llm')
  const appConfig = { ...webllm.prebuiltAppConfig, cacheBackend: backend }
  try {
    const cached = await webllm.hasModelInCache(model, appConfig)
    reportProgress(model, 0, cached ? `Cached model found in ${backend} — loading it into GPU memory.` : `Model is not in ${backend} — downloading it once for future reuse.`)
  } catch {
    reportProgress(model, 0, `Could not verify ${backend}; loading with persistence enabled.`)
  }
  activeModel = model
  activeBackend = backend
  provider = new WebLLMProvider({
    model,
    appConfig,
    onProgress: (progress) => void chrome.runtime.sendMessage({
      type: 'runtime-investigator:ai-progress', target: 'panel', model, ...progress,
    }),
  })
  return provider
}

async function generateWithFallback(message: { model: string; messages: Parameters<WebLLMProvider['generate']>[0]; options: Parameters<WebLLMProvider['generate']>[1] }): Promise<string> {
  try {
    return await (await getProvider(message.model, 'indexeddb')).generate(message.messages, message.options)
  } catch (error) {
    const text = String(error)
    if (!/cache|indexeddb|networkerror|failed to execute 'add'/i.test(text)) throw error
    reportProgress(message.model, 0, 'IndexedDB model cache failed — retrying with OPFS persistence.')
    provider = null
    activeModel = ''
    return (await getProvider(message.model, 'opfs')).generate(message.messages, message.options)
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false
  if (message.type === 'runtime-investigator:ai-generate') {
    const task = generationQueue.then(() => generateWithFallback(message))
    generationQueue = task.then(() => undefined, () => undefined)
    void task.then(
      (text) => sendResponse({ ok: true, text, model: activeModel }),
      (error) => sendResponse({ ok: false, error: String(error) }),
    )
    return true
  }
  if (message.type === 'runtime-investigator:ai-interrupt') {
    provider?.interrupt()
    sendResponse({ ok: true })
  }
  return false
})
