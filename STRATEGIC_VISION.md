# Runtime Investigator - Strategic Vision

## The Real Differentiation

This isn't a "better DevTools" or "Sentry competitor."

**Runtime Investigator is a causal debugging engine.**

The distinction matters because every architectural decision flows from it:
- Not: "How do we build a team dashboard?"
- **But:** "How do we make 'Why?' answerable with evidence?"

The killer feature is **auditable reasoning**: every diagnosis traceable back to actual observed data, confidence quantified by evidence quality, not AI conviction.

---

## The Core Loop (V1.0)

```
CAPTURE
  └─ Browser telemetry (requests, errors, mutations, timing)
       │
       ▼
UNDERSTAND
  └─ Construct evidence graph (causal edges, provenance)
       │
       ▼
INVESTIGATE
  └─ Deterministic anomaly detection + causal path analysis
       │
       ▼
EXPLAIN
  └─ Optional local AI interprets evidence (not invents)
       │
       ▼
REPRODUCE
  └─ Generate executable test from observed sequence
       │
       ▼
FIX
  └─ Developer changes code
       │
       ▼
VERIFY
  └─ Re-run causal scenario, compare evidence graphs
```

This is a **complete debugging workflow**—something between a debugger and an observability tool, but neither.

---

## The Killer Feature: "Why?"

Every important artifact should have an answer.

### Request
**Why did this request happen?**
```
POST /api/checkout
        ↑
checkout.ts:184
        ↑
buildOrderPayload()
        ↑
cart.currency = undefined
        ↑
GET /api/cart
        ↑
stale cached response
```

Not just a trace. A causal chain where each link is clickable.

### Error
**Why did this error happen?**
```
TypeError: Cannot read property 'total' of undefined
        ↑
SearchResults.tsx:92 reading payload.data.total
        ↑
GET /api/search returned wrong shape
        ↑
Field 'total' removed in backend v2.1
        ↑
Frontend not updated for schema change
```

### Payload Corruption
**Why is this field wrong?**
```
amount: "$12.35"  (should be number)
        ↑
formatCurrency() applied twice
        ↑
called from checkout.ts:184
        ↑
called from buildOrderPayload()
        ↑
state mutation at SearchResults:click
```

### Slow Request
**Why was this slow?**
```
GET /api/cart: 2847ms
        ↑
But response arrived in 180ms (shown in timeline)
        ↑
Browser parsing/rendering: 2667ms
        ↑
cart.js:412 processing response with O(n²) algorithm
        ↑
This only manifests with >100 items
```

### UI State Anomaly
**Why is this component showing this state?**
```
SearchResults showing "No results"
        ↑
results.length === 0
        ↑
Last request returned []
        ↑
But previous request returned 47 items
        ↑
Query parameter changed from query=coffee to query=coffe
        ↑
User typo at SearchInput:click
```

The answer isn't prose. It's **a traversable causal chain** where you can:
- Click any node to see supporting evidence
- See confidence score (92% vs 64%)
- See what evidence is missing
- Understand the difference between "observed" and "inferred"

---

## Evidence vs Inference vs Speculation

This is where your deterministic engine becomes your moat.

Don't let the AI simply assert:
> "This looks like a race condition."

Require three layers:

### Layer 1: Evidence (Observed)
```
cache.init() completed: 12:03:102.445
checkout() began:       12:03:089.223
First cache access:     12:03:091.667
cache.get(key):         returned undefined
```

Each with timestamps, line numbers, and evidence node IDs.

### Layer 2: Inference (Deduced from evidence)
```
Timeline shows checkout() started BEFORE cache.init() completed.
→ Cache was not initialized when accessed.
→ cache.get() correctly returned undefined.
```

This is pure logic. It either holds or it doesn't.

### Layer 3: Speculation (Requires interpretation)
```
IF cache.init() races with checkout():
  THEN checkout should fail with "cache not initialized".

OBSERVED: Failure message was "Cache lookup failed."
→ Matches hypothesis with 94% confidence.

MISSING EVIDENCE: We don't see the actual race condition.
→ Initialization lifecycle wasn't fully captured.
```

The tool should distinguish these three layers, and **only the third one uses AI**.

This creates something almost no debugging tool has: **auditable reasoning**.

---

## The Reproduce Feature

After identifying the causal path, generate an executable artifact.

### Input
An investigation showing:
```
User clicks checkout
  ↓
cart state hasn't loaded
  ↓
buildOrderPayload() throws
  ↓
Error UI displays
```

### Output
A Playwright test:
```typescript
test("checkout fails when cart hasn't loaded", async ({ page }) => {
  await page.goto("/checkout");

  // Simulate captured network conditions
  await mockResponse("/api/cart", {
    status: 200,
    body: { items: [] }  // Empty response captured in failure
  });

  // Mock timing: request takes 2s
  await mockDelay("/api/cart", 2000);

  // Trigger checkout before cart loads
  const checkoutButton = page.getByRole("button", { name: "Checkout" });
  
  // Expect the observed failure
  await expect(page.getByText("Checkout failed")).toBeVisible();
});
```

