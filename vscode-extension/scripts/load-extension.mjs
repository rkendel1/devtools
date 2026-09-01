/**
 * Load the compiled extension entrypoint the way VS Code would.
 *
 * Evaluates the whole emitted module graph, then asserts the activation
 * contract. A green `tsc` says the source is well typed; this says the built
 * artifact is actually loadable.
 */
const entrypoint = process.argv[2]
const extension = await import(entrypoint)
for (const exported of ['activate', 'deactivate']) {
  if (typeof extension[exported] !== 'function') {
    throw new Error(`Compiled extension does not export ${exported}(). Found: ${Object.keys(extension).join(', ') || '(nothing)'}`)
  }
}
console.log(`loaded ${entrypoint} (exports: ${Object.keys(extension).sort().join(', ')})`)
