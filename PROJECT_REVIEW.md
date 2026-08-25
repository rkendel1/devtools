# Chrome Runtime Investigator - Project Review Report

**Date:** August 25, 2026  
**Project:** Chrome Runtime Investigator  
**Repository:** https://github.com/rkendel1/devtools  
**Current Version:** 0.1.0 (MVP)  

---

## Executive Summary

Chrome Runtime Investigator is a sophisticated Chrome DevTools extension with a **solid architectural foundation** and an **innovative evidence graph approach** to debugging. The MVP implementation is surprisingly complete, but the project lacks the infrastructure and features needed for production deployment and team adoption.

### Key Findings
- ✅ **Strong technical foundation**: Evidence graph design, deterministic analysis, privacy-first approach
- ⚠️ **Missing critical infrastructure**: No CI/CD, minimal documentation, no community guidelines
- ❌ **Feature gaps for scale**: No collaboration, no integrations, single-browser only
- 🚀 **High potential**: With 30-60 days of focused work, this could be a category leader

### Overall Scorecard
| Category | Score | Status |
|----------|-------|--------|
| Architecture | 8/10 | Strong |
| Feature Completeness | 7/10 | Good MVP, needs intelligence layers |
| Code Quality | 7/10 | Good TypeScript, missing E2E tests |
| Documentation | 3/10 | 🔴 Critical gap |
| Community Readiness | 2/10 | 🔴 Critical gap |
| **Overall Potential** | **8.5/10** | High with execution work |

---

## What's There (Strengths)

### 1. Core Architecture

#### Evidence Graph System
The heart of the application is a sophisticated graph structure that connects:
- Network requests (method, URL, status, timing)
- Runtime events (console errors, exceptions)
- Environment context (page URL, user agent, viewport)
- Related requests and anomalies
- Trace information linking back to source code

This is **more powerful than flat request logs** because it models causality and correlation.

#### Deterministic Analysis Engine
- Rust WASM engine (`/wasm-engine`) for reproducible analysis
- Handles payload diff detection, anomaly discovery, and request tracing
- Runs locally in the browser—no data leaves the device
- Designed for testability and verification

#### Privacy-First Architecture
- **Sensitive data redaction** with configurable patterns (API keys, tokens, PII)
- Optional inclusion/exclusion of headers and request/response bodies
- Bounded retention: 24-hour TTL for unpinned evidence
- Automatic garbage collection with 5-minute cleanup checks
- **No telemetry or tracking** by default

#### Local + Optional AI
- **Deterministic reasoning** works 100% offline
- **Optional WebLLM** for AI diagnosis (SmolLM2 360M, ~580MB VRAM)
- Evidence-scoped questions with local inference only
- Model findings include validated citations to stored evidence nodes

#### Durable Storage
- FeltDB-backed IndexedDB with automatic legacy migration
- Bounded collection: max 300 live requests, 1,500 raw requests, 1,500 runtime events
- Request/response bodies truncated to 128 KiB before storage
- Explicit retention policy with pin-for-permanence feature

### 2. Feature Completeness

| Feature | Status | Notes |
|---------|--------|-------|
| Request selection & investigation | ✅ | One-click investigation panel |
| Evidence graph visualization | ✅ | Interactive graph view |
| Screenshot capture | ✅ | Gallery component with grouping |
| Smart filtering | ✅ | By status, domain, MIME type, time range |
| Auto-investigation | ✅ | Automatic analysis of failures + live updates |
| Multi-format export | ✅ | Plain-text, MD, Jira, JSON |
| Investigation history | ✅ | Searchable, renameable, pinnable, deletable |
| Privacy controls | ✅ | Per-investigation redaction settings |
| Local AI | ✅ | WebLLM integration with model selection |
| Retention management | ✅ | Auto-cleanup with configurable TTLs |

### 3. Development Quality

**Tech Stack:**
- React 19.2.8 (latest)
- TypeScript 6.0.2 (strict mode)
- Vite 8.2.2 (fast HMR, modern bundling)
- Vitest 3.2.4 (unit testing)
- Oxlint 1.79.0 (fast linting)
- Rust + wasm-pack (WASM compilation)

**Test Coverage:**
- 6 test files covering core libraries
  - `evidenceGraph.test.ts` - Graph construction
  - `redaction.test.ts` - Sensitive data handling
  - `retention.test.ts` - Garbage collection
  - `feltRepository.test.ts` - Storage layer
  - `report.test.ts` - Export formatting
  - `evidenceEngine.test.ts` - Analysis engine

**Type Safety:**
- Comprehensive TypeScript interfaces for all major types
- No `any` types in core libraries
- Proper use of generics and discriminated unions
- Chrome API types from `@types/chrome`

