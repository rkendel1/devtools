# DevTools Architecture and Capability Audit

Status: factual audit of the repository at FeltDB core 0.6.10. This document describes implemented behavior and separately labels inactive scaffolding. It does not propose or introduce runtime behavior.

## 1. Executive summary

The repository owns three materially different products:

1. A Chromium DevTools extension that captures network requests and page errors, builds local evidence-backed `InvestigationRecord` objects, stores them in a browser-local FeltDB database, and can publish a second, workspace-facing `runtime_investigation` object.
2. A VS Code extension that connects to the same FeltDB Development Workspace, reads and updates `runtime_investigations`, observes files and Git, opens local source, and hands an investigation prompt to the active VS Code chat agent.
3. An experimental `@feltdb/development-runtime` browser package for select/capture/verify element workflows. It is exercised by tests and imported by an alternate `WorkspacePanel`, but that panel is not mounted by the shipping browser entry point.

The live cross-product boundary is not a DevTools-owned server. Both shipping clients call `connectDevelopmentWorkspace()` from `@feltdb/core/workspace`, then use the returned `DevelopmentWorkspaceConnection` (`publish`, `query`, `update`, `subscribe`, and `disconnect`). The authority and pairing/discovery implementation are owned by FeltDB core.

Two incompatible artifacts are called an envelope in or around this repository:

- `InvestigationContextEnvelope` in `src/lib/developmentWorkspace.ts` is local, unversioned scaffolding used only by the in-memory `LocalDevelopmentBridge` and tests. It is not used by the shipping browser-to-VS-Code path.
- The live handoff is the `kind: "runtime_investigation"` object created in `src/background.ts`. VS Code independently declares its expected shape as `RuntimeInvestigationEnvelope` in `vscode-extension/src/workspace-client.ts`. There is no shared DevTools source file or runtime schema validator for this shape.

FeltDB core 0.6.10 also contains the PR7 Runtime Observation contract: `RuntimeRequestObservation`, stored in `runtime_observation`, produced by `startRuntimeObservation()`. This DevTools repository does not call that observer, publish that shape, or query that collection. The browser's `InvestigationRecord`/`runtime_investigation` path is therefore an overlapping, parallel observation-and-investigation mechanism today.

The most important boundary finding is: DevTools owns capture, presentation, local analysis, source navigation, and development-activity observation; FeltDB owns workspace discovery, pairing resolution, client registration, transport, durable workspace collections/events, and now the canonical Runtime Observation and Runtime Investigation contracts.

## 2. Repository map

| Path | Verified purpose | Owner | Surface | Consumers |
|---|---|---|---|---|
| `src/panel/` | Shipping React DevTools panel. `src/panel/main.tsx` mounts `src/panel/App.tsx`. | DevTools | Private extension UI | Browser user |
| `src/devtools/main.ts` | Registers the Chrome DevTools panel named `Investigate`. | DevTools | Browser-extension entry point | Chrome DevTools |
| `src/background.ts` | Shipping MV3 service worker: workspace connection, handoff, verification coordination, event storage, offscreen AI routing. | DevTools | Extension-internal message API | Panel and content script |
| `public/page-capture.js` | Main-world hooks for `console.error`, uncaught errors, and unhandled rejections. | DevTools | Injected page instrumentation | `public/content.js` |
| `public/content.js` | Relays serialized page events into `chrome.runtime`. | DevTools | Extension-internal bridge | `src/background.ts` |
| `src/lib/chrome.ts` | Chrome DevTools Network/HAR capture, stored console-event retrieval, environment and screenshot capture, source opening. | DevTools | Private module | Shipping panel |
| `src/lib/types.ts` | Local network, error, evidence graph, result, and `InvestigationRecord` shapes. | DevTools | Private TypeScript contract | Panel/evidence/storage code; copied structurally into VS Code types |
| `src/lib/evidenceEngine.ts`, `reasoner.ts` | Redacts and correlates request/runtime evidence; produces local heuristic diagnosis. | DevTools | Private analysis | Shipping panel |
| `src/lib/feltRepository.ts`, `store.ts`, `retention.ts` | Browser-local persistence, graph normalization, history cache, search, and retention. | DevTools using FeltDB database primitives | Private storage | Shipping panel and panel components |
| `src/lib/investigationEnvelope.ts`, `developmentWorkspace.ts`, `developmentBridge.ts` | Older local context-envelope and in-memory bridge model. Imports show no shipping consumer. | DevTools | Inactive scaffolding/test surface | Tests and these modules themselves |
| `src/lib/workspaceConnection.ts` | Placeholder workspace API: connection returns `workspace: null as any`; query/publish/subscribe bodies are empty. | DevTools | Inactive scaffolding | Tests/none in shipping path |
| `src/panel/devtools/` | Alternate select/change/verify workspace UI and key/value `WorkspaceChannel` client. `WorkspacePanel` is not imported by `src/panel/App.tsx` or an entry point. | DevTools | Inactive/experimental UI | Tests/none in shipping build path |
| `packages/development-runtime/` | Browser adapter API and `DevelopmentRuntime` orchestration for element selection, measurement, replay capability, and verification. | DevTools package | Exported package API | Tests and inactive `WorkspacePanel` |
| `vscode-extension/src/` | Shipping VS Code workspace client, tree, webviews, commands, source lookup, agent handoff, filesystem/Git observer. | DevTools | VS Code extension API/UI | VS Code user |
| `wasm-engine/` | Rust/WASM deterministic JSON normalization used by `src/lib/evidenceEngine.ts`. | DevTools | Private build artifact | Browser panel build |
| `src/offscreen/`, `src/lib/localAi.ts` | Optional WebLLM inference hosted in an offscreen extension document. | DevTools | Extension-internal | Shipping panel/background |
| `e2e/` | Real-browser and workspace-pairing harnesses. Several Firefox gates are explicitly scaffolded/TODO, per `e2e/firefox-real.mjs`. | DevTools tests | Private | Maintainers |
| `src/**/*.test.ts`, `packages/**/*.test.ts` | Unit and integration tests for capture, evidence, replay, workspace models, and runtime adapters. | DevTools tests | Private | Maintainers |
| `demo/`, `public/test-page.html`, adapter fixture HTML | Examples and browser fixtures. | DevTools tests/examples | Private | Maintainers/tests |
| `dist/`, `vscode-extension/dist/`, `*.vsix` | Generated browser and VS Code extension artifacts. | Build output | Distributable | Browser/VS Code installation |

