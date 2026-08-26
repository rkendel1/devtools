chrome.runtime.onInstalled.addListener(() => console.info('[Runtime Investigator] Installed'))
const eventQueues = new Map()
const RETENTION_MS = 24 * 60 * 60 * 1000
let creatingOffscreen = null

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen.html')
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })
  if (contexts.length) return
  if (!creatingOffscreen) creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['WORKERS'], justification: 'Run optional private WebLLM inference outside the DevTools panel.',
  }).finally(() => { creatingOffscreen = null })
  await creatingOffscreen
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'runtime-investigator:health') {
    sendResponse({ ok: true })
    return false
  }
  if (message?.type === 'runtime-investigator:ai-generate' && message.target !== 'offscreen') {
    void ensureOffscreen().then(() => chrome.runtime.sendMessage({ ...message, target: 'offscreen' }, sendResponse)).catch(
      (error) => sendResponse({ ok: false, error: String(error) }),
    )
    return true
  }
  if (message?.type === 'runtime-investigator:ai-interrupt' && message.target !== 'offscreen') {
    void ensureOffscreen().then(() => chrome.runtime.sendMessage({ ...message, target: 'offscreen' }, sendResponse))
    return true
  }
  if (message?.type === 'runtime-investigator:event' && sender.tab?.id != null) {
    const key = `events:${sender.tab.id}`
    const previous = eventQueues.get(sender.tab.id) ?? Promise.resolve()
    const next = previous.then(() => chrome.storage.session.get(key)).then((stored) => {
      const events = Array.isArray(stored[key]) ? stored[key] : []
      const cutoff = Date.now() - RETENTION_MS
      return chrome.storage.session.set({ [key]: [...events.filter((event) => event.ts >= cutoff), message.payload].slice(-500) })
    }).then(() => sendResponse({ ok: true }))
    const queued = next.finally(() => {
      if (eventQueues.get(sender.tab.id) === queued) eventQueues.delete(sender.tab.id)
    })
    eventQueues.set(sender.tab.id, queued)
    return true
  }
  if (message?.type === 'runtime-investigator:get-events') {
    const tabId = message.tabId ?? sender.tab?.id
    if (tabId == null) {
      sendResponse({ events: [] })
      return false
    }
    const key = `events:${tabId}`
    void chrome.storage.session.get(key).then((stored) => {
      const cutoff = Date.now() - RETENTION_MS
      const events = (stored[key] ?? []).filter((event) => event.ts >= cutoff)
      void chrome.storage.session.set({ [key]: events })
      sendResponse({ events })
    })
    return true
  }
  if (message?.type === 'runtime-investigator:clear-events') {
    void chrome.storage.session.remove(`events:${message.tabId}`).then(() => sendResponse({ ok: true }))
    return true
  }
  return false
})

chrome.tabs.onRemoved.addListener((tabId) => {
  eventQueues.delete(tabId)
  void chrome.storage.session.remove(`events:${tabId}`)
})
