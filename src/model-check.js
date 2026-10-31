/**
 * Pure helpers for the periodic "new models" reminder.
 *
 * This module deliberately imports nothing from the Harness runtime or from
 * Node: the Host plugin imports it while a Cordis context is mounted, and the
 * test suite loads it in a plain Node process. Keep it dependency-free and
 * side-effect-free.
 */

/** One day in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Every selectable check interval, from the shortest automatic one to manual.
 *
 * The order is the presentation order a settings surface should offer; the
 * last id is not a period but the absence of one.
 */
export const INTERVAL_IDS = ['1d', '3d', '7d', '14d', '30d', 'manual']

/** The interval used when the Config field is absent or blank (the seed). */
export const DEFAULT_INTERVAL_ID = '7d'

/**
 * The automatic-check period of every id, in milliseconds.
 *
 * `manual` is `null`: the scheduler never checks on its own, while a user
 * triggered "check now" still runs exactly one check.
 */
const INTERVAL_PERIOD_MS = {
  '1d': DAY_MS,
  '3d': 3 * DAY_MS,
  '7d': 7 * DAY_MS,
  '14d': 14 * DAY_MS,
  '30d': 30 * DAY_MS,
  manual: null,
}

/**
 * Read a positive number as a period, or `null` when there is no period.
 *
 * @param {unknown} value Candidate period in milliseconds.
 * @returns {number | null} The period, or `null` for `manual` and anything absent.
 */
function periodOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Normalize a raw Config value to one selectable interval id.
 *
 * An absent, `null`, blank, or non-string value means "the row was written
 * before this field existed" and resolves to the default (`7d`). A non-empty
 * but unrecognized string resolves to `manual` instead: a typo must never be
 * mistaken for a valid period and start network probing the user did not ask
 * for.
 *
 * @param {unknown} value Raw `modelCheckInterval` value.
 * @returns {string} One of {@link INTERVAL_IDS}.
 */
export function normalizeIntervalId(value) {
  if (typeof value !== 'string') return DEFAULT_INTERVAL_ID
  const text = value.trim()
  if (text === '') return DEFAULT_INTERVAL_ID
  return INTERVAL_IDS.includes(text) ? text : 'manual'
}

/**
 * Resolve the automatic-check period of an interval id.
 *
 * @param {unknown} intervalId Candidate interval id, normalized first.
 * @returns {number | null} Milliseconds between automatic checks, or `null`
 * when the id is `manual` (never check automatically).
 */
export function intervalMs(intervalId) {
  return periodOf(INTERVAL_PERIOD_MS[normalizeIntervalId(intervalId)])
}

/**
 * Read a model entry's id, tolerating the shapes discovery and catalogs use.
 *
 * @param {unknown} entry A discovered model, a catalog model, or a plain id string.
 * @returns {string} The trimmed, non-blank id, or an empty string.
 */
function modelId(entry) {
  if (typeof entry === 'string') return entry.trim()
  if (entry === null || typeof entry !== 'object') return ''
  const id = Reflect.get(entry, 'id')
  return typeof id === 'string' ? id.trim() : ''
}

/**
 * Read a model entry's display name, tolerating a missing one.
 *
 * @param {unknown} entry A discovered model or a catalog model.
 * @returns {string} The trimmed name, or an empty string when absent.
 */
function modelName(entry) {
  if (entry === null || typeof entry !== 'object') return ''
  const name = Reflect.get(entry, 'name')
  return typeof name === 'string' ? name.trim() : ''
}

/**
 * Copy an array-shaped list, treating anything else as empty.
 *
 * @param {unknown} value Candidate list.
 * @returns {unknown[]} The list itself, or an empty array.
 */
function listOf(value) {
  return Array.isArray(value) ? value : []
}

/**
 * Compute the models an endpoint advertises that the configured catalog lacks.
 *
 * Both inputs are tolerant: an id may be a plain string or an object carrying
 * `id`/`name`, unknown shapes are ignored, duplicates keep their first
 * occurrence, and a missing display name falls back to the id so a caller can
 * always render something. "New" means the exact id is absent from the current
 * catalog; a renamed display name does not create a new model.
 *
 * @param {unknown} discovered Advertised models, for example
 * `ctx.llm.discoverModels()` output (`{ id, name? }`).
 * @param {unknown} current Currently configured models, for example
 * `ctx.llm.listModels()` output (`{ id, name? }`).
 * @returns {{ id: string, name: string }[]} The advertised models missing from
 * the catalog, in discovery order.
 */
export function diffDiscovered(discovered, current) {
  const configured = new Set()
  for (const entry of listOf(current)) {
    const id = modelId(entry)
    if (id !== '') configured.add(id)
  }
  const seen = new Set()
  const added = []
  for (const entry of listOf(discovered)) {
    const id = modelId(entry)
    if (id === '' || configured.has(id) || seen.has(id)) continue
    seen.add(id)
    added.push({ id, name: modelName(entry) || id })
  }
  return added
}

/**
 * Fingerprint the pending reminder so "already dismissed" survives re-checks.
 *
 * The fingerprint covers the exact pending new-model set, not the time of the
 * check: the same set stays dismissed across repeated checks, while any model
 * appearing or disappearing yields a different fingerprint and shows the
 * reminder again. Provider order and model order inside a provider are
 * normalized away, so two checks that found the same set always agree.
 *
 * @param {unknown} providers Pending provider rows, each with a `provider` id
 * and an `added` list of `{ id }` entries.
 * @returns {string | null} A stable JSON string, or `null` when nothing is pending.
 */
export function pendingFingerprint(providers) {
  const rows = []
  for (const provider of listOf(providers)) {
    if (provider === null || typeof provider !== 'object') continue
    const id = Reflect.get(provider, 'provider')
    if (typeof id !== 'string' || id.trim() === '') continue
    const ids = []
    for (const entry of listOf(Reflect.get(provider, 'added'))) {
      const model = modelId(entry)
      if (model !== '') ids.push(model)
    }
    const unique = [...new Set(ids)].sort()
    if (unique.length === 0) continue
    rows.push([id.trim(), unique])
  }
  if (rows.length === 0) return null
  rows.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
  return JSON.stringify(rows)
}

/**
 * When the next automatic check becomes due.
 *
 * `manual` has no next check, so it answers `null`. A profile that never ran a
 * check is due immediately: it answers `now`. Otherwise it is
 * `lastCheckAt + period`, which may already be in the past when a check is
 * overdue; callers that only render the time can compare it with `now`.
 *
 * @param {unknown} lastCheckAt Epoch milliseconds of the previous check, or `null`.
 * @param {unknown} intervalId Candidate interval id, normalized first.
 * @param {number} [now] Epoch milliseconds used for a never-checked profile.
 * @returns {number | null} The due timestamp, or `null` for manual mode.
 */
export function nextCheckAt(lastCheckAt, intervalId, now = Date.now()) {
  const period = intervalMs(intervalId)
  if (period === null) return null
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
  if (typeof lastCheckAt !== 'number' || !Number.isFinite(lastCheckAt) || lastCheckAt < 0) return at
  return lastCheckAt + period
}
