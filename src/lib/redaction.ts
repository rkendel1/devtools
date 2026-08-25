export const DEFAULT_SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'jwt',
  'password',
  'api-key',
  'apikey',
]

const REDACTION_TEXT = '[REDACTED]'

export function redactHeaders(headers: Record<string, string>, customKeys: string[] = []): { redacted: Record<string, string>; changed: boolean } {
  let changed = false
  const redacted: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    if ([...DEFAULT_SENSITIVE_KEYS, ...customKeys].some((keyword) => key.toLowerCase().includes(keyword.toLowerCase()))) {
      redacted[key] = REDACTION_TEXT
      changed = true
      continue
    }

    redacted[key] = maybeRedactValue(value)
    if (redacted[key] !== value) {
      changed = true
    }
  }

  return { redacted, changed }
}

export function redactText(value: string | undefined, customKeys: string[] = []): { redacted: string | undefined; changed: boolean } {
  if (!value) {
    return { redacted: value, changed: false }
  }

  let redacted = maybeRedactValue(value)
  for (const key of customKeys.filter(Boolean)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    redacted = redacted.replace(new RegExp(`("?${escaped}"?\\s*[:=]\\s*"?)([^",\\s}]+)`, 'gi'), `$1${REDACTION_TEXT}`)
  }
  return { redacted, changed: redacted !== value }
}

function maybeRedactValue(value: string): string {
  const tokenPatterns = [
    /bearer\s+[a-z0-9._-]+/gi,
    /("?(?:password|token|api[_-]?key|jwt)"?\s*[:=]\s*"?)([^",\s]+)/gi,
  ]

  let output = value
  for (const pattern of tokenPatterns) {
    output = output.replace(pattern, (_, prefix) => `${prefix}${REDACTION_TEXT}`)
  }

  return output
}
