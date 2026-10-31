/**
 * dsh-model-pin — browser half.
 *
 * A "模型固定 / Model Pin" page under Settings. It shows and edits the pinned
 * default conversation model for *newly created* Sessions:
 *
 * - `ctx.configForms.get('dsh-model-pin')` is the shared settings form for the
 *   Host Config entry inserted by this package's `cordis.patch.yml`; a single
 *   atomic `mutate` writes `provider` / `model` / optional `reasoningEffort`.
 * - `ctx.remote.session.modelCatalog()` supplies the live provider + model +
 *   reasoning-effort directory, the same one the built-in model picker uses.
 *
 * The page never touches the built-in per-Session picker. It only edits the
 * default that the Host's replacement `agentDefaultModel` service returns for
 * fresh Sessions, so switching models inside a Session keeps working and stops
 * rewriting the default.
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-pin',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-model-pin'
    /**
     * Host Config entry id. Must match the `id` inserted by this package's
     * `cordis.patch.yml`: the settings form is addressed by profile entry id.
     */
    const ENTRY_ID = 'dsh-model-pin'
    /** Slot registration id (unique among `settings.section` contributions). */
    const SLOT_ID = 'model-pin'
    /** Style tag identity, so a hot reload never appends a second copy. */
    const STYLE_ID = 'dsh-model-pin/settings.css'

    //#region copy

    /** Simplified Chinese copy. */
    const zh = {
      'settings.label': '模型固定',
      title: '默认对话模型',
      description:
        '新会话默认使用的模型与供应商。在会话内切换模型仍然有效，但不会改写这里的默认值。',
      current: '当前固定',
      provider: '供应商',
      providerHint: '新会话默认使用的 provider 路由。',
      model: '模型',
      modelHint: '该供应商下的模型 id。',
      effort: '推理强度',
      effortHint: '「跟随模型默认」表示不写入 reasoningEffort，由模型自己决定。',
      effortDefault: '跟随模型默认',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      saveFailed: '保存失败，请重试',
      loadingForm: '正在读取配置…',
      unavailable: '插件配置当前不可用（请确认 dsh-model-pin 已启用）。',
      loading: '正在读取模型目录…',
      catalogFailed: '模型目录读取失败，仍可保存当前值。',
      catalogEmpty: '模型目录为空：请先在「设置 → 模型」里配置供应商与模型。',
      readOnly: '当前 profile 的配置为只读，无法保存。',
      unknownOption: '（不在当前目录中）',
      hint: '新建会话会使用这里的模型；已有会话内的模型选择器仍可正常切换，只影响该会话。',
    }

    /** English copy. */
    const en = {
      'settings.label': 'Model Pin',
      title: 'Default conversation model',
      description:
        'The model and provider new sessions start from. The in-session model picker keeps working, but it no longer rewrites this default.',
      current: 'Currently pinned',
      provider: 'Provider',
      providerHint: 'Provider route used by newly created sessions.',
      model: 'Model',
      modelHint: 'Model id owned by the selected provider.',
      effort: 'Reasoning effort',
      effortHint: '“Model default” omits reasoningEffort and lets the model decide.',
      effortDefault: 'Model default',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'The save was rejected; try again.',
      loadingForm: 'Reading the configuration…',
      unavailable: 'The plugin configuration is unavailable (check that dsh-model-pin is enabled).',
      loading: 'Reading the model directory…',
      catalogFailed: 'The model directory could not be read; the saved value can still be changed.',
      catalogEmpty: 'The model directory is empty. Configure providers and models under Settings → Models first.',
      readOnly: 'This profile stores settings read-only, so the pin cannot be saved.',
      unknownOption: ' (not in the current directory)',
      hint: 'New sessions use this model. The in-session model picker still works and only affects that session.',
    }

    //#endregion

    //#region styles

    /**
     * One stylesheet for the page. Only theme tokens are referenced (plus
     * token fallbacks), so light and dark themes both work; literal colors are
     * reserved for artwork elsewhere.
     */
    const CSS = [
      '.dshmp-section{display:flex;flex-direction:column;width:100%;box-sizing:border-box}',
      '.dshmp-header{padding:0 0 16px}',
      '.dshmp-title{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px}',
      '.dshmp-description{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dshmp-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);padding:4px 16px}',
      '.dshmp-current{display:flex;flex-direction:column;gap:2px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dshmp-currentLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dshmp-currentValue{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px;font-weight:500;overflow-wrap:anywhere}',
      '.dshmp-currentRaw{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;overflow-wrap:anywhere}',
      '.dshmp-row{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dshmp-row:last-of-type{border-bottom:none}',
      '.dshmp-field{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dshmp-label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dshmp-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dshmp-select{box-sizing:border-box;min-width:220px;max-width:320px;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:18px}',
      '.dshmp-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dshmp-select:disabled{color:var(--dsw-alias-state-idle-primary)}',
      '.dshmp-actions{display:flex;align-items:center;gap:12px;padding:16px 0 12px}',
      '.dshmp-save{cursor:pointer;padding:7px 16px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-family:inherit;font-size:13px;font-weight:500;line-height:18px}',
      '.dshmp-save:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}',
      '.dshmp-save:disabled{cursor:default;color:var(--dsw-alias-state-idle-primary)}',
      '.dshmp-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dshmp-status{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshmp-status[data-state="saved"]{color:var(--dsw-alias-state-success-primary)}',
      '.dshmp-status[data-state="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.dshmp-note{margin:12px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
    ].join('\n')

    /** Append the stylesheet once; a remount or hot reload keeps one copy. */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin="dsh-model-pin"]') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-model-pin'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    //#endregion

    //#region selection helpers

    /**
     * Trim one selection field without throwing.
     *
     * @param {unknown} value Raw field value.
     * @returns {string} Trimmed text, or an empty string when unset.
     */
    function fieldText(value) {
      return typeof value === 'string' ? value.trim() : ''
    }

    /**
     * Compare a draft selection with a stored one, tolerating a missing effort.
     *
     * @param {object|null|undefined} left First selection.
     * @param {object|null|undefined} right Second selection.
     * @returns {boolean} Whether both carry the same provider, model and effort.
     */
    function sameSelection(left, right) {
      if (!left || !right) return false
      return (
        fieldText(left.provider) === fieldText(right.provider) &&
        fieldText(left.model) === fieldText(right.model) &&
        fieldText(left.reasoningEffort) === fieldText(right.reasoningEffort)
      )
    }

    /**
     * Copy a stored selection into a fresh draft object.
     *
     * @param {object} selection Host Config value.
     * @returns {{provider: string, model: string, reasoningEffort: string|undefined}} Draft.
     */
    function toDraft(selection) {
      const draft = {
        provider: fieldText(selection.provider),
        model: fieldText(selection.model),
      }
      const effort = fieldText(selection.reasoningEffort)
      if (effort !== '') draft.reasoningEffort = effort
      return draft
    }

    /**
     * Look up the provider group and model entry for one selection.
     *
     * @param {Array} groups Catalog groups.
     * @param {object|null|undefined} selection Selection to resolve.
     * @returns {{group: object|undefined, model: object|undefined}} Matches, when present.
     */
    function resolveSelection(groups, selection) {
      const list = Array.isArray(groups) ? groups : []
      const providerId = fieldText(selection && selection.provider)
      const group = list.find((candidate) => candidate.id === providerId)
      const model = group && Array.isArray(group.models)
        ? group.models.find((candidate) => candidate.id === fieldText(selection && selection.model))
        : undefined
      return { group, model }
    }

    /**
     * Advertised reasoning efforts for one model entry.
     *
     * @param {object|undefined} model Catalog model entry.
     * @returns {Array<{id: string, name: string}>} Advertised efforts, empty when none.
     */
    function effortsFor(model) {
      const efforts = model && model.reasoning && model.reasoning.efforts
      return Array.isArray(efforts) ? efforts : []
    }

    /**
     * Human-readable names for one selection, with raw ids as the fallback.
     *
     * @param {Array} groups Catalog groups.
     * @param {object} selection Selection (host value, draft, or catalog default).
     * @returns {{title: string, raw: string}} Display strings.
     */
    function describeSelection(groups, selection) {
      const { group, model } = resolveSelection(groups, selection)
      const providerName = (group && group.name) || fieldText(selection.provider)
      const modelName = (model && model.name) || fieldText(selection.model)
      const effortId = fieldText(selection.reasoningEffort)
      const effort = effortId === ''
        ? undefined
        : effortsFor(model).find((candidate) => candidate.id === effortId)
      const effortName = effort ? effort.name : effortId
      return {
        title: effortId === '' ? `${providerName} / ${modelName}` : `${providerName} / ${modelName} · ${effortName}`,
        raw:
          effortId === ''
            ? `${fieldText(selection.provider)}/${fieldText(selection.model)}`
            : `${fieldText(selection.provider)}/${fieldText(selection.model)} · ${effortId}`,
      }
    }

    /**
     * Coerce the Remote catalog answer into a compact local view.
     *
     * @param {object} response `session.modelCatalog` Remote result.
     * @returns {{groups: Array, default: object|undefined}} Catalog view.
     */
    function catalogView(response) {
      const value = response && response.value
      return {
        groups: value && Array.isArray(value.groups) ? value.groups : [],
        default: value && value.default ? value.default : undefined,
      }
    }

    //#endregion

    //#region component

    /**
     * Build the Settings page component for one form and locale reader.
     *
     * The component owns only presentation state: the accepted Host value comes
     * from the shared form snapshot, the provider/model directory from the
     * Remote catalog, and the draft from local edits.
     *
     * @param {object} ctx Client plugin context.
     * @param {object} form Shared settings form for {@link ENTRY_ID}.
     * @param {(key: string) => string} t Localized copy reader.
     * @returns {Function} React component for the `settings.section` slot.
     */
    function createSectionComponent(ctx, form, t) {
      return function ModelPinSection() {
        const [snapshot, setSnapshot] = useState(() => form.getSnapshot())
        const [catalog, setCatalog] = useState({ status: 'loading', groups: [], error: null })
        const [draft, setDraft] = useState(null)
        const [saving, setSaving] = useState(false)
        const [status, setStatus] = useState(null)
        const mounted = useRef(true)

        useEffect(() => {
          mounted.current = true
          return () => {
            mounted.current = false
          }
        }, [])

        // Accepted Host value + revision updates.
        useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), [form])

        // Live model directory, refreshed when the LLM topology or the
        // connection changes; a stale answer never overwrites a newer one.
        const refreshCatalog = useCallback(() => {
          let cancelled = false
          ctx.remote.session
            .modelCatalog()
            .then((response) => {
              if (!response || !response.ok) {
                const failure = response && response.error
                throw new Error(failure ? `${failure.code}: ${failure.message}` : 'model catalog request failed')
              }
              if (cancelled) return
              setCatalog({ status: 'ready', ...catalogView(response), error: null })
            })
            .catch((error) => {
              if (cancelled) return
              setCatalog((current) => ({
                status: 'error',
                groups: current.groups,
                error: error instanceof Error ? error.message : String(error),
              }))
            })
          return () => {
            cancelled = true
          }
        }, [ctx])

        useEffect(() => {
          let cancel = refreshCatalog()
          const disposers = []
          const listen = (register) => {
            try {
              const dispose = register()
              if (typeof dispose === 'function') disposers.push(dispose)
            } catch {
              // A missing forwarded event channel must not break the page.
            }
          }
          listen(() => ctx.remote.$on('llm/adapters-updated', () => {
            cancel()
            cancel = refreshCatalog()
          }))
          listen(() => ctx.on('connection/reset', () => {
            cancel()
            cancel = refreshCatalog()
          }))
          return () => {
            cancel()
            for (const dispose of disposers) {
              try {
                dispose()
              } catch {
                // Ignore a listener that already unloaded with its owner.
              }
            }
          }
        }, [ctx, refreshCatalog])

        const ready = snapshot && snapshot.status === 'ready' && snapshot.value !== undefined
        const pinned = ready ? snapshot.value : undefined

        // Adopt the accepted Host value on first load and after every commit
        // (the revision changes when this page, another tab or the profile
        // patch writes the entry). Unsaved local edits survive until then.
        const revision = ready ? snapshot.revision : null
        useEffect(() => {
          if (!ready) return
          setDraft(toDraft(snapshot.value))
        }, [revision, ready])

        const groups = catalog.groups
        const { model: selectedModel } = resolveSelection(groups, draft)
        const efforts = effortsFor(selectedModel)
        const summary = pinned ? describeSelection(groups, pinned) : undefined

        const dirty = Boolean(draft) && Boolean(pinned) ? !sameSelection(draft, pinned) : false
        const writable = Boolean(snapshot && snapshot.writable)
        const canSave =
          ready && writable && !saving && dirty && fieldText(draft && draft.provider) !== '' && fieldText(draft && draft.model) !== ''

        const chooseProvider = useCallback((providerId) => {
          setStatus(null)
          setDraft((current) => {
            if (!current) return current
            const group = groups.find((candidate) => candidate.id === providerId)
            const available = group && Array.isArray(group.models) ? group.models : []
            const keepModel = available.some((candidate) => candidate.id === current.model)
            const nextModel = keepModel ? current.model : available[0] ? available[0].id : current.model
            const nextModelEntry = available.find((candidate) => candidate.id === nextModel)
            const advertised = effortsFor(nextModelEntry)
            const keepEffort =
              current.reasoningEffort !== undefined &&
              advertised.some((candidate) => candidate.id === current.reasoningEffort)
            return {
              provider: providerId,
              model: nextModel,
              ...(keepEffort ? { reasoningEffort: current.reasoningEffort } : {}),
            }
          })
        }, [groups])

        const chooseModel = useCallback((modelId) => {
          setStatus(null)
          setDraft((current) => {
            if (!current) return current
            const group = groups.find((candidate) => candidate.id === current.provider)
            const entry = group && Array.isArray(group.models)
              ? group.models.find((candidate) => candidate.id === modelId)
              : undefined
            const advertised = effortsFor(entry)
            const keepEffort =
              current.reasoningEffort !== undefined &&
              advertised.some((candidate) => candidate.id === current.reasoningEffort)
            return {
              provider: current.provider,
              model: modelId,
              ...(keepEffort ? { reasoningEffort: current.reasoningEffort } : {}),
            }
          })
        }, [groups])

        const chooseEffort = useCallback((effortId) => {
          setStatus(null)
          setDraft((current) => {
            if (!current) return current
            return {
              provider: current.provider,
              model: current.model,
              ...(effortId === '' ? {} : { reasoningEffort: effortId }),
            }
          })
        }, [])

        const save = useCallback(async () => {
          if (!draft || saving) return
          setSaving(true)
          setStatus(null)
          // A blank reasoning effort means "follow the model's own default".
          // It is written as an explicit empty string rather than `unset`:
          // `unset` would restore the value inherited from the plugin's bundle
          // patch (the seeded `max`), while a blank override stays blank and
          // the Host service omits the field from `currentSelection()`.
          const ops = [
            { op: 'set', path: ['provider'], value: fieldText(draft.provider) },
            { op: 'set', path: ['model'], value: fieldText(draft.model) },
            { op: 'set', path: ['reasoningEffort'], value: fieldText(draft.reasoningEffort) },
          ]
          try {
            const accepted = await form.mutate(ops)
            if (!mounted.current) return
            setStatus(accepted ? 'saved' : 'saveFailed')
          } catch {
            if (!mounted.current) return
            setStatus('saveFailed')
          } finally {
            if (mounted.current) setSaving(false)
          }
        }, [draft, form, saving])

        const providerOptions = useMemo(() => {
          const options = groups.map((group) => h('option', { key: group.id, value: group.id }, group.name || group.id))
          const providerId = fieldText(draft && draft.provider)
          if (providerId !== '' && !groups.some((group) => group.id === providerId)) {
            options.unshift(h('option', { key: `unknown-${providerId}`, value: providerId }, `${providerId}${t('unknownOption')}`))
          }
          return options
        }, [groups, draft && draft.provider, t])

        const modelOptions = useMemo(() => {
          const group = groups.find((candidate) => candidate.id === fieldText(draft && draft.provider))
          const available = group && Array.isArray(group.models) ? group.models : []
          const options = available.map((model) => h('option', { key: model.id, value: model.id }, model.name || model.id))
          const modelId = fieldText(draft && draft.model)
          if (modelId !== '' && !available.some((model) => model.id === modelId)) {
            options.unshift(h('option', { key: `unknown-${modelId}`, value: modelId }, `${modelId}${t('unknownOption')}`))
          }
          return options
        }, [groups, draft && draft.provider, draft && draft.model, selectedModel, t])

        const effortOptions = useMemo(() => {
          const options = [h('option', { key: 'model-default', value: '' }, t('effortDefault'))]
          for (const effort of efforts) options.push(h('option', { key: effort.id, value: effort.id }, effort.name || effort.id))
          const effortId = fieldText(draft && draft.reasoningEffort)
          if (effortId !== '' && !efforts.some((effort) => effort.id === effortId)) {
            options.push(h('option', { key: `unknown-${effortId}`, value: effortId }, `${effortId}${t('unknownOption')}`))
          }
          return options
        }, [efforts, draft && draft.reasoningEffort, t])

        const catalogEmpty = catalog.status === 'ready' && groups.length === 0

        if (!ready) {
          const copy = snapshot && snapshot.status === 'unavailable' ? t('unavailable') : t('loadingForm')
          return h(
            'div',
            { className: 'dshmp-section' },
            h('header', { className: 'dshmp-header' },
              h('h2', { className: 'dshmp-title' }, t('title')),
              h('p', { className: 'dshmp-description' }, t('description'))),
            h('p', { className: 'dshmp-status' }, copy),
          )
        }

        return h(
          'div',
          { className: 'dshmp-section' },
          h('header', { className: 'dshmp-header' },
            h('h2', { className: 'dshmp-title' }, t('title')),
            h('p', { className: 'dshmp-description' }, t('description'))),
          h(
            'section',
            { className: 'dshmp-card', 'aria-label': t('current') },
            h(
              'div',
              { className: 'dshmp-current' },
              h('span', { className: 'dshmp-currentLabel' }, t('current')),
              h('span', { className: 'dshmp-currentValue' }, summary ? summary.title : '—'),
              summary ? h('span', { className: 'dshmp-currentRaw' }, summary.raw) : null,
            ),
            h(
              'div',
              { className: 'dshmp-row' },
              h(
                'div',
                { className: 'dshmp-field' },
                h('label', { className: 'dshmp-label', htmlFor: 'dshmp-provider' }, t('provider')),
                h('p', { className: 'dshmp-hint' }, t('providerHint')),
              ),
              h(
                'select',
                {
                  id: 'dshmp-provider',
                  className: 'dshmp-select',
                  value: fieldText(draft && draft.provider),
                  disabled: !writable || saving,
                  onChange: (event) => chooseProvider(event.target.value),
                },
                providerOptions,
              ),
            ),
            h(
              'div',
              { className: 'dshmp-row' },
              h(
                'div',
                { className: 'dshmp-field' },
                h('label', { className: 'dshmp-label', htmlFor: 'dshmp-model' }, t('model')),
                h('p', { className: 'dshmp-hint' }, t('modelHint')),
              ),
              h(
                'select',
                {
                  id: 'dshmp-model',
                  className: 'dshmp-select',
                  value: fieldText(draft && draft.model),
                  disabled: !writable || saving || modelOptions.length === 0,
                  onChange: (event) => chooseModel(event.target.value),
                },
                modelOptions,
              ),
            ),
            efforts.length > 0
              ? h(
                  'div',
                  { className: 'dshmp-row' },
                  h(
                    'div',
                    { className: 'dshmp-field' },
                    h('label', { className: 'dshmp-label', htmlFor: 'dshmp-effort' }, t('effort')),
                    h('p', { className: 'dshmp-hint' }, t('effortHint')),
                  ),
                  h(
                    'select',
                    {
                      id: 'dshmp-effort',
                      className: 'dshmp-select',
                      value: fieldText(draft && draft.reasoningEffort),
                      disabled: !writable || saving,
                      onChange: (event) => chooseEffort(event.target.value),
                    },
                    effortOptions,
                  ),
                )
              : null,
            h(
              'div',
              { className: 'dshmp-actions' },
              h(
                'button',
                { type: 'button', className: 'dshmp-save', onClick: save, disabled: !canSave },
                saving ? t('saving') : t('save'),
              ),
              status
                ? h(
                    'p',
                    { className: 'dshmp-status', 'data-state': status === 'saved' ? 'saved' : 'error', 'aria-live': 'polite' },
                    t(status),
                  )
                : null,
            ),
          ),
          catalog.status === 'loading' ? h('p', { className: 'dshmp-note' }, t('loading')) : null,
          catalog.status === 'error' ? h('p', { className: 'dshmp-status', 'data-state': 'error' }, t('catalogFailed')) : null,
          catalogEmpty ? h('p', { className: 'dshmp-note' }, t('catalogEmpty')) : null,
          !writable ? h('p', { className: 'dshmp-status', 'data-state': 'error' }, t('readOnly')) : null,
          h('p', { className: 'dshmp-note' }, t('hint')),
        )
      }
    }

    //#endregion

    //#region plugin

    /**
     * Register the Model Pin settings page.
     *
     * @param {object} ctx Client plugin context.
     */
    function apply(ctx) {
      ensureStyle()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-model-pin: copy dictionaries')
      const t = ctx.locale.bind(NS)
      const form = ctx.configForms.get(ENTRY_ID)
      const ModelPinSection = createSectionComponent(ctx, form, t)
      ctx.effect(() =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: SLOT_ID,
              order: 20,
              label: () => t('settings.label'),
            },
            ModelPinSection,
          ),
        ), 'dsh-model-pin: settings page')
    }

    /** Services required before the page can mount. */
    const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
