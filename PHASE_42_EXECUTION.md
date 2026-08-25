# Phase 4.2: One Real Replay - Execution Guide

**Status:** Architecture Complete, Tests Pass (10/10). Ready for real Chrome execution.

## Deterministic Test Scenario

**Setup:**
- Test page with checkout form (no currency selected = failure)
- Node.js test server serving page + API
- Fixture: currency=null → POST /api/checkout → 422 + error

**Expected Flow:**
```
Browser observes:
  Navigation        ✓
  Interaction       ✓  (click Checkout)
  Network mock      ✓  (fixture matched)
  Target request    ✓  (422)
  Runtime error     ✓  (currency_required)
  
Classification: REPRODUCED ✓
```

## Manual Execution Steps

### 1. Start the Test Server

```bash
node test-server.js
```

Output:
```
Test server listening on http://localhost:3000
  - Test page: http://localhost:3000/
  - API: POST http://localhost:3000/api/checkout
```

### 2. Open Chrome and Navigate

```
http://localhost:3000/
```

You should see the Checkout Form with:
- Currency dropdown (empty)
- Email: test@example.com
- Amount: 99.99
- Checkout button

### 3. Trigger the Failure

- Leave Currency blank
- Click "Checkout"
- Observe: Error 422 - "currency_required"
- Watch console: `console.error()` fires

### 4. Capture as Investigation

In Runtime Investigator DevTools panel:
- Record the failure observation
- Note: POST /api/checkout → 422
- Note: console.error: "Checkout failed: currency_required"
- Create ReplayFixture from this observation

### 5. Execute Replay

Using Chrome DevTools Protocol (via extension):

```typescript
// In ReplayController:
const fixture = await captureFix fixture();  // From step 4
const originalOutcome = await captureOutcome();
const run = await sendReplayRequest(fixture, originalOutcome);
```

The ChromeReplayAdapter will:
```
1. Attach debugger to current tab
2. Navigate to http://localhost:3000/
3. Enable network capture (intercept POST /api/checkout)
4. Install fixture mock (422 response)
5. Execute: click #checkout-btn
6. Capture observations:
   - Navigation: ✓
   - Fixture matched: ✓
   - Target request: ✓
   - Runtime error: ✓
7. Classify: REPRODUCED ✓
```

### 6. Verify ReplayRun

Expected output:
```json
{
  "id": "replayrun:...",
  "investigationId": "inv-checkout-failure",
  "outcome": {
    "status": "REPRODUCED",
    "confidence": 0.9,
    "signature": {
      "status": 422,
      "errorCount": 1,
      "targetRequest": {
        "method": "POST",
        "url": "http://localhost:3000/api/checkout"
      }
    }
  },
  "observations": [
    { "type": "navigation", "description": "Navigate to http://localhost:3000/", "success": true },
    { "type": "network", "description": "Enabled network capture: 1 fixtures", "success": true },
    { "type": "interaction", "description": "Click #checkout-btn", "success": true },
    { "type": "network", "description": "FIXTURE_MATCHED: POST http://localhost:3000/api/checkout → 422", "success": true },
    { "type": "target_request", "description": "Target request captured: POST http://localhost:3000/api/checkout", "success": true },
    { "type": "runtime_error", "description": "Runtime error: Checkout failed: currency_required", "success": true }
  ],
  "matches": {
    "status": true,
    "errorCount": true,
    "timing": true,
    "behavior": true,
    "overall": true
  }
}
```

## Test Scenarios

### Scenario 1: Reproduce the Failure (REPRODUCED)
```
Currency:  (empty)
Expected:  422 ✓
Replay:    422 ✓
Result:    REPRODUCED ✓
```

### Scenario 2: Fix Applied (FIX VERIFIED)
```
Currency:  USD (filled in)
Expected:  422 (original failure)
Replay:    200 (fix works!)
Result:    NOT_REPRODUCED → FIXED ✓
```

### Scenario 3: Regression Test
```
Currency:  (empty) again
Expected:  422 (should still fail)
Replay:    422 ✓
Result:    REPRODUCED (regression detected)
```

## Next: Persist to FeltDB (Phase 4.3)

Once REPRODUCED classification works:

1. Wire ReplayRun into FeltDB
2. Link: Investigation → ReplayFixture → ReplayRun
3. Add observations as FeltDB evidence nodes
4. Show replay in EvidenceInspector

Result: Closed loop
```
Observed failure
  ↓
Investigated (why?)
  ↓
Replayed (can we recreate it?)
  ↓
Evidence stored
  ↓
Verified reproducible
```

## Key Integration Points

### CDP Bridge
- `attach()` → connects to current tab via chrome.debugger
- `navigate()` → page.goto with automatic load waiting
- `click()`, `type()` → via Runtime.evaluate
- Network domain → tracks matched fixtures
- Runtime domain → captures console.error + exceptions

### Replay Engine
- Consumes ReplayBrowser interface (doesn't know about Chrome)
- Orchestrates: navigate → network setup → interactions → capture
- Builds OutcomeSignature from browser observations
- Classifies: REPRODUCED | PARTIAL | NOT_REPRODUCED | UNDETERMINED

### Evidence Integration
- Each observation can become FeltDB node
- Replay links back to original investigation
- Complete event sequence for causal analysis

## Troubleshooting

**Debugger fails to attach:**
- Make sure Extension is loaded in the same Chrome instance
- Check chrome.debugger API permissions in manifest.json

**Network intercept not working:**
- Ensure fixture pattern matches request URL exactly
- Check that Network domain is enabled

**Target request not captured:**
- Verify POST /api/checkout actually fires
- Check that status/body are accessible via CDP

**REPRODUCED but shouldn't:**
- Verify fingerprint calculation matches
- Check error count is correct

## Architecture Flow

```
Test Page
  ↓
User clicks Checkout
  ↓
Browser makes POST /api/checkout (currency=null)
  ↓
Server responds 422
  ↓
Runtime error: console.error()
  ↓
DevTools captures as Investigation
  ↓ (manual: create ReplayFixture)
  ↓
Replay requested via ReplayController
  ↓
ChromeReplayAdapter → CDPBridge → chrome.debugger API
  ↓
Replay navigates → intercepts → interacts → captures
  ↓
ReplayEngine builds OutcomeSignature
  ↓
Outcome classified: REPRODUCED ✓
  ↓
ReplayRun stored in FeltDB
  ↓
UI shows: ▶ Replay #184 | REPRODUCED ✓
```

---

**Next Steps:**
1. Run test server: `node test-server.js`
2. Open Chrome DevTools on http://localhost:3000/
3. Load Runtime Investigator extension
4. Trigger checkout failure (currency blank)
5. Capture as investigation
6. Press ▶ Replay
7. Verify REPRODUCED classification
8. Persist to FeltDB (Phase 4.3)
