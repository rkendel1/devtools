# @feltdb/development-runtime

Browser runtime for FeltDB Development Workspace. Orchestrates **SELECT → CAPTURE → VERIFY** workflow.

## What This Is

A reusable browser interaction primitive that:
- Captures element selections from the running application
- Measures element metrics before and after code changes
- Verifies that code changes produce the expected results
- Reports browser capabilities honestly (Chrome works, Firefox/Safari not yet)

## What This Is NOT

- Not a workspace client (doesn't publish to FeltDB)
- Not a DevTools UI (doesn't manage tasks or descriptions)
- Not an IDE integration (doesn't know about editors)
- Not an agent (doesn't modify code)

Those are responsibilities of the consumer application.

## Architecture

```
                   @feltdb/core
               Development Workspace
                       │
          ┌────────────┼────────────┐
          │            │            │
       DevTools       IDE         Agent
          │
          │
@feltdb/development-runtime
          │
    BrowserRuntimeAdapter
          │
       Browser
```

## Quick Start

### Installation

```bash
npm install @feltdb/development-runtime
```

### Usage

```typescript
import { DevelopmentRuntime, createChromiumAdapter } from '@feltdb/development-runtime'

// Create runtime (just the browser interaction capability)
const runtime = new DevelopmentRuntime({
  browserAdapter: createChromiumAdapter(),
})

// SELECT: Capture element selection
const selection = await runtime.select()
// → user clicks element in browser
// → returns: { elementQuery, boundingBox, sourceHints, computedStyle }

// CAPTURE: Measure current state (optional)
const beforeMetrics = await runtime.captureElementState('.button')
// → { width: 400, height: 48, x: 200, y: 400, ... }

// ... Code change happens via workspace or IDE ...
// ... Page reloads or updates ...

// VERIFY: Measure after change
const outcome = await runtime.verify({
  selection,
  change, // From workspace (workspace publishes this)
})
// → { status: 'FIXED' | 'FAILED' | 'REGRESSION', confidence, beforeMetrics, afterMetrics }

// Cleanup
await runtime.disconnect()
```

## API Contracts

### `DevelopmentRuntime`

Main orchestrator. Owns browser interaction workflow.

```typescript
class DevelopmentRuntime {
  constructor(config: RuntimeConfig)

  // Workflow methods
  select(): Promise<Selection>
  captureElementState(query: string): Promise<ElementMetrics>
  verify(params: VerifyParams): Promise<VerificationOutcome>

  // Utilities
  getCapabilities(): Promise<BrowserCapabilities>
  waitForPageReady(): Promise<void>
  disconnect(): Promise<void>
}
```

### `Selection`

What user selected. Pure data, serializable.

```typescript
interface Selection {
  elementQuery: string  // CSS selector or XPath
  boundingBox: {
    x: number
    y: number
    width: number
    height: number
  }
  sourceHints: SourceHints  // File/line/component for IDE
  computedStyle?: Record<string, string>
}
```

### `VerificationOutcome`

Result of verification. Pure data, serializable.

```typescript
interface VerificationOutcome {
  status: 'FIXED' | 'FAILED' | 'REGRESSION'
  confidence: number // 0-1
  beforeMetrics: ElementMetrics
  afterMetrics: ElementMetrics
  evidence: {
    screenshots?: { before: string; after: string }
    performanceMetrics?: Record<string, number>
    domChanges?: string[]
  }
}
```

### `BrowserCapabilities`

What this browser can actually do (honest assessment).

```typescript
interface BrowserCapabilities {
  selection: {
    enabled: boolean
    supportsVisualSelection: boolean
    supportsSourceMapping: boolean
  }
  elementInspection: {
    enabled: boolean
    supportsBoundingBox: boolean
    supportsComputedStyle: boolean
    supportsDOMPath: boolean
  }
  replay: {
    enabled: boolean
    supportsClickReplay: boolean
    supportsScrollReplay: boolean
    supportsInputReplay: boolean
  }
  verification: {
    enabled: boolean
    supportsScreenCapture: boolean
    supportsMetricsCapture: boolean
    supportsPerformanceObservation: boolean
  }
}
```

## Adapters

### Chromium (Chrome/Brave)

```typescript
import { createChromiumAdapter } from '@feltdb/development-runtime'

const adapter = createChromiumAdapter()
const runtime = new DevelopmentRuntime({ browserAdapter: adapter })
```

**Status:** Production-ready (PR 4.12)

### Firefox

```typescript
import { createFirefoxAdapter } from '@feltdb/development-runtime'

const adapter = createFirefoxAdapter() // Throws: not implemented yet
```

**Status:** Not implemented. See PR 4.13.

### Safari/WebKit

```typescript
import { createSafariAdapter } from '@feltdb/development-runtime'

const adapter = createSafariAdapter() // Throws: not implemented yet
```

**Status:** Not implemented. See PR 4.14.

## Design Principles

1. **Adapter honesty** — Only report capabilities the browser actually has. Chromium works, Firefox/Safari throw.

2. **No workspace ownership** — Runtime does not connect to, publish to, or subscribe from FeltDB. Consumer application does.

3. **No browser protocol leakage** — Public API never exposes ElementHandle, DOM Element, Chrome DevTools Protocol types. Only serializable data.

4. **Workflow clarity** — Runtime owns SELECT → CAPTURE → VERIFY. Consumer owns DESCRIBE → PUBLISH TASK → WAIT FOR CHANGE.

5. **Adapter boundary** — BrowserRuntimeAdapter is the contract. Different browsers implement it differently (Chrome via CDP, Firefox via Debugger Protocol, Safari via Web Inspector).

## Integration with DevTools

```typescript
// DevTools uses runtime + workspace separately

import { DevelopmentRuntime, createChromiumAdapter } from '@feltdb/development-runtime'
import { connectDevelopmentWorkspace } from '@feltdb/core'

const runtime = new DevelopmentRuntime({
  browserAdapter: createChromiumAdapter(),
})

const workspace = connectDevelopmentWorkspace('ws_checkout')

// SELECT: browser interaction
const selection = await runtime.select()

// DevTools publishes to workspace
await workspace.publishSelection(selection)

// User describes intent (DevTools UI)
const task = await workspace.createTask({
  selectionId: selection.id,
  intent: userDescription,
})

// Wait for agent to publish change
const change = await workspace.waitForCodeChange(task.id)

// VERIFY: browser measurement
const outcome = await runtime.verify({ selection, change })

// DevTools publishes result
await workspace.publishVerificationResult(outcome)
```

## Testing

```bash
npm test                # Run all tests
npm run test:watch     # Watch mode
```

Tests prove:
- DevelopmentRuntime API contracts work
- Chromium adapter provides real browser interaction
- SELECT → CAPTURE → VERIFY workflow executes end-to-end
- No browser protocol types leak through public API
- No workspace concerns in runtime

## Future

**PR 4.13** — Firefox adapter implementation
**PR 4.14** — Safari adapter implementation
**PR 4.15** — Runtime Investigator migration (use this package)
**PR 4.16** — Cross-browser acceptance (Chrome + Firefox + Safari + IDE)

## Contributing

When implementing a new adapter:

1. Implement `BrowserRuntimeAdapter` interface
2. Provide honest `BrowserCapabilities` (don't pretend feature exists if it doesn't)
3. Write acceptance tests against real browser
4. Document browser-specific limitations
5. Don't add workspace concerns

## License

MIT