Key points:
- Uses **captured network conditions** (actual responses from failure)
- Uses **observed timing** (not artificial delays)
- Uses **actual DOM queries** from the investigation (scraped from evidence)
- Can be run immediately by developer
- Can be committed to CI

This transforms the tool from **"Here's what failed"** to **"Here's how to reproduce it."**

---

## The Verify Loop

After the developer fixes code:

### Before
```
SEQUENCE
  click
    ↓
  cart undefined
    ↓
  buildOrderPayload throws
    ↓
  error UI
```

### After
```
SEQUENCE
  click
    ↓
  cart loaded
    ↓
  buildOrderPayload succeeds
    ↓
  checkout request sent
    ↓
  success response
```

### Comparison
```
✅ Original failure resolved
   Before: buildOrderPayload threw
   After:  buildOrderPayload succeeded

⚠️  New behavior detected
   Before: No POST /api/checkout
   After:  POST /api/checkout (201 Created)
   
   [New investigation auto-created]
```

This is more sophisticated than conventional testing because it's not just "test passed/failed"—it's "**what changed in the actual runtime behavior**?"

---

## Make Investigations Queryable

Your FeltDB + evidence nodes already support this.

An investigation should be more than a report. It should be a **queryable debugging artifact**:

```
Investigation {
  id: "inv-2024-08-25-001"
  
  Session {
    url: "https://app.example.com/checkout"
    userAgent: "Chrome 128..."
    timing: [start, end]
  }
  
  Timeline {
    events: [
      { ts: 12:03:01, type: "click", source: "checkout.tsx:184" },
      { ts: 12:03:02, type: "fetch", url: "/api/cart" },
      { ts: 12:03:04, type: "response", status: 200 },
      { ts: 12:03:05, type: "error", message: "..." }
    ]
  }
  
  Requests {
    GET /api/cart: { status: 200, body: {...}, timing: 2s }
    POST /api/checkout: { failed }
  }
  
  RuntimeEvents {
    console.error: [...]
    exceptions: [...]
  }
  
  SourceLocations {
    checkout.tsx:184
    buildOrderPayload.ts:42
    cart.ts:67
  }
  
  CausalEdges {
    buildOrderPayload(ERROR) ← cart.state.undefined
    checkout.click → buildOrderPayload.call
    GET /api/cart → cart.state
  }
  
  Hypotheses {
    "Race condition": { confidence: 94%, evidence: [...] }
    "Schema mismatch": { confidence: 23%, evidence: [...] }
  }
  
  Reproductions {
    test_id: "checkout-fails-when-cart-not-loaded"
    playwright_code: "..."
    status: "passing"
  }
  
  Verifications {
    fix_commit: "abc123def"
    re_run_status: "success"
    behavior_changes: [...]
  }
}
```

Now you can query:
- "What caused this error?"
- "What depended on this request?"
- "What changed between then and now?"
- "Show all paths from user interaction → failure"
- "Find another investigation with this causal pattern"
- "When did this causal path first appear?"

The investigation becomes a graph you can traverse, not just a report you read.

---

## The AI Philosophy (Different from Report)

The report said:
> "AI-Powered Root Cause Analysis"

**Better framing:**
```
Evidence Graph → Deterministic Reasoning → Bounded Evidence Neighborhood → LLM Interpretation
```

The LLM should **never invent** the investigation. It should **interpret what was observed**.

Your existing provenance requirement is exactly right:
- Every claim must trace back to evidence nodes
- Confidence scored by evidence quality
- Missing evidence noted explicitly
- Speculation labeled as such

This creates **auditable AI diagnosis** — something almost no tool has.

Eventually every finding should be traceable:
```
Diagnosis
├── Evidence E-184 (cache.init timing)
├── Evidence E-193 (cache.get call)
└── Evidence E-201 (checkout.click source)
```

---

## Time Travel (Focused)

The report proposed full application-state time travel. That's a rabbit hole.

**Instead: Causal time travel**

Let me scrub through the evidence timeline:
```
12:04:01.012  [user] click "Checkout"
12:04:01.018  [state] cart loading = true
12:04:01.024  [fetch] GET /api/cart
12:04:01.113  [response] 200 OK
12:04:01.118  [state] cart = {items: []}
12:04:01.119  [error] TypeError: cannot read property...
```

Select any event:
- "Why did the app reach this state?"
- Traverse backward through the evidence graph
- See what conditions led to this point
- Jump to related events

This is **immediately achievable** and aligns perfectly with your architecture.

---

## The "What Changed?" Feature

This unlocks a very different product idea.

Currently: Developer encounters failure, selects request, investigates.

**Eventually:**
- Extension watches runtime behavior continuously
- Establishes baseline (normal request latency, response shape, error rate)
- Detects anomalies automatically:
  > "GET /api/search normally returns 200 in 180–240ms. Today: 47 requests in 180–240ms (normal), but 3 returned in 8–12s (slow)."
  
- Correlates with other observations:
  > "Those 3 slow requests all had query parameter search_type=exact, which is new."
  
- Traces to code change:
  > "This behavior first appeared after commit abc123def (searchExact endpoint added)."
  
