/**
 * Public types for @feltdb/development-runtime
 *
 * These are browser-facing types: outcomes and capabilities.
 * Not to be confused with FeltDB types (Selection, CodeChange, etc.)
 * which are owned by @feltdb/core and shared via workspace.
 */

// ===== Configuration =====

export interface RuntimeConfig {
  // Browser interaction capability
  browserAdapter: BrowserRuntimeAdapter

  // Optional: framework hints for source detection
  frameworkHints?: FrameworkHints
}

// ===== Capabilities =====

export interface BrowserCapabilities {
  // Selection: can runtime capture element selections?
  selection: {
    enabled: boolean
    supportsVisualSelection: boolean
    supportsSourceMapping: boolean
  }

  // Element inspection: detailed element properties?
  elementInspection: {
    enabled: boolean
    supportsBoundingBox: boolean
    supportsComputedStyle: boolean
    supportsDOMPath: boolean
  }

  // Replay: can runtime replay user interactions?
  replay: {
    enabled: boolean
    supportsClickReplay: boolean
    supportsScrollReplay: boolean
    supportsInputReplay: boolean
  }

  // Verification: can runtime measure changes?
  verification: {
    enabled: boolean
    supportsScreenCapture: boolean
    supportsMetricsCapture: boolean
    supportsPerformanceObservation: boolean
  }
}

// ===== Selection =====

export interface Selection {
  // Element selector (CSS or XPath)
  elementQuery: string

  // Visual position and size
  boundingBox: {
    x: number
    y: number
    width: number
    height: number
  }

  // File/line/component hints for IDE integration
  sourceHints: SourceHints

  // Optional: computed styles from browser
  computedStyle?: Record<string, string>

  // Factual element context captured with the selection.
  textContent?: string
  elementRole?: string
  pageUrl?: string
}

export interface SourceHints {
  // Most specific first: file location takes priority
  sourceLocations?: SourceLocation[]

  // Framework detection
  framework?: FrameworkDetection

  // Component detection
  component?: ComponentDetection
}

export interface SourceLocation {
  file: string // Relative path: src/components/Button.tsx
  line: number // 1-indexed line number
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface FrameworkDetection {
  name: 'react' | 'vue' | 'svelte' | 'angular' | 'unknown'
  version?: string
  detected: boolean
}

export interface ComponentDetection {
  name: string // Component name if detectable
  props?: Record<string, string>
}

// ===== Element Metrics =====

export interface ElementMetrics {
  width: number
  height: number
  x: number
  y: number
  display: string
  visibility: string
}

// ===== Verification =====

export interface VerifyParams {
  selection: Selection
  change: { id: string; description: string }
}

export interface VerificationOutcome {
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

// ===== Framework Hints =====

export interface FrameworkHints {
  // Help runtime detect framework
  framework?: 'react' | 'vue' | 'svelte' | 'angular'

  // Source map configuration
  sourceMaps?: {
    enabled: boolean
    baseUrl?: string
  }

  // Component name patterns
  componentPatterns?: RegExp[]
}

// ===== Adapter Interface (Internal, but documented for implementers) =====

export interface BrowserRuntimeAdapter {
  // Identify browser
  getBrowserName(): 'chromium' | 'firefox' | 'webkit'

  // Report capabilities
  getCapabilities(): Promise<BrowserCapabilities>

  // Selection workflow
  enableSelectionMode(): Promise<void>
  disableSelectionMode(): Promise<void>
  onElementSelected(callback: (sel: Selection) => void): void

  // Inspection: get detailed element properties
  inspectElement(query: string): Promise<ElementMetrics>

  // Verification: measure element state
  captureElementState(query: string): Promise<ElementMetrics>
  captureScreenshot?(): Promise<string> // Base64 if supported

  // Page ready: handle reload timing
  waitForPageReady(): Promise<void>

  // Replay (optional, capability-gated)
  replayInteraction?(action: ReplayAction): Promise<void>

  // Cleanup
  disconnect(): Promise<void>
}

export interface ReplayAction {
  type: 'click' | 'scroll' | 'input'
  target: string // CSS selector
  value?: string | number
}

// ===== Workspace Types (imported from @feltdb/core) =====
// These come from FeltDB workspace, not defined here.
// We accept them as inputs but don't own their definition.

export interface CodeChange {
  id: string
  workspaceId: string
  taskId: string
  investigationId: string
  kind: string
  label: string
  description: string
  filePath: string
  lineStart: number
  lineEnd: number
  createdAt: number
  createdBy: string
  status: string
  properties: Record<string, unknown>
}
