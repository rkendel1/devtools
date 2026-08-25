import type { InvestigationRecord, PrivacySettings } from './types'
import { feltRepository } from './feltRepository'

const KEY = 'runtime-investigator:history:v1'
const PRIVACY_KEY = 'runtime-investigator:privacy:v1'

export const DEFAULT_PRIVACY: PrivacySettings = { sensitiveKeys: [], includeHeaders: true, includeBodies: true }

export function loadHistory(): InvestigationRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as InvestigationRecord[]) : []
  } catch {
    return []
  }
}

export function saveHistory(records: InvestigationRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records.slice(0, 200), (key, value) => key === 'screenshot' ? undefined : value))
  } catch (error) {
    console.warn('[Runtime Investigator] Local compatibility cache unavailable', error)
  }
  void feltRepository.syncHistory(records.slice(0, 200)).catch((error) => console.error('[Runtime Investigator] FeltDB history sync failed', error))
}

export function appendHistory(record: InvestigationRecord): InvestigationRecord[] {
  const current = loadHistory()
  const updated = [record, ...current]
  saveHistory(updated)
  return updated
}

export function updateHistory(records: InvestigationRecord[]): InvestigationRecord[] {
  const sorted = [...records].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt - a.createdAt)
  saveHistory(sorted)
  return sorted
}

export function loadPrivacy() {
  try {
    return { ...DEFAULT_PRIVACY, ...JSON.parse(localStorage.getItem(PRIVACY_KEY) ?? '{}') }
  } catch {
    return DEFAULT_PRIVACY
  }
}

export function savePrivacy(settings: PrivacySettings): void {
  localStorage.setItem(PRIVACY_KEY, JSON.stringify(settings))
  void feltRepository.savePrivacy(settings).catch((error) => console.error('[Runtime Investigator] FeltDB settings sync failed', error))
}

export async function initializeDurableStore(): Promise<{ history: InvestigationRecord[]; privacy: PrivacySettings }> {
  const [history, privacy] = await Promise.all([
    feltRepository.initializeHistory(loadHistory()), feltRepository.loadPrivacy(loadPrivacy()),
  ])
  localStorage.setItem(KEY, JSON.stringify(history))
  localStorage.setItem(PRIVACY_KEY, JSON.stringify(privacy))
  return { history, privacy }
}

export function subscribeDurableHistory(callback: (records: InvestigationRecord[]) => void): () => void {
  return feltRepository.subscribeHistory(callback)
}

export function durableRuntime() {
  return feltRepository.runtime()
}
