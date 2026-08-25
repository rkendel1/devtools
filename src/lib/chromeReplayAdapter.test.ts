import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChromeReplayAdapter } from './chromeReplayAdapter'

describe('ChromeReplayAdapter', () => {
  let adapter: ChromeReplayAdapter

  beforeEach(() => {
    // Mock chrome.debugger API
    global.chrome = {
      debugger: {
        attach: vi.fn((target, version, callback) => callback()),
        detach: vi.fn((target, callback) => callback()),
        sendCommand: vi.fn((target, method, params, callback) => {
          if (method === 'Page.navigate') {
            callback({})
          } else if (method === 'Runtime.evaluate') {
            callback({ result: { value: true } })
          } else {
            callback({})
          }
        }),
        onEvent: {
          addListener: vi.fn(),
        },
      },
      runtime: {
        lastError: undefined,
      },
    } as any

    adapter = new ChromeReplayAdapter({
      tabId: 123,
      targetUrl: 'https://api.example.com/checkout',
      targetMethod: 'POST',
      timeout: 5000,
    })
  })

  describe('navigate', () => {
    it('should attach debugger and navigate', async () => {
      await adapter.navigate('https://app.example.com/checkout')

      expect(chrome.debugger.attach).toHaveBeenCalled()
      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 123 },
        'Page.navigate',
        { url: 'https://app.example.com/checkout' },
        expect.any(Function)
      )
    })
  })

  describe('click', () => {
    it('should click element via evaluate', async () => {
      await adapter.navigate('https://app.example.com/checkout')
      await adapter.click('#submit')

      const calls = (chrome.debugger.sendCommand as any).mock.calls
      const evaluateCall = calls.find((c: any) => c[1] === 'Runtime.evaluate')
      expect(evaluateCall).toBeDefined()
    })
  })

  describe('input', () => {
    it('should type into element via evaluate', async () => {
      await adapter.navigate('https://app.example.com/checkout')
      await adapter.input('#email', 'test@example.com')

      const calls = (chrome.debugger.sendCommand as any).mock.calls
      const evaluateCall = calls.find((c: any) => c[1] === 'Runtime.evaluate')
      expect(evaluateCall).toBeDefined()
    })
  })

  describe('enableNetworkCapture', () => {
    it('should enable network capture for fixtures', async () => {
      await adapter.navigate('https://app.example.com/checkout')

      const fixtures = [
        {
          id: 'f1',
          pattern: 'https://api.example.com/checkout',
          method: 'POST' as const,
          responseStatus: 422,
          responseHeaders: {},
          responseBody: '{}',
        },
      ]

      await adapter.enableNetworkCapture(fixtures)

      const calls = (chrome.debugger.sendCommand as any).mock.calls
      const networkCall = calls.find((c: any) => c[1] === 'Network.setRequestInterceptionEnabled')
      expect(networkCall).toBeDefined()
    })
  })

  describe('collectObservations', () => {
    it('should collect observations from execution', async () => {
      await adapter.navigate('https://app.example.com/checkout')
      await adapter.wait(100)

      const observations = await adapter.collectObservations()

      expect(observations.length).toBeGreaterThan(0)
      expect(observations[0].type).toBeDefined()
      expect(observations[0].description).toBeDefined()
      expect(observations[0].success).toBeDefined()
    })
  })

  describe('dispose', () => {
    it('should detach debugger on dispose', async () => {
      await adapter.navigate('https://app.example.com/checkout')
      await adapter.dispose()

      expect(chrome.debugger.detach).toHaveBeenCalled()
    })
  })
})
