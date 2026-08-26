# Complete Architecture: Phases 4-5 + Development Workspace

**Status:** ✅ Vertical Slice Complete (53 passing tests)

## What Was Built

### Phase 4: Causal Replay
**Goal:** Prove the extension can replay a captured failure against the inspected tab and produce FeltDB-linked evidence.

**Delivered:**
- ✅ Phase 4.1: Architecture (ReplayBrowser, ChromeAdapter, ReplayController, ReplayEngine)
- ✅ Phase 4.2: Integration tests (test server, E2E simulation)
- ✅ Phase 4.3: Persistence + UI (ReplayPanel, useReplay hook, FeltDB integration)

**Evidence:**
- Browser observes failure (currency=null → 422)
- ReplayFixture created with reproduction
- Replay executed via CDP against inspected tab
- Observations captured: navigation, interaction, network, errors
- Outcome classified: REPRODUCED
- Evidence stored in FeltDB

### Phase 5: Counterfactual Experiments
**Goal:** Isolate causal variables by running experiments with mutations.

**Delivered:**
- ✅ Fixture cloning and mutation (variable, network, timing)
- ✅ Outcome classification (ISOLATES_CAUSE, NOT_CAUSAL, INCONCLUSIVE)
- ✅ Counterfactual panel UI with suggested mutations
- ✅ FeltDB integration (experiment nodes, findings)

**Evidence:**
- Original: currency=null → 422
- Experiment: currency="USD" → 200
- Classification: ISOLATES_CAUSE (status changed)
- Finding: "currency field is necessary and sufficient"

### Development Workspace: Shared State Model
**Goal:** Establish browser and IDE as two clients of the same FeltDB-backed development state.

**Delivered:**
- ✅ DevelopmentWorkspace entity (root)
- ✅ InvestigationContextEnvelope (clean contract for agent)
- ✅ DevelopmentTask (work item from investigation)
- ✅ DevelopmentBridge abstraction (VS Code, Cursor, Claude Code, CLI)
- ✅ Vertical slice: Investigation → Workspace → Task → Agent discovers

**Evidence:**
- Same workspaceId = same development context
- Agent sees clean envelope (diagnosis, source, replay status, findings)
- Agent never sees Chrome internals or ReplayRun structure
- All data references FeltDB node IDs

## Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ BROWSER RUNTIME INVESTIGATOR (Phases 4–5)                       │
│                                                                  │
│ User triggers currency=null → 422 failure                       │
│ ↓                                                                │
│ Runtime Investigator captures evidence                          │
│ • Request/response snapshot                                     │
│ • Runtime errors and console events                             │
│ • Browser state                                                 │
│ ↓                                                                │
│ [▶ Replay] button clicked                                       │
│ ↓                                                                │
│ Phase 4.3: Replay Execution                                     │
│ • CDP navigates to page                                         │
│ • Installs network fixture                                      │
│ • Clicks element                                                │
│ • Captures observations                                         │
│ • Classifies outcome: REPRODUCED                                │
│ ↓                                                                │
│ ReplayPanel displays:                                           │
│ ✓ REPRODUCED | 90% confidence | 4/4 observations               │
│ ↓                                                                │
│ Phase 5: Counterfactuals                                        │
│ [▶ Set currency to USD]                                         │
│ [▶ Increase quantity to 2]                                      │
│ [▶ Mock successful response]                                    │
│ [▶ Add 5s network delay]                                        │
│ ↓                                                                │
│ Counterfactual #1: currency="USD"                               │
│ → Outcome: 200 OK                                               │
│ → Status changed: 422 → 200                                     │
│ → Classification: ISOLATES_CAUSE                                │
│ ↓                                                                │
│ CounterfactualPanel displays:                                   │
│ 🎯 ISOLATES CAUSE | 95% confidence                              │
│ "currency field is necessary and sufficient"                    │
└─────────────────────────────────────────────────────────────────┘
              │
              │ Publish investigation
              ▼
┌─────────────────────────────────────────────────────────────────┐
│ FELTDB: Evidence Graph                                          │
│                                                                  │
│ Investigation (inv-123)                                         │
│ • diagnosis: "currency field is required"                       │
│ • confidence: 96%                                               │
│                                                                 │
│ ReplayRun (reproduced_by)                                       │
│ • status: REPRODUCED                                            │
│ • confidence: 90%                                               │
│ • observations: 4                                               │
│ └─ Observation nodes (navigation, interaction, network, error)  │
│                                                                 │
│ CounterfactualExperiment                                        │
│ • variable: currency                                            │
│ • status: ISOLATES_CAUSE                                        │
│ • baseline: 422 → experiment: 200                               │
│ └─ CausalFinding node                                           │
└─────────────────────────────────────────────────────────────────┘
              │
              │ Extract clean envelope
              ▼
