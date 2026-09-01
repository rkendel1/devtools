#!/usr/bin/env node
/**
 * Verify the compiled DevTools extension distribution.
 *
 * `dist/` is a first-class build artifact, not a by-product of the type check.
 * A green `tsc` does not prove the extension is installable, so this builds it
 * from clean and then checks the artifact itself:
 *
 *   1. the canonical entrypoint named by package.json `main` exists
 *   2. the shared bridge modules are emitted alongside it
 *   3. nothing in `dist/` imports outside `dist/` at runtime
 *   4. every bare specifier is a declared dependency or a node builtin
 *   5. a clean rebuild is deterministic and leaves no stale output
 *   6. the entrypoint loads and exports the activation contract
 *   7. the packaging model would include the emitted output
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const extensionRoot = path.resolve(import.meta.dirname, '..')
const distRoot = path.join(extensionRoot, 'dist')
const manifest = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'))

/** Modules the proposal bridge needs at runtime, beyond the extension's own sources. */
const REQUIRED_SHARED_MODULES = [
  'dist/src/lib/proposal.js',
  'dist/src/lib/proposalBridge.js',
  'dist/src/lib/proposalContext.js',
  'dist/src/lib/repositoryContext.js',
]

const failures = []
function check(label, run) {
  try {
    const detail = run()
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    console.log(`  FAIL  ${label}`)
    console.log(`        ${error instanceof Error ? error.message : String(error)}`)
  }
}

function build() {
  execFileSync('npm', ['run', 'build'], { cwd: extensionRoot, stdio: 'inherit' })
}

function emittedFiles() {
  const found = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else found.push(path.relative(distRoot, absolute).replaceAll('\\', '/'))
    }
  }
  if (existsSync(distRoot)) walk(distRoot)
  return found.sort()
}

console.log('Building the extension from clean…')
build()
const firstBuild = emittedFiles()

console.log('\nVerifying the compiled distribution:')

const entrypoint = path.join(extensionRoot, manifest.main)
check('package.json main names a compiled entrypoint', () => {
  if (!manifest.main?.startsWith('./dist/')) throw new Error(`main must point into dist/, found ${manifest.main}`)
  if (!existsSync(entrypoint) || !statSync(entrypoint).isFile()) throw new Error(`${manifest.main} was not emitted`)
  return manifest.main
})

check('shared bridge modules are emitted', () => {
  const missing = REQUIRED_SHARED_MODULES.filter((relative) => !existsSync(path.join(extensionRoot, relative)))
  if (missing.length) throw new Error(`missing from the build: ${missing.join(', ')}`)
  return `${REQUIRED_SHARED_MODULES.length} modules`
})

const declared = new Set(Object.keys(manifest.dependencies ?? {}))
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

check('the compiled output is self-contained within dist/', () => {
  const escaping = []
  for (const relative of firstBuild.filter((file) => file.endsWith('.js'))) {
    const absolute = path.join(distRoot, relative)
    for (const specifier of importSpecifiers(readFileSync(absolute, 'utf8'))) {
      if (!specifier.startsWith('.')) continue
      const resolved = path.resolve(path.dirname(absolute), specifier)
      if (path.relative(distRoot, resolved).startsWith('..')) escaping.push(`${relative} → ${specifier}`)
      else if (!existsSync(resolved)) escaping.push(`${relative} → ${specifier} (not emitted)`)
    }
  }
  if (escaping.length) throw new Error(`imports leaving the distribution: ${escaping.join(', ')}`)
  return `${firstBuild.filter((file) => file.endsWith('.js')).length} modules checked`
})

check('every external import is a declared dependency or a builtin', () => {
  const unsatisfied = new Set()
  for (const relative of firstBuild.filter((file) => file.endsWith('.js'))) {
    for (const specifier of importSpecifiers(readFileSync(path.join(distRoot, relative), 'utf8'))) {
      if (specifier.startsWith('.') || builtins.has(specifier)) continue
      if (specifier === 'vscode') continue // Provided by the extension host.
      const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      if (!declared.has(packageName)) unsatisfied.add(`${specifier} (not in dependencies)`)
      else if (!installedPackage(packageName)) unsatisfied.add(`${specifier} (declared but not installed)`)
    }
  }
  if (unsatisfied.size) throw new Error([...unsatisfied].join(', '))
  return `${declared.size} declared dependencies`
})

check('a clean rebuild is deterministic and drops stale output', () => {
  const stale = path.join(distRoot, 'stale-artifact-from-a-previous-build.js')
  writeFileSync(stale, 'export const stale = true\n')
  build()
  if (existsSync(stale)) throw new Error('a stale file survived the build; dist/ is not cleaned')
  const secondBuild = emittedFiles()
  if (secondBuild.join('\n') !== firstBuild.join('\n')) {
    const added = secondBuild.filter((file) => !firstBuild.includes(file))
    const removed = firstBuild.filter((file) => !secondBuild.includes(file))
    throw new Error(`rebuild differs — added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'}`)
  }
  return `${firstBuild.length} files, identical across builds`
})

