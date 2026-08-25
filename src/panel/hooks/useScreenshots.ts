import { useEffect, useRef, useState } from 'react'
import { captureScreenshot } from '../../lib/chrome'

export type ScreenshotFrame = { id: string; dataUrl: string; capturedAt: number; label: string }

export const MAX_SCREENSHOTS = 12
export const SCREENSHOT_INTERVAL_MS = 3000

export function useScreenshots(setMessage: (msg: string) => void) {
  const [screenshots, setScreenshots] = useState<ScreenshotFrame[]>([])
  const screenshotsRef = useRef<ScreenshotFrame[]>([])
  const [recordingScreens, setRecordingScreens] = useState(false)
  const screenshotBusy = useRef(false)

  useEffect(() => { screenshotsRef.current = screenshots }, [screenshots])

  useEffect(() => {
    if (!recordingScreens) return
    const take = async () => {
      if (screenshotBusy.current) return
      if (screenshotsRef.current.length >= MAX_SCREENSHOTS) {
        setRecordingScreens(false)
        setMessage(`Screenshot sequence stopped at the ${MAX_SCREENSHOTS}-frame memory cap.`)
        return
      }
      screenshotBusy.current = true
      try {
        const dataUrl = await captureScreenshot()
        if (!dataUrl) {
          setRecordingScreens(false)
          setMessage('Screen capture was not permitted for the inspected tab.')
          return
        }
        const next = [...screenshotsRef.current, { id: crypto.randomUUID(), dataUrl, capturedAt: Date.now(), label: 'Sequence capture' }].slice(-MAX_SCREENSHOTS)
        screenshotsRef.current = next
        setScreenshots(next)
        if (next.length >= MAX_SCREENSHOTS) {
          setRecordingScreens(false)
          setMessage(`Screenshot sequence complete at the ${MAX_SCREENSHOTS}-frame memory cap.`)
        }
      } finally {
        screenshotBusy.current = false
      }
    }
    void take()
    const timer = window.setInterval(() => void take(), SCREENSHOT_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [recordingScreens, setMessage])

  async function captureFrame(): Promise<void> {
    if (screenshotBusy.current) return
    screenshotBusy.current = true
    try {
      const dataUrl = await captureScreenshot()
      if (!dataUrl) {
        setMessage('Screen capture was not permitted for the inspected tab.')
        return
      }
      const next = [...screenshotsRef.current, { id: crypto.randomUUID(), dataUrl, capturedAt: Date.now(), label: 'Manual capture' }].slice(-MAX_SCREENSHOTS)
      screenshotsRef.current = next
      setScreenshots(next)
      setMessage('Screenshot captured in memory.')
    } finally {
      screenshotBusy.current = false
    }
  }

  async function copyScreenshot(frame: ScreenshotFrame): Promise<void> {
    try {
      const blob = await fetch(frame.dataUrl).then((response) => response.blob())
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard is unavailable.')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setMessage('Screenshot copied as an image. Paste it into any image-capable app.')
    } catch (error) {
      setMessage(`Could not copy screenshot: ${String(error)}`)
    }
  }

  return {
    screenshots, setScreenshots, screenshotsRef,
    recordingScreens, setRecordingScreens,
    captureFrame, copyScreenshot,
    screenshotBusy,
  }
}
