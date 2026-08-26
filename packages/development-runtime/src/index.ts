/**
 * @feltdb/development-runtime
 *
 * Browser runtime for FeltDB Development Workspace
 * Orchestrates: SELECT → CAPTURE → VERIFY
 *
 * Does not own workspace concerns (publish, subscribe, discovery).
 * Does not own DevTools UI (describe, task management).
 * Does not own adapter implementation details.
 *
 * Public API: outcomes and capabilities, never browser protocol types.
 */

// Core runtime
export { DevelopmentRuntime } from './core/runtime'

// Types
export type {
  RuntimeConfig,
  BrowserCapabilities,
  Selection,
  ElementMetrics,
  SourceHints,
  SourceLocation,
  FrameworkDetection,
  ComponentDetection,
  VerifyParams,
  VerificationOutcome,
  FrameworkHints,
  BrowserRuntimeAdapter,
  ReplayAction,
  CodeChange,
} from './types'

// Adapters
export { createChromiumAdapter } from './adapters/chromium'
export { createFirefoxAdapter } from './adapters/firefox'
export { createSafariAdapter } from './adapters/webkit'
