/**
 * Safari/WebKit Adapter Stub
 *
 * Safari adapter is not implemented in @feltdb/development-runtime 0.x.
 * See PR 4.14 for implementation.
 */

import type { BrowserRuntimeAdapter } from '../../types'

export function createSafariAdapter(): BrowserRuntimeAdapter {
  throw new Error(
    'Safari (WebKit) adapter is not implemented in @feltdb/development-runtime 0.x. ' +
      'See PR 4.14 for implementation. ' +
      'https://github.com/rkendel1/devtools/pull/414',
  )
}
