# Proposal-Aware DevTools Bridge

The DevTools connection is now the repository-context layer for FeltDB
Proposals. Studio and the IDE collaborate around a persisted
`_feltdb.Proposal`; DevTools supplies the repository facts needed to inspect and
review it, and nothing else.

```
Studio
  │
  │ Proposal
  ▼
_feltdb.Proposal
  │
  ▼
DevTools Bridge
  │
  ├── repository
  ├── feltdb.flow
  ├── contract hash
  ├── git state
  ├── source tree
  └── relevant files
          │
          ▼
         IDE
```

`.feltdb/` remains connection, pairing, and workspace state. No proposal is
stored there, and DevTools never persists a proposal of its own.

## What each component owns

| Component | Responsibility |
| --- | --- |
| `feltdb.flow` | Application specification |
| FeltDB | State and the canonical contract |
| Module | External-system semantics |
| Proposal | Intended application change |
| Studio | Inspect / preview / approve |
| DevTools | Repository context bridge |
| IDE / Agent | Developer reasoning and work |
| CLI | Repository application authority |

## Modules

| File | Role |
| --- | --- |
| `src/lib/repositoryContext.ts` | The context contract plus containment and secret policy. Host-independent, no filesystem. |
| `src/lib/proposal.ts` | The read-only `_feltdb.Proposal` view, staleness comparison, and the diagnostic report. |
| `src/lib/proposalContext.ts` | The proposal context an IDE agent receives, and its handoff prompt. |
| `src/lib/proposalBridge.ts` | The request/response protocol and the Studio-side client. |
| `src/panel/devtools/ProposalWorkspacePanel.tsx` | Studio's proposal surface: Preview / Open in IDE / Approve. |
| `vscode-extension/src/repository-context.ts` | The only code that touches disk or git. Read-only. |
| `vscode-extension/src/proposal-bridge-service.ts` | The repository side of the bridge. |
| `vscode-extension/src/proposal-bridge.ts` | VS Code wiring: commands, agent handoff, proposal status. |

## Repository context

`getRepositoryContext()` returns a bounded view — never the whole repository:

```json
{
  "repository": { "root": "…", "branch": "main", "commit": "abc123", "dirty": true, "changedFiles": [] },
  "flow": { "path": "feltdb.flow", "hash": "sha256:…" },
  "contract": { "version": "v1.4", "hash": "sha256:…", "path": "feltdb.contract.json" },
  "files": ["src/…", "tests/…", "feltdb.flow"],
  "secrets": { "names": ["STRIPE_SECRET_KEY"] }
}
```

The file listing comes from git's own view of the repository (`ls-files` plus
non-ignored untracked files), filtered through the containment rules and capped
at `MAX_CONTEXT_FILES`.

## Bounded file access

`readFile(path)` accepts repository-relative paths only. It refuses:

- `../` traversal in any position
- absolute paths, drive letters, and URLs
- excluded directories (`.git`, `.feltdb`, `node_modules`, build output)
- credential paths (`.env*`, `*.pem`, `*.key`, `.npmrc`, `.ssh/`, `secrets.*`, …)
- symlinks whose real path resolves outside the repository

Containment is enforced twice: once on the requested path before any filesystem
call, and again on the resolved real path. Files above `MAX_FILE_BYTES` are
truncated rather than streamed whole.

## Session binding

A DevTools session may be bound to one proposal:

```
DevTools session
    └── activeProposalId
```

Studio binds when it opens a proposal in the IDE. While bound:

- requests naming a different proposal are refused (`proposal_mismatch`)
- every response carries the binding, so the client can see what it is answering for
- a `read_file` outside the proposal's source plan is flagged `outsideSourcePlan`
  and reported to the IDE

This is what stops an IDE from drifting out of "I am working on Proposal p_123"
into arbitrary repository work without the developer noticing. An unbound
session never adopts a proposal on its own — it only tracks one it was
explicitly bound to.

## Three fingerprints

A proposal is checked against the repository on three fingerprints:

```
Proposal
├── base_contract_hash   ← authority
├── base_flow_hash       ← authority
└── repository_commit    ← evidence
```