┌─────────────────────────────────────────────────────────────────┐
│ DEVELOPMENT WORKSPACE                                           │
│                                                                  │
│ DevelopmentWorkspace (workspace:123)                            │
│ ├─ repository: github.com/myapp/checkout                        │
│ ├─ branch: main                                                 │
│ └─ browserSessionId: session-123                                │
│                                                                 │
│ InvestigationContextEnvelope (clean contract)                   │
│ ├─ diagnosis: "currency field is required"                      │
│ ├─ confidence: 96%                                              │
│ ├─ sourceLocations: src/api/checkout.ts:45                      │
│ ├─ replay: REPRODUCED 90%                                       │
│ ├─ counterfactuals: [currency ISOLATES_CAUSE 95%]               │
│ └─ evidence: [node-ids]                                         │
│                                                                 │
│ DevelopmentTask                                                 │
│ ├─ workspaceId: workspace:123                                   │
│ ├─ investigationId: inv-123                                     │
│ ├─ label: "POST /api/checkout returns 422..."                   │
│ ├─ status: open                                                 │
│ ├─ sourceLocations: src/api/checkout.ts:45                      │
│ └─ properties.context:                                          │
│    ├─ pageUrl: http://localhost:3000                            │
│    ├─ targetRequest: POST /api/checkout                         │
│    ├─ replayId: replay:123                                      │
│    └─ counterfactuals: [currency ISOLATES_CAUSE]                │
└─────────────────────────────────────────────────────────────────┘
              │
              │ Query by workspaceId
              ▼
┌─────────────────────────────────────────────────────────────────┐
│ AGENT / IDE                                                      │
│                                                                  │
│ Agent discovers DevelopmentTask                                 │
│                                                                  │
│ Agent reads task:                                               │
│ "POST /api/checkout returns 422"                                │
│ "currency field is required"                                    │
│ "confidence: 96%"                                               │
│ "likely source: src/api/checkout.ts:45"                         │
│ "replay confirms: REPRODUCED"                                   │
│ "experiment shows: currency = necessary"                        │
│                                                                  │
│ Agent decides: Add currency validation check                    │
│                                                                  │
│ Agent makes code change:                                        │
│ src/api/checkout.ts (lines 45-47)                               │
│ -  const amount = cart.total                                    │
│ +  if (!cart.currency) throw new Error('Currency required')     │
│ +  const amount = cart.total                                    │
└─────────────────────────────────────────────────────────────────┘
              │
              │ Associate with workspace
              ▼
┌─────────────────────────────────────────────────────────────────┐
│ FELTDB: Code Change Linked                                      │
│                                                                  │
│ CodeChange                                                      │
│ ├─ workspaceId: workspace:123                                   │
│ ├─ taskId: task:123                                             │
│ ├─ investigationId: inv-123                                     │
│ ├─ filePath: src/api/checkout.ts                                │
│ └─ change: Add currency validation                              │
│                                                                  │
│ VerificationRun                                                 │
│ ├─ workspaceId: workspace:123                                   │
│ ├─ codeChangeId: change:123                                     │
│ ├─ investigationId: inv-123                                     │
│ ├─ status: pending                                              │
│ └─ (Ready for browser to verify via replay)                     │
└─────────────────────────────────────────────────────────────────┘
              │
              │ Browser verifies fix
              ▼
┌─────────────────────────────────────────────────────────────────┐
│ BROWSER VERIFICATION (Not yet implemented)                      │
│                                                                  │
│ Runtime Investigator detects VerificationRun                    │
│ ↓                                                                │
│ Replay with new code (hot reload)                               │
│ ↓                                                                │
│ Expected outcome: currency=null → 200 OK                        │
│ ↓                                                                │
│ Observation: currency required validation triggered             │
│ ↓                                                                │
│ Outcome: NOW_FIXED                                              │
│ ↓                                                                │
│ Update VerificationRun.status = passed                          │
│ ↓                                                                │
│ FeltDB linked evidence chain complete:                          │
│ Investigation → Replay → Experiment → CodeChange → Verification │
└─────────────────────────────────────────────────────────────────┘
```

## Test Coverage

### Phase 4.3: Replay Persistence (13 tests)
```
✓ createReplayEvidenceNodes (node/edge creation, confidence)
✓ buildReplaySummary (counts, observations, failures)
✓ formatReplayStatus (all outcome types)
```

### Phase 5: Counterfactuals (26 tests)
```
✓ createExperimentId (unique IDs)
✓ cloneFixture (deep copy, immutability)
✓ applyMutation (variable, timing, network)
✓ classifyExperimentOutcome (ISOLATES_CAUSE, NOT_CAUSAL, INCONCLUSIVE)
✓ buildExperimentResult (reasoning, confidence)
✓ createCounterfactualEvidenceNodes (nodes, edges, finding linking)
✓ formatExperimentStatus (icons, colors)
✓ buildExperimentSummary
```

### Development Workspace (14 tests)
```
Unit Tests (10):
✓ Workspace creation and reuse
✓ Investigation publication as task
✓ Task discovery and filtering
✓ Callback notifications
✓ Envelope extraction (no telemetry)
✓ Summary generation

