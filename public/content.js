window.addEventListener('runtime-investigator:event', (event) => {
  try {
    chrome.runtime.sendMessage({ type: 'runtime-investigator:event', payload: JSON.parse(event.detail) })
  } catch {
    // Ignore malformed page-world events.
  }
})
