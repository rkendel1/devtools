import * as vscode from 'vscode'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DevelopmentActivity, FeltWorkspaceClient } from './workspace-client.js'

const execute = promisify(execFile)
type ChangeKind = 'created' | 'changed' | 'deleted'

export class DevelopmentObserver implements vscode.Disposable {
  private readonly watcher = vscode.workspace.createFileSystemWatcher('**/*')
  private readonly gitWatchers = [
    vscode.workspace.createFileSystemWatcher('**/.git/HEAD'),
    vscode.workspace.createFileSystemWatcher('**/.git/refs/heads/**'),
  ]
  private readonly subscriptions: vscode.Disposable[]
  private readonly pending = new Map<string, ChangeKind>()
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly client: FeltWorkspaceClient) {
    this.subscriptions = [
      this.watcher.onDidCreate((uri) => this.queue(uri, 'created')),
      this.watcher.onDidChange((uri) => this.queue(uri, 'changed')),
      this.watcher.onDidDelete((uri) => this.queue(uri, 'deleted')),
      ...this.gitWatchers.map((watcher) => watcher.onDidChange(() => this.queueGitSnapshot())),
    ]
  }

  private queue(uri: vscode.Uri, change: ChangeKind): void {
    if (!this.client.activeInvestigations.length) return
    const relative = vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/')
    if (!relative || /(?:^|\/)(?:\.git|\.feltdb|node_modules|dist|out|build|coverage)(?:\/|$)/.test(relative)) return
    this.pending.set(relative, change)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 750)
  }

  private queueGitSnapshot(): void {
    if (!this.client.activeInvestigations.length) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(true), 750)
  }

  private async flush(includeGitOnly = false): Promise<void> {
    if (!this.client.activeInvestigations.length || (!this.pending.size && !includeGitOnly)) return
    const changedFiles = [...this.pending].map(([path, change]) => ({ path, change }))
    this.pending.clear()
    const git = await gitSnapshot(changedFiles.map((file) => file.path))
    if (!changedFiles.length) changedFiles.push(...(git?.changedFiles ?? []).map((path) => ({ path, change: 'changed' as const })))
    const activity: DevelopmentActivity = { observedAt: Date.now(), changedFiles, git }
    const item = this.client.correlateActiveInvestigation(changedFiles.map((file) => file.path))
    try {
      if (item) await this.client.recordDevelopmentActivity(item, activity)
      else await this.client.recordUnassociatedActivity(activity)
    }
    catch (error) { console.error('[FeltDB] Failed to record development activity', error) }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.subscriptions.forEach((subscription) => subscription.dispose())
    this.watcher.dispose()
    this.gitWatchers.forEach((watcher) => watcher.dispose())
  }
}

async function gitSnapshot(paths: string[]): Promise<DevelopmentActivity['git']> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!cwd) return undefined
  try {
    const [branch, commit, metadata, status, workingStat, workingDiff, commitFiles, commitStat] = await Promise.all([
      git(cwd, ['branch', '--show-current']),
      git(cwd, ['rev-parse', 'HEAD']),
      git(cwd, ['show', '-s', '--format=%an%n%aI', 'HEAD']),
      git(cwd, ['status', '--porcelain']),
      git(cwd, ['diff', '--stat', 'HEAD', ...(paths.length ? ['--', ...paths] : [])]),
      git(cwd, ['diff', '--no-ext-diff', '--unified=3', 'HEAD', ...(paths.length ? ['--', ...paths] : [])]),
      git(cwd, ['show', '--name-only', '--format=', 'HEAD']),
      git(cwd, ['show', '--stat', '--format=', 'HEAD']),
    ])
    const [author, committedAt] = metadata.split('\n')
    return {
      branch: branch || undefined,
      commit: commit || undefined,
      author: author || undefined,
      committedAt: committedAt || undefined,
      changedFiles: status ? status.split('\n').filter(Boolean).map((line) => line.slice(3).trim()) : commitFiles.split('\n').filter(Boolean),
      diffStat: workingStat || commitStat || undefined,
      diff: workingDiff.slice(0, 200_000) || undefined,
    }
  } catch { return undefined }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execute('git', args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024 })
  return stdout.trim()
}