Shipping entry points are established by `vite.config.ts`, `public/manifest.json`, `src/devtools/main.ts`, and `src/panel/main.tsx`. This is why similarly named code under `src/panel/devtools/` and `src/App.tsx` is not counted as shipping functionality without an import path from those entries.

## 3. Envelope architecture

### 3.1 The live envelope

What exactly is the envelope on the implemented Browser-to-VS-Code path? It is a plain JSON-serializable object created by `handleInvestigationHandoff()` in `src/background.ts`, published as the value of an entity in the FeltDB workspace collection `runtime_investigations`, and structurally consumed as `RuntimeInvestigationEnvelope` in `vscode-extension/src/workspace-client.ts`.

It has no exported shared schema. Browser construction is inferred locally; VS Code accepts any object for which `isEnvelope()` finds `kind === "runtime_investigation"`, an investigation ID, a request graph, and a result. `schemaVersion` is written as `1` but is not checked by VS Code.

Representative sanitized structure, containing only fields present in implementation:

```ts
{
  kind: "runtime_investigation",
  schemaVersion: 1,
  workspaceId: "ws_…",
  entityId: "entity_…",             // added in a follow-up workspace update
  lifecycle: "NEW",
  status: "OPEN",
  source: {
    clientId: "browser-extension-…",
    clientType: "browser",
    product: "chrome-runtime-investigator"
  },
  sentAt: 0,
  createdAt: 0,
  updatedAt: 0,
  originalObservationId: "request-or-investigation-id",
  history: [{ type: "OBSERVATION_CAPTURED", at: 0, data: { observationId: "…" } }],
  delivery: "manual" | "automatic",
  investigation: {
    id: "…",
    createdAt: 0,
    requestId: "METHOD:url:timestamp",
    requestUrl: "https://…",
    graph: { request: {}, response: {}, relatedEvents: [], anomalies: [], trace: [], bundle: {} },
    result: { diagnosis: "…", confidence: 0.0, evidence: [], alternatives: [], nextActions: [] }
  },
  verificationOf: "entity_…"        // optional; browser writes it, VS Code type omits it
}
```

VS Code later adds `developmentActivity`, `changeId`, `verificationId`, lifecycle/status transitions, and `verifications`; see `recordDevelopmentActivity()` in `vscode-extension/src/workspace-client.ts`. The browser later appends verification history and results in `src/background.ts`.

Lifecycle: local creation -> workspace `publish()` -> workspace-generated entity ID -> `update()` to embed `entityId` -> VS Code subscription/query -> VS Code lifecycle/development updates -> browser verification update. Serialization and durable wrapping are performed by the core `HttpWorkspaceTransport`, which stores `{workspaceId, collection, entityId, value, updatedAt}` and emits `WorkspaceEventPayload`; see the installed 0.6.10 implementation at `node_modules/@feltdb/core/dist/workspace/workspace-connection.js`.

### 3.2 The inactive context envelope

`InvestigationContextEnvelope` is declared in `src/lib/developmentWorkspace.ts` and created by `extractInvestigationEnvelope()` in `src/lib/investigationEnvelope.ts`. It contains `workspaceId`, `investigationId`, optional task, problem/diagnosis, reproduction, optional replay summary, causal counterfactuals, and evidence node IDs. `LocalDevelopmentBridge.publishInvestigation()` converts it into an in-memory `DevelopmentTask`.

It has no kind, envelope ID, timestamps, schema version, serializer, transport, runtime identity, session identity, or commit context. Repository imports show that the extractor and bridge are not reached from the shipping browser or VS Code entry points. It is therefore not “the existing envelope” for the live connection.

## 4. Connection lifecycle

### 4.1 Browser DevTools

