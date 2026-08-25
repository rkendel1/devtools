const SENSITIVE_KEYWORDS = [
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

export function redactHeaders(headers: Record<string, string>): { redacted: Record<string, string>; changed: boolean } {
  let changed = false
  const redacted: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_KEYWORDS.some((keyword) => key.toLowerCase().includes(keyword))) {
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

export function redactText(value: string | undefined): { redacted: string | undefined; changed: boolean } {
  if (!value) {
    return { redacted: value, changed: false }
  }

  const redacted = maybeRedactValue(value)
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
