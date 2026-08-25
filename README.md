# Chrome Runtime Investigator

Chrome Runtime Investigator is a Chrome DevTools extension that turns raw browser telemetry into causal investigation results.

## MVP scope implemented

- DevTools **Investigate** panel with request selection and one-click investigation.
- Local evidence graph construction from network/runtime evidence.
- Deterministic analysis for payload diffs, anomalies, and request traces.
- Local-first reasoning layer that returns diagnosis, confidence, and actions.
- Sensitive data redaction before model-facing analysis.
- Local investigation history persistence.
- Rust WASM evidence engine crate scaffold (`/wasm-engine`) for deterministic normalization.

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