```text
WorkspaceConnection form (pairing code)
  -> chrome.runtime message: feltdb:test-bootstrap
  -> src/background.ts: handleFeltDBBootstrap
  -> @feltdb/core/workspace.connectDevelopmentWorkspace
  -> HTTP pairing discovery at 127.0.0.1:7799
  -> resolved workspace authority endpoint
  -> DevelopmentWorkspaceConnection client registration
  -> subscription to investigation_changes
  -> publish/query/update runtime_investigations
  -> FeltDB workspace authority/durable collections
```

Evidence: `src/panel/App.tsx`, `src/panel/components/WorkspaceConnection.tsx`, `src/background.ts`, and the core connection API in `node_modules/@feltdb/core/dist/workspace/workspace-connection.{d.ts,js}`.

- Establishment: explicit pairing-code submission. The panel message is still named `feltdb:test-bootstrap`, although it is the shipping connection path.
- Discovery: browser passes no project directory; core resolves the pairing code through HTTP discovery, defaulting to `http://127.0.0.1:7799`.
- Validation/authentication: DevTools validates only `FELT-[A-Z0-9]{6}`. Core discovery validates the response shape and expiry presence. The resolved authority connection passes an empty token unless `auth` was supplied; DevTools supplies none.
- Pairing expiration: enforced by the discovery service/core response at connection time. No DevTools timer revalidates it after connection.
- Subscription transport: core's HTTP database change subscription plus a 250 ms event-log reconciliation interval. The event log is filtered to events at/after subscription time.
- Reconnect: none in browser code. A background/service-worker restart loses `extensionWorkspace` and the workspace subscription. The panel has no implemented restoration path.
- Disconnect: core supports it, but the shipping browser UI does not invoke it. The displayed Disconnect button only clears the component's input state. Thus browser disconnect is **not implemented**.
- Heartbeat/expiration: no heartbeat, lease refresh, or connected-client expiry is visible in DevTools or the inspected core connection implementation.
- Page session restart: browser-local investigation history survives in IndexedDB/localStorage. Captured page events use `chrome.storage.session`; `tabs.onRemoved` deletes that tab's event buffer.

### 4.2 VS Code

```text
connect/reconnect/activation restore command
  -> FeltWorkspaceClient.connect(pairingCode, openFolder)
  -> @feltdb/core/workspace.connectDevelopmentWorkspace
  -> local .feltdb/pairing.json resolution when applicable,
     with retry through pairing discovery without projectDir
  -> authority client registration
  -> subscribe/query runtime_investigations
  -> FeltDB workspace authority/durable collections
```

Evidence: `vscode-extension/src/commands.ts`, `extension.ts`, and `workspace-client.ts`.

- Establishment: explicit pairing code, client ID `vscode-<machineId prefix>`, client type `ide`, with the first open workspace folder as `projectDir`.
- Discovery: the core first tries local `.feltdb/pairing.json` for a supplied project directory. On a not-found/expired error, VS Code retries without `projectDir`, which uses HTTP pairing discovery.
- Reconnect/restart: the last pairing code is stored in VS Code `globalState`. `restoreWorkspace()` reconnects on activation; the Reconnect command uses the same value. The code is not a durable authority credential and may have expired.
- Disconnect: unsubscribes, unregisters the core client, clears active items, and resets the VS Code context key. Explicit and implemented.
- Runtime/session restart: reconnect plus `query('runtime_investigations')` restores durable records. Active records are reconstructed when status/lifecycle is `INVESTIGATING`, `CHANGE_DETECTED`, or `VERIFYING`.
- Heartbeat/connection expiration: none implemented. Connection failure after startup is not automatically retried.

## 5. Identity model

| Identity | Source and shape | Scope/lifetime | Producer/consumer | Persistence |
|---|---|---|---|---|
| Workspace ID | Resolved by core pairing/discovery; `ws_…` in examples | Shared development workspace | FeltDB -> browser/VS Code/envelopes | FeltDB metadata; VS Code reconnects via saved pairing code |
| Project ID | `WorkspaceMetadata.projectId` / `.feltdb/workspace.json` in core | Project discovery | FeltDB core; not directly used by DevTools clients | FeltDB discovery metadata |
| Browser capture session ID | `tab:<chrome tabId>` | One tab's local captured records | `feltRepository` | Browser-local FeltDB; bounded/24-hour retention |
| Runtime instance ID | No explicit identity | — | — | **Absent** |
| Application ID | No explicit identity | — | — | **Absent** |
| Workspace client/connection ID | `browser-extension-<extension id prefix>` or `vscode-<machine id prefix>` | Registration for a connected client; stable prefix across reconnects | DevTools -> core events/source | FeltDB `_development_workspace_clients` while registered; envelope `source.clientId` |
| Pairing ID/code | `FELT-XXXXXX` | Short-lived discovery token | `feltdb dev` -> user -> clients | VS Code globalState stores last code; browser does not persist it explicitly |
| Local request ID | `${method}:${url}:${startedAt}` | One captured HAR request | `src/lib/chrome.ts` | Local request collection and investigation `requestId` |
| Local investigation ID | `crypto.randomUUID()`, reused by fingerprint issue grouping | Local grouped investigation history | Shipping panel -> envelope/VS Code UI | Browser local DB and workspace envelope |
| Envelope ID | No dedicated field | — | — | **Absent**. The durable workspace entity ID serves as record identity. |
| Workspace entity ID | `entity_<time>_<random>` generated by core | One value in one workspace collection | Core -> browser/VS Code | Workspace entity wrapper and embedded back into live envelope |
| Workspace event ID | `event_<time>_<random>` generated by core | One created/updated event | Core transport -> subscribers | Workspace event log |
| Original observation ID (legacy live envelope) | local request ID or investigation ID | Link from live envelope to local capture | Browser -> VS Code | Envelope field/history; semantic fallback makes it non-uniform |
| PR7 observation ID | `createObservationId()` on `RuntimeRequestObservation` | One canonical runtime request observation | FeltDB core runtime observer/supervisor | `runtime_observation` collection; not used by DevTools path |
| Correlation ID | PR7 `createCorrelationId()` | One in-flight request and nearby events | FeltDB core runtime observer | Runtime Observation; absent from DevTools envelope |
| Change ID | `change_<time>_<UUID prefix>` | One correlated development activity | VS Code -> envelope/change/verification collections | Workspace records |
| Verification ID | `verification_<time>_<UUID prefix>` | One verification cycle | VS Code -> browser and workspace | Workspace records and browser session pending-verification state |
| Commit ID | `git rev-parse HEAD` SHA | Repository HEAD at a development-activity snapshot | VS Code observer -> workspace | Nested under `developmentActivity[].git` and `investigation_changes.git` |

