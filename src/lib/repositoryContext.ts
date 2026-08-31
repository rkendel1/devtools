/**
 * Repository Context: the bounded shape of a connected developer repository.
 *
 * The DevTools bridge exposes repository context. It is not another FeltDB API,
 * it is not application state, and it never writes to the repository.
 *
 * This module is the host-independent half: the context contract plus the
 * containment and secret policy that every host implementation must enforce.
 * Filesystem and git access live in the repository-side host (see
 * `vscode-extension/src/repository-context.ts`), which is the only code allowed
 * to touch disk.
 */

/** Bridge responses are bounded: a single file never exceeds this size. */
export const MAX_FILE_BYTES = 256 * 1024

/** A repository context lists at most this many files. */
export const MAX_CONTEXT_FILES = 500

/** A proposal source plan resolves to at most this many files. */
export const MAX_RELEVANT_FILES = 40

/** Directories that are never listed, read, or offered as proposal context. */
export const EXCLUDED_DIRECTORIES = [
  '.git', '.feltdb', '.hg', '.svn', 'node_modules', 'dist', 'dist-ssr', 'build', 'out',
  'coverage', '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', 'target', 'vendor',
  '__pycache__', '.venv', '.gradle', '.idea', '.pnpm-store',
]

/**
 * Paths that may hold credentials. These are refused by every read path and
 * omitted from every listing. Secret *names* may be reported; values never are.
 */
export const SECRET_PATH_PATTERNS: RegExp[] = [
  /(?:^|\/)\.env(?:\.[^/]*)?$/i,
  /(?:^|\/)\.envrc$/i,
  /(?:^|\/)\.(?:aws|ssh|gnupg)(?:\/|$)/i,
  /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /(?:^|\/)\.(?:npmrc|netrc|pgpass|htpasswd)$/i,
  /(?:^|\/)(?:credentials|secrets?)(?:\.(?:json|ya?ml|toml|ini|txt|env))?$/i,
  /(?:^|\/)service-account[^/]*\.json$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore|asc|gpg|ppk)$/i,
]

export interface RepositoryHead {
  root: string
  branch: string
  commit: string
  dirty: boolean
  changedFiles: RepositoryChange[]
  /** False when the workspace is not a git checkout: git state is then unknown, not clean. */
  gitAvailable: boolean
}

export interface RepositoryChange {
  path: string
  change: 'created' | 'changed' | 'deleted' | 'renamed' | 'untracked'
}

export interface RepositoryFingerprint {
  path: string
  hash: string
}

export interface ContractFingerprint {
  version: string
  hash: string
  path?: string
}

/**
 * The bounded repository context handed to Studio and the IDE.
 *
 * `files` is a bounded relevant-file listing, never the whole repository.
 * `secrets.names` reports required secret names only; a value never appears here.
 */
export interface RepositoryContext {
  repository: RepositoryHead
  flow: RepositoryFingerprint | null
  contract: ContractFingerprint | null
  files: string[]
  secrets: { names: string[] }
  truncated: boolean
  capturedAt: number
}

export interface RepositoryFile {
  path: string
  contents: string
  bytes: number
  truncated: boolean
}

export type PathRejection = 'invalid_path' | 'absolute_path' | 'escapes_repository' | 'excluded_path' | 'secret_path'

export type PathResolution =
  | { ok: true; path: string }
  | { ok: false; reason: PathRejection }

/** Human-readable reason for a refused path, used in bridge errors and the IDE. */
export function describePathRejection(reason: PathRejection): string {
  switch (reason) {
    case 'invalid_path': return 'The requested path is not a usable repository path.'
    case 'absolute_path': return 'Absolute paths are not accepted. Request a repository-relative path.'
    case 'escapes_repository': return 'The requested path resolves outside the connected repository.'
    case 'excluded_path': return 'The requested path is inside an excluded directory.'
    case 'secret_path': return 'The requested path may contain credentials and is never exposed.'
  }
}

