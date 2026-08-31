import { describe, expect, it } from 'vitest'
import {
  describePathRejection, isExcludedPath, isReadablePath, isSecretPath,
  resolveRepositoryPath, secretNames, selectRelevantFiles,
} from './repositoryContext'

describe('repository path containment', () => {
  it('accepts repository-relative paths', () => {
    expect(resolveRepositoryPath('src/auth.ts')).toEqual({ ok: true, path: 'src/auth.ts' })
    expect(resolveRepositoryPath('./src/./auth.ts')).toEqual({ ok: true, path: 'src/auth.ts' })
    expect(resolveRepositoryPath('src\\models.ts')).toEqual({ ok: true, path: 'src/models.ts' })
    expect(resolveRepositoryPath('src/a/../b.ts')).toEqual({ ok: true, path: 'src/b.ts' })
  })

  it('rejects traversal out of the repository', () => {
    expect(resolveRepositoryPath('../secrets.txt')).toEqual({ ok: false, reason: 'escapes_repository' })
    expect(resolveRepositoryPath('src/../../etc/passwd')).toEqual({ ok: false, reason: 'escapes_repository' })
    expect(resolveRepositoryPath('a/../../b')).toEqual({ ok: false, reason: 'escapes_repository' })
  })

  it('rejects absolute paths and URLs', () => {
    for (const value of ['/etc/passwd', 'C:/Windows/system.ini', 'file:///etc/passwd', 'https://example.test/x']) {
      expect(resolveRepositoryPath(value)).toEqual({ ok: false, reason: 'absolute_path' })
    }
  })

  it('rejects unusable paths', () => {
    expect(resolveRepositoryPath('')).toEqual({ ok: false, reason: 'invalid_path' })
    expect(resolveRepositoryPath('src/\0auth.ts')).toEqual({ ok: false, reason: 'invalid_path' })
    expect(resolveRepositoryPath('.')).toEqual({ ok: false, reason: 'invalid_path' })
  })

  it('never exposes credential files', () => {
    for (const value of ['.env', '.env.local', 'config/.env.production', 'certs/server.pem', 'deploy.key', '.npmrc', '.ssh/config', 'secrets.json', 'service-account-prod.json']) {
      expect(resolveRepositoryPath(value), value).toEqual({ ok: false, reason: 'secret_path' })
      expect(isSecretPath(value), value).toBe(true)
    }
    expect(isSecretPath('src/environment.ts')).toBe(false)
  })

  it('excludes build output, dependencies, and workspace state', () => {
    for (const value of ['node_modules/react/index.js', 'dist/panel.js', '.git/config', '.feltdb/connections.json']) {
      expect(resolveRepositoryPath(value), value).toEqual({ ok: false, reason: 'excluded_path' })
      expect(isExcludedPath(value), value).toBe(true)
    }
  })

  it('describes every rejection', () => {
    for (const reason of ['invalid_path', 'absolute_path', 'escapes_repository', 'excluded_path', 'secret_path'] as const) {
      expect(describePathRejection(reason)).toMatch(/\S/)
    }
  })

  it('reports readability for listing decisions', () => {
    expect(isReadablePath('src/auth.ts')).toBe(true)
    expect(isReadablePath('.env')).toBe(false)
    expect(isReadablePath('../outside.ts')).toBe(false)
  })
})

describe('secret names', () => {
  it('returns names from env content and never values', () => {
    const names = secretNames('STRIPE_SECRET_KEY=sk_live_verysecret\nexport DATABASE_URL=postgres://user:pw@host/db\n# comment\n')
    expect(names).toEqual(['DATABASE_URL', 'STRIPE_SECRET_KEY'])
    expect(names.join(' ')).not.toContain('sk_live_verysecret')
    expect(names.join(' ')).not.toContain('postgres://')
  })

  it('reads declared secrets from configuration', () => {
    expect(secretNames({ secrets: ['STRIPE_SECRET_KEY'] })).toEqual(['STRIPE_SECRET_KEY'])
    expect(secretNames({ requiredSecrets: { STRIPE_SECRET_KEY: { required: true } } })).toEqual(['STRIPE_SECRET_KEY'])
    expect(secretNames(undefined)).toEqual([])
  })
})

describe('relevant file selection', () => {
  const tracked = ['feltdb.flow', 'feltdb.config.json', 'src/auth.ts', 'src/models.ts', 'src/routes.ts', 'tests/auth.test.ts', 'node_modules/x/index.js', '.env']

  it('resolves the source plan against tracked files and always anchors on the flow', () => {
    const files = selectRelevantFiles([{ path: 'src/auth.ts' }, { path: 'models.ts' }], tracked)
    expect(files).toContain('feltdb.flow')
    expect(files).toContain('src/auth.ts')
    expect(files).toContain('src/models.ts')
  })

  it('cannot be widened past the tracked, readable set', () => {
    const files = selectRelevantFiles([{ path: '../../etc/passwd' }, { path: '.env' }, { path: 'node_modules/x/index.js' }], tracked)
    expect(files).not.toContain('.env')
    expect(files).not.toContain('node_modules/x/index.js')
    expect(files.every((path) => tracked.includes(path))).toBe(true)
  })

  it('is bounded', () => {
    const many = Array.from({ length: 200 }, (_, index) => `src/file${index}.ts`)
    expect(selectRelevantFiles(many.map((path) => ({ path })), many, 10)).toHaveLength(10)
  })
})
