/**
 * A structural stand-in for the `vscode` module.
 *
 * The compiled extension can only be loaded outside VS Code if `vscode`
 * resolves to something. This is not a simulation of the API — it exists so the
 * module graph evaluates, which is what proves the build is complete. Anything
 * the extension touches at load time (class extension, enum member access,
 * namespace lookup) is answered generically.
 */

/** A value that behaves as a namespace, a class, and a function at once. */
export function createStub(name) {
  const properties = new Map()
  const target = function () {}
  Object.defineProperty(target, 'name', { value: name, configurable: true })
  return new Proxy(target, {
    get(receiver, property, self) {
      // `then` must stay undefined or an awaited stub becomes a hanging thenable.
      if (typeof property === 'symbol' || property === 'then' || property === 'prototype' || property === 'name' || property === 'length') {
        return Reflect.get(receiver, property, self)
      }
      if (!properties.has(property)) properties.set(property, createStub(`${name}.${property}`))
      return properties.get(property)
    },
    set(_receiver, property, value) {
      properties.set(property, value)
      return true
    },
    apply() { return createStub(`${name}()`) },
    // `class X extends vscode.TreeItem` needs a real construct trap, and the
    // instance must carry the subclass prototype so `super(...)` behaves.
    construct(_receiver, _args, newTarget) { return Reflect.construct(Object, [], newTarget) },
  })
}
