import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
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
 * `provider` and `model` are deliberately NOT schema-required. A hard Config
 * failure does not just fail this row: consumers inject `agentDefaultModel`, so
 * the Session controller would unmount with it and the whole app would come up
 * silently degraded. Instead an incomplete pin keeps the service mounted, logs
 * the problem, and lets the Settings page repair the row.
 */
class ModelPinService extends Service {
  /**
   * The pinned deployment default. All three fields are live references; an
   * absent `reasoningEffort` means "follow the model's own default".
   *
   * @type {import('@deepseek-ai/schemastery').default}
   */
  static Config = z.object({
    provider: z.string().volatile(),
    model: z.string().volatile(),
    reasoningEffort: z.string().volatile(),
  })

  /**
   * Live Config references for the pinned selection.
   *
   * @type {{ provider: ConfigRef, model: ConfigRef, reasoningEffort: ConfigRef }}
   */
  config

  /** Whether the incomplete-pin error was already reported for this instance. */
  incompleteReported = false

  /**
   * Register the replacement `agentDefaultModel` service.
   *
   * @param {object} ctx Cordis Context owning this plugin instance.
   * @param {{ provider: ConfigRef, model: ConfigRef, reasoningEffort: ConfigRef }} config
   * Resolved row config; `volatile()` fields arrive as live references.
   */
  constructor(ctx, config) {
    super(ctx, 'agentDefaultModel')
    this.config = config
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
}

export { ModelPinService }
export default ModelPinService
