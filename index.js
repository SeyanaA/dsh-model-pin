/**
 * dsh-model-pin — host half.
 *
 * Owns the deployment default conversation model in two independent pieces:
 *
 * 1. The `agentDefaultModel` service replacement: new Sessions start on the
 *    pinned provider/model, while the built-in per-Session picker keeps
 *    working and never rewrites the pinned default.
 * 2. The optional "new models" reminder: on the user-chosen interval the Host
 *    asks every registered provider's adapter for the models it advertises,
 *    diffs them against the configured catalog, and persists the difference.
 *    The reminder NEVER writes model configuration; it only records which
 *    provider gained which models so the client half can surface a notice and
 *    a quick jump to the official Settings → Models page.
 *
 * The reminder runtime (llm + settings + webServer) is optional through
 * `ctx.inject`: without those services the reminder feature stays inactive
 * while the pin service keeps working. Everything is registered through
 * `ctx.effect`/`ctx.inject`, so removing the row unloads timers and routes.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  diffDiscovered,
  intervalMs,
  nextCheckAt,
  normalizeIntervalId,
  pendingFingerprint,
} from './src/model-check.js'
import { describeSelection, normalizeSelection, selectionEquals } from './src/pin.js'

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
 * A live Config reference: `.volatile()` fields keep the reference and swap the
 * value it reads when Settings writes the row config.
 *
 * @typedef {object} ConfigRef
 * @property {() => string | undefined} get Read the current value.
 */

/**
 * One provider's outcome in the latest check.
 *
 * `error` is present when the provider could not be compared (unsupported
 * adapter, missing credential or configured model, unreachable endpoint,
 * timeout). Such a provider is not a failure of the whole check: every
 * provider is isolated and the remaining ones still report.
 *
 * @typedef {object} ModelCheckResult
 * @property {string} provider Provider route id.
 * @property {string} providerName Human-readable provider name.
 * @property {string} settingsNs Settings namespace owning the provider profile.
 * @property {number} checkedAt Epoch milliseconds when this provider was probed.
 * @property {number} currentCount Number of models in the configured catalog.
 * @property {number} addedCount Number of advertised models missing from it.
 * @property {{ id: string, name: string }[]} added The new model ids and names.
 * @property {string} [error] Why this provider could not be compared.
 */

/**
 * A provider with at least one new model, as surfaced by `status()`.
 *
 * @typedef {object} PendingProvider
 * @property {string} provider Provider route id.
 * @property {string} providerName Human-readable provider name.
 * @property {{ id: string, name: string }[]} added New model ids and names.
 */

/**
 * The persisted reminder document, `$DSH_HOME/dsh-model-pin/state.json`.
 *
 * The fingerprints are the reminder's memory: `pendingFingerprint` is the set
 * of new models the latest check found, `dismissedFingerprint` is the set the
 * user already acknowledged. The reminder is visible only while those differ.
 *
 * @typedef {object} ReminderState
 * @property {1} version Persisted format version.
 * @property {number | null} lastCheckAt Epoch milliseconds of the last completed check.
 * @property {ModelCheckResult[]} results Latest per-provider outcomes.
 * @property {string | null} pendingFingerprint Fingerprint of the latest pending set.
 * @property {string | null} dismissedFingerprint Fingerprint of the dismissed set.
 */

/**
 * What the client half reads from the status route.
 *
 * @typedef {object} ModelCheckStatus
 * @property {number | null} interval Effective automatic-check period in
 * milliseconds, or `null` in manual mode.
 * @property {string} intervalId Normalized interval id, one of the
 * `model-check.js` ids (`1d` / `3d` / `7d` / `14d` / `30d` / `manual`).
 * @property {number | null} lastCheckAt Epoch milliseconds of the last completed
 * check, or `null` when this profile never checked.
 * @property {number | null} nextCheckAt Epoch milliseconds when the next
 * automatic check is due, or `null` in manual mode.
 * @property {boolean} manual Whether the automatic scheduler is off.
 * @property {boolean} checking Whether a check is running right now.
 * @property {{ total: number, providerCount: number, providers: PendingProvider[] }} pending
 * The visible reminder: aggregated new-model counts and their providers. Empty
 * while hidden (nothing new, or this exact set was dismissed).
 * @property {ModelCheckResult[]} results Latest per-provider outcomes, errors included.
 */

/** The Host routes the client half consumes. */
export const ROUTES = {
  status: '/api/dsh-model-pin/status',
  check: '/api/dsh-model-pin/check',
  dismiss: '/api/dsh-model-pin/dismiss',
}

/** First automatic check after the reminder feature activates (~8 seconds). */
const FIRST_TICK_MS = 8_000

/** How often the scheduler re-reads the interval and decides whether a check is due. */
const TICK_MS = 60_000

/** One provider discovery may take this long before it is aborted. */
const DISCOVERY_TIMEOUT_MS = 20_000

/** Defensive upper bound for a write-route JSON body. */
const MAX_BODY_BYTES = 16 * 1024

/** Recorded for a provider whose adapter registered no model discovery. */
const NO_DISCOVERY_TEXT = '该提供商不支持自动检查'

/** Recorded for a provider with no configured models or no usable credential. */
const NO_MODELS_TEXT = '尚未配置模型或凭证不可用'

