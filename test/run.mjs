#!/usr/bin/env node
/**
 * dsh-model-pin smoke tests.
 *
 * Plain Node ESM with no dependencies: `node test/run.mjs`.
 * The suite checks the shipped package (manifest, bundle patch, locale, icon,
 * host/client syntax and import discipline, pure helpers) plus the documentation
 * that users follow. It never starts DSH and never touches the network, so it
 * runs in well under a second.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (relative) => readFileSync(join(root, relative), 'utf8')
const exists = (relative) => existsSync(join(root, relative))
const isDirectory = (relative) => exists(relative) && statSync(join(root, relative)).isDirectory()

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const results = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, message) {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) throw new Error(`${message} (expected ${right}, received ${left})`)
}

function assertMatch(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(`${message} (pattern ${pattern})`)
}

function assertThrows(fn, pattern, message) {
  try {
    fn()
  } catch (error) {
    if (pattern !== undefined && !pattern.test(String(error && error.message))) {
      throw new Error(`${message} (threw ${String(error && error.message)}, expected ${pattern})`)
    }
    return
  }
  throw new Error(`${message} (did not throw)`)
}

// ---------------------------------------------------------------------------
// YAML subset parser (see test/README-less note below)
//
// The bundle patch is YAML, and this package has no dependencies, so the tests
// parse the real file with a small parser for the dialect a Cordis patch uses:
// a top-level sequence of mappings, nested sequences/mappings by indentation,
// inline flow mappings, quoted scalars and comments. Anything outside that
// dialect fails the test on purpose instead of silently passing.
// ---------------------------------------------------------------------------

function parseYaml(text) {
  const tokens = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine)
    if (line.trim() === '') continue
    tokens.push({ indent: line.length - line.trimStart().length, content: line.trim() })
  }
  if (tokens.length === 0) return null
  let index = 0
  const peek = () => tokens[index]
  const next = () => tokens[index++]

  const parseNode = (indent) => {
    const token = peek()
    if (token === undefined) return null
    if (token.indent !== indent) throw new Error(`unexpected indentation at "${token.content}"`)
    if (token.content.startsWith('- ') || token.content === '-') return parseSequence(indent)
    return parseMapping(indent)
  }

  const readBlockScalar = (parentIndent) => {
    const lines = []
    while (peek() !== undefined && peek().indent > parentIndent) lines.push(next().content)
    return lines.join('\n')
  }

  const parseSequence = (indent) => {
    const items = []
    while (peek() !== undefined && peek().indent === indent && (peek().content.startsWith('- ') || peek().content === '-')) {
      const token = next()
      const rest = token.content.slice(1).trim()
      if (rest === '') {
        const child = peek()
        if (child === undefined || child.indent <= indent) throw new Error('sequence item without a value')
        items.push(parseNode(child.indent))
        continue
      }
      const separator = findKeySeparator(rest)
      if (separator === -1) {
        items.push(parseScalar(rest))
        continue
      }
      const mapping = {}
      const key = unquote(rest.slice(0, separator).trim())
      const valueText = rest.slice(separator + 1).trim()
      if (valueText === '') {
        const child = peek()
        mapping[key] = child !== undefined && child.indent > indent ? parseNode(child.indent) : null
      } else if (/^[|>][+-]?$/.test(valueText)) {
        mapping[key] = readBlockScalar(indent)
      } else {
        mapping[key] = parseInline(valueText)
      }
      while (peek() !== undefined && peek().indent > indent) {
        const member = next()
        const memberIndent = member.indent
        const memberSeparator = findKeySeparator(member.content)
        if (memberSeparator === -1) throw new Error(`expected a mapping member, got "${member.content}"`)
        const memberKey = unquote(member.content.slice(0, memberSeparator).trim())
        const memberValue = member.content.slice(memberSeparator + 1).trim()
        if (memberValue === '') {
          const child = peek()
          mapping[memberKey] = child !== undefined && child.indent > memberIndent ? parseNode(child.indent) : null
        } else if (/^[|>][+-]?$/.test(memberValue)) {
          mapping[memberKey] = readBlockScalar(memberIndent)
        } else {
          mapping[memberKey] = parseInline(memberValue)
        }
      }
      items.push(mapping)
    }
    return items
  }

  const parseMapping = (indent) => {
    const mapping = {}
    while (peek() !== undefined && peek().indent === indent) {
      const token = next()
      const separator = findKeySeparator(token.content)
      if (separator === -1) throw new Error(`expected a mapping member, got "${token.content}"`)
      const key = unquote(token.content.slice(0, separator).trim())
      const valueText = token.content.slice(separator + 1).trim()
      if (valueText === '') {
        const child = peek()
        mapping[key] = child !== undefined && child.indent > indent ? parseNode(child.indent) : null
      } else if (/^[|>][+-]?$/.test(valueText)) {
        mapping[key] = readBlockScalar(indent)
      } else {
        mapping[key] = parseInline(valueText)
      }
    }
    return mapping
  }

  return parseNode(tokens[0].indent)
}

function stripComment(line) {
  let quote = null
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quote !== null) {
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index)
  }
  return line
}

function findKeySeparator(text) {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === ':' && (index + 1 === text.length || /\s/.test(text[index + 1]))) return index
  }
  return -1
}

function parseInline(text) {
  if (text.startsWith('{') && text.endsWith('}')) return parseFlowMapping(text.slice(1, -1))
  return parseScalar(text)
}

function parseFlowMapping(body) {
  const mapping = {}
  for (const part of splitTopLevel(body, ',')) {
    const separator = findKeySeparator(part)
    if (separator === -1) throw new Error(`invalid flow mapping entry "${part}"`)
    mapping[unquote(part.slice(0, separator).trim())] = parseScalar(part.slice(separator + 1).trim())
  }
  return mapping
}

function splitTopLevel(text, separator) {
  const parts = []
  let depth = 0
  let quote = null
  let current = ''
  for (const character of text) {
    if (quote !== null) {
      current += character
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      current += character
      continue
    }
    if (character === '{' || character === '[') depth += 1
    if (character === '}' || character === ']') depth -= 1
    if (character === separator && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (current.trim() !== '') parts.push(current.trim())
  return parts
}

function parseScalar(text) {
  const trimmed = text.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null' || trimmed === '~') return null
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  return unquote(trimmed)
}

function unquote(text) {
  const trimmed = text.trim()
  if (trimmed.length >= 2 && ((trimmed[0] === "'" && trimmed.at(-1) === "'") || (trimmed[0] === '"' && trimmed.at(-1) === '"'))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Convert a `files[]` entry (directory or glob) into a predicate over package paths. */