The implemented legacy hierarchy is not a strict ownership tree. It is a graph:

```text
workspaceId
  +-- clientId
  +-- workspace entityId -> runtime_investigation value
        +-- local investigation.id
        +-- originalObservationId -> local request/investigation identity
        +-- changeId -> developmentActivity.git.commit (optional)
        +-- verificationId -> later observation entity/result

browser-local tab sessionId -> requestId -> local investigation.id
```

PR7 defines a separate canonical chain in core: workspace -> `RuntimeRequestObservation.observationId` (plus optional correlation/investigation/verification IDs) -> core `RuntimeInvestigation.observationId`. DevTools has not integrated that chain.

## 6. Commit context

Commit context is produced only by the VS Code `DevelopmentObserver` in `vscode-extension/src/development-observer.ts`, after at least one investigation has been marked active. It runs Git commands in the first workspace folder: current branch, `rev-parse HEAD`, author/date, status, diff/stat, and HEAD files/stat. The working diff is capped at 200,000 characters.

The resulting `DevelopmentActivity.git` enters the live `runtime_investigation` through `FeltWorkspaceClient.recordDevelopmentActivity()` and is also copied to the `investigation_changes` record. Browser DevTools receives it by subscribing to `investigation_changes` in `src/background.ts`; it displays changed files/diff/branch/commit in its verification state. VS Code receives its own updated envelope through the workspace subscription and renders the latest activity in `InvestigationView`.

Commit context is not present when the browser initially creates the envelope. It is an optional, later association based on filesystem-path relevance scoring. It survives client reconnect because it is embedded in the durable workspace entity. Browser service-worker restart can recover the most recent active verification only after the user reconnects; `handleFeltDBBootstrap()` queries it.

Runtime observations can be associated with a commit indirectly through the active legacy investigation's `developmentActivity`, `changeId`, and verification result. The legacy browser observation itself does not carry a commit ID. PR7's core `RuntimeRequestObservation` also has no commit field; core's separate `RuntimeInvestigation.remediation` uses `RepositoryIdentity` and `changeIdentity` (`workspace-types.d.ts`).

## 7. Capability matrix

`Shared` means an implemented shared component used by both shipping clients, not merely similarly named code.

| Capability | Browser | VS Code | Shared | Evidence/source |
|---|---:|---:|---:|---|
| Runtime discovery | PARTIAL | PARTIAL | YES | Pairing discovers a workspace authority, not runtime instances: `src/background.ts`, VS Code `workspace-client.ts`, core connection |
| Pairing | YES | YES | YES | Shipping UIs/commands + core `connectDevelopmentWorkspace()` |
| Runtime identity | NO | NO | NO | Only client type/ID and product are recorded; no runtime instance identity |
| Workspace identity | YES | YES | YES | Live envelope/client state + core connection |
| Commit context | PARTIAL | YES | PARTIAL | Produced in VS Code; browser receives only change-associated snapshot |
| Live observations | YES | YES | PARTIAL | Browser captures requests/errors; VS Code receives live legacy envelopes; shared workspace transport only |
| Network inspection | YES | PARTIAL | NO | Browser HAR/bodies/headers; VS Code renders persisted request evidence but cannot inspect live network |
| Database inspection | NO | NO | NO | Browser uses a local FeltDB database but exposes no general DB inspector |
| Collection inspection | NO | NO | NO | Fixed collection calls are not a collection inspection UI/API |
| Transaction inspection | NO | NO | NO | No implementation found |
| Error inspection | YES | YES | PARTIAL | Browser page hooks/evidence; VS Code renders related persisted events |
| Source context | YES | YES | PARTIAL | Browser initiator/openResource; VS Code persisted source resolution |
| File context | PARTIAL | YES | NO | Browser receives changed file names; VS Code observes filesystem and opens files |
| Git context | PARTIAL | YES | NO | VS Code produces Git snapshot; browser consumes it during verification |
| Investigation | YES | YES | PARTIAL | Shared workspace record, but duplicated structural types and browser-local reasoning |
| Diagnostics | YES | PARTIAL | NO | Browser heuristic diagnosis/anomalies; VS Code displays and hands them off |
| Agent integration | NO | YES | NO | VS Code active-chat prompt/clipboard fallback; browser local WebLLM is analysis, not coding-agent handoff |
| Historical events | YES | YES | PARTIAL | Browser local history/retention; workspace query restores envelopes; no common history API |
| Search | YES | NO | NO | Browser request/history search and similarity query |
| Filtering | YES | NO | NO | Browser status/domain/type/time filters |
| Export | YES | NO | NO | Browser text/Markdown/Jira/JSON copy/download |

