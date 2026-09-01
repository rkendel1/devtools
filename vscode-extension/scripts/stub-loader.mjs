/** Module hook that resolves the bare `vscode` specifier to a generated stub. */
export async function resolve(specifier, context, next) {
  if (specifier === 'vscode') return { url: process.env.FELTDB_VSCODE_STUB, shortCircuit: true }
  return next(specifier, context)
}
