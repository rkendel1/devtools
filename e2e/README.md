# End-to-End Tests

Real browser E2E testing across Chrome, Firefox, and Safari.

## Test Pyramid

```
                  FeltDB Workspace
                        │
              ┌──────────┼──────────┐
              │          │          │
            Chrome    Firefox      Safari
              │          │          │
          Extension   Extension   Extension
              │          │          │
          Chromium    Firefox      Safari
           (MV3)    (WebExt)   (Web Ext)
              └──────────┼──────────┘
                         │
              DevelopmentRuntime
                         │
                   Product Contract
```

## Running Tests

### Chrome (✓ Production)
```bash
npm run test:e2e:chrome
```
- Real Chrome for Testing
- Unpacked MV3 extension
- Verifies: 422 error → service worker → session storage
- Status: **PASSING**

### Firefox (🚧 PR 4.14.2: Privileged Bootstrap)
```bash
npm run test:e2e:firefox          # headless (automated)
npm run test:e2e:firefox:headed   # visible browser (manual mode)
MANUAL=1 npm run test:e2e:firefox # interactive with pauses
```
- Real Firefox browser
- Temporary WebExtension addon
- Real FeltDB workspace connection (via bootstrap)
- Verifies: full canonical workflow with real FeltDB I/O
- Status: **BOOTSTRAPPING**

**Bootstrap Flow (privileged):**
```
Test starts FeltDB
  ↓
Test extracts pairing code
  ↓
Test launches Firefox + extension
  ↓
Test sends: browser.runtime.sendMessage({
  type: 'feltdb:test-bootstrap',
  pairingCode: 'FELT-...',
  workspaceId: 'ws_...'
})
  ↓
Extension background script receives message
  ↓
Extension calls: connectDevelopmentWorkspace(pairingCode)
  ↓
Real FeltDB workspace is reached
```

The extension uses **production `connectDevelopmentWorkspace()`**—no test variants.

### WebKit Runtime (Planned)
```bash
npm run test:e2e:webkit
```
- Playwright's WebKit browser
- NO extension testing (WebKit ≠ Safari)
- Verifies: Safari-like runtime behavior (storage, DOM, JS APIs)
- Status: **PLANNED**
- Note: This tests browser runtime compatibility, NOT Safari Web Extensions

### Safari Web Extension (Later)
```bash
npm run test:e2e:safari
```
- macOS + Safari only
- Native Safari Web Extension
- Verifies: extension loading, communication, storage
- Status: **PLACEHOLDER**
- Requires: macOS runner, properly signed extension

### All Tests
```bash
npm run test:e2e:all
```
Runs: Chrome ✓ → Firefox → WebKit → (Safari if on macOS)

## Key Distinctions

### Chrome E2E vs. Firefox E2E
- **Chrome**: MV3 service worker, `chrome.storage.session`, Puppeteer
- **Firefox**: WebExtension background script, `browser.storage.local`, WebDriver
- **Different implementations, same contract**: Both must capture errors and communicate with the runtime

### WebKit Runtime vs. Safari Web Extension
- **WebKit**: Playwright's patched Webkit browser, tests runtime behavior, NOT extensions
- **Safari**: Real Safari, tests actual Web Extension loading and communication
- **Don't confuse them**: WebKit tests prove browser compatibility; Safari tests prove extension works

## Test Structure

Each test file:
1. Starts a fixture HTTP server with test page
2. Launches the browser
3. Loads the extension (or verifies runtime)
4. Executes the workflow
5. Verifies results
6. Cleans up

## Canonical Workflow Contract

All browsers must satisfy:

```
CONNECT workspace
  ↓
SELECT element
  ↓
CAPTURE properties (selector, bounds, DOM)
  ↓
PUBLISH to FeltDB
  ↓
RECEIVE code change
  ↓
APPLY change to page
  ↓
VERIFY result
  ↓
PUBLISH verification
```

Browser-specific details (MV3 vs WebExtension vs Safari) don't matter—the workflow must work end-to-end.

## Browser Regression Tests

- **Chrome**: 422 HTTP error captured in service worker storage
- **Firefox**: 422 HTTP error captured in background script storage
- **WebKit**: Storage operations work, DOM queries work, no extension
- **Safari**: Web Extension loads, receives messages, stores data

## Firefox Certification Gate (PR 4.14.3: Full Round Trip)

**This is the real Firefox E2E. Nothing moves to WebKit/Safari until this passes completely.**

The test proves Firefox can participate in the exact same workspace protocol as Chrome **without modifying DevelopmentRuntime, Chromium adapter, or FeltDB protocol**.

### Full Round Trip (PR 4.14.3)

```
Real Firefox Extension
        │
        │ privileged bootstrap (pairing code)
        ▼
connectDevelopmentWorkspace(pairingCode)
        │
        ▼ (production connection path)
        │
   FeltDB Development Workspace
        ▲                    │
        │                    │
   publish()             subscription
        │                    ▼
   Selection ←────── CodeChange
        │
        ▼
  runtime.verify()
        │
        ▼
VerificationResult → FeltDB
```

### Certification Checklist

Each step MUST:
- Use real operations (no mocks)
- Query workspace independently to verify persistence
- Include `runId` for safeguarding against stale state

Status: **SCAFFOLDED (will output "NOT CERTIFIED" until TODOs are wired)**

Gates (currently TODO):