## 8. Browser DevTools architecture

The shipping extension has one DevTools panel, `Investigate`, registered by `src/devtools/main.ts`. `src/panel/App.tsx` renders request filters, investigation details, screenshots, local AI controls, history/issue groups, maintenance/privacy state, and workspace connection/verification state. Supporting components under `src/panel/components/` render evidence graphs, screenshots, generated tests, and verification details.

It talks to FeltDB in two different ways:

- Browser-local database: `feltRepository` calls `createFeltDB({ namespace: 'chrome-runtime-investigator-v2', browser: true })` and owns fixed collections for investigations, graph records, findings, settings, sessions, requests, and runtime events.
- Development Workspace: the panel sends extension messages; `src/background.ts` calls the core workspace client directly. It does not route through Studio and contains no Studio API call.

Its local UI state is React state plus refs; compatible history/privacy copies are kept in `localStorage`; durable local records use FeltDB/IndexedDB; transient captured page events and pending verification markers use `chrome.storage.session`; the workspace connection lives only in service-worker memory.

Representative feature flow — automatic failed-request investigation:

1. `chrome.devtools.network.onRequestFinished` is converted to `NetworkRequestSnapshot` by `src/lib/chrome.ts`.
2. Page errors captured by `public/page-capture.js` cross the isolated-world boundary through `public/content.js`, then are retained by `src/background.ts` in `chrome.storage.session`.
3. `src/panel/App.tsx` retrieves nearby errors/environment and calls `buildEvidenceGraph()` and `reasonFromEvidence()`.
4. The resulting local `InvestigationRecord` is grouped by fingerprint and persisted by `src/lib/store.ts`/`feltRepository`.
5. If a workspace is connected, the panel sends `runtime-investigator:observe`; the background constructs and publishes a `runtime_investigation` envelope.
6. VS Code receives the workspace event; no direct Browser-to-IDE socket or Studio hop exists.

Runtime assumptions: Chrome DevTools Network and inspected-window APIs, an MV3 extension background, Chrome-compatible session/offscreen/alarms APIs, and a reachable local pairing/authority service. The manifest exposes the page capture to all URLs. Firefox/WebKit runtime adapters and tests do not make the shipping manifest a Firefox or Safari extension.

## 9. VS Code architecture

The extension contributes one activity-bar container and one tree view, `feltdb.runtimeInvestigations`. It also creates webviews for investigation detail, request trace, and comparison (`vscode-extension/src/investigation-view.ts`).

Commands registered in `vscode-extension/src/commands.ts` are:

- `feltdb.connectWorkspace`, `disconnectWorkspace`, `reconnectWorkspace`, `refreshInvestigations`
- `feltdb.openInvestigation`, `showSource`, `viewTrace`, `compareInvestigation`
- `feltdb.investigateRuntimeIssue`

Connection and envelope consumption are in `FeltWorkspaceClient`. Source integration resolves persisted initiator/trace URLs against open workspace folders and opens an exact local file. Git/file integration is in `DevelopmentObserver`. No VS Code DiagnosticCollection or Problems-panel integration exists; “diagnostics” are displayed investigation content. Agent integration opens the provider-neutral active VS Code chat with a structured prompt, or copies it to the clipboard and opens an agent picker.

Representative feature flow — investigate and verify:

1. Workspace subscription/query yields a `runtime_investigation`; `InvestigationProvider` inserts it into the tree and updates an open webview.
2. `Investigate Runtime Issue` calls `markInvestigating()`, updating the durable envelope, then sends a read-only prompt to the active chat agent.
3. While an investigation is active, `DevelopmentObserver` batches filesystem/Git changes.
4. Relevance scoring associates changed paths with persisted source/endpoint hints. Associated activity updates the envelope to `VERIFYING` and publishes `investigation_changes` plus `INVESTIGATION_VERIFICATION_STARTED`.
5. Browser background receives the change; a matching later browser investigation updates the original envelope and publishes an `INVESTIGATION_VERIFICATION_RESULT`.
6. VS Code receives the update, refreshes views, and notifies when lifecycle becomes `RESOLVED`.

There is no command that directly queries a running application, database, collection, or transaction. Inspection is of persisted envelope content and local source/Git state.

## 10. Shared infrastructure