/** Recorded when discovery did not answer within {@link DISCOVERY_TIMEOUT_MS}. */
const TIMEOUT_TEXT = '检查超时（20 秒）'

/**
 * Read one volatile Config reference without assuming the row validated it.
 *
 * A row may omit a field, in which case Schemastery produces no reference for
 * it. Reading through this helper keeps `currentSelection()` total, so an
 * incomplete pin degrades to a diagnostic instead of an exception.
 *
 * @param {unknown} ref Config reference or a missing field.
 * @returns {string | undefined} Trimmed string value, or undefined.
 */
function readRef(ref) {
  if (ref === null || ref === undefined || typeof ref.get !== 'function') return undefined
  const value = ref.get()
  return typeof value === 'string' ? value.trim() : undefined
}

// ---------------------------------------------------------------------------
// Persisted reminder state
// ---------------------------------------------------------------------------

/** The directory holding this plugin's persisted state. */
function stateDir() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-model-pin')
}

/** The reminder state file. */
function stateFile() {
  return join(stateDir(), 'state.json')
}

/**
 * A fresh reminder document (first run, or an unusable state file).
 *
 * @returns {ReminderState} The empty state.
 */
function emptyState() {
  return {
    version: 1,
    lastCheckAt: null,
    results: [],
    pendingFingerprint: null,
    dismissedFingerprint: null,
  }
}

/**
 * Read a finite non-negative timestamp.
 *
 * @param {unknown} value Candidate epoch-milliseconds value.
 * @returns {number | null} The timestamp, or `null` when it is not usable.
 */
function timestampOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Read a finite non-negative count.
 *
 * @param {unknown} value Candidate count.
 * @returns {number} The count, or `0` when it is not usable.
 */
function countOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Read one persisted per-provider result.
 *
 * @param {unknown} raw Parsed result entry.
 * @returns {ModelCheckResult | null} A detached result, or `null` when the entry
 * cannot name a provider and is therefore meaningless.
 */
function normalizeStoredResult(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const provider = typeof Reflect.get(raw, 'provider') === 'string' ? Reflect.get(raw, 'provider') : ''
  if (provider === '') return null
  const added = []
  const rawAdded = Reflect.get(raw, 'added')
  if (Array.isArray(rawAdded)) {
    for (const entry of rawAdded) {
      if (entry === null || typeof entry !== 'object') continue
      const id = typeof Reflect.get(entry, 'id') === 'string' ? Reflect.get(entry, 'id').trim() : ''
      if (id === '') continue
      const rawName = Reflect.get(entry, 'name')
      const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : id
      added.push({ id, name })
    }
  }
  const providerName = Reflect.get(raw, 'providerName')
  const settingsNs = Reflect.get(raw, 'settingsNs')
  /** @type {ModelCheckResult} */
  const result = {
    provider,
    providerName: typeof providerName === 'string' && providerName !== '' ? providerName : provider,
    settingsNs: typeof settingsNs === 'string' ? settingsNs : '',
    checkedAt: countOf(Reflect.get(raw, 'checkedAt')),
    currentCount: countOf(Reflect.get(raw, 'currentCount')),
    addedCount: added.length,
    added,
  }
  const error = Reflect.get(raw, 'error')
  if (typeof error === 'string' && error !== '') result.error = error
  return result
}

/**
 * Validate and detach a parsed state document.
 *
 * Unknown fields are dropped, a different `version` is treated as unusable, and
 * every sub-document is re-read field by field: a hand-edited or partially
 * written file degrades to the fields that still make sense instead of
 * poisoning the in-memory state.
 *
 * @param {unknown} raw Parsed JSON.
 * @returns {ReminderState | null} The normalized state, or `null` when unusable.
 */
function normalizeStoredState(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (Reflect.get(raw, 'version') !== 1) return null
  const results = []
  const rawResults = Reflect.get(raw, 'results')
  if (Array.isArray(rawResults)) {
    for (const entry of rawResults) {
      const result = normalizeStoredResult(entry)
      if (result !== null) results.push(result)
    }
  }
  const pending = Reflect.get(raw, 'pendingFingerprint')
  const dismissed = Reflect.get(raw, 'dismissedFingerprint')
  return {
    version: 1,
    lastCheckAt: timestampOf(Reflect.get(raw, 'lastCheckAt')),
    results,
    pendingFingerprint: typeof pending === 'string' ? pending : null,
    dismissedFingerprint: typeof dismissed === 'string' ? dismissed : null,
  }
}

/**
 * Load the persisted reminder state, falling back to empty on any failure.
 *
 * A missing file is the normal first run; an unreadable, torn, or hand-edited
 * file must never stop the plugin from mounting.
 *
 * @param {string} file State file path.
 * @returns {ReminderState} The loaded or empty state.
 */
function loadStoredState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return normalizeStoredState(parsed) ?? emptyState()
  } catch {
    return emptyState()
  }
}

/**
 * The reminder state document plus its atomic persistence.
 *
 * Writes go through a sibling temporary file and `rename`, so a crash mid-write
 * cannot truncate the previous document. Every filesystem failure is contained:
 * an unwritable data directory only costs persistence, not the feature.
 */
class ReminderStore {
  /**
   * @param {string} [file] State file path; tests may point it at a temp dir.
   */
  constructor(file = stateFile()) {
    this.file = file
    /** @type {ReminderState} */
    this.state = loadStoredState(file)
  }