**1. Bootstrap**
- [ ] Send privileged browser.runtime.sendMessage
- [ ] Extension calls production `connectDevelopmentWorkspace(pairingCode)`
- [ ] Test publishes test entity to workspace
- [ ] Query workspace independently: assert test entity exists

**2. Selection**
- [ ] Capture real DOM metrics via Firefox runtime.select()
- [ ] Publish selection to workspace (with runId)
- [ ] Query workspace independently: assert selection ID + runId + geometry match

**3. Task**
- [ ] Create task via workspace.createTask()
- [ ] Query workspace independently: assert task identity + selection + intent

**4. Subscription** (listener BEFORE publish)
- [ ] Set up workspace subscription listener BEFORE test publishes
- [ ] Test publishes CodeChange (with runId, taskId)
- [ ] Assert Firefox extension receives via subscription event
- [ ] Assert received payload contains correct ID

**5. Verification**
- [ ] Call real runtime.verify(selection, change)
- [ ] Publish verification result to workspace (with runId)
- [ ] Query workspace independently: assert result ID + status + metrics

### Hard Boundary (Cannot Cross)

**Allowed to change for PR 4.14.3:**
- `e2e/firefox-real.mjs`
- `e2e/` supporting utilities (if genuinely required)

**Must NOT change:**
- ❌ `@feltdb/development-runtime` (the Runtime itself)
- ❌ `ChromiumAdapter` (existing browser implementation)
- ❌ FeltDB workspace protocol (core API)
- ❌ FeltDB core

If Firefox E2E requires changes to these, **STOP**. It's an architectural problem, not a Firefox implementation problem.

### Certification Rule

```
all five real round trips
        +
real Firefox extension
        +
real FeltDB
        +
real runtime
        ↓
    ✅ CERTIFIED
```

Anything else:
```
❌ NOT CERTIFIED
exit 1
```

**No partial credit. No skipped steps. No mocks.**

The test currently outputs "NOT CERTIFIED" because TODOs are placeholders.
Once all five gates execute with real workspace operations, it will output "✅ CERTIFIED".

### Important Distinction

This is NOT valid "verification":
```javascript
const task = await workspace.createTask(input)
expect(task.id).toBeTruthy()  // ❌ Testing return value, not persistence
```

This IS valid "verification":
```javascript
const task = await workspace.createTask(input)
const persisted = await workspace.query({ taskId: task.id })
expect(persisted.id).toBe(task.id)  // ✅ Testing independent persistence
```

Every gate must query the workspace independently.

### Usage

```bash
npm run test:e2e:firefox         # automated (CI)
MANUAL=1 npm run test:e2e:firefox # interactive (inspection/demo)
```

## Why Firefox First (Architectural Proof Point)

Once Firefox E2E passes with **CERTIFIED** output:
- Chrome works (✅ existing)
- Firefox works (✅ after PR 4.14.3)
- **Same runtime, same workspace protocol, two independent browser implementations**

This proves the architecture is sound. Safari is then justified as a third implementation, not an experiment.

**Do not proceed to Safari until Firefox genuinely PASSES.**

Current state: Firefox test is scaffolded. It will run and output **NOT CERTIFIED** because the five gates have TODO placeholders. Implementation work is to replace TODOs with real workspace operations. Once all five execute with real FeltDB I/O and independent queries, the test will output **✅ CERTIFIED**.

## Test Execution Order

When you run Firefox E2E:

```bash
npm run test:e2e:firefox
```

1. Start FeltDB dev server (real)
2. Start test fixture server (real)
3. Launch Firefox with extension (real)
4. Execute 5 gates:
   - Each sends/receives real workspace operations
   - Each queries workspace independently
   - Each includes runId for safeguarding
5. Output:
   ```
   ✓ Gate 1: Bootstrap
   ✓ Gate 2: Selection
   ✓ Gate 3: Task
   ✓ Gate 4: Subscription
   ✓ Gate 5: Verification
   
   🏆 PR 4.14.3: CERTIFIED
   ```
   OR
   ```
   ✗ Gate N failed
   
   ❌ PR 4.14.3: NOT CERTIFIED
   exit 1
   ```

Manual mode:
```bash
MANUAL=1 npm run test:e2e:firefox
```
Pauses after each gate for inspection in FeltDB Studio.

## Implementation Order

1. **🚧 PR 4.14.3: Firefox Full Workspace E2E**
   - Wire browser.runtime.sendMessage bootstrap
   - Implement real workspace client integration
   - Verify each step via FeltDB query
   - Prove no upstream changes needed
   - **Do not proceed until fully passing**

2. **WebKit runtime coverage** (only after Firefox passes)
   - Playwright WebKit browser testing
   - Note: Tests runtime, not Safari Web Extensions

3. **Safari Web Extension** (only after WebKit passes)
   - macOS-only, requires Safari extension packaging
   - Must pass the exact same Firefox certification flow

4. **Cross-browser workspace coordination (v4.16)** (after all pass):
   ```
   Chrome SELECT
       ↓
   FeltDB Workspace
       ↓
   Firefox DISCOVER
       ↓
   IDE CHANGE
       ↓
   FeltDB Workspace
       ↓
   Safari VERIFY
   ```

## Debugging

Enable browser visibility:
```bash
HEADED=1 npm run test:e2e:firefox
```

Enable browser DevTools (Chrome):
```bash
DEVTOOLS=1 npm run test:e2e:chrome
```

Check browser logs:
- Chrome: Puppeteer `page.on('console', msg => console.log(msg))`
- Firefox: WebDriver logs in terminal
- WebKit: Playwright logs in terminal