- Generates reproduction:
  > "Test for searchExact performance regression."

That becomes **a system that observes, hypothesizes, and verifies automatically**.

It's closer to browser-native observability + debugging than to a conventional tool.

And critically: the core evidence can remain **local and privacy-preserving**.

---

## What NOT to Build (Yet)

Push these down substantially:

### Distribution Layer
- Slack integration ❌
- Jira integration ❌
- Firefox/Safari ports ❌
- Team dashboards ❌

These don't make the core product better. They're solvents for adoption problems you don't have yet.

### Business Layer
- SSO ❌
- Audit logs ❌
- Enterprise tier ❌

Again: distribution, not differentiation.

### Community/Crowdsourced
- ML clustering ❌
- Knowledge base ❌
- Community plugins ❌

Nice-to-have ecosystem features. Ship the core loop first.

### All the documentation you don't need yet
The report suggested 12-16 hours of docs before proving the product works.

**Actually:** Write just enough to let someone install it and run through the core loop. The product proves itself.

---

## The Roadmap (Re-prioritized)

### Phase 1: Perfect "Why?"
**Goal:** Make "Why?" answerable with evidence.

- [ ] Implement full causal edge traversal
- [ ] Surface evidence node IDs in UI
- [ ] Show evidence quality (observed vs inferred vs missing)
- [ ] Confidence scoring based on evidence completeness
- [ ] Distinguish evidence from speculation

**Output:** Investigation UI where every claim is clickable and traceable.

**Duration:** 2-3 weeks

### Phase 2: Add "Reproduce"
**Goal:** Turn observed failures into executable tests.

- [ ] Extract network mocks from investigation
- [ ] Extract DOM queries from captured screenshots
- [ ] Generate Playwright test template
- [ ] Auto-detect mutation patterns for state setup
- [ ] Generate both positive (repro) and negative (verify) tests

**Output:** One-click "Generate Test" from investigation.

**Duration:** 2-3 weeks

### Phase 3: Build "Verify"
**Goal:** Close the loop: fix → re-run → compare.

- [ ] Store investigation as queryable artifact
- [ ] Re-capture evidence for re-run
- [ ] Diff evidence graphs (before/after)
- [ ] Detect new failures in fixed code
- [ ] Show timeline comparison

**Output:** Verification workflow showing before/after behavior.

**Duration:** 2-3 weeks

### Phase 4: Make Investigations Queryable
**Goal:** Investigations become debugging artifacts, not just reports.

- [ ] Implement graph query interface
- [ ] Add "Find similar investigations" (pattern matching)
- [ ] Add "Timeline scrubber" with causal traversal
- [ ] Add "What changed?" queries
- [ ] Export as structured format (JSON-LD with provenance)

**Output:** Investigations are searchable, reusable, shareable as data.

**Duration:** 3-4 weeks

### Phase 5: Automatic Anomaly Detection
**Goal:** Extension watches for failures proactively.

- [ ] Baseline learning (normal behavior)
- [ ] Anomaly scoring (deviation from baseline)
- [ ] Auto-correlation with code changes
- [ ] Auto-investigation triggering
- [ ] Diff against commits

**Output:** Extension flags problems before user encounters them.

**Duration:** 4-6 weeks

---

## Why This Roadmap Matters

Each phase **adds depth to the core loop**, not breadth to distribution.

Phase 1 makes investigations **auditable**.
Phase 2 makes them **actionable**.
Phase 3 makes them **verifiable**.
Phase 4 makes them **queryable and reusable**.
Phase 5 makes them **proactive**.

By Phase 3, you have something **no conventional debugger does**: a tool that turns observed failures into tests, and verifies fixes by re-observing behavior.

That's the differentiation.

---

## The Long-Term Moat

By Phase 5, you have:

1. **Evidence-backed reasoning** — every diagnosis traceable to data
2. **Causal understanding** — not just "what failed" but "why"
3. **Executable reproductions** — failures turn into tests automatically
4. **Verifiable fixes** — proof that fixes actually work
5. **Proactive observation** — anomalies detected before user sees them

Sentry does monitoring. DevTools does step-through debugging.

**You do causal debugging + verification + automation.**

That's a different product category.

And it all stays local, privacy-preserving, and embedded in the browser where the evidence lives.

---

## One-Sentence Roadmap

> Don't turn Runtime Investigator into a team dashboard. Turn it into a system that observes a failure, explains its causal chain, reproduces it, and verifies the fix—all without leaving the browser.

---

## What to Build First (Monday)

1. **Enhance "Why?" UI** 
   - Make causal edges clickable in investigation details
   - Show which evidence supports each inference
   - Add confidence score per claim

2. **Add Evidence Inspector**
   - Click any node in the graph to see:
     - Raw data
     - Provenance (where it came from)
     - Related nodes
     - Evidence quality

3. **Distinguish Evidence Layers**
   - "Observed: cache.get returned undefined at T+2000ms"
   - "Inferred: checkout() hadn't called cache.init()"
   - "Hypothesis: Race condition (confidence 94%)"

That one feature—making reasoning transparent—might be enough to make this fundamentally different from what exists.

Do that first. Everything else flows from it.
