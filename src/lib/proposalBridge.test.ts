import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PROPOSAL_COLLECTION, type Proposal } from './proposal'
import {
  BRIDGE_REQUEST_KINDS, PROPOSAL_BRIDGE_REQUEST_COLLECTION, PROPOSAL_BRIDGE_RESPONSE_COLLECTION,
  ProposalBridgeClient, type BridgeConnection, type BridgeConnectionEvent, type BridgeRequest, type BridgeResponse,
} from './proposalBridge'
import { renderProposalAgentPrompt, type ProposalIdeContext } from './proposalContext'
import { RepositoryContextProvider } from '../../vscode-extension/src/repository-context'
import { ProposalBridgeService } from '../../vscode-extension/src/proposal-bridge-service'

const SECRET_VALUE = 'sk_live_never_leaves_the_repository'

/** Stand-in for the shared FeltDB development workspace both clients already use. */
class MemoryWorkspace implements BridgeConnection {
  private readonly collections = new Map<string, Map<string, unknown>>()
  private readonly handlers = new Map<string, Set<(event: BridgeConnectionEvent<never>) => void>>()
  private sequence = 0

  seed(collection: string, entityId: string, value: unknown): void {
    this.store(collection).set(entityId, value)
    this.notify(collection, { type: 'created', entityId, value: value as never })
  }

  async publish(collection: string, entity: object): Promise<string> {
    const entityId = (entity as { proposal_id?: string }).proposal_id ?? `${collection}_${(this.sequence += 1)}`
    this.store(collection).set(entityId, entity)
    this.notify(collection, { type: 'created', entityId, value: entity as never })
    return entityId
  }

  async get<T>(collection: string, entityId: string): Promise<T | null> {
    return (this.store(collection).get(entityId) as T | undefined) ?? null
  }

  subscribe<T>(collection: string, handler: (event: BridgeConnectionEvent<T>) => void): () => void {
    const set = this.handlers.get(collection) ?? new Set()
    set.add(handler as (event: BridgeConnectionEvent<never>) => void)
    this.handlers.set(collection, set)
    return () => { set.delete(handler as (event: BridgeConnectionEvent<never>) => void) }
  }

  records(collection: string): unknown[] { return [...this.store(collection).values()] }
  collectionNames(): string[] { return [...this.collections.keys()] }

  private store(collection: string): Map<string, unknown> {
    const existing = this.collections.get(collection)
    if (existing) return existing
    const created = new Map<string, unknown>()
    this.collections.set(collection, created)
    return created
  }

