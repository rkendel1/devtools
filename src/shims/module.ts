export function createRequire(): never {
  throw new Error('Node.js require is unavailable in the browser runtime')
}