function filesEntryMatches(entry, relative) {
  if (!entry.includes('*')) {
    if (entry.endsWith('/')) return relative.startsWith(entry)
    return relative === entry
  }
  const pattern = entry
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*')
  return new RegExp(`^${pattern}$`).test(relative)
}

/** Copy one source file to a temporary `.mjs` and ask Node to syntax-check it. */
function syntaxCheck(relative) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-model-pin-'))
  const copy = join(directory, relative.replaceAll('/', '_') + '.mjs')
  try {
    writeFileSync(copy, read(relative))
    const result = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(`node --check ${relative} failed: ${(result.stderr || '').trim().split('\n').slice(0, 3).join(' ')}`)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Collect every `require('…')` specifier used by the browser module. */
function requiredSpecifiers(source) {
  const specifiers = new Set()
  const pattern = /require\(\s*(['"])([^'"]+)\1\s*\)/g
  let match
  while ((match = pattern.exec(source)) !== null) specifiers.add(match[2])
  return specifiers
}

const manifest = JSON.parse(read('package.json'))

// ---------------------------------------------------------------------------
// Package manifest
// ---------------------------------------------------------------------------

test('manifest: name, version and module type', () => {
  assert(manifest.name === 'dsh-model-pin', `name is ${JSON.stringify(manifest.name)}`)
  assertMatch(String(manifest.version), /^\d+\.\d+\.\d+$/, 'version is not semver')
  assert(manifest.type === 'module', 'type must be "module"')
  assert(manifest.main === 'index.js', 'main must be index.js')
  assert(manifest.license === 'MIT', 'license must be MIT')
  assert(typeof manifest.description === 'string' && manifest.description.length > 20, 'description is missing')
})

test('manifest: exports point at shipped files', () => {
  const exportsMap = manifest.exports
  assert(exportsMap !== null && typeof exportsMap === 'object', 'exports is missing')
  for (const [key, value] of Object.entries(exportsMap)) {
    assert(typeof value === 'string', `exports["${key}"] must be a path string`)
    if (key.includes('*')) {
      const sample = value.replace('*', 'en')
      assert(exists(sample), `exports["${key}"] sample ${sample} does not exist`)
      continue
    }
    assert(exists(value), `exports["${key}"] → ${value} does not exist`)
  }
  assert(exportsMap['.'] === './index.js', 'exports["."] must be ./index.js')
  assert(exportsMap['./client'] === './client.js', 'exports["./client"] must be ./client.js')
})

test('manifest: dsh bundle and client wiring', () => {
  const dsh = manifest.dsh
  assert(dsh !== null && typeof dsh === 'object', 'dsh field is missing')
  assert(dsh.bundle && dsh.bundle.patch === './cordis.patch.yml', 'dsh.bundle.patch must be ./cordis.patch.yml')
  assert(exists('cordis.patch.yml'), 'cordis.patch.yml is missing')
  assert(dsh.client && dsh.client.platform === 'web', 'dsh.client.platform must be web')
  assert(Array.isArray(dsh.client.inject), 'dsh.client.inject must be an array')
  assert(dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'), 'client inject must include the UI settings package')
  assert(dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'), 'client inject must include the API remotes package')
  assert(
    dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-models'),
    'client inject must include the official Models settings package (settings.models.footer slot)',
  )
})

test('manifest: host peers and engine bounds', () => {
  const peers = manifest.peerDependencies ?? {}
  assert(typeof peers['@deepseek-ai/cordis'] === 'string', 'peerDependencies must declare @deepseek-ai/cordis')
  assert(typeof peers['@deepseek-ai/schemastery'] === 'string', 'peerDependencies must declare @deepseek-ai/schemastery')
  const engines = manifest.engines ?? {}
  assert(engines.node === '>=22', 'engines.node must be >=22')
  assertMatch(String(engines.dsh ?? ''), /^>=0\.2\.0/, 'engines.dsh must require DSH >= 0.2.0')
  assertMatch(String(engines.dsh ?? ''), /<0\.3\.0/, 'engines.dsh must cap the next minor so a breaking 0.3 upgrade is refused')
})

test('manifest: files[] covers every shipped runtime file', () => {
  const files = manifest.files
  assert(Array.isArray(files) && files.length > 0, 'files[] is missing')
  const shipped = ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'src/pin.js', 'src/model-check.js', 'locale/en.json', 'locale/zh.json']
  for (const relative of shipped) {
    assert(exists(relative), `shipped file ${relative} does not exist`)
    assert(
      files.some((entry) => filesEntryMatches(entry, relative)),
      `files[] does not ship ${relative} (entries: ${files.join(', ')})`,
    )
  }
  for (const entry of files) {
    if (entry.includes('*')) continue
    const target = entry.endsWith('/') ? entry.slice(0, -1) : entry
    assert(exists(target), `files[] entry ${entry} does not exist`)
  }
})

// ---------------------------------------------------------------------------
// Bundle patch
// ---------------------------------------------------------------------------

const patchText = read('cordis.patch.yml')
const patch = parseYaml(patchText)

test('patch: parses as a loader patch list', () => {
  assert(Array.isArray(patch), 'cordis.patch.yml must be a top-level YAML sequence')
  assert(patch.length >= 2, `expected at least two patch entries, got ${patch.length}`)
  for (const entry of patch) assert(entry !== null && typeof entry === 'object', 'every patch entry must be a mapping')
})

test('patch: disables the stock agent-default-model row', () => {
  const stock = patch.filter((entry) => entry.id === 'agent-default-model')
  assert(stock.length === 1, `expected exactly one agent-default-model patch, got ${stock.length}`)
  assert(stock[0].disabled === true, 'agent-default-model must be disabled: true')
  assert(!('insert' in stock[0]), 'the agent-default-model patch must not insert rows')
  for (const entry of patch) {
    if (entry.id === 'agent-default-model' && entry.disabled === false) throw new Error('a later layer re-enables agent-default-model')
  }
})

test('patch: inserts the pinned dsh-model-pin row', () => {
  const inserts = patch.flatMap((entry) => (Array.isArray(entry.insert) ? entry.insert : []))
  const rows = inserts.filter((row) => row !== null && typeof row === 'object' && row.id === 'dsh-model-pin')
  assert(rows.length === 1, `expected exactly one inserted dsh-model-pin row, got ${rows.length}`)
  const row = rows[0]
  assert(row.name === 'dsh-model-pin', `inserted row name is ${JSON.stringify(row.name)}`)
  assert(row.config !== null && typeof row.config === 'object', 'inserted row must carry config')
  assertEqual(row.config.provider, 'opencode-go', 'seed provider')
  assertEqual(row.config.model, 'deepseek-v4.1-flash', 'seed model')
  assertEqual(row.config.reasoningEffort, 'max', 'seed reasoning effort')
  assertEqual(row.config.modelCheckInterval, '7d', 'seed model check interval')
})

// ---------------------------------------------------------------------------
// Locale metadata and icon
// ---------------------------------------------------------------------------

test('locale: English metadata', () => {
  const locale = JSON.parse(read('locale/en.json'))
  assert(locale.meta !== null && typeof locale.meta === 'object', 'locale/en.json must carry meta')
  assertMatch(String(locale.meta.title), /model pin/i, 'English title')
  assert(typeof locale.meta.description === 'string' && locale.meta.description.length > 20, 'English description is too short')
})

test('locale: Chinese metadata', () => {
  const locale = JSON.parse(read('locale/zh.json'))
  assert(locale.meta !== null && typeof locale.meta === 'object', 'locale/zh.json must carry meta')
  assertMatch(String(locale.meta.title), /模型固定/, 'Chinese title')
  assertMatch(String(locale.meta.description), /新会话/, 'Chinese description must mention new sessions')
  assertMatch(String(locale.meta.description), /模型/, 'Chinese description must mention models')
})

test('icon: bound SVG document', () => {
  const icon = read('icon.svg')
  const bytes = Buffer.byteLength(icon)
  assert(bytes < 20 * 1024, `icon.svg is ${bytes} bytes, expected < 20480`)
  assertMatch(icon, /^\s*<svg[\s>]/, 'icon.svg must start with an <svg> root element')
  assertMatch(icon, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, 'icon.svg must declare the SVG namespace')
  assertMatch(icon, /<\/svg>\s*$/, 'icon.svg must close its <svg> root')
  assert(!/<script/i.test(icon), 'icon.svg must not contain scripts')
  const opens = (icon.match(/<svg[\s>]/g) ?? []).length
  assert(opens === 1, `icon.svg must have exactly one <svg> root, found ${opens}`)
})

// ---------------------------------------------------------------------------
// Pure helpers (src/pin.js)
// ---------------------------------------------------------------------------

const pin = await import(pathToFileURL(join(root, 'src/pin.js')).href)

test('helpers: module is dependency-free', () => {
  const source = read('src/pin.js')
  assert(!/^\s*import\s/m.test(source), 'src/pin.js must not import anything')
  assert(!/require\(/.test(source), 'src/pin.js must not use require()')
  assert(!/@deepseek-ai\//.test(source), 'src/pin.js must not reference harness packages')
})

test('helpers: normalizeSelection trims and detaches', () => {
  const input = { provider: '  opencode-go ', model: ' deepseek-v4.1-flash  ', reasoningEffort: ' max ' }
  const selection = pin.normalizeSelection(input)
  assertEqual(selection, { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' }, 'normalized selection')
  input.model = 'changed-after-normalize'
  assertEqual(selection.model, 'deepseek-v4.1-flash', 'normalized selection must not alias its input')
})

test('helpers: normalizeSelection omits an absent effort', () => {
  for (const value of [undefined, null, '', '   ']) {
    const selection = pin.normalizeSelection({ provider: 'p', model: 'm', reasoningEffort: value })
    assertEqual(selection, { provider: 'p', model: 'm' }, `effort ${JSON.stringify(value)}`)
    assert(!('reasoningEffort' in selection), 'blank effort must be omitted, not stored as undefined')
  }
  const withoutKey = pin.normalizeSelection({ provider: 'p', model: 'm' })
  assertEqual(Object.keys(withoutKey).sort(), ['model', 'provider'], 'only provider and model are required')
})

test('helpers: normalizeSelection rejects malformed input', () => {
  for (const value of [null, undefined, 'provider/model', 42, [], true]) {
    assertThrows(() => pin.normalizeSelection(value), /must be an object/, `non-object input ${JSON.stringify(value)}`)
  }
  assertThrows(() => pin.normalizeSelection({ model: 'm' }), /provider/, 'missing provider')
  assertThrows(() => pin.normalizeSelection({ provider: '   ', model: 'm' }), /provider must not be blank/, 'blank provider')
  assertThrows(() => pin.normalizeSelection({ provider: 'p' }), /model/, 'missing model')
  assertThrows(() => pin.normalizeSelection({ provider: 'p', model: 7 }), /model must be a string/, 'numeric model')
  assertThrows(
    () => pin.normalizeSelection({ provider: 'p', model: 'm', reasoningEffort: 1 }),
    /reasoningEffort must be a string/,
    'numeric effort',
  )
})

test('helpers: selectionEquals is transport tolerant', () => {
  assert(pin.selectionEquals({ provider: 'p', model: 'm' }, { provider: ' p ', model: ' m ' }), 'whitespace must compare equal')
  assert(pin.selectionEquals({ provider: 'p', model: 'm', reasoningEffort: 'max' }, { provider: 'p', model: 'm', reasoningEffort: ' max ' }), 'effort whitespace')
  assert(pin.selectionEquals({ provider: 'p', model: 'm' }, { provider: 'p', model: 'm', reasoningEffort: '' }), 'blank effort equals absent effort')
  assert(pin.selectionEquals({ provider: 'p', model: 'm' }, { provider: 'p', model: 'm', reasoningEffort: null }), 'null effort equals absent effort')
  assert(!pin.selectionEquals({ provider: 'p', model: 'm', reasoningEffort: 'max' }, { provider: 'p', model: 'm', reasoningEffort: 'high' }), 'different efforts differ')
  assert(!pin.selectionEquals({ provider: 'p', model: 'm' }, { provider: 'p', model: 'other' }), 'different models differ')
  assert(!pin.selectionEquals({ provider: 'p', model: 'm' }, { provider: 'q', model: 'm' }), 'different providers differ')
  assert(!pin.selectionEquals(null, null), 'non-object selections are never equal')
  assert(!pin.selectionEquals('p/m', 'p/m'), 'string selections are never equal')
})

test('helpers: describeSelection renders the pin', () => {
  assertEqual(pin.describeSelection({ provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' }), 'opencode-go/deepseek-v4.1-flash · max', 'selection with effort')
  assertEqual(pin.describeSelection({ provider: 'p', model: 'm' }), 'p/m', 'selection without effort')
  assertEqual(pin.describeSelection({ provider: 'p', model: 'm', reasoningEffort: '' }), 'p/m', 'blank effort is not rendered')
  assertThrows(() => pin.describeSelection({ provider: '', model: 'm' }), /provider/, 'invalid selection')
})

// ---------------------------------------------------------------------------
// Pure helpers for the new-model reminder (src/model-check.js)
// ---------------------------------------------------------------------------

const modelCheck = await import(pathToFileURL(join(root, 'src/model-check.js')).href)

test('model-check helpers: module is dependency-free', () => {
  const source = read('src/model-check.js')
  assert(!/^\s*import\s/m.test(source), 'src/model-check.js must not import anything')
  assert(!/require\(/.test(source), 'src/model-check.js must not use require()')
  assert(!/@deepseek-ai\//.test(source), 'src/model-check.js must not reference harness packages')
})

test('model-check helpers: interval ids and defaults', () => {
  assertEqual(modelCheck.DAY_MS, 24 * 60 * 60 * 1000, 'DAY_MS')
  assertEqual(modelCheck.INTERVAL_IDS, ['1d', '3d', '7d', '14d', '30d', 'manual'], 'interval ids in presentation order')
  assertEqual(modelCheck.DEFAULT_INTERVAL_ID, '7d', 'the absent-field default is the seed')
  for (const id of ['1d', '3d', '7d', '14d', '30d', 'manual']) {
    assertEqual(modelCheck.normalizeIntervalId(id), id, `normalize ${id}`)
    assert(modelCheck.INTERVAL_IDS.includes(id), `INTERVAL_IDS must include ${id}`)
  }
  for (const value of [undefined, null, '', '   ', 42, false]) {
    assertEqual(modelCheck.normalizeIntervalId(value), '7d', `blank ${JSON.stringify(value)} falls back to the seed`)
  }
  for (const value of ['2d', '7', 'MANUAL', 'daily']) {
    assertEqual(modelCheck.normalizeIntervalId(value), 'manual', `unknown ${JSON.stringify(value)} must not start network probing`)
  }
})

test('model-check helpers: intervalMs maps ids to periods', () => {
  assertEqual(modelCheck.intervalMs('1d'), modelCheck.DAY_MS, '1d')
  assertEqual(modelCheck.intervalMs('3d'), 3 * modelCheck.DAY_MS, '3d')
  assertEqual(modelCheck.intervalMs('7d'), 7 * modelCheck.DAY_MS, '7d')
  assertEqual(modelCheck.intervalMs('14d'), 14 * modelCheck.DAY_MS, '14d')
  assertEqual(modelCheck.intervalMs('30d'), 30 * modelCheck.DAY_MS, '30d')
  assertEqual(modelCheck.intervalMs('manual'), null, 'manual has no automatic period')
  assertEqual(modelCheck.intervalMs(undefined), 7 * modelCheck.DAY_MS, 'an absent interval uses the seed period')
  assertEqual(modelCheck.intervalMs('bogus'), null, 'an unknown interval behaves like manual')
})

test('model-check helpers: diffDiscovered keeps only ids missing from the catalog', () => {
  const discovered = [
    { id: 'a', name: 'Model A' },
    { id: 'b', name: 'Model B' },
    { id: 'a', name: 'Model A again' },
    'c',
    { id: '', name: 'blank' },
    null,
  ]
  const current = [{ id: 'b' }, 'd']
  const added = modelCheck.diffDiscovered(discovered, current)
  assertEqual(added.map((model) => model.id), ['a', 'c'], 'new ids in discovery order, duplicates and blanks dropped')
  assertEqual(added.map((model) => model.name), ['Model A', 'c'], 'a missing display name falls back to the id')
  assertEqual(modelCheck.diffDiscovered([], current), [], 'nothing advertised means nothing new')
  assertEqual(modelCheck.diffDiscovered(null, null), [], 'non-list inputs are tolerated')
  assertEqual(
    modelCheck.diffDiscovered([{ id: 'x' }], []),
    [{ id: 'x', name: 'x' }],
    'an empty catalog makes every advertised id new',
  )
})

test('model-check helpers: pendingFingerprint is stable and order-insensitive', () => {
  const left = [
    { provider: 'p1', added: [{ id: 'm2' }, { id: 'm1' }] },
    { provider: 'p2', added: [{ id: 'm3' }] },
  ]
  const right = [
    { provider: 'p2', added: ['m3'] },
    { provider: 'p1', added: [{ id: 'm1' }, { id: 'm2' }, { id: 'm2' }] },
  ]
  assertEqual(modelCheck.pendingFingerprint(left), modelCheck.pendingFingerprint(right), 'the same pending set must fingerprint the same')
  assertEqual(typeof modelCheck.pendingFingerprint(left), 'string', 'a pending set serializes to a string')
  assertEqual(modelCheck.pendingFingerprint([]), null, 'nothing pending has no fingerprint')
  assertEqual(modelCheck.pendingFingerprint([{ provider: 'p', added: [] }]), null, 'a provider without new models is not pending')
  assert(
    modelCheck.pendingFingerprint(left) !== modelCheck.pendingFingerprint([{ provider: 'p1', added: [{ id: 'm1' }] }]),
    'a different pending set must fingerprint differently',
  )
})

test('model-check helpers: nextCheckAt respects the configured interval', () => {
  const now = 1_700_000_000_000
  assertEqual(modelCheck.nextCheckAt(null, '7d', now), now, 'a profile that never checked is due immediately')
  assertEqual(modelCheck.nextCheckAt(now - 1000, '1d', now), now - 1000 + modelCheck.DAY_MS, 'last check plus the period')
  assertEqual(modelCheck.nextCheckAt(now, '3d', now), now + 3 * modelCheck.DAY_MS, '3d')
  assertEqual(modelCheck.nextCheckAt(now, 'manual', now), null, 'manual never schedules an automatic check')
  assertEqual(modelCheck.nextCheckAt(null, 'bogus', now), null, 'an unknown interval behaves like manual')
  assertEqual(
    modelCheck.nextCheckAt(now - 10 * modelCheck.DAY_MS, '7d', now),
    now - 10 * modelCheck.DAY_MS + 7 * modelCheck.DAY_MS,
    'an overdue check keeps its computed due time so callers can show it as due',
  )
})

// ---------------------------------------------------------------------------
// Host entry (index.js) and client entry (client.js)
// ---------------------------------------------------------------------------

test('host: index.js parses as ESM', () => {
  syntaxCheck('index.js')
})

test('host: registers the replacement agentDefaultModel service', () => {
  const source = read('index.js')
  assertMatch(source, /extends Service/, 'index.js must extend the Cordis Service class')
  assertMatch(source, /super\(ctx,\s*'agentDefaultModel'\)/, "the service must register under 'agentDefaultModel'")
  assertMatch(source, /async saveSelection\(/, 'saveSelection must be asynchronous like the stock service')
  assertMatch(source, /currentSelection\(\)/, 'currentSelection must be implemented')
  assertMatch(source, /from '\.\/src\/pin\.js'/, 'the host half must reuse the pure helpers')
  assertMatch(source, /export default ModelPinService/, 'the loader needs a default export')
  assertMatch(source, /export \{ ModelPinService \}/, 'the service class must also be a named export')
})

test('host: saveSelection never persists the picker choice', () => {
  const source = read('index.js')
  assert(!/configEditor/.test(source), 'the pinned default must not be rewritten through a config editor')
  const start = source.indexOf('async saveSelection(')
  const end = source.indexOf('describe()')
  assert(start !== -1 && end > start, 'the saveSelection implementation is missing')
  const body = source.slice(start, end)
  assert(!/\.set\(/.test(body), 'saveSelection must not write its own Config references')
})

test('host: Config keeps the three live fields', () => {
  const source = read('index.js')
  assertMatch(source, /static Config = z\.object\(\{/, 'Config must be a Schemastery object')
  assertMatch(source, /provider:\s*z\.string\(\)\.volatile\(\)/, 'provider must be volatile and tolerant of a missing value')
  assertMatch(source, /model:\s*z\.string\(\)\.volatile\(\)/, 'model must be volatile and tolerant of a missing value')
  assertMatch(source, /reasoningEffort:\s*z\.string\(\)\.volatile\(\)/, 'reasoningEffort must be optional and volatile')
  assertMatch(source, /incompleteReported/, 'an incomplete pin must be reported instead of failing Config validation')
  assertMatch(source, /listProviders\(\)/, 'a pin whose provider is not registered must be diagnosed')
  assertMatch(source, /settings\.configure\(\{\s*auto:\s*false\s*\}/, 'the row must opt out of the automatic Settings form')
})

test('host: model retrieval interval check, state file and routes', () => {
  const source = read('index.js')
  assertMatch(source, /modelCheckInterval:\s*z\.string\(\)\.volatile\(\)/, 'modelCheckInterval must be an optional volatile Config field')
  assertMatch(source, /discoverModels/, 'the periodic check must use the adapter model discovery')
  assertMatch(source, /listModels/, 'the periodic check must compare against the configured model catalog')
  for (const route of ['/api/dsh-model-pin/status', '/api/dsh-model-pin/check', '/api/dsh-model-pin/dismiss']) {
    assert(source.includes(route), `index.js must register the ${route} route`)
  }
  assert(source.includes('state.json'), 'the reminder state file must be named state.json')
  assertMatch(source, /DSH_HOME/, 'the state directory must honour DSH_HOME')
  assertMatch(source, /homedir\(\)[^\n]*\.dsh/, 'the state directory must default to ~/.dsh')
  assertMatch(source, /join\([^\n]*['"]state\.json['"]\)/, 'the state file must be written through a state.json path')
  assertMatch(source, /version:\s*1/, 'the persisted reminder state must carry version 1')
  assertMatch(source, /x-dsh-model-pin-client/, 'the write routes must require the client header')
  assertMatch(source, /setInterval|setTimeout/, 'the scheduler must tick with a timer')
})

test('client: client.js parses as ESM', () => {
  syntaxCheck('client.js')
})

test('client: module-loader shape and import discipline', () => {
  const source = read('client.js')
  assertMatch(source, /__ModuleLoader__\.load\(/, 'client.js must register through window.__ModuleLoader__')
  const allowed = new Set(['react'])
  for (const specifier of requiredSpecifiers(source)) {
    assert(allowed.has(specifier), `client.js requires disallowed module ${JSON.stringify(specifier)}`)
  }
  assert(requiredSpecifiers(source).has('react'), "client.js must require('react')")
  assertMatch(source, /settings\.section/, 'client.js must contribute to the settings.section slot')
  assertMatch(source, /dsh-model-pin/, "client.js must bind the 'dsh-model-pin' config entry")
  assertMatch(source, /configForms/, 'client.js must use the shared config form for saving')
  assertMatch(source, /modelCatalog/, 'client.js must read the live model catalog')
})

test('client: "follow model default" writes a blank set, never an unset', () => {
  // `dsh-settings` unset means "drop this layer's override", which resolves back
  // to the bundle patch's seeded reasoningEffort (max). So the page must write an
  // explicit blank override; the Host then omits the field for new sessions.
  const source = read('client.js')
  assertMatch(
    source,
    /op:\s*'set',\s*path:\s*\['reasoningEffort'\]/,
    "the effort must be saved as { op: 'set', path: ['reasoningEffort'], ... }",
  )
  assertMatch(
    source,
    /path:\s*\['reasoningEffort'\],\s*value:\s*fieldText\(/,
    'the effort value must come from the draft text so a blank choice stays an explicit blank',
  )
  assert(!/op:\s*'unset'/.test(source), "client.js must not unset reasoningEffort (an unset restores the seeded 'max')")
})

test('client: new-model reminders, host routes and the official Models footer', () => {
  const source = read('client.js')
  assertMatch(source, /settings\.models\.footer/, 'client.js must fill the official Models settings page footer slot')
  assertMatch(source, /sidebar\.footer\.action/, 'client.js must contribute a sidebar footer action')
  for (const route of ['/api/dsh-model-pin/status', '/api/dsh-model-pin/check', '/api/dsh-model-pin/dismiss']) {
    assert(source.includes(route), `client.js must call the ${route} route`)
  }
  assertMatch(source, /openOfficialModelsSettings/, 'client.js must implement the best-effort jump helper')
  assertMatch(source, /modelCheckInterval/, 'client.js must read and write the modelCheckInterval config field')
  assertMatch(source, /x-dsh-model-pin-client/, 'client.js writes must send the client header')
})

test('consistency: settings label matches the locale metadata', () => {
  const source = read('client.js')
  for (const language of ['en', 'zh']) {
    const title = JSON.parse(read(`locale/${language}.json`)).meta.title
    assert(source.includes(`'${title}'`), `client.js must use the ${language} settings label ${JSON.stringify(title)}`)
  }
})

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

const readme = read('README.md')
const changelog = read('CHANGELOG.md')

test('docs: README documents every Config field', () => {
  for (const field of ['provider', 'model', 'reasoningEffort', 'modelCheckInterval']) {
    const occurrences = (readme.match(new RegExp(`\`${field}\``, 'g')) ?? []).length
    assert(occurrences >= 2, `README must mention the Config field ${field} at least twice, found ${occurrences}`)
  }
  assertMatch(readme, /(必填|缺失)/, 'README must document the required/missing-field behaviour')
  assertMatch(readme, /cordis\.patch\.yml/, 'README must point at cordis.patch.yml')
  assertMatch(readme, /dsh-model-pin/, 'README must name the config entry id')
  assertMatch(readme, /reasoningEffort: ""/, 'README must document the blank-string "follow model default" override')
})

test('docs: README sections required by the package usage guide', () => {
  const headings = readme.split('\n').filter((line) => line.startsWith('## '))
  const required = [
    '功能',
    '为什么需要',
    '安装',
    '配置',
    '模型检索周期（新模型提醒）',
    '工作原理',
    '与系统自带模型选择的关系',
    '已有会话 / 子代理 / headless 行为',
    '验证与排查',
    '卸载与回滚',
    '已知限制',
    '开发与测试',
  ]
  for (const title of required) {
    assert(headings.some((heading) => heading.slice(3).trim() === title), `README is missing the "## ${title}" section`)
  }
  assertMatch(readme, /node test\/run\.mjs/, 'README must document the test command')
  assertMatch(readme, /plugin_manager/, 'README must document the plugin_manager verification path')
  assertMatch(readme, /设置 → 模型固定/, 'README must point users at Settings → 模型固定')
})

test('docs: README documents the new-model reminder semantics', () => {
  assertMatch(readme, /模型检索周期（新模型提醒）/, 'README must name the model retrieval section')
  for (const option of ['1d', '3d', '7d', '14d', '30d', 'manual']) {
    assert(readme.includes(`\`${option}\``), `README must document the modelCheckInterval option ${option}`)
  }
  assertMatch(readme, /只提醒/, 'README must state the feature only reminds')
  assertMatch(readme, /不自动修改|永远不会自己改|不会[^。\n]*修改/, 'README must state that it never edits the model configuration')
  assertMatch(readme, /state\.json/, 'README must document the reminder state file')
  assertMatch(readme, /~\/\.dsh\/dsh-model-pin|DSH_HOME/, 'README must document where the state file lives')
  assertMatch(readme, /settings\.models\.footer|设置 → 模型.*页脚/, 'README must document where reminders appear')
  assertMatch(readme, /openOfficialModelsSettings|快速跳转/, 'README must document the best-effort jump')
})

test('docs: CHANGELOG, LICENSE, .gitignore and CI', () => {
  assertMatch(changelog, new RegExp(`##\\s*${manifest.version.replaceAll('.', '\\.')}\\b`), `CHANGELOG must describe version ${manifest.version}`)
  assertMatch(changelog, /首个版本|初始/, 'CHANGELOG 0.1.0 must describe the initial release')

  const license = read('LICENSE')
  assertMatch(license, /^MIT License/m, 'LICENSE must be MIT')
  assertMatch(license, /Copyright \(c\) \d{4} SeyanaA/, 'LICENSE must name the author')

  const gitignore = read('.gitignore').split('\n').map((line) => line.trim())
  for (const entry of ['node_modules/', '*.log', '.DS_Store']) {
    assert(gitignore.includes(entry), `.gitignore must ignore ${entry}`)
  }

  const workflow = read('.github/workflows/test.yml')
  assertMatch(workflow, /node test\/run\.mjs/, 'CI workflow must run node test/run.mjs')
  assertMatch(workflow, /node-version:\s*22/, 'CI workflow must use Node 22')
})

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log('dsh-model-pin tests\n')
for (const { name, fn } of tests) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ok    ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log(`  FAIL  ${name}`)
    console.log(`        ${String(error && error.message).split('\n').join('\n        ')}`)
  }
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed (of ${results.length})`)
if (failed.length > 0) {
  console.error(`\n${failed.length} test(s) failed: ${failed.map((result) => result.name).join('; ')}`)
  process.exit(1)
}
console.log('\nall dsh-model-pin tests passed')