check('the compiled entrypoint loads', () => {
  const stubDirectory = mkdtempSync(path.join(tmpdir(), 'feltdb-vscode-stub-'))
  try {
    const stub = path.join(stubDirectory, 'vscode.mjs')
    writeFileSync(stub, generateVscodeStub(firstBuild))
    const output = execFileSync(process.execPath, [
      '--import', path.join(extensionRoot, 'scripts', 'register-stub.mjs'),
      path.join(extensionRoot, 'scripts', 'load-extension.mjs'),
      pathToFileURL(entrypoint).href,
    ], { cwd: extensionRoot, encoding: 'utf8', env: { ...process.env, FELTDB_VSCODE_STUB: pathToFileURL(stub).href } })
    return output.trim().split('\n').at(-1)
  } finally { rmSync(stubDirectory, { recursive: true, force: true }) }
})

check('the packaging model includes the compiled output', () => {
  const ignore = readFileSync(path.join(extensionRoot, '.vscodeignore'), 'utf8')
    .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  const excluded = ignore.filter((pattern) => /^dist(\/|$)/.test(pattern))
  if (excluded.length) throw new Error(`.vscodeignore excludes the distribution: ${excluded.join(', ')}`)
  if (!manifest.scripts?.package) throw new Error('no packaging script is defined')

  // When the packaging tool is available, ask it what it would ship rather than
  // inferring it from the ignore file.
  const listed = packagedFiles()
  if (!listed) return `.vscodeignore keeps dist/, package script: ${manifest.scripts.package} (vsce unavailable, contents not listed)`
  const required = [manifest.main.replace(/^\.\//, ''), ...REQUIRED_SHARED_MODULES]
  const missing = required.filter((file) => !listed.includes(file))
  if (missing.length) throw new Error(`the package would omit: ${missing.join(', ')}`)
  return `${listed.length} files packaged, entrypoint and shared modules included`
})

/**
 * The files the packaging tool would ship, or undefined when it is unavailable.
 *
 * Offline runs fall back to the static ignore-file check above; set
 * FELTDB_VERIFY_PACKAGE=1 to allow fetching the tool.
 */
function packagedFiles() {
  const install = process.env.FELTDB_VERIFY_PACKAGE === '1' ? '--yes' : '--no-install'
  try {
    const output = execFileSync('npx', [install, '@vscode/vsce', 'ls'], { cwd: extensionRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return output.split('\n').map((line) => line.trim().replaceAll('\\', '/')).filter(Boolean)
  } catch { return undefined }
}

/**
 * Whether a declared dependency is installed for the extension.
 *
 * Checks the package directory rather than resolving the specifier: subpath
 * exports may omit the `require` condition, which makes CJS-condition
 * resolution fail on a package that is present and imports fine. The load
 * check below proves the subpaths themselves resolve.
 */
function installedPackage(packageName) {
  for (let directory = extensionRoot; ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, 'node_modules', packageName, 'package.json'))) return true
    if (directory === path.dirname(directory)) return false
  }
}

/** Static import, re-export, and dynamic import specifiers in emitted JavaScript. */
function importSpecifiers(source) {
  const specifiers = []
  const patterns = [
    /(?:^|[\s;}])(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']/g,
    /(?:^|[\s;}])import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) specifiers.push(match[1])
  return specifiers
}

/**
 * Build a `vscode` stub exporting exactly the names the compiled code reads.
 *
 * Derived from the artifact rather than hand-maintained, so a newly used API
 * cannot silently break the load check.
 */
function generateVscodeStub(files) {
  const names = new Set()
  for (const relative of files.filter((file) => file.endsWith('.js'))) {
    const source = readFileSync(path.join(distRoot, relative), 'utf8')
    for (const match of source.matchAll(/\bvscode\.([A-Za-z_$][\w$]*)/g)) names.add(match[1])
  }
  const exports = [...names].sort().map((name) => `export const ${name} = createStub('vscode.${name}')`)
  return [`import { createStub } from ${JSON.stringify(pathToFileURL(path.join(extensionRoot, 'scripts', 'vscode-stub.mjs')).href)}`, ...exports, ''].join('\n')
}

console.log('')
if (failures.length) {
  console.error(`Extension distribution is not valid (${failures.length} failure${failures.length === 1 ? '' : 's'}).`)
  process.exit(1)
}
console.log('Extension distribution verified.')