  /**
   * Replace the state file atomically.
   *
   * @returns {boolean} Whether the file was written.
   */
  save() {
    try {
      const directory = dirname(this.file)
      mkdirSync(directory, { recursive: true })
      const temporary = join(directory, `.state.${process.pid}.tmp`)
      writeFileSync(temporary, JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 })
      renameSync(temporary, this.file)
      return true
    } catch {
      return false
    }
  }
}

/**
 * Collect the providers that currently contribute a visible reminder.
 *
 * @param {ModelCheckResult[]} results Latest per-provider outcomes.
 * @returns {PendingProvider[]} Providers with at least one new model.
 */
function pendingProvidersOf(results) {
  const providers = []
  for (const result of Array.isArray(results) ? results : []) {
    if (result === null || typeof result !== 'object') continue
    const provider = result.provider
    if (typeof provider !== 'string' || provider === '') continue
    const added = []
    for (const entry of Array.isArray(result.added) ? result.added : []) {
      if (entry === null || typeof entry !== 'object') continue
      const id = typeof entry.id === 'string' ? entry.id : ''
      if (id === '') continue
      added.push({ id, name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : id })
    }
    if (added.length === 0) continue
    providers.push({
      provider,
      providerName: typeof result.providerName === 'string' && result.providerName !== '' ? result.providerName : provider,
      added,
    })
  }
  return providers
}

// ---------------------------------------------------------------------------
// Provider probing
// ---------------------------------------------------------------------------

/**
 * Read the stored route profile of one configurable provider.
 *
 * The directory entry names a settings namespace and a path from that
 * namespace's section root to the provider profile; the Settings service
 * exposes resolved values per namespace. `baseURL` and `api` are the only
 * fields discovery needs, and an absent or malformed field is simply omitted
 * so the adapter can fall back to its own default.
 *
 * @param {unknown[]} descriptors `ctx.settings.describe({ redactSecrets: true })` output.
 * @param {string} settingsNs Namespace owning the provider profile.
 * @param {unknown} settingsPath Path from the namespace root to the profile.
 * @returns {{ baseURL?: string, api?: string }} The route fields that are set.
 */
