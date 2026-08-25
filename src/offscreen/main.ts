import { WebLLMProvider } from '@feltdb/webllm'

let provider: WebLLMProvider | null = null
let activeModel = ''

async function getProvider(model: string): Promise<WebLLMProvider> {
  if (provider && activeModel === model) return provider
  if (provider) await provider.shutdown()
  activeModel = model
  provider = new WebLLMProvider({
    model,
    cacheBackend: 'cache',
    onProgress: (progress) => void chrome.runtime.sendMessage({
      type: 'runtime-investigator:ai-progress', target: 'panel', model, ...progress,
    }),
  })
  return provider
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false
  if (message.type === 'runtime-investigator:ai-generate') {
    void getProvider(message.model).then((llm) => llm.generate(message.messages, message.options)).then(
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