**Build System:**
- Multi-entry Vite config (panel, devtools, offscreen)
- Proper WASM integration with bundler target
- Content script separation for security
- Chrome MV3 security headers in CSP

### 4. Code Statistics

```
Total TypeScript Code: ~2,100 lines
Components: 11 (App, Panel, Investigaton, Gallery, GraphView, etc.)
Libraries: 12 core modules
Tests: 6 test suites
Git History: 13 commits, active development
```

---

## What's Missing (Critical Gaps)

### 🔴 Tier 1: Critical for Production (Blocks Shipping)

#### 1. CI/CD Pipeline
**Impact:** Cannot safely merge changes; no quality gate

**Missing:**
- No `.github/workflows/` directory
- Tests don't run on every commit
- No type-checking in CI
- No linting enforcement
- No build verification

**Effort:** 4-6 hours
**Solution:**
```yaml
# .github/workflows/test.yml
- Lint with oxlint
- Type-check with tsc
- Run tests with vitest
- Build extension with vite
- Upload artifacts
```

#### 2. Documentation
**Impact:** Developers can't understand architecture; users can't install

**Missing:**
- `docs/ARCHITECTURE.md` - Evidence graph design, data flow
- `docs/DEVELOPMENT.md` - Setup, debugging, release process
- `docs/INSTALLATION.md` - Step-by-step guide with screenshots
- `docs/API.md` - Message passing, extension APIs
- Enhanced README with screenshots, feature comparison
- `TROUBLESHOOTING.md` - Common issues and solutions

**Effort:** 12-16 hours
**Impact:** Game-changer for adoption

#### 3. Community Guidelines
**Impact:** No clear path for contributions; looks abandoned

