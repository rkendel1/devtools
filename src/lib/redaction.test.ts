import { describe, expect, it } from 'vitest'
import { redactHeaders, redactText } from './redaction'

describe('redaction', () => {
  it('redacts sensitive headers', () => {
    const { redacted, changed } = redactHeaders({ Authorization: '******' })
    expect(changed).toBe(true)
    expect(redacted.Authorization).toBe('[REDACTED]')
  })

  it('redacts token-like payload values', () => {
    const { redacted, changed } = redactText('{"token":"abc123"}')
    expect(changed).toBe(true)
    expect(redacted).toContain('[REDACTED]')
  })

  it('redacts user-configured sensitive fields', () => {
    const { redacted, changed } = redactText('{"accountId":"customer-42"}', ['accountId'])
    expect(changed).toBe(true)
    expect(redacted).toBe('{"accountId":"[REDACTED]"}')
  })
})
