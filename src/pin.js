/**
 * Pure helpers for the pinned default conversation model.
 *
 * This module deliberately imports nothing from the Harness runtime: the Host
 * plugin imports it while a Cordis context is mounted, and the test suite loads
 * it in a plain Node process. Keep it dependency-free and side-effect-free.
 */

/**
 * A detached model selection, as consumed by the Session controller and the
 * headless runner.
 *
 * @typedef {object} ModelSelection
 * @property {string} provider Provider id, for example `opencode-go`.
 * @property {string} model Model id, for example `deepseek-v4.1-flash`.
 * @property {string} [reasoningEffort] Optional reasoning-effort id, for example `max`.
 */

/**
 * Whether a value is a plain record (not `null`, not an array).
 *
 * @param {unknown} value Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value can carry fields.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one required selection field and trim it.
 *
 * @param {unknown} value Raw field value.
 * @param {string} field Field name used in diagnostics.
 * @returns {string} The trimmed, non-blank value.
 * @throws {TypeError} When the value is not a string or trims to a blank string.
 */
function readRequiredText(value, field) {
  if (typeof value !== 'string') {
    throw new TypeError(`model selection ${field} must be a string, received ${value === null ? 'null' : typeof value}`)
  }
  const text = value.trim()
  if (text === '') throw new TypeError(`model selection ${field} must not be blank`)
  return text
}

/**
 * Read an optional selection field.
 *
 * A missing (`undefined`/`null`) or blank value means "not selected": the field
 * is omitted from the normalized selection instead of being rejected, so an
 * empty optional Config field cannot break Session creation.
 *
 * @param {unknown} value Raw field value.
 * @returns {string | undefined} The trimmed value, or `undefined` when absent.
 * @throws {TypeError} When the value is present but not a string.
 */
function readOptionalText(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new TypeError(`model selection reasoningEffort must be a string, received ${typeof value}`)
  }
  const text = value.trim()
  return text === '' ? undefined : text
}

/**
 * Normalize and validate a model selection.
 *
 * Provider and model are required non-blank strings; both are trimmed.
 * `reasoningEffort` is optional; a blank value is treated as absent. The result
 * is a fresh object, so callers can hold it without aliasing their input.
 *
 * @param {unknown} input Candidate selection, usually a Config snapshot or a
 * picker payload.
 * @returns {ModelSelection} A detached normalized selection.
 * @throws {TypeError} When the input is not an object or a field is invalid.
 */
export function normalizeSelection(input) {
  if (!isRecord(input)) throw new TypeError('model selection must be an object')
  /** @type {ModelSelection} */
  const selection = {
    provider: readRequiredText(input.provider, 'provider'),
    model: readRequiredText(input.model, 'model'),
  }
  const reasoningEffort = readOptionalText(input.reasoningEffort)
  if (reasoningEffort !== undefined) selection.reasoningEffort = reasoningEffort
  return selection
}

/**
 * Read one field as a comparable string without throwing.
 *
 * Absent, `null`, blank, and non-string values all collapse to `undefined` so
 * two selections carried through different transports still compare equal.
 *
 * @param {unknown} value Raw field value.
 * @returns {string | undefined} Trimmed text, or `undefined` when unset.
 */
function comparableText(value) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text === '' ? undefined : text
}

/**
 * Compare two model selections field by field.
 *
 * The comparison is tolerant about transport shape (surrounding whitespace and
 * a missing versus blank effort are equal) and never throws: non-object inputs
 * are simply never equal to anything.
 *
 * @param {unknown} a First selection.
 * @param {unknown} b Second selection.
 * @returns {boolean} Whether both describe the same provider, model, and effort.
 */
export function selectionEquals(a, b) {
  if (!isRecord(a) || !isRecord(b)) return false
  return comparableText(a.provider) === comparableText(b.provider)
    && comparableText(a.model) === comparableText(b.model)
    && comparableText(a.reasoningEffort) === comparableText(b.reasoningEffort)
}

/**
 * Describe a selection for humans, for example
 * `opencode-go/deepseek-v4.1-flash · max`.
 *
 * @param {unknown} selection Candidate selection.
 * @returns {string} `provider/model`, followed by ` · effort` when the
 * selection carries a reasoning effort.
 * @throws {TypeError} When the selection fails {@link normalizeSelection}.
 */
export function describeSelection(selection) {
  const { provider, model, reasoningEffort } = normalizeSelection(selection)
  return reasoningEffort === undefined ? `${provider}/${model}` : `${provider}/${model} · ${reasoningEffort}`
}
