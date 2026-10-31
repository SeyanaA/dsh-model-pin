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
 */
class ModelPinService extends Service {
  /**
   * The pinned deployment default. `provider` and `model` are required;
   * `reasoningEffort` is optional and omitted when the row does not set it.
   *
   * @type {import('@deepseek-ai/schemastery').default}
   */
  static Config = z.object({
    provider: z.string().required().volatile(),
    model: z.string().required().volatile(),
    reasoningEffort: z.string().volatile(),
  })

  /**
   * Live Config references for the pinned selection.
   *
   * @type {{ provider: ConfigRef, model: ConfigRef, reasoningEffort: ConfigRef }}
   */
  config

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
  }

  /**
   * Read the selection that every newly created Session starts from.
   *
   * Values are read from the live Config references on every call, so a
   * Settings write is visible immediately, even to an already-running plugin.
   *
   * @returns {ModelSelection} A detached normalized selection.
   */
  currentSelection() {
    return normalizeSelection({
      provider: this.config.provider.get(),
      model: this.config.model.get(),
      reasoningEffort: this.config.reasoningEffort.get(),
    })
  }

  /**
   * Accept a requested default-selection change without persisting it.
   *
   * The Session controller has already installed the picked model on the
   * current Session before calling this hook; only the deployment default is
   * pinned, so a pinner must discard the "make this the default" request rather
   * than rewrite its own Config. The request is still normalized so a malformed
   * payload reports the same class of error the stock service reported.
   *
   * @param {unknown} next Requested default selection.
   * @returns {Promise<void>} Fulfillment after the request is discarded.
   */
  async saveSelection(next) {
    const requested = normalizeSelection(next)
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
    return describeSelection(this.currentSelection())
  }
}

export { ModelPinService }
export default ModelPinService