The contract and flow hashes decide staleness. The repository commit is
evidence and cannot decide anything: commit drift can only ever land in
`ProposalReadiness.notes`, never in `blockers`. A proposal generated at a
different commit is still applicable when the contract and flow it was
generated against are unchanged. A fingerprint the proposal never recorded is
`unrecorded`, never assumed current.

## Readiness

`ProposalReadiness` is the one canonical semantic result. Studio, the IDE, and
`feltdb ai proposal` all render this same structure — there is no separate CLI
model and no separate Studio model.

```
ProposalReadiness
  contract:        current | stale | unrecorded    (authority)
  flow:            current | stale | unrecorded    (authority)
  repository:      clean | modified | unknown
  commitEvidence:  { proposal, current, matches }  (evidence only)
  sourceConflicts: []
  secretsExposed:  []
  ready:           true
  blockers:        []
  notes:           []
```

`secretsExposed` is an asserted invariant rather than an assumption: readiness
re-checks the context it was handed for credential paths and refuses to report
ready if one got through.

## Source-plan conflict detection

When a proposal plans to touch `src/auth.ts` and the developer has modified it
locally, the bridge says so before anyone reaches apply:

```
⚠ Proposal conflict
src/auth.ts
  modified locally, proposal plans to modify
```

The bridge only establishes that a conflict exists. It does not merge and it
does not decide what happens next — that is the CLI's call at apply time.

## Proposal context refresh

`getProposalContext(proposalId)` returns the current status, contract and flow
fingerprints, repository commit, readiness, source plan, relevant file paths,
and warnings.

The proposal is durable state; this snapshot is ephemeral context. It is
recomputed from FeltDB and disk on every request, never served from a cache,
and stamped with `expiresAt` (`PROPOSAL_CONTEXT_TTL_MS`). Consumers must
refresh rather than hold it.

The snapshot carries the proposal's *operational* fields only. The narrative
body — summary, intent, rationale — stays in `_feltdb.Proposal` and never
travels over the bridge, so no bridge record can be mistaken for, or
reassembled into, a proposal.

## Relevant-file discovery

The proposal's `source_plan` names candidates. The bridge resolves them against
the files it can actually see and returns at most `MAX_RELEVANT_FILES`. A source
plan cannot widen the bridge's reach: anything outside the tracked, readable set
is dropped. `feltdb.flow` is always included when present — an agent cannot
reason about a proposal without the specification it was generated from. This
bound matters most for local WebLLM, which cannot take a repository as input.

## Security model

- **Workspace boundary.** Only the connected repository is inspectable.
- **Explicit read capability.** Every request is a read of the repository; the
  protocol has no write kind, and the repository provider has no write method.
  `bind_proposal` is the one stateful kind, and the only state it touches is the
  session's own `activeProposalId`.
- **No secret exposure.** Credential paths are never listed or read. Required
  secret *names* may be reported (`STRIPE_SECRET_KEY`); a value never is.
  `.env` is read internally for its key names only.
- **No proposal duplication.** The protocol carries proposal *identifiers*. The
  repository side reads `_feltdb.Proposal` itself, so no proposal body travels
  over the bridge and DevTools stores no copy.

## No implicit source mutation

This layer explicitly prohibits:

```
Studio        → repository write
DevTools      → repository write
Proposal API  → repository write
IDE connection → repository write
```

Existing IDE tooling keeps whatever explicit developer and agent workflows it
already supports. Proposal application remains CLI authority:

```
Proposal → Approved → feltdb ai apply → Repository → Applied
```

The bridge is context transport.

## Connection lifecycle

The bridge reuses the existing `connections.json` / `pairing.json` /
`workspace.json` mechanism and the same `DevelopmentWorkspaceConnection` the IDE
already holds for runtime investigations. There is no second connection
registry and no second Studio↔IDE integration.

## What does not belong here

Two boundaries hold the architecture together, and both are easy to erode by
accident.

**`.feltdb/` stays connection and workspace tooling.**

```
.feltdb/
├── connections.json
├── pairing.json
└── workspace.json
```

