# Chrome Runtime Investigator

Chrome Runtime Investigator is a Chrome DevTools extension that turns raw browser telemetry into causal investigation results.

## MVP scope implemented

- DevTools **Investigate** panel with request selection and one-click investigation.
- Local evidence graph construction from network/runtime evidence.
- Deterministic analysis for payload diffs, anomalies, and request traces.
- Local-first reasoning layer that returns diagnosis, confidence, and actions.
- Sensitive data redaction before model-facing analysis.
- Local investigation history persistence.
- Copyable plain-text reports with request details, evidence, and source line references.
- Automatic investigation of failed requests and runtime errors with live request updates.
- Request filtering by status, domain, MIME type, search text, and timeframe.
- Redacted evidence bundles with optional screenshots and configurable sensitive fields.
- Markdown/GitHub, Jira, JSON, and plain-text export formats.
- Endpoint-pattern comparisons, clickable source lines, and grouped recurring issues.
- Searchable history with reopen, rename, pin, delete, and export controls.
- FeltDB-backed durable IndexedDB evidence storage with automatic migration from legacy local history.
- Explicit causal evidence nodes and edges with bounded traversal and an interactive graph view.
- Optional private WebLLM diagnosis and evidence-scoped questions through `@feltdb/webllm`.
- Model-finding provenance with validated citations to stored graph node IDs.
- Lightweight retention: 24-hour TTL for unpinned evidence, five-minute cleanup checks, bounded collection counts, and capture-time payload truncation.
- Rust WASM evidence engine crate scaffold (`/wasm-engine`) for deterministic normalization.

## Proposal bridge

The DevTools connection also carries repository context for FeltDB Proposals:
bounded repository listing, `feltdb.flow` and contract fingerprints, git state,
and the relevant files a proposal's source plan names. It is read-only — no
proposal is stored in `.feltdb/`, and applying a proposal remains
`feltdb ai apply`. See [DEVTOOLS_PROPOSAL_BRIDGE.md](DEVTOOLS_PROPOSAL_BRIDGE.md).

## Development

```bash
npm install
npm run dev
```

## Build extension

```bash
npm run build
```

Load `/dist` as an unpacked extension in Chrome.

## Local AI

Local AI is opt-in from an investigation result and requires WebGPU. The first
request downloads the selected model; the default SmolLM2 360M model needs
roughly 580 MB of VRAM. Inference runs in a worker owned by an offscreen
extension document, while the DevTools panel receives progress over extension
messaging. Only a bounded, redacted FeltDB evidence neighborhood is sent to the
model. Deterministic analysis remains available when WebGPU or the model is not.

## Retention

Raw requests, runtime events, sessions, unpinned investigations, orphaned graph
records, and model findings are automatically removed after 24 hours. Pinned
investigations are retained intentionally. The panel keeps at most 300 live
requests; FeltDB keeps at most 1,500 raw requests and 1,500 runtime events, and
request/response bodies are truncated to 128 KiB before entering memory or
durable storage. Maintenance runs at startup, every five minutes while DevTools
is open, and is throttled during capture writes.