Genuinely shared by both shipping clients:

- `@feltdb/core/workspace` connection API and its workspace ID, client registration, HTTP transport, entity collections, event log, and subscription mechanism.
- Collection names used by convention: `runtime_investigations`, `investigation_changes`, and `investigation_verifications`.
- The durable live `runtime_investigation` value, but only structurally; its TypeScript declaration is duplicated rather than imported.

Not genuinely shared:

- Browser `src/lib/types.ts` and VS Code's copied `RuntimeInvestigation`/envelope types.
- Browser-local `InvestigationContextEnvelope`, local `DevelopmentWorkspace` family, placeholder `workspaceConnection`, and `LocalDevelopmentBridge`.
- Experimental `WorkspaceChannel` key/value client versus the core `DevelopmentWorkspaceConnection` used in shipping code.
- Browser local persistence/state versus VS Code provider/client state.
- Runtime observation capture: DevTools page/HAR capture and core PR7 `startRuntimeObservation()` are separate implementations.
- Development/runtime verification types exist independently in `src/lib/developmentWorkspace.ts`, `packages/development-runtime/src/types.ts`, VS Code, and FeltDB core.

These duplications are inventory findings only; this audit does not refactor them.

## 11. FeltDB integration boundary

| DevTools capability | FeltDB endpoint/API | Protocol | Direction | Runtime source |
|---|---|---|---|---|
| Discovery | `resolvePairingCode()`; default `/api/v1/development/pairing/:code` at port 7799 | HTTP JSON | DevTools -> FeltDB discovery | Browser background; VS Code client/core |
| Local IDE discovery | `.feltdb/pairing.json`, `.feltdb/workspace.json` via core | Filesystem JSON | VS Code/core -> project files | VS Code `projectDir` connection |
| Pairing | `connectDevelopmentWorkspace({pairingCode,…})` | HTTP discovery then authority transport | Both clients -> FeltDB | Core workspace connection |
| Runtime/client registration | `_development_workspace_clients` through `registerClient()` | FeltDB HTTP database API | Both clients -> FeltDB | `DevelopmentWorkspaceConnection.connect()` |
| Legacy observation/investigation handoff | `publish/update/query/subscribe('runtime_investigations')` | JSON entity + workspace events/SSE/reconciliation | Browser -> FeltDB -> VS Code; updates both ways | DevTools `InvestigationRecord` |
| Development change | `investigation_changes` | JSON entity + workspace events | VS Code -> FeltDB -> Browser | VS Code filesystem/Git observer |
| Verification | `investigation_verifications`; update `runtime_investigations` | JSON entity + workspace events | VS Code/Browser -> FeltDB -> clients | VS Code change and later browser capture |
| Browser-local persistence | `createFeltDB(..., browser: true)` and fixed collections | FeltDB JS database/IndexedDB | Browser panel <-> local DB | DevTools HAR/page capture |
| PR7 Runtime Observation | `startRuntimeObservation()`, `runtime_observation` | Patched browser APIs -> workspace JSON entity | Application runtime -> FeltDB | `@feltdb/core/workspace/browser` (not called by DevTools) |
| PR7 investigation/verification | Core `InvestigationSupervisor`/`InvestigationLifecycleManager` and workspace types | Core API + durable records | FeltDB internal/agents | Core Runtime Observation (not called by DevTools) |

The low-level authority endpoint paths for entity CRUD are encapsulated by `HttpJsDb`; DevTools calls the public core API rather than hard-coding them. The only literal HTTP endpoint visible at this boundary is pairing discovery.

## 12. Runtime observation comparison

### Existing mechanisms in DevTools

| Mechanism | Producer/schema | Transport | Consumer/UI | Retention/identity |
|---|---|---|---|---|
| HAR request snapshot | `src/lib/chrome.ts` / `NetworkRequestSnapshot` | Chrome DevTools API -> panel | Request list, evidence engine | Live 300; local max 1,500/24h; method+URL+time ID |
| Page error event | `public/page-capture.js` / `ConsoleEvent`-compatible JSON | DOM CustomEvent -> content script -> runtime message -> session storage | Evidence engine and history | 500 per tab/24h session buffer; local max 1,500/24h |
| Local investigation | panel / `InvestigationRecord` | In-process + localStorage + browser FeltDB | Browser details/history/evidence | Max 200/24h unless pinned; UUID/fingerprint grouping |
| Live workspace envelope | background / ad hoc `runtime_investigation` schema v1 | Core workspace `runtime_investigations` | VS Code tree/webviews/agent and browser verification | Workspace durable entity; core entity ID |
| Replay observation | replay engine / `ReplayObservation` in `src/lib/replayContract.ts` | Local replay and evidence graph | Replay panels/tests | Attached to replay runs; replay-scoped ID |
| Development activity | VS Code / `DevelopmentActivity` | Envelope update + `investigation_changes` | Both UIs/verification | Last 50 on envelope; change/verification IDs |

### PR7 Runtime Observation in installed FeltDB core 0.6.10