**Missing:**
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/pull_request_template.md`
- `CONTRIBUTING.md` - Code style, review process
- `CODE_OF_CONDUCT.md` (if taking external contributors)
- Issue labels and automation

**Effort:** 3-4 hours

#### 4. End-to-End Tests
**Impact:** UI changes can break silently; no regression detection

**Missing:**
- Playwright/Puppeteer tests for extension behavior
- Test fixtures for various failure scenarios
- Export format validation
- Privacy redaction verification
- History persistence tests

**Effort:** 12-16 hours

#### 5. Release Management
**Impact:** No way to publish updates consistently

**Missing:**
- Release checklist process
- CHANGELOG documentation
- Version bumping strategy
- Chrome Web Store submission guide
- Auto-generated release notes

**Effort:** 4-6 hours

---

### 🟡 Tier 2: Important for Growth (Blocks Team Adoption)

#### 1. Collaboration Features
**Missing:**
- No way to share investigations with teammates
- No annotation/comment system
- No approval workflows
- No team dashboard

**Current:** Solo developer tool  
**Market need:** Teams want centralized visibility

#### 2. Integrations
**Missing:**
- Slack notifications
- Jira issue creation
- GitHub issue linking
- Email reports
- Webhook support

**Current:** Clipboard export only

#### 3. Intelligence Layers
**Missing:**
- No ML-based issue clustering
- No pattern learning across investigations
- No anomaly trend detection
- No correlation across requests/sessions

**Current:** Static rule-based analysis

#### 4. Cross-Browser Support
**Missing:**
- Firefox WebExtensions version
- Safari App Extension version
- Unified build system for multi-browser

**Current:** Chrome MV3 only

---

## What Would Make It Incredible (Strategic Opportunities)

### 🎯 Game-Changing Features (Tier 1)

#### 1. AI-Powered Root Cause Analysis
**Impact:** 10x increase in debugging speed

**How:**
- Use graph structure to feed context to Claude API (enterprise option) or local model
- Correlate seemingly unrelated events automatically
- Learn from developer feedback to improve diagnoses
- Generate hypothetical fixes with code snippets

**Example:**
```
"Request failed 500ms after 3x retries.
Console shows: "Cache not initialized"
Initiator trace shows cache.init() was skipped.
Hypothesis: Race condition in initialization order."
```

**Effort:** 20-30 hours  
**ROI:** This is your killer feature

#### 2. Time-Travel Debugging
**Impact:** Eliminate "works on my machine" debugging

**How:**
- Record full request/response lifecycle with microsecond timing
- Index by timestamp for fast lookback
- Allow stepping through events like debugger
- Inspect application state at any point

**Current:** Just captures final state

**Effort:** 25-35 hours

#### 3. Request Correlation Engine
**Impact:** Identify cascading failures in microservices

**How:**
- Link requests via session tokens, user IDs, trace IDs
- Visualize dependency graph
- Show which service started the failure cascade
- Correlate across multiple DevTools windows

**Example:** User clicks → Frontend request fails → Backend request fails → Database timeout

**Effort:** 15-20 hours

#### 4. Mobile & Remote Device Debugging
**Impact:** Debug real devices without installing DevTools everywhere

**How:**
- Proxy DevTools protocol from remote device
- Stream evidence from device to desktop DevTools
- Central "debug wall" showing all connected devices
- Same investigation workflow for all devices

**Effort:** 30-40 hours (infrastructure heavy)

---

### 🚀 Tier 2: Production Readiness

#### 1. Custom Anomaly Rules
```javascript
// Example: Allow custom rule definitions
addRule('slow_response', {
  check: (request) => request.timingMs > 2000,
  severity: 'warning',
  action: 'auto_investigate'
})
```

**Effort:** 8-10 hours

#### 2. Team Dashboard
- Aggregated failure metrics by endpoint, status, domain
- Trend charts (failures/hour, avg response time)
- Most common issues with crowd wisdom
- Affected endpoints ranked by frequency

**Effort:** 20-25 hours

#### 3. Integrations
- Slack: Post investigation summaries with 1-click Jira/Linear creation
- Jira: Deep linking, issue templates, auto-assignment
- GitHub Issues: Auto-create issues from investigations
- Webhooks: Custom downstream automation

**Effort:** 15-20 hours (per integration)

#### 4. Test Generation
- Record failing request sequences
- Generate Playwright/Cypress tests
- Auto-generate expected values from successful responses
- One-click "add to CI"

**Effort:** 20-30 hours

#### 5. Team Collaboration
- Share investigations with @mentions
- Annotation/comment threads
- Status tracking (investigating → confirmed → fixed)
- Integration with bug tracking workflows

**Effort:** 15-20 hours

---

### 🌟 Tier 3: Ecosystem & Moat

#### 1. Plugin System
- Custom analysis engines
- Domain-specific redaction strategies
- Custom exporters and report formatters
- Third-party integrations

**Effort:** 20-25 hours

#### 2. Knowledge Base
- Crowdsourced failure patterns (anonymized)
- Similar issues from community
- Search by error message, stack trace patterns
- Solutions from developers who solved it

**Effort:** 30-40 hours

#### 3. ML-Driven Clustering
- Use graph embeddings to find similar failures
- Automatically deduplicate issues
- Suggest related investigations
- Predict which fixes will work

**Effort:** 25-35 hours

#### 4. Cross-Browser Support
- Firefox version (WebExtensions API abstraction)
- Safari version (different distribution model)
- Unified backend/frontend

**Effort:** 30-40 hours per browser

---

## Immediate Action Plan (Next 30 Days)

### Week 1: Foundation
- [ ] Set up GitHub Actions CI/CD
- [ ] Create `.github/` templates and workflows
- [ ] Write `docs/ARCHITECTURE.md`

**Effort:** 12-16 hours  
**Output:** Tests running on every commit, architecture documented

### Week 2: Documentation
- [ ] Write `docs/DEVELOPMENT.md` (setup, debugging, debugging locally)
- [ ] Write `docs/INSTALLATION.md` with screenshots
- [ ] Enhance README with feature comparison
- [ ] Create `CONTRIBUTING.md`

**Effort:** 12-16 hours  
**Output:** Users can install; developers can contribute

### Week 3: Quality
- [ ] Write E2E tests with Playwright
- [ ] Add coverage reporting
- [ ] Create `docs/RELEASE.md`
- [ ] Document Chrome Web Store submission

**Effort:** 16-20 hours  
**Output:** Can safely merge changes; ready for public release

### Week 4: Community
- [ ] Publish to Chrome Web Store (if privacy policy ready)
- [ ] Create roadmap in `docs/ROADMAP.md`
- [ ] Set up discussion templates
- [ ] Write first blog post on Hacker News / Dev.to

**Effort:** 8-12 hours  
**Output:** First users; community feedback

---

## Technical Debt & Risks

### High Priority
1. **No E2E tests** - UI changes go untested
2. **Minimal linting** - Only React hooks, missing naming conventions
3. **No error tracking** - Can't diagnose production issues
4. **No versioning** - Chrome Web Store distribution undefined

### Medium Priority
1. **WASM compilation time** - Build is slow for development
2. **Test isolation** - Some tests may depend on IndexedDB state
3. **Message passing untested** - Content script ↔ background worker communication

### Low Priority
1. **No performance profiling** - Graph construction time not measured
2. **No accessibility audit** - WCAG compliance unknown
3. **TypeScript strictness** - `skipLibCheck` not analyzed

---

## Competitive Analysis

### Strengths vs. Alternatives
| Feature | This Tool | DevTools | Postman | Sentry |
|---------|-----------|----------|---------|--------|
| Local-first | ✅ | ✅ | ⚠️ Cloud-first | ❌ Cloud only |
| Evidence graph | ✅ | ❌ Flat UI | ❌ Request-only | ⚠️ Error trace |
| AI diagnosis | ✅ Optional | ❌ | ⚠️ Limited | ✅ Good |
| Privacy control | ✅ Full | ⚠️ Google | ⚠️ Limited | ❌ None |
| Team features | ❌ | ✅ | ✅ | ✅ |
| Cost | Free | Free | $$ | Free/$$$ |

### Market Positioning
- **Niche:** Mid-market SaaS teams frustrated with Cloud/Sentry cost and privacy
- **Strength:** Local-first privacy + graph-based investigation
- **Challenge:** No team features yet (critical for adoption)

---

## Risk Assessment

### Market Risks
- **Small TAM if single-browser:** Limiting to Chrome restricts reach
- **Competition:** DevTools + Sentry are well-entrenched
- **Adoption curve:** Requires developer workflow change

### Technical Risks
- **WASM maintenance:** Rust dependency adds complexity
- **Browser compatibility:** Chrome changes could break extension
- **Storage limitations:** IndexedDB quotas can be restrictive

### Execution Risks
- **Team bandwidth:** Solo project, hard to scale without help
- **Churn:** Early users leave without team features / integrations

---

## Success Metrics (30-90 Days)

### Short Term (30 days)
- ✅ CI/CD green on all commits
- ✅ Documentation complete (arch, dev setup, installation)
- ✅ E2E tests covering core flows
- ✅ Published to Chrome Web Store
- ✅ 100+ installs

### Medium Term (60 days)
- ✅ Slack integration working
- ✅ First AI-powered root cause feature
- ✅ Custom rule system
- ✅ 500+ installs
- ✅ 5+ GitHub stars

### Long Term (90 days)
- ✅ Team dashboard prototype
- ✅ Request correlation engine
- ✅ 2,000+ installs
- ✅ First enterprise feature (SSO/audit logs discussion)

---

## Recommendations

### Top 3 Priorities
1. **Documentation (48 hours)** - Unblocks adoption; zero engineering risk
2. **CI/CD (8 hours)** - Enables safe iteration; high ROI
3. **E2E Tests (20 hours)** - Confidence to ship; prevents regressions

### Strategic Next Steps
1. **Collect user feedback** - Talk to 10 developers using devtools; understand pain points
2. **Build AI feature** - This is the differentiator; prioritize over team features initially
3. **Ship to Chrome Web Store** - First 100 users will surface the most impactful features

### Long-Term Positioning
- **Year 1:** Killer single-user experience with AI; build brand in dev community
- **Year 2:** Add team features; grow from 1K to 10K users
- **Year 3:** Enterprise features (SSO, audit logs); go after teams using Sentry

---

## Conclusion

**Chrome Runtime Investigator has the potential to be a category leader** if you focus on:

1. **Shipping the foundation** (CI/CD, docs, tests) → Enables iteration
2. **Building the moat** (AI-powered diagnosis) → Differentiates from DevTools
3. **Enabling collaboration** (team features, integrations) → Drives adoption

The core innovation—evidence graph–based debugging—is worth building on. The execution gaps are all fixable in 30-60 days. With focused effort, this could be a 10K+ user tool by year-end.

**Next step:** Pick week 1 priorities and ship the foundation. The rest flows from there.

---

## Appendix: File Structure Review

```
/devtools
├── .github/               # ❌ MISSING - Need workflows
├── docs/                  # ❌ MISSING - Need architecture, dev setup
├── src/
│   ├── lib/               # ✅ Core analysis libraries
│   │   ├── evidenceEngine.ts
│   │   ├── reasoner.ts
│   │   ├── store.ts
│   │   ├── feltRepository.ts
│   │   └── [tests]
│   ├── panel/             # ✅ DevTools UI
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   └── utils/
│   └── devtools/          # ✅ Extension bootstrap
├── wasm-engine/           # ✅ Rust WASM compilation
├── public/                # ✅ Assets & manifest.json
├── package.json           # ✅ Modern dependencies
├── vite.config.ts         # ✅ Good build config
├── README.md              # ⚠️ Minimal (needs enhancement)
└── .oxlintrc.json         # ⚠️ Minimal (needs more rules)
```

---

**Report prepared:** August 25, 2026  
**Reviewed:** TypeScript codebase, architecture, test coverage, tooling  
**Confidence Level:** High (based on full codebase analysis)
