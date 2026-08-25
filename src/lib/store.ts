import type { InvestigationRecord } from './types'

const KEY = 'runtime-investigator:history:v1'

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
  localStorage.setItem(KEY, JSON.stringify(records.slice(0, 200)))
}

export function appendHistory(record: InvestigationRecord): InvestigationRecord[] {
  const current = loadHistory()
  const updated = [record, ...current]
  saveHistory(updated)
  return updated
}