`RuntimeRequestObservation` is declared in `node_modules/@feltdb/core/dist/workspace/workspace-types.d.ts`; construction/redaction is in `runtime-observation`, and browser instrumentation is in `runtime-observer`. It represents one redacted request fact with request timing/status, runtime/browser/engine/page context, correlation ID, nearby runtime events, failure state, and characteristics. It is published to the durable `runtime_observation` collection. The core investigation supervisor consumes it and opens investigations only for actionable defects.

The core observer instruments application `fetch`, `XMLHttpRequest`, `console.error/warn`, uncaught errors, and rejections. It does not capture request/response bodies or authorization/cookie headers. DevTools instead obtains full HAR headers/bodies (subject to local redaction/privacy settings) and correlates events in the panel.

The concepts overlap but the schemas, producers, collection names, redaction contracts, identities, and downstream investigation models differ. No adapter or link between them exists in this repository.

## 13. Existing inspection capabilities

- Inspect runtime: **PARTIAL**. Browser captures network/error/environment facts and local replay evidence; there is no generic runtime state inspector or runtime-instance discovery.
- Inspect database: **NO**. Local persistence uses FeltDB but offers maintenance/stats, not arbitrary DB browsing.
- Inspect collection: **NO**. Fixed collection queries are implementation details, not inspection capability.
- Inspect transaction/operation: **NO**. No transaction or general operation model was found.
- Inspect error: **YES**. Browser captures and correlates console/runtime errors; VS Code renders persisted events and source.
- Inspect commit/Git: **PARTIAL**. VS Code snapshots HEAD/status/diff for active investigations; there is no general commit browser.
- Inspect source/file: **YES** for exact persisted source locations and request URLs that resolve to source files.
- Inspect network/request: **YES** in Browser; **PARTIAL** in VS Code from persisted envelope content.

The CDP replay adapter (`src/lib/cdpBridge.ts`, `chromeReplayAdapter.ts`) controls navigation/input/network fixture replay and collects replay observations. It is not a database/transaction inspection protocol.

## 14. Envelope versus observation

### Existing live DevTools envelope

- What it represents: a locally analyzed investigation plus lifecycle/development/verification state.
- Lifetime: durable workspace entity, updated across the investigation lifecycle.
- Creator: DevTools browser background.
- Consumers: VS Code extension and browser verification path.
- Contents: raw-ish request evidence, derived evidence graph, heuristic diagnosis, history, optional development/Git activity and verifications.

### PR7 Runtime Observation

- What it represents: one factual, redacted runtime request observation.
- Lifetime: immutable-style durable observation entity; investigations reference its `observationId`.
- Creator: FeltDB core browser runtime observer.
- Consumers: FeltDB core investigation supervisor/lifecycle and verification.
- Contents: method/URL/status/timing, runtime/browser/engine/page, correlation and correlated events, network failure, request/response characteristics; no analysis or bodies.

Is Runtime Observation payload inside the existing envelope, metadata associated with it, a separate stream, or something else?

**Current implementation: a separate, parallel stream and model.** Core constrains Runtime Observation to the `runtime_observation` collection and creates core `RuntimeInvestigation` records that reference `observationId`. The DevTools envelope is independently published to `runtime_investigations` and does not contain a `RuntimeRequestObservation`; its `originalObservationId` points to a DevTools-local request/investigation ID, not demonstrably a PR7 observation.

**Intended future relationship: UNKNOWN.** There is no integration code establishing whether DevTools should become a producer, consumer, presentation layer, or adapter for PR7. Actual core constraints argue against embedding the canonical observation as mutable envelope metadata, but selecting a migration/compatibility relationship requires a deliberate next change.

## 15. Capability gaps

### Already solved

- FeltDB core already supplies workspace discovery, pairing resolution, client registration, durable entity CRUD, subscriptions, reconnectable queries, canonical Runtime Observation construction/redaction, and a core investigation/verification lifecycle.
- DevTools already supplies rich Chrome DevTools request capture, page error capture, local evidence/analysis/history, source hints, export, and browser UI.
- VS Code already supplies connection UX, durable-envelope rendering, exact source opening, filesystem/Git activity, agent handoff, and change-to-runtime verification coordination.

These should not be rebuilt as another transport or generic protocol.

### Partially solved

- Runtime observation exists twice: PR7 canonical factual observations and DevTools legacy rich investigations.
- Commit association exists after VS Code activity but not on original browser observations.
- Reconnect is solid enough in VS Code but absent in browser background.
- Shared investigation state exists operationally but lacks one shared schema and validation.
- Network/error inspection is strong, while runtime/database/collection/transaction inspection is absent.

### Missing

- Explicit runtime instance and application identity.
- Browser disconnect/reconnect and connection health/heartbeat behavior.
- A documented/implemented mapping between DevTools capture and PR7 Runtime Observation/investigation records.
- Generic database, collection, transaction, and operation inspection.
- Shared compile-time/runtime contracts for the live envelope.

### Conflicting

- DevTools `runtime_investigation` versus core 0.6.10 `RuntimeInvestigation` have different schemas and lifecycle vocabularies while describing the same broad artifact.
- DevTools uses `originalObservationId` for a local request/investigation ID; PR7 defines a canonical `observationId`.
- DevTools local evidence contains bodies/headers and heuristic findings in one nested object; PR7 deliberately separates factual observation/evidence from FeltDB analysis and excludes bodies/credentials.
- Multiple workspace/runtime type families under `src/lib`, `packages/development-runtime`, VS Code, and core disagree in naming/status.

