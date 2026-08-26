# Development Workspace: Shared State Model

**Status:** ✅ Complete (Architecture + Bridge + Integration tests)

## Overview

The Development Workspace establishes the architectural foundation for browser and IDE to be two clients of the same FeltDB-backed development state.

**Core invariant:** Same `workspaceId` = same development context.

No data copying. No HTTP POST from extension to IDE. Both systems query the same FeltDB.

## Architecture

```
                    FeltDB
                    (single source of truth)
                 /      |      \
            /           |           \
    Browser           Workspace      IDE/Agent
    Observer          Coordinator    (acts on
  (investigates)    (shared state)    tasks)
         |                |                |
         ↓                ↓                ↓
   Investigation   DevelopmentTask   Code Changes
         ↓                ↓                ↓
   ReplayRun    Clean Envelope    Verification
         ↓                ↓                ↓
  Counterfactual  Agent-safe          Replay
    Findings      Contract           Verification
```

## Data Model

### DevelopmentWorkspace (root)

```typescript
interface DevelopmentWorkspace {
  id: string                    // workspace:timestamp:random
  kind: 'development_workspace'
  label: string
  repositoryUrl: string
  branch: string
  browserSessionId?: string      // Links to chrome.tabs
  properties: {
    repositoryOwner?: string
    repositoryName?: string
    workspaceRoot?: string
  }
}
```

Everything hangs off the workspace. Same workspaceId = same development context.

### Investigation (from browser)

```typescript
interface Investigation {
  id: string
  workspaceId: string      // Links to DevelopmentWorkspace
  kind: 'investigation'
  diagnosis: string
  confidence: number
  properties: {
    pageUrl?: string
    targetRequest?: { method: string; url: string }
    status?: number
    errorCount?: number
    reproductionSteps?: string[]
  }
}
```

Browser Runtime Investigator populates this via Phase 4–5 workflow.

### InvestigationContextEnvelope (clean contract)

```typescript
interface InvestigationContextEnvelope {
  workspaceId: string
  investigationId: string
  problem: {
    diagnosis: string
    confidence: number
    sourceLocations?: Array<{ file: string; line?: number }>
  }
  reproduction: {
    pageUrl?: string
    targetRequest: { method: string; url: string }
    status: number
    errorCount: number
    reproductionSteps?: string[]
  }
  replay?: {
    id: string
    status: 'REPRODUCED' | 'PARTIAL' | 'NOT_REPRODUCED'
    confidence: number
    observationCount: number
  }
  counterfactuals: Array<{
    variable: string
    status: 'ISOLATES_CAUSE' | 'INCONCLUSIVE' | 'NOT_CAUSAL'
    confidence: number
    reasoning: string
    baselineOutcome: number
    experimentOutcome: number
  }>
  evidence: {
    nodeIds: string[]  // FeltDB node IDs for future detailed inspection
  }
}
```

**Key property:** Agent never sees Chrome telemetry, ReplayRun internals, or evidence-graph details. Only development-safe context.

### DevelopmentTask (work item)

```typescript
interface DevelopmentTask {
  id: string                  // task:timestamp:random
  workspaceId: string         // Links to DevelopmentWorkspace
  investigationId: string     // Links to Investigation
  kind: 'development_task'
  label: string               // "POST /api/checkout returns 422 - currency field is required"
  description: string
  status: 'open' | 'in_progress' | 'completed' | 'blocked'
  sourceLocations: Array<{ file: string; line?: number }>
  evidenceReferenceIds: string[]  // FeltDB node IDs
  properties: {
    context?: {
      pageUrl?: string
      targetRequest?: { method: string; url: string }
      replayId?: string
      counterfactuals?: CounterfactualFinding[]
    }
  }
}
```

Agent consumes this without understanding browser internals.

### CodeChange (proposed fix)

```typescript
interface CodeChange {
  id: string                  // change:timestamp:random
  workspaceId: string         // Links to DevelopmentWorkspace
  taskId?: string             // Links to DevelopmentTask
  investigationId?: string    // Links to Investigation
  kind: 'code_change'
  label: string
  filePath: string
  lineStart?: number
  lineEnd?: number
  originalText?: string
  newText?: string
  status: 'draft' | 'proposed' | 'applied' | 'reverted'
}
```

Agent publishes proposed changes associated with workspace and task.

### VerificationRun (replay verification)

```typescript
interface VerificationRun {
  id: string                  // verify:timestamp:random
  workspaceId: string         // Links to DevelopmentWorkspace
  codeChangeId: string        // Links to CodeChange
  investigationId: string     // Links to Investigation
  kind: 'verification_run'
  status: 'pending' | 'running' | 'passed' | 'failed'
  replayId?: string           // Links to ReplayRun
  replayStatus?: 'REPRODUCED' | 'NOT_REPRODUCED' | 'UNDETERMINED'
  confidence?: number
}
```

Verification runs are triggered after code changes to confirm the fix works.

## DevelopmentBridge API

Platform-agnostic abstraction. First implementation: `LocalDevelopmentBridge` (in-memory).

Future implementations:
- VS Code extension
- Cursor integration
- Claude Code
- CLI
- Remote cloud sync

