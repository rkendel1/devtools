(() => {
  window.addEventListener(
    'error',
    (event) => {
      chrome.runtime.sendMessage({
        type: 'runtime-investigator:page-error',
        payload: {
          message: event.message,
          source: event.filename,
          line: event.lineno,
          column: event.colno,
          stack: event.error?.stack ?? null,
          ts: Date.now(),
        },
      })
    },
    true,
  )
})()