### Unclear

- Whether rich DevTools-only payloads should remain linked supplemental evidence, be projected into PR7 characteristics, or remain local.
- Which component should initiate application runtime observation when the DevTools extension is present.
- Migration/compatibility requirements for already durable `runtime_investigations` entities.
- Whether connected-client registration needs lease/heartbeat semantics.

## 16. Recommended next step

Finding: FeltDB core 0.6.10 already owns the canonical Runtime Observation contract, durable observation collection, investigation lifecycle, workspace transport, and verification evaluation. DevTools already owns richer Chrome capture and the browser/IDE presentation surfaces, but its live `runtime_investigation` duplicates core concepts and does not consume PR7.

Therefore, do not create a new Runtime Inspection Protocol or another envelope. The next PR should be a narrowly scoped **DevTools-to-PR7 compatibility design and contract test PR**. It should first specify, without UI expansion, how a DevTools-captured request maps (or deliberately does not map) to `RuntimeRequestObservation`, how supplemental rich evidence is linked without weakening PR7 redaction/fact-vs-analysis boundaries, and how existing `runtime_investigations` records coexist or migrate to core `RuntimeInvestigation`.

The component to extend should be the actual shared boundary—`@feltdb/core/workspace` Runtime Observation/investigation APIs as consumed from DevTools—not `src/lib/workspaceConnection.ts`, `LocalDevelopmentBridge`, or the inactive `InvestigationContextEnvelope`. Any implementation PR should begin with cross-repository contract fixtures proving IDs, collection names, lifecycle mapping, redaction, reconnect durability, and Browser/VS Code consumption before changing product behavior.

## Audit validation notes

- Shipping claims were traced from manifest/build entry points through imports, rather than inferred from names.
- The live envelope producer, collection calls, and VS Code consumer were compared field-by-field.
- FeltDB boundary claims use the installed declared dependency (`@feltdb/core` 0.6.10); the FeltDB repository was not modified.
- Placeholder and TODO implementations are explicitly excluded from YES capability claims.
- No protocol, type, transport, pairing, runtime, UI, or product behavior was changed by this audit.

## FeltDB Runtime Investigation Integration

Release 0.6.11 integrates exactly with `@feltdb/core@0.6.13` while retaining legacy rich investigation records for compatibility and supplemental presentation.

```text
Chrome DevTools
      |
      | rich capture (HAR, bodies, headers, graph, diagnosis)
      v
DevTools Investigation (local ID; browser-local rich evidence)
      |
      | canonicalObservationIds[]
      v
FeltDB Runtime Observation (canonical observationId)
      |
      v
FeltDB Runtime Investigation (canonical lifecycle)
      |\
      | +-- Development Change -> Git identity
      +---- Verification -> verificationId
      |
      v
VS Code
```

### Identity and correlation

`toRuntimeObservationInput()` in `src/lib/runtimeObservation.ts` is the only Chrome-capture-to-canonical-input mapping. The browser background passes that input to `DevelopmentWorkspaceConnection.recordRuntimeObservation()`. FeltDB supplies and persists `workspaceId`, `sessionId`, `runtimeInstanceId`, `observationId`, and `correlationId`; DevTools never derives them. DevTools request IDs and local investigation IDs remain distinct. The local investigation ID appears only at `correlation.source.investigationId`, with product `feltdb-devtools` and the connection-owned client ID.

After recording, DevTools uses `createRuntimeInvestigation()` for the first observation and `linkRuntimeObservationToInvestigation()` for later observations. `InvestigationRecord.canonicalObservationIds` and `canonicalInvestigationId` cache only the returned canonical identities. Resolution also uses the explicit DevTools correlation, allowing a restarted runtime instance to contribute to the same investigation. `originalObservationId` remains a legacy/local field and is never promoted.

When canonical connection identity is unavailable, automatic publication falls back to the existing legacy collection. It does not create substitute session/runtime IDs.

### Redaction and evidence boundary

The canonical projection contains only method, redacted URL/page, status, timing, network-failure state, runtime/browser context, correlated redacted runtime events, and limited content-type/status characteristics. It has no mapping for authorization/cookie headers, request or response bodies, screenshots, the evidence graph, heuristic diagnosis, or other Chrome-only metadata. Those remain in the browser-local FeltDB/IndexedDB investigation owned by DevTools.

### Canonical lifecycle and compatibility

VS Code subscribes to and queries canonical `runtime_investigation` first, resolves every `observationIds` entry through `getRuntimeObservation()`, and renders the canonical investigation/remediation/verification states and IDs as authoritative. Observation correlation locates a matching DevTools legacy record when present; its graph and diagnosis are supplemental only. Unmatched historical `runtime_investigations` records remain readable and writable through the existing compatibility flow.

Reconnect uses the canonical workspace query and durable investigation record; no filesystem lifecycle manager or new transport is introduced. Canonical `changeId` and `verificationId` are displayed directly. Historical envelopes without explicit canonical references continue to load without reinterpretation.
