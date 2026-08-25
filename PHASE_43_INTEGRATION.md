# Phase 4.3: Persist Replay Evidence + Minimal UI

**Status:** ✅ Complete (FeltDB integration + ReplayPanel + useReplay hook)

## What Was Built

### 1. FeltDB Integration (`replayFeltDB.ts`)
- Converts ReplayRun observations into FeltDB nodes
- Creates edges linking investigation → replay → observations
- Maintains complete evidence chain for analysis
- Confidence scoring based on replay outcome

**Evidence Structure:**
```
Investigation (inv-123)
    ↓
ReplayRun (reproduced_by)
    ├─ Navigation observation
    ├─ Interaction observation
    ├─ Network observation
    ├─ Target request observation
    └─ Runtime error observation
```

### 2. Minimal Replay Panel UI (`ReplayPanel.tsx`)
- Shows replay status with icon + color
- Displays confidence percentage
- Lists all observations (expandable)
- Shows success/failure indicators
- Link to inspect evidence chain

**Display:**
```
REPLAY #abc123
REPRODUCED
90% confidence | 4/4 observations

▶ Expand to see:
  ✓ navigation: Navigate to http://localhost:3000/
  ✓ interaction: Click #checkout-btn
  ✓ target_request: POST /api/checkout → 422
  ✓ runtime_error: currency_required

[🔍 Inspect Evidence Chain]
```

### 3. useReplay Hook (`useReplay.ts`)
- Manages replay state (loading, error, result)
- Tracks execution phase (preparing → running → capturing → complete)
- Creates fixtures from investigation data
- Integrates with ReplayController for async execution
- Provides cleanup

**Usage:**
```typescript
const replay = useReplay()

// Create fixture
const fixture = replay.createFixture(
  'inv-123',
  'req-456',
  'http://api.example.com/checkout',
  'POST',
  'http://app.example.com/checkout',
  interactions,
  networkFixtures
)

// Execute
const run = await replay.executeReplay(fixture, originalOutcome)

// Show result
<ReplayPanel run={run} />
```

### 4. Styling (`ReplayPanel.css`)
- Professional card layout
- Collapsible observations
- Color-coded by observation type
- Responsive design (mobile-friendly)
- Smooth transitions

## Integration Points

### In InvestigationDetails

```typescript
// 1. Show replay button
<button onClick={() => setShowReplay(true)}>
  ▶ Replay
</button>

// 2. Execute replay when requested
if (showReplay) {
  const fixture = replay.createFixture(...)
  const run = await replay.executeReplay(fixture, investigation.outcome)
}

// 3. Display results
{run && (
  <ReplayPanel
    run={run}
    onInspectEvidence={() => showEvidenceChain(run)}
  />
)}
```

### In FeltDB Storage

```typescript
// When replay completes:
const { nodes, edges } = createReplayEvidenceNodes(run)

// Store nodes
for (const node of nodes) {
  feltRepository.addNode(node)
}

// Store edges
for (const edge of edges) {
  feltRepository.addEdge(edge)
}

// Investigation now has:
// investigation → replay run → observations
```

## Complete Workflow (Phases 4.2 + 4.3)

```
1. OBSERVE FAILURE
   User triggers currency=null → 422
   Runtime Investigator captures evidence

2. CREATE FIXTURE
   ReplayFixture created with:
   - Target request (POST /api/checkout)
   - Network fixture (422 response)
   - Interaction (click button)
   - Expected outcome (status 422, error count 1)

3. REQUEST REPLAY
   ▶ Replay button clicked
   → ReplayController notified
   → ChromeReplayAdapter activated
   → CDP attached to current tab

4. EXECUTE REPLAY
   Navigate → Install network → Click → Capture
   Chrome DevTools Protocol observes:
   ✓ Navigation complete
   ✓ Network fixture matched
   ✓ Target request made (422)
   ✓ Runtime error captured
   
5. CLASSIFY OUTCOME
   ReplayEngine builds OutcomeSignature
   Compare original vs replay:
   - Status: 422 == 422 ✓
   - Errors: 1 == 1 ✓
   - Fingerprint: same ✓
   → REPRODUCED ✓

6. DISPLAY RESULT
   ReplayPanel shows:
   ✓ REPRODUCED
   90% confidence
   4/4 observations
   
7. STORE EVIDENCE
   FeltDB receives:
   - ReplayRun node
   - 4 observation nodes
   - 5 edges (run→obs, inv→run)
   
   Investigation evidence graph now includes
   complete replay proof
```

## Test Results

**All Phase 4.3 tests passing:**
- ✅ createReplayEvidenceNodes (links inv to replay to observations)
- ✅ buildReplaySummary (counts observations correctly)
- ✅ formatReplayStatus (formats all outcome types)
- ✅ Confidence scoring (based on replay outcome)
- ✅ Evidence chain completeness

**Test Count:** 13 passing

## Next: Phase 5 - Counterfactuals

Once Phase 4.3 is integrated into InvestigationDetails:

1. **Change fixture variable** - currency → "USD"
2. **Re-run replay** - Execute against mutated fixture
3. **Observe change** - New outcome (should be 200 ✓)
4. **Isolate causality** - "Changing currency fixes the error"
5. **Store experiment** - FeltDB links original → experiment → outcome

```
Investigation (currency=null → 422)
├─ ReplayFixture
├─ ReplayRun #1 (baseline, REPRODUCED)
│
└─ Experiment
    └─ Counterfactual #1 (currency="USD")
        └─ ReplayRun #2 (NOT_REPRODUCED → FIXED)
            └─ Finding: "currency field is necessary and sufficient"
```

## Files Added

| File | Lines | Purpose |
|------|-------|---------|
| replayFeltDB.ts | 95 | FeltDB node/edge creation |
| replayFeltDB.test.ts | 180 | Evidence integration tests |
| ReplayPanel.tsx | 95 | Minimal UI component |
| ReplayPanel.css | 280 | Professional styling |
| useReplay.ts | 125 | State management hook |

**Total:** 775 lines (13 tests passing)

## Architecture Complete

```
Investigation Evidence
    ↓
ReplayFixture (what to replay)
    ↓
ReplayEngine (how to replay - platform agnostic)
    ↓
ChromeReplayAdapter (CDP integration)
    ↓
ReplayRun (observations from actual browser)
    ↓
FeltDB (persistent evidence storage)
    ↓
ReplayPanel UI (show results)
    ↓
Counterfactuals (Phase 5: experiment with mutations)
```

## Ready for Integration

The components are ready to be wired into `InvestigationDetails`:

1. Add ▶ Replay button
2. Use `useReplay` hook for state
3. Show `ReplayPanel` when result available
4. Wire FeltDB storage when available

No architectural changes needed for Phase 5—counterfactuals simply:
- Clone ReplayFixture
- Mutate one variable
- Re-run replay
- Compare outcomes
