export const RETENTION_MS = 24 * 60 * 60 * 1000
export const MAX_LIVE_REQUESTS = 300
export const MAX_STORED_REQUESTS = 1500
export const MAX_STORED_RUNTIME_EVENTS = 1500
export const MAX_STORED_SESSIONS = 50
export const MAX_STORED_INVESTIGATIONS = 200
export const MAX_BODY_CHARS = 128 * 1024
export const MAX_HEADER_VALUE_CHARS = 8 * 1024
export const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000

export function truncateText(value: string | undefined, limit = MAX_BODY_CHARS): string | undefined {
  if (!value || value.length <= limit) return value
  return `${value.slice(0, limit)}\n[TRUNCATED: ${value.length - limit} characters omitted]`
}

export function truncateHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, truncateText(value, MAX_HEADER_VALUE_CHARS) ?? '']))
}