export function isSecretPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isExcludedPath(path: string): boolean {
  return path.replaceAll('\\', '/').split('/').some((segment) => EXCLUDED_DIRECTORIES.includes(segment))
}

/**
 * Resolve a requested path against the repository root.
 *
 * Repository-relative paths only: `../`, absolute paths, drive letters, URLs,
 * and NUL bytes are refused before any host touches the filesystem. Hosts must
 * additionally verify the resolved real path is still inside the repository,
 * which is the only way to catch a symlink escape.
 */
export function resolveRepositoryPath(requested: string): PathResolution {
  if (typeof requested !== 'string' || !requested.trim()) return { ok: false, reason: 'invalid_path' }
  if (requested.includes('\0')) return { ok: false, reason: 'invalid_path' }
  const normalized = requested.replaceAll('\\', '/').trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return { ok: false, reason: 'absolute_path' }
  if (normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) return { ok: false, reason: 'absolute_path' }

  const segments: string[] = []
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return { ok: false, reason: 'escapes_repository' }
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (!segments.length) return { ok: false, reason: 'invalid_path' }

  const path = segments.join('/')
  if (isSecretPath(path)) return { ok: false, reason: 'secret_path' }
  if (isExcludedPath(path)) return { ok: false, reason: 'excluded_path' }
  return { ok: true, path }
}

/** True when a path may be listed or read through the bridge. */
export function isReadablePath(path: string): boolean {
  const resolution = resolveRepositoryPath(path)
  return resolution.ok && resolution.path === path.replaceAll('\\', '/').replace(/^\.\//, '')
}

/**
 * Secret names declared by repository configuration.
 *
 * Accepts `.env`-style content or a parsed configuration object. Only the names
 * are returned: this function never returns, logs, or retains a value.
 */
export function secretNames(source: string | Record<string, unknown> | undefined): string[] {
  if (!source) return []
  const names = new Set<string>()
  if (typeof source === 'string') {
    for (const line of source.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
      if (match?.[1]) names.add(match[1])
    }
    return [...names].sort()
  }
  const declared = source.secrets ?? source.requiredSecrets ?? source.required_secrets
  if (Array.isArray(declared)) {
    for (const value of declared) if (typeof value === 'string' && value.trim()) names.add(value.trim())
  } else if (declared && typeof declared === 'object') {
    for (const key of Object.keys(declared)) names.add(key)
  }
  return [...names].sort()
}

export interface SourcePlanEntry {
  path: string
  action?: 'create' | 'modify' | 'delete' | 'inspect'
  reason?: string
}

/**
 * Resolve a proposal source plan to a bounded set of repository files.
 *
 * The proposal names candidates; the bridge decides what actually exists and is
 * safe to expose. Nothing outside `tracked` is ever returned, so a source plan
 * cannot widen the bridge's reach. `feltdb.flow` is always included when
 * present: the agent cannot reason about a proposal without the specification.
 */
export function selectRelevantFiles(
  plan: SourcePlanEntry[],
  tracked: string[],
  limit = MAX_RELEVANT_FILES,
): string[] {
  const available = tracked.map((path) => path.replaceAll('\\', '/')).filter(isReadablePath)
  const availableSet = new Set(available)
  const scored = new Map<string, number>()
  const keep = (path: string, score: number) => scored.set(path, Math.max(scored.get(path) ?? 0, score))

  for (const anchor of ['feltdb.flow', 'feltdb.config.json']) if (availableSet.has(anchor)) keep(anchor, 1000)

  for (const entry of plan) {
    const requested = entry?.path?.replaceAll('\\', '/').replace(/^\.\//, '')
    if (!requested) continue
    if (availableSet.has(requested)) { keep(requested, 100); continue }
    const basename = requested.split('/').at(-1)
    for (const candidate of available) {
      if (candidate.endsWith(`/${requested}`)) keep(candidate, 80)
      else if (basename && candidate.split('/').at(-1) === basename) keep(candidate, 50)
      else if (requested.endsWith('/') && candidate.startsWith(requested)) keep(candidate, 40)
    }
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path]) => path)
}
