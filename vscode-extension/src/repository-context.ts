/**
 * Repository Context Provider: the only code in the bridge that touches disk.
 *
 * Read-only by construction. There is no write path here, and none may be
 * added: Studio, the Proposal API, and the IDE connection must never mutate the
 * repository. Applying a proposal is `feltdb ai apply`.
 *
 * Deliberately free of `vscode` imports so the containment and secret rules can
 * be exercised directly against a real repository in tests.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  MAX_CONTEXT_FILES, MAX_FILE_BYTES, MAX_RELEVANT_FILES,
  describePathRejection, isReadablePath, resolveRepositoryPath, secretNames, selectRelevantFiles,
  type ContractFingerprint, type PathRejection, type RepositoryChange, type RepositoryContext,
  type RepositoryFile, type RepositoryFingerprint, type SourcePlanEntry,
} from '../../src/lib/repositoryContext.js'

const execute = promisify(execFile)

const FLOW_PATH = 'feltdb.flow'
const CONFIG_PATH = 'feltdb.config.json'
const CONTRACT_CANDIDATES = ['feltdb.contract.json', path.join('.feltdb', 'contract.json')]

export type RepositoryAccessReason = PathRejection | 'not_found' | 'not_a_file'

export class RepositoryAccessError extends Error {
  constructor(readonly reason: RepositoryAccessReason, message: string) {
    super(message)
    this.name = 'RepositoryAccessError'
  }
}

export interface RepositoryContextOptions {
  root: string
  maxFiles?: number
  maxFileBytes?: number
}

export class RepositoryContextProvider {
  readonly root: string
  private readonly maxFiles: number
  private readonly maxFileBytes: number

  constructor(options: RepositoryContextOptions) {
    this.root = path.resolve(options.root)
    this.maxFiles = options.maxFiles ?? MAX_CONTEXT_FILES
    this.maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES
  }

  /** The bounded repository context: git state, fingerprints, and a file listing. */
  async context(): Promise<RepositoryContext> {
    const [git, files, flow, contract, secrets] = await Promise.all([
      this.git(),
      this.listFiles(),
      this.flowFingerprint(),
      this.contractFingerprint(),
      this.secretNames(),
    ])
    return {
      repository: { root: this.root, ...git },
      flow,
      contract,
      files: files.paths,
      secrets: { names: secrets },
      truncated: files.truncated,
      capturedAt: Date.now(),
    }
  }

  /**
   * Read one repository file.
   *
   * Containment is enforced twice: the requested path is resolved under the
   * repository-relative rules, then the real path on disk is checked so a
   * symlink cannot walk out of the workspace.
   */
  async readFile(requested: string): Promise<RepositoryFile> {
    const relative = this.toRelative(requested)
    const resolution = resolveRepositoryPath(relative)
    if (!resolution.ok) throw new RepositoryAccessError(resolution.reason, describePathRejection(resolution.reason))

    const absolute = path.resolve(this.root, resolution.path)
    let real: string
    try { real = await realpath(absolute) }
    catch { throw new RepositoryAccessError('not_found', `${resolution.path} does not exist in the connected repository.`) }
    if (!(await this.containsRealPath(real))) {
      throw new RepositoryAccessError('escapes_repository', describePathRejection('escapes_repository'))
    }

    const info = await stat(real)
    if (!info.isFile()) throw new RepositoryAccessError('not_a_file', `${resolution.path} is not a readable file.`)
    if (info.size <= this.maxFileBytes) {
      return { path: resolution.path, contents: await readFile(real, 'utf8'), bytes: info.size, truncated: false }
    }
    const handle = await open(real, 'r')
    try {
      const buffer = Buffer.alloc(this.maxFileBytes)
      const { bytesRead } = await handle.read(buffer, 0, this.maxFileBytes, 0)
      return { path: resolution.path, contents: buffer.subarray(0, bytesRead).toString('utf8'), bytes: info.size, truncated: true }
    } finally { await handle.close() }
  }

  /** Repository files a proposal source plan names, bounded and secret-free. */
  async filesForSourcePlan(plan: SourcePlanEntry[], limit = MAX_RELEVANT_FILES): Promise<RepositoryFile[]> {
    const { paths } = await this.listFiles()
    const relevant = selectRelevantFiles(plan, paths, limit)
    const files: RepositoryFile[] = []
    for (const candidate of relevant) {
      try { files.push(await this.readFile(candidate)) }
      catch { /* A planned path that cannot be read is simply not offered as context. */ }
    }
    return files
  }

  private toRelative(requested: string): string {
    if (!requested || typeof requested !== 'string') return requested
    const normalized = requested.replaceAll('\\', '/')
    if (!path.isAbsolute(normalized)) return normalized
    // Absolute paths are only accepted when they already point inside the
    // repository; anything else falls through to the containment rules and is refused.
    const relative = path.relative(this.root, path.resolve(normalized))
    return relative && !relative.startsWith('..') ? relative.replaceAll('\\', '/') : normalized
  }

  private async containsRealPath(candidate: string): Promise<boolean> {
    let realRoot = this.root
    try { realRoot = await realpath(this.root) } catch { /* Use the configured root. */ }
    const relative = path.relative(realRoot, candidate)
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
  }

  private async git(): Promise<Omit<RepositoryContext['repository'], 'root'>> {
    try {
      const [branch, commit, status] = await Promise.all([
        this.runGit(['branch', '--show-current']),
        this.runGit(['rev-parse', 'HEAD']),
        this.runGitRaw(['status', '--porcelain']),
      ])
      const changedFiles = parseStatus(status)
      return { branch, commit, dirty: changedFiles.length > 0, changedFiles, gitAvailable: true }
    } catch {
      return { branch: '', commit: '', dirty: false, changedFiles: [], gitAvailable: false }
    }
  }

  private async listFiles(): Promise<{ paths: string[]; truncated: boolean }> {
    let candidates: string[] = []
    try {
      const [tracked, untracked] = await Promise.all([
        this.runGit(['ls-files']),
        this.runGit(['ls-files', '--others', '--exclude-standard']),
      ])
      candidates = [...tracked.split('\n'), ...untracked.split('\n')]
    } catch { return { paths: [], truncated: false } }
    const paths = [...new Set(candidates.map((value) => value.trim()).filter(Boolean))]
      .filter(isReadablePath)
      .sort()
    return { paths: paths.slice(0, this.maxFiles), truncated: paths.length > this.maxFiles }
  }

  private async flowFingerprint(): Promise<RepositoryFingerprint | null> {
    const contents = await this.readInternal(FLOW_PATH)
    return contents === undefined ? null : { path: FLOW_PATH, hash: hash(contents) }
  }

  /**
   * The repository's current contract snapshot, reported as version and hash only.
   *
   * This is the second of the three fingerprints a proposal is checked against
   * (contract hash, flow hash, repository commit). The snapshot's contents are
   * never returned through the bridge.
   */
  private async contractFingerprint(): Promise<ContractFingerprint | null> {
    for (const candidate of CONTRACT_CANDIDATES) {
      const contents = await this.readInternal(candidate)
      if (contents === undefined) continue
      return { path: candidate.replaceAll('\\', '/'), version: contractVersion(contents), hash: hash(contents) }
    }
    const config = await this.readInternal(CONFIG_PATH)
    if (config === undefined) return null
    const parsed = parseJson(config)
    const contract = parsed?.contract
    if (!contract || typeof contract !== 'object') return null
    const serialized = JSON.stringify(contract)
    return { path: CONFIG_PATH, version: contractVersion(serialized), hash: hash(serialized) }
  }

  /**
   * Required secret *names*.
   *
   * `.env` is read here and immediately reduced to its key names. No value is
   * returned, retained, or logged, and `.env` itself is never readable through
   * the bridge — `resolveRepositoryPath` refuses it.
   */
  private async secretNames(): Promise<string[]> {
    const names = new Set<string>()
    const config = await this.readInternal(CONFIG_PATH)
    for (const name of secretNames(config === undefined ? undefined : parseJson(config) ?? undefined)) names.add(name)
    for (const candidate of ['.env', '.env.example']) {
      const contents = await this.readInternal(candidate)
      if (contents === undefined) continue
      for (const name of secretNames(contents)) names.add(name)
    }
    return [...names].sort()
  }

  /** Internal, fingerprint-only read of a known repository file. Never exposed. */
  private async readInternal(relative: string): Promise<string | undefined> {
    const absolute = path.resolve(this.root, relative)
    if (!(await this.containsRealPath(path.resolve(absolute)))) return undefined
    try { return await readFile(absolute, 'utf8') } catch { return undefined }
  }

  private async runGit(args: string[]): Promise<string> {
    return (await this.runGitRaw(args)).trim()
  }

  /** Porcelain status encodes state in the first two columns, so leading space is significant. */
  private async runGitRaw(args: string[]): Promise<string> {
    const { stdout } = await execute('git', args, { cwd: this.root, timeout: 5000, maxBuffer: 4 * 1024 * 1024 })
    return stdout.replace(/\n$/, '')
  }
}

function parseStatus(status: string): RepositoryChange[] {
  return status.split('\n').map((line) => line.trimEnd()).filter(Boolean).map((line) => {
    const code = line.slice(0, 2)
    const value = line.slice(3).trim()
    const target = value.includes(' -> ') ? value.split(' -> ')[1]! : value
    return { path: target.replaceAll('\\', '/'), change: statusChange(code) }
  })
}

function statusChange(code: string): RepositoryChange['change'] {
  if (code === '??') return 'untracked'
  if (code.includes('A')) return 'created'
  if (code.includes('D')) return 'deleted'
  if (code.includes('R')) return 'renamed'
  return 'changed'
}

function contractVersion(contents: string): string {
  const parsed = parseJson(contents)
  const candidate = parsed?.version ?? parsed?.contract_revision ?? parsed?.contractRevision ?? parsed?.contract_id
  return candidate === undefined || candidate === null ? 'unversioned' : String(candidate)
}

function parseJson(contents: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(contents)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch { return undefined }
}

function hash(contents: string): string {
  return `sha256:${createHash('sha256').update(contents).digest('hex')}`
}