```typescript
interface DevelopmentBridge {
  // Workspace operations
  getOrCreateWorkspace(
    repositoryUrl: string,
    branch: string,
    browserSessionId?: string
  ): Promise<DevelopmentWorkspace>

  getWorkspace(workspaceId: string): Promise<DevelopmentWorkspace | null>

  // Investigation and task publishing
  publishInvestigation(
    workspaceId: string,
    envelope: InvestigationContextEnvelope
  ): Promise<DevelopmentTask>

  // Task discovery
  discoverTasks(
    workspaceId: string,
    status?: string
  ): Promise<DevelopmentTask[]>

  // Status updates
  updateTaskStatus(
    taskId: string,
    status: DevelopmentTask['status'],
    updates?: Partial<DevelopmentTask>
  ): Promise<void>

  // Source navigation
  openSourceLocation(file: string, line?: number, column?: number): Promise<void>

  // Change management
  proposedCodeChange(
    workspaceId: string,
    taskId: string,
    change: CodeChange
  ): Promise<void>

  // Notifications
  notifyChange(workspaceId: string, message: string): Promise<void>

  // Callbacks
  onDiscoveredTask(callback: (task: DevelopmentTask) => void): () => void
  onVerificationRequired(callback: (run: VerificationRun) => void): () => void
}
```

## The Vertical Slice: Browser → IDE

```
1. Browser investigator observes failure
   ↓
2. Phase 4.3: Replay confirms reproduction
   ↓
3. Phase 5: Counterfactual finds causal variable
   ↓
4. Extract clean InvestigationContextEnvelope
   (No raw telemetry, no ReplayRun internals)
   ↓
5. Publish to DevelopmentBridge via DevelopmentWorkspace
   ↓
6. Agent/IDE queries bridge for workspace
   ↓
7. Agent discovers DevelopmentTask
   ↓
8. Agent reads task properties
   (diagnosis, source location, replay status, findings)
   ↓
9. Agent makes code change
   ↓
10. Change associated with same workspaceId
    ↓
11. VerificationRun created
    ↓
12. Browser Runtime Investigator can replay and verify fix
```

**Key invariant:** Steps 1–7 work without agent ever understanding CDP, ReplayRun, or evidence-graph internals.

## What Agent Sees

```
DevelopmentTask {
  label: "POST /api/checkout returns 422 - currency field is required"
  diagnosis: "Currency field is required"
  confidence: 96%
  sourceLocations: [{ file: "src/api/checkout.ts", line: 45 }]
  reproductionSteps: ["Navigate", "Click", "POST returns 422"]
  replayStatus: "REPRODUCED"
  replayConfidence: 90%
  observations: 4
  counterfactuals: [{
    variable: "currency",
    status: "ISOLATES_CAUSE",
    reasoning: "Changing currency from null to USD changed status from 422 to 200",
    confidence: 95%
  }]
}
```

No:
- Chrome DevTools Protocol objects
- ReplayRun internals
- Network packet dumps
- Raw console events
- Evidence graph structure

Just: **Clean development context.**

## Test Coverage

### Unit Tests (10 tests)
- Workspace creation and reuse
- Investigation publication
- Task discovery
- Status filtering
- Callback notifications
- Envelope extraction
- Summary generation

### Integration Tests (4 tests)
- Complete vertical slice: Investigation → Workspace → Task → Agent discovery
- Multiple investigations in same workspace
- Evidence reference ID preservation
- Browser/agent pairing via same workspaceId

**All 14 tests passing.**

## Next Steps (Not Yet Implemented)

### Second Vertical Slice: IDE → Browser
```
Agent creates CodeChange
  ↓
Associated with workspace
  ↓
VerificationRun created
  ↓
Browser Runtime Investigator
  ↓
Replay with code changes
  ↓
Replay verification succeeds/fails
  ↓
FeltDB updated
  ↓
Agent discovers verification result
```

### Third Vertical Slice: Visual Selection
```
User selects element on live page
  ↓
Browser captures element + context
  ↓
Opens intent dialog
  ↓
"Make this text bigger"
  ↓
Creates DevelopmentTask with visual/DOM context
  ↓
Agent receives task with source hint
  ↓
Agent changes code
  ↓
Browser automatically verifies
```

## Architectural Guarantees

✅ **No data copying** — Everything references FeltDB node IDs

✅ **No direct IDE → Browser** — Communication is via workspace state

✅ **No Chrome-specific abstractions in agent** — Clean InvestigationContextEnvelope

✅ **Future IDE support** — DevelopmentBridge allows VS Code, Cursor, Claude Code without modification

✅ **Evidence provenance** — Every task references investigations which reference evidence nodes

✅ **Pairing via workspaceId** — Same ID means same context, no manual linking needed

## Files Added

| File | Purpose |
|------|---------|
| developmentWorkspace.ts | Data model (Workspace, Investigation, Task, Change, Verification) |
| developmentBridge.ts | Abstraction + LocalDevelopmentBridge implementation |
| investigationEnvelope.ts | Clean contract extraction + summary |
| developmentWorkspace.test.ts | 10 unit tests |
| developmentWorkspace.integration.test.ts | 4 integration tests |

**Total: 650+ lines + 14 passing tests**

## Acceptance Criteria Met

✅ Browser investigation → FeltDB → DevelopmentWorkspace → DevelopmentTask → Agent discovers task

✅ Agent receives clean contract (InvestigationContextEnvelope), not raw telemetry

✅ Same workspaceId establishes pairing

✅ No second database or persistence system

✅ All 39 Phase 4–5 tests continue passing (+ 14 new tests)

✅ DevelopmentBridge abstraction allows multiple IDE implementations

✅ Evidence references (node IDs) preserved for future detailed inspection

Next: Prove agent can make code change and have it discovered by verification loop.