The proposal stays in `_feltdb.Proposal`. The bridge is the transport and
context layer between them.

**Data Explorer does not belong in DevTools.** DevTools has repository access,
which makes it tempting to let it inspect FeltDB data too. It must not. Data
inspection goes through the Service API; DevTools goes to the repository and the
IDE:

```
                   Studio
                  /      \
                 /        \
                ▼          ▼
          Service API    DevTools
                │           │
                ▼           ▼
             FeltDB       Git/IDE
                │
                ▼
          _feltdb.Proposal
```

DevTools is a typed transport and context bridge, not the application's
authority.

## CLI

`feltdb ai proposal <proposal-id>` reports whether the repository can apply a
proposal:

```
Proposal: p_123
Status: APPROVED
Contract:
  ✓ current
Flow:
  ✓ current
Repository:
  Branch: main
  Commit: abc123
  Working tree: clean
Ready to apply.
```

or, when the working tree conflicts with the source plan:

```
Repository has uncommitted changes that conflict
with the proposal source plan.
  src/auth.ts
Apply aborted.
```

The report is rendered from `ProposalReadiness` by `renderProposalDiagnostic()`
and served over the bridge as the `proposal_diagnostic` request, with the
structured result itself available as `proposal_readiness`. Any workspace client
— the `feltdb` CLI included — gets the same structure and byte-identical text. The `feltdb` binary itself
ships in `@feltdb/core` and is not part of this repository; the subcommand wiring
belongs there. In VS Code the same report is available today as
**FeltDB: Proposal Repository Status**.

## Build and distribution

`dist/` is a first-class build artifact, not a by-product of the type check.
The extension must run from compiled output alone, with no TypeScript source
tree present.

```
npm --prefix vscode-extension run build     # clean rebuild
npm --prefix vscode-extension run verify    # build, then check the artifact
npm --prefix vscode-extension run package   # build, then produce a .vsix
```

The canonical entrypoint, named by the extension manifest's `main`:

```
vscode-extension/dist/
├── src/lib/                        shared bridge modules
│   ├── proposal.js
│   ├── proposalBridge.js
│   ├── proposalContext.js
│   └── repositoryContext.js
└── vscode-extension/src/
    └── extension.js                ← main
```

The layout has two roots because the extension compiles the shared bridge
modules from the repository root (`rootDir: ".."`). The emitted extension
reaches them as `../../src/lib/*.js`, which resolves *inside* `dist/` — the
distribution is self-contained and never reads from the source tree at runtime.

`npm run build` cleans `dist/` first, so no stale JavaScript can survive a
rename or deletion, and repeated builds produce an identical file set.

`src/` is source and `dist/` is generated: `dist/` is gitignored and never
committed.

### What `verify` checks

A green `tsc` does not prove the built extension is installable. The verifier
builds from clean and then checks the artifact itself:

1. the entrypoint named by `main` exists
2. the shared bridge modules are emitted alongside it
3. no emitted module imports outside `dist/`, and every relative import resolves
   to a file that was actually emitted
4. every external import is a declared dependency or a Node builtin
5. a clean rebuild is deterministic and drops stale output
6. the entrypoint **loads** — the whole module graph is evaluated against a
   generated `vscode` stub, and `activate`/`deactivate` are asserted
7. the packaging tool would ship the entrypoint and the shared modules

Step 6 is the one that catches `tsc` green but extension broken: a missing
emit, a bad specifier, or an unresolvable dependency fails here rather than at
install time. The `vscode` stub is generated from the compiled output, so a
newly used API cannot silently skip the check.

CI runs lint, typecheck, and the test suite alongside this, so packaging cannot
regress the bridge and the bridge cannot regress packaging.

## Acceptance test

`src/lib/proposalBridge.test.ts` runs the loop against a real git repository:
Studio connects, a proposal is persisted in `_feltdb.Proposal`, Studio opens it,
the IDE receives proposal context with the contract snapshot, relevant files,
and git state, secrets stay unexposed, no proposal copy is persisted, approval
stays with FeltDB, the repository is left untouched, and the diagnostic reports
the repository ready for `feltdb ai apply`.