  private notify(collection: string, event: BridgeConnectionEvent<never>): void {
    for (const handler of this.handlers.get(collection) ?? []) handler(event)
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=dev@feltdb.test', '-c', 'user.name=FeltDB Dev', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

function createRepository(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'feltdb-proposal-'))
  mkdirSync(path.join(root, 'src'))
  mkdirSync(path.join(root, 'tests'))
  mkdirSync(path.join(root, 'node_modules', 'left-pad'), { recursive: true })
  writeFileSync(path.join(root, '.gitignore'), '.env\nnode_modules\n')
  writeFileSync(path.join(root, 'feltdb.flow'), 'application SaaS Portal\n  checkout: stripe\n')
  writeFileSync(path.join(root, 'feltdb.config.json'), JSON.stringify({ application: 'saas-portal', secrets: ['STRIPE_SECRET_KEY'] }, null, 2))
  writeFileSync(path.join(root, 'feltdb.contract.json'), JSON.stringify({ version: 'v1.4', assertions: {} }, null, 2))
  writeFileSync(path.join(root, 'src', 'auth.ts'), 'export function authenticate() { return true }\n')
  writeFileSync(path.join(root, 'src', 'models.ts'), 'export interface Account { id: string }\n')
  writeFileSync(path.join(root, 'src', 'routes.ts'), 'export const routes = []\n')
  writeFileSync(path.join(root, 'tests', 'auth.test.ts'), 'export const cases = []\n')
  writeFileSync(path.join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = () => {}\n')
  writeFileSync(path.join(root, '.env'), `STRIPE_SECRET_KEY=${SECRET_VALUE}\nDATABASE_URL=postgres://user:pw@localhost/app\n`)
  git(root, ['init', '-b', 'main'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'initial'])
  return root
}

describe('proposal-aware DevTools bridge', () => {
  let root: string
  let workspace: MemoryWorkspace
  let service: ProposalBridgeService
  let client: ProposalBridgeClient

  beforeAll(() => {
    root = createRepository()
    workspace = new MemoryWorkspace()
    service = new ProposalBridgeService({ connection: workspace, provider: new RepositoryContextProvider({ root, maxFileBytes: 64 }) })
    service.start()
    client = new ProposalBridgeClient(workspace, { clientId: 'devtools-studio', timeoutMs: 10_000 })
    client.start()
  })

  afterAll(() => {
    client.dispose()
    service.stop()
    rmSync(root, { recursive: true, force: true })
  })

  it('exposes bounded repository context over the existing connection', async () => {
    const context = await client.getRepositoryContext()
    expect(context.repository).toMatchObject({ root, branch: 'main', dirty: false, gitAvailable: true })
    expect(context.repository.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(context.flow).toEqual({ path: 'feltdb.flow', hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) })
    expect(context.contract).toMatchObject({ version: 'v1.4', path: 'feltdb.contract.json' })
    expect(context.files).toContain('src/auth.ts')
    expect(context.files).toContain('feltdb.flow')
  })

  it('does not expose the repository beyond its boundary', async () => {
    const context = await client.getRepositoryContext()
    expect(context.files).not.toContain('.env')
    expect(context.files.some((file) => file.startsWith('node_modules/'))).toBe(false)
    expect(context.files.some((file) => file.startsWith('.git/'))).toBe(false)

    await expect(client.readFile('../../etc/passwd')).rejects.toThrow(/outside the connected repository/i)
    await expect(client.readFile('/etc/passwd')).rejects.toThrow(/Absolute paths are not accepted/i)
    await expect(client.readFile('.env')).rejects.toThrow(/credentials/i)
  })

  it('refuses a symlink that escapes the repository', async () => {
    const link = path.join(root, 'escape.txt')
    symlinkSync('/etc/hostname', link)
    try { await expect(client.readFile('escape.txt')).rejects.toThrow(/outside the connected repository/i) }
    finally { rmSync(link, { force: true }) }
  })

  it('reads a repository file inside the boundary', async () => {
    const file = await client.readFile('src/auth.ts')
    expect(file).toMatchObject({ path: 'src/auth.ts', truncated: false })
    expect(file.contents).toContain('authenticate')
  })

  it('bounds an oversized file instead of streaming the repository into the browser', async () => {
    writeFileSync(path.join(root, 'src', 'large.ts'), 'x'.repeat(4096))
    const file = await client.readFile('src/large.ts')
    expect(file.truncated).toBe(true)
    expect(file.contents).toHaveLength(64)
    expect(file.bytes).toBe(4096)
  })

  it('reports a missing file rather than an empty one', async () => {
    await expect(client.readFile('src/absent.ts')).rejects.toThrow(/does not exist/i)
  })

  it('reports required secret names and never their values', async () => {
    const context = await client.getRepositoryContext()
    expect(context.secrets.names).toContain('STRIPE_SECRET_KEY')
    expect(JSON.stringify(context)).not.toContain(SECRET_VALUE)
  })
})

describe('proposal acceptance loop', () => {
  let root: string
  let workspace: MemoryWorkspace
  let service: ProposalBridgeService
  let client: ProposalBridgeClient
  let opened: ProposalIdeContext | undefined
  const statusChanges: Proposal[] = []

  beforeAll(async () => {
    // 1-2. A generated application's repository, with Studio connected to it.
    root = createRepository()
    const provider = new RepositoryContextProvider({ root })
    const context = await provider.context()
    workspace = new MemoryWorkspace()
    service = new ProposalBridgeService({
      connection: workspace,
      provider,
      onOpenInIde: (value) => { opened = value },
      onProposalChanged: (value) => { statusChanges.push(value) },
    })
    service.start()
    client = new ProposalBridgeClient(workspace, { clientId: 'devtools-studio', timeoutMs: 10_000 })
    client.start()

    // 3. FeltDB persists the proposal. DevTools reads it; it never authors one.
    workspace.seed(PROPOSAL_COLLECTION, 'p_123', {
      proposal_id: 'p_123',
      application_id: 'saas-portal',
      status: 'PREVIEWED',
      summary: 'Implement Stripe',
      intent: 'Add Stripe checkout to the SaaS Portal',
      module: { name: 'stripe-compatible', version: '1.0.0' },
      base_contract_hash: context.contract!.hash,
      base_flow_hash: context.flow!.hash,
      repository_commit: context.repository.commit,
      source_plan: [{ path: 'src/auth.ts', action: 'modify' }, { path: 'src/models.ts', action: 'modify' }],
      warnings: ['Stripe requires STRIPE_SECRET_KEY'],
    } satisfies Proposal)
  })

  afterAll(() => {
    client.dispose()
    service.stop()
    rmSync(root, { recursive: true, force: true })
  })

  it('4. compares the opened proposal against the current repository', async () => {
    const comparison = await client.compareProposal('p_123')
    expect(comparison).toMatchObject({ proposalId: 'p_123', contract: 'matches', flow: 'matches', repository: 'clean', conflicts: [] })
    // Not approved yet, so not applicable.
    expect(comparison.applicable).toBe(false)
  })

  it('5-9. opens the proposal in the IDE with contract, files, and git state', async () => {
    const result = await client.openInIde('p_123')
    expect(result.proposalId).toBe('p_123')

    // 6. The IDE receives proposal context, not a coding task.
    expect(opened).toBeDefined()
    expect(opened!.proposalId).toBe('p_123')
    expect(opened!.summary).toBe('Implement Stripe')
    expect(opened!.sourcePlan).toHaveLength(2)

    // 7. Contract snapshot.
    expect(opened!.repository.contract).toMatchObject({ version: 'v1.4' })

    // 8. Relevant repository files, resolved from the source plan.
    const relevant = opened!.relevantFiles.map((file) => file.path)
    expect(relevant).toContain('src/auth.ts')
    expect(relevant).toContain('src/models.ts')
    expect(relevant).toContain('feltdb.flow')
    expect(relevant).not.toContain('src/routes.ts')
    expect(opened!.relevantFiles.find((file) => file.path === 'src/auth.ts')!.contents).toContain('authenticate')

    // 9. Git state.
    expect(opened!.repository.repository).toMatchObject({ branch: 'main', dirty: false, gitAvailable: true })
  })

  it('10. never exposes secret values to the IDE or the agent prompt', () => {
    const prompt = renderProposalAgentPrompt(opened!)
    expect(prompt).toContain('STRIPE_SECRET_KEY')
    expect(prompt).not.toContain(SECRET_VALUE)
    expect(JSON.stringify(opened)).not.toContain(SECRET_VALUE)
    expect(opened!.relevantFiles.some((file) => file.path === '.env')).toBe(false)
  })

  it('10b. frames the agent handoff as proposal work, not an independent task', () => {
    const prompt = renderProposalAgentPrompt(opened!)
    expect(prompt).toContain('You are working on Proposal p_123.')
    expect(prompt).toContain('Do not treat this as an independent coding task.')
    expect(prompt).toContain('feltdb ai apply p_123')
    expect(prompt).toMatch(/Do not apply this proposal/i)
  })

  it('11. never persists a copy of the proposal', () => {
    for (const collection of workspace.collectionNames()) {
      if (collection === PROPOSAL_COLLECTION) continue
      for (const record of workspace.records(collection)) {
        expect(JSON.stringify(record)).not.toContain('Implement Stripe')
      }
    }
    const requests = workspace.records(PROPOSAL_BRIDGE_REQUEST_COLLECTION) as BridgeRequest[]
    expect(requests.every((request) => !('summary' in request) && !('source_plan' in request))).toBe(true)
    expect(requests.some((request) => request.proposalId === 'p_123')).toBe(true)
    const responses = workspace.records(PROPOSAL_BRIDGE_RESPONSE_COLLECTION) as BridgeResponse[]
    expect(responses.every((response) => !('proposal' in response))).toBe(true)
  })

  it('12. leaves approval with FeltDB and observes the result', async () => {
    // Studio asks FeltDB to approve; the bridge has no write path of its own.
    workspace.seed(PROPOSAL_COLLECTION, 'p_123', { ...(await workspace.get<Proposal>(PROPOSAL_COLLECTION, 'p_123'))!, status: 'APPROVED' })
    expect(statusChanges.at(-1)?.status).toBe('APPROVED')
    expect(service.activeProposal?.status).toBe('APPROVED')
  })

  it('13. leaves the repository unchanged', () => {
    expect(git(root, ['status', '--porcelain'])).toBe('')
    expect(readFileSync(path.join(root, 'src', 'auth.ts'), 'utf8')).toBe('export function authenticate() { return true }\n')
  })

  it('14. reports the repository ready for `feltdb ai apply`', async () => {
    const report = await client.proposalDiagnostic('p_123')
    expect(report).toContain('Proposal: p_123')
    expect(report).toContain('Status: APPROVED')
    expect(report).toContain('Contract:\n  ✓ current')
    expect(report).toContain('Flow:\n  ✓ current')
    expect(report).toContain('Working tree: clean')
    expect(report.endsWith('Ready to apply.')).toBe(true)
  })

  it('14b. aborts the diagnostic when the working tree conflicts with the source plan', async () => {
    writeFileSync(path.join(root, 'src', 'auth.ts'), 'export function authenticate() { return false }\n')
    try {
      const report = await client.proposalDiagnostic('p_123')
      expect(report).toContain('Repository has uncommitted changes that conflict')
      expect(report).toContain('Apply aborted.')
    } finally {
      git(root, ['checkout', '--', 'src/auth.ts'])
    }
  })

  it('15. exposes no capability that could apply the proposal', () => {
    expect([...BRIDGE_REQUEST_KINDS].sort()).toEqual(['open_in_ide', 'proposal_comparison', 'proposal_diagnostic', 'read_file', 'repository_context'])
    expect(BRIDGE_REQUEST_KINDS.some((kind) => /write|apply|approve|commit|delete/.test(kind))).toBe(false)
    expect(Object.keys(Object.getOwnPropertyDescriptors(RepositoryContextProvider.prototype)).filter((name) => /write|apply|commit|delete/i.test(name))).toEqual([])
  })

  it('rejects an unknown proposal instead of guessing', async () => {
    await expect(client.compareProposal('p_missing')).rejects.toThrow(/was not found in FeltDB/i)
  })
})
