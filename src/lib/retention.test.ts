import { describe, expect, it } from 'vitest'
import { MAX_BODY_CHARS, truncateHeaders, truncateText } from './retention'

describe('retention limits', () => {
  it('bounds bodies and header values before persistence', () => {
    const body = truncateText('x'.repeat(MAX_BODY_CHARS + 100))!
    expect(body).toContain('[TRUNCATED: 100 characters omitted]')
    expect(truncateHeaders({ huge: 'x'.repeat(9000) }).huge.length).toBeLessThan(9000)
  })
})
