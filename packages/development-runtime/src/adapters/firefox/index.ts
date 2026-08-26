/**
 * Firefox Adapter Stub
 *
 * Firefox adapter is not implemented in @feltdb/development-runtime 0.x.
 * See PR 4.13 for implementation.
 */

import type { BrowserRuntimeAdapter } from '../../types'

export function createFirefoxAdapter(): BrowserRuntimeAdapter {
  throw new Error(
    'Firefox adapter is not implemented in @feltdb/development-runtime 0.x. ' +
      'See PR 4.13 for implementation. ' +
      'https://github.com/rkendel1/devtools/pull/413',
  )
}