function readProviderRoute(descriptors, settingsNs, settingsPath) {
  const descriptor = descriptors.find(
    (row) => row !== null && typeof row === 'object' && Reflect.get(row, 'ns') === settingsNs,
  )
  if (descriptor === undefined) return {}
  let node = Reflect.get(descriptor, 'value')
  for (const segment of Array.isArray(settingsPath) ? settingsPath : []) {
    if (typeof segment !== 'string' || node === null || typeof node !== 'object') return {}
    node = Reflect.get(node, segment)
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return {}
  const route = {}
  const baseURL = Reflect.get(node, 'baseURL')
  if (typeof baseURL === 'string' && baseURL.trim() !== '') route.baseURL = baseURL.trim()
  const api = Reflect.get(node, 'api')
  if (typeof api === 'string' && api.trim() !== '') route.api = api.trim()
  return route
}

/**
 * Bound a failure message so one verbose error cannot bloat the state file.
 *
 * @param {unknown} error Any thrown value.
 * @returns {string} A non-empty, bounded message.
 */
function messageOf(error) {
  let text
  if (error instanceof Error) text = error.message
  else if (typeof error === 'string') text = error
  else {
    try {
      text = String(error)
    } catch {
      text = ''
    }
  }
  if (typeof text !== 'string' || text === '') return '未知错误'
  return text.length > 300 ? `${text.slice(0, 297)}…` : text
}

/**
 * Log through the owning Cordis logger without ever letting diagnostics break
 * the feature: a context may already be unloading when a late failure lands.
 *
 * @param {object} ctx Context whose logger to use.
 * @param {'debug' | 'info' | 'warn' | 'error'} level Severity.
 * @param {string} format printf-style message.
 * @param {...unknown} params Placeholder values.
 */
function log(ctx, level, format, ...params) {
  try {
    const logger = ctx.logger
    if (logger === null || typeof logger !== 'object') return
    const write = Reflect.get(logger, level)
    if (typeof write === 'function') write.call(logger, format, ...params)
  } catch {
    // Diagnostics are best effort.
  }
}

/**
 * Turn a discovery failure into the short diagnostic stored in the result.
 *
 * `NO_DISCOVERY` is expected for the official DeepSeek adapters: they register
 * no model discovery, so this provider cannot be auto-checked. It is reported
 * as a normal per-provider note, never as a failed check.
 *
 * @param {unknown} error Any thrown discovery value.
 * @returns {string} A user-facing one-line reason.
 */
function discoveryErrorText(error) {
  const code = error !== null && typeof error === 'object' && typeof Reflect.get(error, 'code') === 'string'
    ? Reflect.get(error, 'code')
    : ''
  const text = messageOf(error)
  if (code === 'NO_DISCOVERY' || text.includes('NO_DISCOVERY')) return NO_DISCOVERY_TEXT
  return text
}

/**
 * Turn a catalog read failure into the short diagnostic stored in the result.
 *
 * A missing credential is the common case: the adapter cannot enumerate models
 * it could not be called with, so it reads as the same "nothing configured yet"
 * note as an empty catalog.
 *
 * @param {unknown} error Any thrown listModels value.
 * @returns {string} A user-facing one-line reason.
 */
function catalogErrorText(error) {
  const code = error !== null && typeof error === 'object' && typeof Reflect.get(error, 'code') === 'string'
    ? Reflect.get(error, 'code')
    : ''
  return code === 'MISSING_CREDENTIAL' ? NO_MODELS_TEXT : messageOf(error)
}

/**
 * Run the periodic probe, compare, and persist cycle for one plugin instance.
 *
 * One runner exists while the reminder feature is active (llm + settings +
 * webServer all present). Every provider is isolated: an unreachable endpoint,
 * an unsupported adapter, a missing credential, or a timeout becomes that
 * provider's `error` string and the check continues with the next provider.
 * The scheduler only decides *when*; no code path here throws out of
 * `runCheck()` or writes model configuration.
 */
class ModelCheckRunner {
  /**
   * @param {ModelPinService} service Owning plugin service (state and Config).
   * @param {object} ctx Fiber context carrying llm, settings, and webServer.
   */
  constructor(service, ctx) {
    this.service = service
    this.ctx = ctx
    /** Whether a check is in flight; surfaced as `status().checking`. */
    this.checking = false
    /** The in-flight discovery, so unloading can abort the network call. */
    this.controller = null
    /** Set by {@link stop}; a late callback must not resurrect the feature. */
    this.disposed = false
    this.firstTimer = null
    this.tickTimer = null
  }

  /**
   * Start the scheduler: one early check, then a readiness tick every minute.
   *
   * Timers are `unref`ed so an idle plugin never keeps the Host process alive,
   * and both were created inside the owning `ctx.effect`, which calls
   * {@link stop} on unload.
   */
  start() {
    if (this.disposed) return
    this.firstTimer = setTimeout(() => {
      this.tick()
    }, FIRST_TICK_MS)
    this.firstTimer.unref?.()
    this.tickTimer = setInterval(() => {
      this.tick()
    }, TICK_MS)
    this.tickTimer.unref?.()
  }

  /** Stop the scheduler and abort an in-flight discovery. */
  stop() {
    this.disposed = true
    if (this.firstTimer !== null) clearTimeout(this.firstTimer)
    if (this.tickTimer !== null) clearInterval(this.tickTimer)
    this.firstTimer = null
    this.tickTimer = null
    const controller = this.controller
    this.controller = null
    if (controller !== null) {
      try {
        controller.abort()
      } catch {
        // An already-aborted controller is not a failure.
      }
    }
  }

  /** @returns {string} The interval id currently selected in the row config. */
  intervalId() {
    return this.service.currentIntervalId()
  }

  /**
   * Whether an automatic check is due at `now`.
   *
   * Manual mode is never due, a profile that never checked is due immediately,
   * and otherwise the previous check plus the period decides.
   *
   * @param {number} now Epoch milliseconds.
   * @returns {boolean} Whether the scheduler should run a check.
   */
  isDue(now) {
    const period = intervalMs(this.intervalId())
    if (period === null) return false
    const lastCheckAt = this.service.store.state.lastCheckAt
    return lastCheckAt === null || now >= lastCheckAt + period
  }

  /** One scheduler tick: read the live interval and check only when due. */
  tick() {
    if (this.disposed || this.checking) return
    try {
      if (!this.isDue(Date.now())) return
    } catch (error) {
      log(this.ctx, 'warn', 'dsh-model-pin: could not evaluate the model check schedule: %s', messageOf(error))
      return
    }
    this.runCheck('auto').catch((error) => {
      log(this.ctx, 'warn', 'dsh-model-pin: automatic model check failed: %s', messageOf(error))
    })
  }

  /**
   * Run one full check and persist its outcome.
   *
   * Concurrent triggers collapse into the running check (the status route
   * still answers with `checking: true`). The method never throws and never
   * rejects; every failure is either a per-provider `error` string or a logged
   * diagnostic, and the last check timestamp is still advanced so a broken
   * endpoint cannot make the scheduler retry every minute.
   *
   * @param {string} reason `auto` for the scheduler, `manual` for the route.
   * @returns {Promise<void>} Fulfillment after the state is persisted.
   */
  async runCheck(reason) {
    if (this.checking || this.disposed) return
    this.checking = true
    const startedAt = Date.now()
    try {
      const results = await this.checkProviders()
      if (this.disposed) return
      const state = this.service.store.state
      state.lastCheckAt = startedAt
      state.results = results
      state.pendingFingerprint = pendingFingerprint(pendingProvidersOf(results))
      // With nothing pending there is nothing left to acknowledge; clearing the
      // dismissal lets the same ids remind again if they ever disappear from
      // the catalog and come back.
      if (state.pendingFingerprint === null) state.dismissedFingerprint = null
      if (!this.service.store.save()) {
        log(this.ctx, 'debug', 'dsh-model-pin: model check state could not be persisted')
      }
    } catch (error) {
      // Absolute backstop: a check must never break the plugin or the timer.
      log(this.ctx, 'warn', 'dsh-model-pin: model check (%s) failed: %s', reason, messageOf(error))
      if (!this.disposed) {
        const state = this.service.store.state
        state.lastCheckAt = startedAt
        this.service.store.save()
      }
    } finally {
      this.checking = false
    }
  }

  /**
   * Orchestrate one provider enumeration pass.
   *
   * The provider list, the configurable-provider directory, and the settings
   * descriptors are read once; a failure to read any of them degrades that
   * part (no probes, or no stored route fields) instead of aborting the check.
   *
   * @returns {Promise<ModelCheckResult[]>} One result per registered provider.
   */
  async checkProviders() {
    const { llm, settings } = this.ctx
    const providers = []
    try {
      const listed = llm.listProviders()
      for (const entry of Array.isArray(listed) ? listed : []) {
        if (entry === null || typeof entry !== 'object') continue
        const id = Reflect.get(entry, 'id')
        if (typeof id !== 'string' || id === '') continue
        if (providers.some((seen) => seen.id === id)) continue
        providers.push({
          id,
          name: typeof Reflect.get(entry, 'name') === 'string' ? Reflect.get(entry, 'name') : id,
        })
      }
    } catch (error) {
      log(this.ctx, 'warn', 'dsh-model-pin: could not list providers: %s', messageOf(error))
      return []
    }
    if (providers.length === 0) return []
    let directory = []
    try {
      const listed = llm.listConfigurableProviders()
      if (Array.isArray(listed)) directory = listed
    } catch (error) {
      log(this.ctx, 'warn', 'dsh-model-pin: could not read the provider directory: %s', messageOf(error))
    }
    let descriptors = []
    try {
      const described = settings.describe({ redactSecrets: true })
      if (Array.isArray(described)) descriptors = described
    } catch (error) {
      log(this.ctx, 'debug', 'dsh-model-pin: could not read settings descriptors: %s', messageOf(error))
    }
    const results = []
    for (const provider of providers) {
      if (this.disposed) break
      results.push(await this.checkProvider(provider.id, provider.name, directory, descriptors))
    }
    return results
  }

  /**
   * Probe one provider and diff its advertised models against the catalog.
   *
   * The configured catalog decides whether the provider is usable at all: an
   * empty catalog (no models configured, or no usable credential) is skipped
   * with a note instead of being reported as "every advertised model is new".
   *
   * @param {string} provider Provider route id.
   * @param {string} providerName Human-readable provider name.
   * @param {unknown[]} directory `ctx.llm.listConfigurableProviders()` output.
   * @param {unknown[]} descriptors `ctx.settings.describe({ redactSecrets: true })` output.
   * @returns {Promise<ModelCheckResult>} One provider's outcome.
   */
  async checkProvider(provider, providerName, directory, descriptors) {
    const checkedAt = Date.now()
    const entry = directory.find(
      (candidate) => candidate !== null && typeof candidate === 'object' && Reflect.get(candidate, 'provider') === provider,
    )
    const settingsNs = entry !== undefined && typeof Reflect.get(entry, 'settingsNs') === 'string'
      ? Reflect.get(entry, 'settingsNs')
      : ''
    /** @type {ModelCheckResult} */
    const base = {
      provider,
      providerName,
      settingsNs,
      checkedAt,
      currentCount: 0,
      addedCount: 0,
      added: [],
    }
    // A registered route with no directory entry has no settings address, so
    // there is no discovery offer to ask; treat it like an unsupported adapter.
    if (entry === undefined || settingsNs === '') return { ...base, error: NO_DISCOVERY_TEXT }
    let current = []
    try {
      const listed = await this.ctx.llm.listModels(provider)
      if (Array.isArray(listed)) current = listed
    } catch (error) {
      return { ...base, error: catalogErrorText(error) }
    }
    base.currentCount = current.length
    if (current.length === 0) return { ...base, error: NO_MODELS_TEXT }
    const route = readProviderRoute(descriptors, settingsNs, Reflect.get(entry, 'settingsPath'))
    /** @type {{ provider: string, baseURL?: string, api?: string }} */
    const request = { provider }
    if (typeof route.baseURL === 'string') request.baseURL = route.baseURL
    else if (typeof Reflect.get(entry, 'defaultBaseURL') === 'string' && Reflect.get(entry, 'defaultBaseURL') !== '') {
      request.baseURL = Reflect.get(entry, 'defaultBaseURL')
    }
    if (typeof route.api === 'string') request.api = route.api
    const controller = new AbortController()
    this.controller = controller
    const timeout = setTimeout(() => {
      try {
        controller.abort()
      } catch {
        // Aborting an already-finished controller is harmless.
      }
    }, DISCOVERY_TIMEOUT_MS)
    timeout.unref?.()
    let discovered = []
    try {
      const listed = await this.ctx.llm.discoverModels(settingsNs, request, controller.signal)
      if (Array.isArray(listed)) discovered = listed
    } catch (error) {
      if (controller.signal.aborted) return { ...base, error: TIMEOUT_TEXT }
      return { ...base, error: discoveryErrorText(error) }
    } finally {
      clearTimeout(timeout)
      if (this.controller === controller) this.controller = null
    }
    const added = diffDiscovered(discovered, current)
    return { ...base, addedCount: added.length, added }
  }
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

/** A rejected request carrying the HTTP status the route should answer with. */
class RouteError extends Error {
  /**
   * @param {number} status HTTP status.
   * @param {string} message User-facing reason.
   */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Reject a state-changing request that did not come from the DSH web page.
 *
 * Two reminder routes run a check and dismiss a notice. Neither may be
 * triggered by an arbitrary local page (or a DNS-rebinding attempt): a write
 * needs a JSON content type, the explicit client marker header, no cross-site
 * `Sec-Fetch-Site`, and either the exact advertised origin or a loopback origin
 * on the same port as the `Host` header. Adapted from the dsh-lock hardening so
 * both plugins share one trust model.
 *
 * @param {object} req Incoming request.
 * @param {string | undefined} allowedOrigin The exact DSH web origin when known.
 * @returns {string | null} A user-facing rejection reason, or `null` to proceed.
 */
function requestGuardProblem(req, allowedOrigin) {
  const headers = req !== null && typeof req === 'object' && req.headers !== null && typeof req.headers === 'object'
    ? req.headers
    : {}
  const contentType = String(headers['content-type'] ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) return '需要 application/json 请求'
  if (headers['x-dsh-model-pin-client'] !== '1') return '缺少 dsh-model-pin 客户端标识'
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site !== '' && site !== 'same-origin' && site !== 'none') return '跨站请求不被允许'
  const origin = headers.origin
  if (typeof origin === 'string' && origin !== '') {
    let parsed = null
    try {
      parsed = new URL(origin)
    } catch {
      return '来源不被允许'
    }
    // The exact advertised origin is ideal; a loopback origin on the same port
    // as the Host header is equally trustworthy (127.0.0.1 vs localhost, or a
    // stale advertised URL). Everything else is rejected.
    const target = typeof allowedOrigin === 'string' && allowedOrigin !== '' ? allowedOrigin.replace(/\/$/, '') : null
    const exact = target !== null && origin.replace(/\/$/, '') === target
    const host = String(headers.host ?? '')
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
      || parsed.hostname === '::1' || parsed.hostname === '[::1]'
    const samePort = host.includes(':') ? parsed.port === host.slice(host.lastIndexOf(':') + 1) : true
    if (!exact && !(loopback && samePort)) return '来源不被允许'
  }
  return null
}

/**
 * @param {import('node:http').ServerResponse} res Response.
 * @param {number} status HTTP status.
 * @param {object} body JSON body.
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * @param {import('node:http').IncomingMessage} req Request.
 * @returns {Promise<object>} The parsed JSON body (an empty object when absent).
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new RouteError(413, '请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new RouteError(400, 'JSON 格式不正确'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Wrap a route handler with the method check, the write guard, and error
 * mapping. A handler failure always ends as a JSON answer, never as an
 * uncaught rejection in the web server.
 *
 * @param {'GET' | 'POST'} method Accepted method.
 * @param {(req: object, res: object) => Promise<void> | void} handler Route body.
 * @param {{ guard?: boolean, allowedOrigin?: string }} [options] Write hardening.
 * @returns {(req: object, res: object) => Promise<void>} The web-server handler.
 */
function route(method, handler, options = {}) {
  const guard = options.guard === true
  const allowedOrigin = options.allowedOrigin
  return async (req, res) => {
    try {
      if (req.method !== method) {
        sendJson(res, 405, { ok: false, error: `${method} only` })
        return
      }
      if (guard) {
        const problem = requestGuardProblem(req, allowedOrigin)
        if (problem !== null) {
          sendJson(res, 403, { ok: false, error: problem })
          return
        }
      }
      await handler(req, res)
    } catch (error) {
      if (error instanceof RouteError) {
        sendJson(res, error.status, { ok: false, error: error.message })
        return
      }
      sendJson(res, 500, { ok: false, error: messageOf(error) })
    }
  }
}

/**
 * Read the exact origin the web server advertises, if it is already bound.
 *
 * @param {object} ctx Context carrying the webServer service.
 * @returns {string | undefined} The origin, or `undefined` before listen.
 */
function allowedOriginOf(ctx) {
  try {
    const origin = ctx.webServer.getOrigin()
    return typeof origin === 'string' && origin !== '' ? origin : undefined
  } catch {
    return undefined
  }
}

/**
 * Register the three reminder routes on the web server.
 *
 * Registered inside `ctx.effect`, so unloading the plugin removes every route;
 * a registration failure is logged and skips that route instead of failing the
 * plugin (and with it the pin service).
 *
 * @param {ModelPinService} service Owning plugin service.
 * @param {object} ctx Fiber context carrying the webServer service.
 * @param {ModelCheckRunner} runner The active reminder runner.
 * @returns {() => void} Disposer withdrawing every registered route.
 */
function registerFeatureRoutes(service, ctx, runner) {
  const allowedOrigin = allowedOriginOf(ctx)
  const disposers = []
  const register = (path, handler) => {
    try {
      disposers.push(ctx.webServer.register({ kind: 'exact', path, handler }))
    } catch (error) {
      log(ctx, 'warn', 'dsh-model-pin: could not register %s: %s', path, messageOf(error))
    }
  }
  const mutation = (method, handler) => route(method, handler, { guard: true, allowedOrigin })
  register(ROUTES.status, route('GET', (_req, res) => {
    sendJson(res, 200, { ok: true, value: service.status() })
  }))
  register(ROUTES.check, mutation('POST', async (req, res) => {
    await readJson(req)
    await runner.runCheck('manual')
    sendJson(res, 200, { ok: true, value: service.status() })
  }))
  register(ROUTES.dismiss, mutation('POST', async (req, res) => {
    await readJson(req)
    service.dismiss()
    sendJson(res, 200, { ok: true, value: service.status() })
  }))
  return () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch {
        // A route already gone is not a failure.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin service
// ---------------------------------------------------------------------------

/**
 * Owns the default conversation model for newly created Sessions.
 *
 * The instance registers under the stock `agentDefaultModel` service name, so
 * existing consumers keep working unchanged:
 * - `@deepseek-ai/dsh-api-session-controller` reads `currentSelection()` when it
 *   creates Agents and when it builds the model catalog, and calls
 *   `saveSelection()` after the built-in per-Session model picker chooses a
 *   model;
 * - `@deepseek-ai/dsh-headless` reads `currentSelection()` for its default.
 *
 * The companion bundle patch disables the stock `agent-default-model` row and
 * inserts this plugin, so this class is the only provider of that service.
 *
 * The per-Session model picker keeps working: the Session controller installs
 * the picked model on the current Session itself and only then calls
 * `saveSelection()` as a "persist the new default" hook. That hook is a
 * deliberate no-op here, so the next new Session still starts on the pinned
 * selection instead of following the picker.
 *
 * Every Config field is `.volatile()`, so a Settings write hot-applies to
 * running consumers without restarting the plugin.
 *
 * `provider`, `model`, and `modelCheckInterval` are deliberately NOT
 * schema-required. A hard Config failure does not just fail this row:
 * consumers inject `agentDefaultModel`, so the Session controller would unmount
 * with it and the whole app would come up silently degraded. Instead an
 * incomplete pin keeps the service mounted, logs the problem, and lets the
 * Settings page repair the row.
 *
 * The "new models" reminder described above is a separate, optional subsystem:
 * it needs `llm`, `settings`, and `webServer`, and registers itself through
 * `ctx.inject` so this service still mounts when those are absent.
 */
class ModelPinService extends Service {
  /**
   * The pinned deployment default plus the reminder interval. All fields are
   * live references; an absent `reasoningEffort` means "follow the model's own
   * default", and an absent `modelCheckInterval` means the seed (`7d`).
   *
   * @type {import('@deepseek-ai/schemastery').default}
   */
  static Config = z.object({
    provider: z.string().volatile(),
    model: z.string().volatile(),
    reasoningEffort: z.string().volatile(),
    modelCheckInterval: z.string().volatile(),
  })

  /**
   * Live Config references for the pinned selection.
   *
   * @type {{ provider: ConfigRef, model: ConfigRef, reasoningEffort: ConfigRef, modelCheckInterval: ConfigRef }}
   */
  config

  /** Whether the incomplete-pin error was already reported for this instance. */
  incompleteReported = false

  /** The persisted reminder state; loaded even while the reminder is inactive. */
  store

  /** The active reminder runner, or `null` while the feature is inactive. */
  runner = null

  /**
   * Register the replacement `agentDefaultModel` service and, when its
   * services exist, the reminder subsystem.
   *
   * @param {object} ctx Cordis Context owning this plugin instance.
   * @param {{ provider: ConfigRef, model: ConfigRef, reasoningEffort: ConfigRef, modelCheckInterval: ConfigRef }} config
   * Resolved row config; `volatile()` fields arrive as live references.
   */
  constructor(ctx, config) {
    super(ctx, 'agentDefaultModel')
    this.config = config
    this.store = new ReminderStore()
    // The Settings service keeps one presentation policy per plugin instance.
    // `auto: false` states that this row has no automatically generated form:
    // the pin is shown and edited by the client half of the package, while the
    // built-in per-Session picker stays the way to change one Session.
    ctx.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    })
    // Read-only diagnostic: a pin whose provider is not part of this deployment
    // cannot start a model request. Report it at activation instead of letting
    // the first new Session fail without an explanation. `llm` is optional so
    // the plugin still mounts in compositions without a registry.
    ctx.inject(['llm'], (child) => {
      child.effect(() => {
        const selection = this.currentSelection()
        if (selection.provider === '') return
        try {
          const providers = child.llm.listProviders() ?? []
          const registered = providers.some(
            (provider) => provider !== null && typeof provider === 'object' && provider.id === selection.provider,
          )
          if (registered) return
          child.logger.warn(
            'dsh-model-pin: pinned provider "%s" is not registered in this deployment; '
              + 'new Sessions will not start until Settings → 模型固定 points at a configured provider.',
            selection.provider,
          )
        } catch {
          // A diagnostics probe must never break activation.
        }
      })
    })
    // The reminder needs all three services at once. When any is absent (a
    // headless or non-web composition, or a stripped deployment) the feature is
    // simply inactive: no scheduler, no routes, but the pin service above still
    // works. Everything this callback creates is disposed with its fiber, so a
    // service restart re-registers timers and routes instead of duplicating them.
    ctx.inject(['llm', 'settings', 'webServer'], (child) => {
      const runner = new ModelCheckRunner(this, child)
      this.runner = runner
      child.effect(() => {
        runner.start()
        return () => {
          if (this.runner === runner) this.runner = null
          runner.stop()
        }
      }, 'dsh-model-pin: model check scheduler')
      child.effect(() => registerFeatureRoutes(this, child, runner), 'dsh-model-pin: model check routes')
    })
  }

  /**
   * Read the selection that every newly created Session starts from.
   *
   * Values are read from the live Config references on every call, so a
   * Settings write is visible immediately, even to an already-running plugin.
   * An incomplete pin returns empty ids: consumers keep running, and their own
   * "no provider/model" diagnostic names the missing route instead of the
   * whole Session controller failing to mount.
   *
   * @returns {ModelSelection} A detached normalized selection.
   */
  currentSelection() {
    const provider = readRef(this.config && this.config.provider) ?? ''
    const model = readRef(this.config && this.config.model) ?? ''
    const reasoningEffort = readRef(this.config && this.config.reasoningEffort)
    if (provider === '' || model === '') {
      if (!this.incompleteReported) {
        this.incompleteReported = true
        this.ctx.logger.error(
          'dsh-model-pin: provider/model are missing in the "dsh-model-pin" profile row; '
            + 'new Sessions cannot start model requests until Settings → 模型固定 is saved.',
        )
      }
      return { provider, model }
    }
    this.incompleteReported = false
    return reasoningEffort === undefined || reasoningEffort === ''
      ? { provider, model }
      : { provider, model, reasoningEffort }
  }

  /**
   * Accept a requested default-selection change without persisting it.
   *
   * The Session controller has already installed the picked model on the
   * current Session before calling this hook; only the deployment default is
   * pinned, so a pinner must discard the "make this the default" request rather
   * than rewrite its own Config. A malformed payload is discarded as well: the
   * picker's own result is applied before this hook, and nothing here should
   * add a new failure to that path.
   *
   * @param {unknown} next Requested default selection.
   * @returns {Promise<void>} Fulfillment after the request is discarded.
   */
  async saveSelection(next) {
    let requested
    try {
      requested = normalizeSelection(next)
    } catch {
      return
    }
    if (selectionEquals(requested, this.currentSelection())) {
      // Already the pinned selection: a save could not add anything.
      return
    }
    // The pin wins over the picker: nothing is written to the row config. The
    // per-Session effect of the picker was applied by the Session controller
    // before this call, so the current Session still changed models.
  }

  /**
   * Describe the pinned selection for diagnostics and UI readouts.
   *
   * @returns {string} For example `opencode-go/deepseek-v4.1-flash · max`.
   */
  describe() {
    const selection = this.currentSelection()
    if (selection.provider === '' || selection.model === '') return 'unconfigured'
    return describeSelection(selection)
  }

  /**
   * The interval id currently selected in the row config.
   *
   * Read live on every call, so a Settings write takes effect on the next
   * scheduler tick without restarting the plugin.
   *
   * @returns {string} One of the `model-check.js` interval ids.
   */
  currentIntervalId() {
    return normalizeIntervalId(readRef(this.config && this.config.modelCheckInterval))
  }

  /**
   * The public reminder status, as served by `GET /api/dsh-model-pin/status`.
   *
   * Reads the persisted state and the live Config only; it never touches the
   * network and works even while the reminder subsystem is inactive (the
   * intervals then still describe the row config, `checking` is false, and the
   * persisted reminder is reported as-is).
   *
   * The pending block is empty unless the latest pending set differs from the
   * dismissed set, which is what makes "clear reminder" survive re-checks of
   * the same new models.
   *
   * @returns {ModelCheckStatus} A detached status document.
   */
  status() {
    const intervalId = this.currentIntervalId()
    const state = this.store.state
    const pendingProviders = pendingProvidersOf(state.results)
    const fingerprint = pendingFingerprint(pendingProviders)
    const visible = fingerprint !== null && fingerprint !== state.dismissedFingerprint
    let total = 0
    for (const provider of pendingProviders) total += provider.added.length
    return {
      interval: intervalMs(intervalId),
      intervalId,
      lastCheckAt: state.lastCheckAt,
      nextCheckAt: nextCheckAt(state.lastCheckAt, intervalId, Date.now()),
      manual: intervalId === 'manual',
      checking: this.runner !== null && this.runner.checking === true,
      pending: visible
        ? { total, providerCount: pendingProviders.length, providers: pendingProviders }
        : { total: 0, providerCount: 0, providers: [] },
      results: state.results,
    }
  }

  /**
   * Dismiss the currently visible reminder without changing any configuration.
   *
   * Records the current pending set's fingerprint, so the same set stays
   * hidden across later checks while a different set reminds again.
   *
   * @returns {ModelCheckStatus} The status after dismissal.
   */
  dismiss() {
    this.store.state.dismissedFingerprint = pendingFingerprint(
      pendingProvidersOf(this.store.state.results),
    )
    this.store.save()
    return this.status()
  }

  /**
   * Run one model check now (the "check now" action).
   *
   * Runs through the active reminder runner when the feature is available and
   * is a no-op otherwise; it never throws, and the caller can read the outcome
   * from `status()`. The `reason` is a diagnostic label only (`manual` from the
   * route, `auto` from the scheduler).
   *
   * @param {string} [reason] `auto` or `manual`.
   * @returns {Promise<ModelCheckStatus>} The status after the check settles.
   */
  async runCheck(reason = 'manual') {
    const runner = this.runner
    if (runner === null) return this.status()
    await runner.runCheck(reason)
    return this.status()
  }
}

export { ModelPinService }
export default ModelPinService
