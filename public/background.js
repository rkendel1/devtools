chrome.runtime.onInstalled.addListener(() => {
  console.info('[Runtime Investigator] Installed')
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'runtime-investigator:ping') {
    sendResponse({ ok: true, tabId: sender.tab?.id ?? null })
  }
})
