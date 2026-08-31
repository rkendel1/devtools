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

## Three fingerprints

A proposal is checked against the repository on three fingerprints:

```
Proposal
├── base_contract_hash   ← application-level staleness
├── base_flow_hash       ← application-level staleness
└── repository_commit    ← contextual evidence
```

The contract and flow hashes decide staleness. The repository commit is
evidence, not an authority. A fingerprint the proposal never recorded is
reported `unknown`, never assumed current.

## Relevant-file discovery

The proposal's `source_plan` names candidates. The bridge resolves them against
the files it can actually see and returns at most `MAX_RELEVANT_FILES`. A source
plan cannot widen the bridge's reach: anything outside the tracked, readable set
is dropped. `feltdb.flow` is always included when present — an agent cannot
reason about a proposal without the specification it was generated from. This
bound matters most for local WebLLM, which cannot take a repository as input.

## Security model

- **Workspace boundary.** Only the connected repository is inspectable.
- **Explicit read capability.** Every request is a read; the protocol has no
  write kind, and the repository provider has no write method.
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

The report is produced by `renderProposalDiagnostic()` and served over the
bridge as the `proposal_diagnostic` request, so any workspace client — the
`feltdb` CLI included — gets byte-identical output. The `feltdb` binary itself
ships in `@feltdb/core` and is not part of this repository; the subcommand wiring
belongs there. In VS Code the same report is available today as
**FeltDB: Proposal Repository Status**.

## Acceptance test

`src/lib/proposalBridge.test.ts` runs the loop against a real git repository:
Studio connects, a proposal is persisted in `_feltdb.Proposal`, Studio opens it,
the IDE receives proposal context with the contract snapshot, relevant files,
and git state, secrets stay unexposed, no proposal copy is persisted, approval
stays with FeltDB, the repository is left untouched, and the diagnostic reports
the repository ready for `feltdb ai apply`.