Integration Tests (4):
✓ Complete vertical slice (investigation → workspace → task → agent discovery)
✓ Multiple investigations in workspace
✓ Evidence reference ID preservation
✓ Browser/agent pairing via workspaceId
```

**Total: 53 tests passing**

## Architecture Guarantees

### No Data Copying
- Browser publishes investigation ID
- Agent queries by investigation ID
- Both reference same FeltDB nodes
- No duplication or sync issues

### No Direct IDE → Browser
- Communication is via workspace state
- DevelopmentBridge abstraction
- Works with any IDE via adapters

### No Chrome Specificity in Agent
- InvestigationContextEnvelope is Chrome-independent
- Agent never knows about CDP, ReplayRun, evidence-graph
- Clean contract with domain-specific language (diagnosis, source, replay status, findings)

### Evidence Provenance
- Every task references investigation
- Every investigation references evidence nodes
- Every experiment references baseline replay
- Complete audit trail in FeltDB

### Future-Proof IDE Support
- DevelopmentBridge interface is platform-agnostic
- First implementation: LocalDevelopmentBridge (in-memory for testing)
- Can add VS Code, Cursor, Claude Code, CLI, cloud sync without changing core

## Code Stats

| Component | Files | Lines | Tests |
|-----------|-------|-------|-------|
| Phase 4.3 | 5 | 775 | 13 |
| Phase 5 | 8 | 1,456 | 26 |
| Dev Workspace | 5 | 1,700+ | 14 |
| **Total** | **18** | **3,900+** | **53** |

## Acceptance Criteria Met

✅ **Phase 4.3:** Replay observations → FeltDB evidence chain (REPRODUCED classification)

✅ **Phase 5:** Counterfactual experiments → Causal findings (ISOLATES_CAUSE)

✅ **Integration:** ReplayPanel wired into InvestigationDetails

✅ **Development Workspace:** Investigation → Task via clean contract

✅ **Agent Discovery:** DevelopmentTask discoverable without Chrome knowledge

✅ **Shared State:** Same workspaceId = same development context

✅ **No Copying:** All data references FeltDB node IDs

✅ **Extensible Bridge:** Platform-agnostic DevelopmentBridge abstraction

✅ **All Tests:** 39 existing Phase 4–5 tests + 14 new tests = 53 passing

## What's Ready for Next

### Second Vertical Slice (Browser Verification)
```
Agent makes code change
  ↓
Associated with workspace
  ↓
VerificationRun created
  ↓
Browser detects via FeltDB query
  ↓
Replay with new code
  ↓
Outcome compared to original
  ↓
Verification passed/failed
  ↓
Result stored in FeltDB
  ↓
Agent discovers result
```

### Third Vertical Slice (Visual Selection)
```
User selects element on live page
  ↓
Browser captures: selector, text, location, DOM context
  ↓
Opens intent dialog: "Make this text bigger"
  ↓
Creates DevelopmentTask with visual context
  ↓
Agent receives task with DOM/source hints
  ↓
Agent changes CSS/code
  ↓
Browser verifies live
```

## Key Insight

The browser is no longer just an observer. It's becoming an active participant in the development state.

```
Before:
  Browser → Chrome DevTools → Manual debugging

After:
  Browser ← → FeltDB ← → Agent
     (observe)     (decide)
     (verify)      (change)
```

The pairing works because both systems reference the same workspace. No HTTP requests. No data copying. Just: shared FeltDB state.

## Deployment Readiness

- ✅ All code compiles (TypeScript clean)
- ✅ All tests pass (53/53)
- ✅ No external dependencies added
- ✅ Existing Phase 4–5 functionality untouched
- ✅ Can deploy immediately (DevelopmentBridge is abstraction layer)
- ✅ Next IDE integration is "wire up DevelopmentBridge implementation"

Ready for next architectural milestone: Browser verification loop.
