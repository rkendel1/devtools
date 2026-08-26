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

### Firefox (Planned)
```bash
npm run test:e2e:firefox          # headless
npm run test:e2e:firefox:headed   # visible browser
```
- Real Firefox browser
- Temporary WebExtension addon
- Verifies: canonical workflow (select → capture → publish → receive → verify)
- Status: **IN DEVELOPMENT**

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

## Future Work

1. Firefox canonical workflow (currently 422 regression only)
2. WebKit runtime coverage
3. Safari Web Extension packaging and signing
4. Cross-browser workspace coordination (v4.16):
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
