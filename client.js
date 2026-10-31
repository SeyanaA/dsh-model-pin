/**
 * dsh-model-pin — browser half.
 *
 * Three surfaces:
 *
 * - `settings.section` — a "模型固定 / Model Pin" page under Settings. It shows
 *   and edits the pinned default conversation model for *newly created*
 *   Sessions, plus a "模型检索周期 / Model check interval" card that drives the
 *   Host's periodic model-discovery check.
 * - `settings.models.footer` — a compact reminder on the official Models page
 *   while newly discovered models are pending (newer models only appear after
 *   the user fetches them there by hand).
 * - `sidebar.footer.action` — a small bell with the pending count beside
 *   Settings; clicking it navigates to the official Models page.
 *
 * The Model Pin page never touches the built-in per-Session picker. It only
 * edits the default that the Host's replacement `agentDefaultModel` service
 * returns for fresh Sessions, so switching models inside a Session keeps
 * working and stops rewriting the default.
 *
 * The Host side owns the check itself and exposes it over same-origin HTTP
 * routes (`/api/dsh-model-pin/{status,check,dismiss}`). This module keeps one
 * shared status store for all surfaces. Every request degrades to a locally
 * "unavailable" state: a browser bundle can hot-reload ahead of the Host, and
 * the UI must stay quiet (no error banner, no reminder) until DSH restarts.
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
      notConfigured: '尚未固定：请在下面选择供应商与模型并保存。',
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
      formStale: '配置读取超时：请重启 DSH，或检查 profile 的 cordis.patch.yml 里 dsh-model-pin 行。',
      unavailable: '插件配置当前不可用（请确认 dsh-model-pin 已启用）。',
      loading: '正在读取模型目录…',
      catalogFailed: '模型目录读取失败，仍可保存当前值。',
      catalogEmpty: '模型目录为空：请先在「设置 → 模型」里配置供应商与模型。',
      readOnly: '当前 profile 的配置为只读，无法保存。',
      unknownOption: '（不在当前目录中）',
      hint: '新建会话会使用这里的模型；已有会话内的模型选择器仍可正常切换，只影响该会话。',
      // ---- periodic model discovery -------------------------------------
      'interval.title': '模型检索周期',
      'interval.label': '检索周期',
      'interval.hint': '定期检查官方模型目录，发现新模型时提醒你手动抓取。',
      'interval.disclaimer':
        '只做提醒，不会改动你的模型配置；到官方「设置 → 模型」手动抓取后点「清除提醒」。',
      'interval.1d': '1天',
      'interval.3d': '3天',
      'interval.7d': '7天',
      'interval.14d': '14天',
      'interval.30d': '30天',
      'interval.manual': '手动',
      lastCheck: '上次检查',
      nextCheck: '下次自动检查',
      checking: '正在检查…',
      lastResult: '检查结果',
      never: '从未',
      manualMode: '手动模式',
      notChecked: '尚未检查。',
      noPending: '未发现新模型。',
      resultCounts: '共 {current} 个，新增 {added} 个',
      resultError: '读取失败',
      pendingTitle: '发现的新模型',
      checkNow: '立即检查',
      checkAgain: '立即再次检查',
      goModels: '前往 设置 → 模型',
      dismiss: '清除提醒',
      jumpFailed: '请手动打开 设置 → 模型',
      serviceUnavailable: '模型检索服务尚未就绪：请重启 DeepSeek Harness 以加载新版本插件。',
      loadingStatus: '正在读取检索状态…',
      modelsFooterTitle: '模型固定：发现 {count} 个新模型',
      modelsFooterHint: '只做提醒，不会改动模型配置。请到「设置 → 模型」手动抓取新模型，然后清除提醒。',
      sidebarReminder: '发现 {count} 个新模型，点击前往 设置 → 模型 手动抓取',
      listSeparator: '、',
    }

    /** English copy. */
    const en = {
      'settings.label': 'Model Pin',
      title: 'Default conversation model',
      description:
        'The model and provider new sessions start from. The in-session model picker keeps working, but it no longer rewrites this default.',
      current: 'Currently pinned',
      notConfigured: 'Not pinned yet — choose a provider and model below and save.',
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
      formStale: 'Reading the configuration timed out. Restart DSH, or check the dsh-model-pin row in the profile cordis.patch.yml.',
      unavailable: 'The plugin configuration is unavailable (check that dsh-model-pin is enabled).',
      loading: 'Reading the model directory…',
      catalogFailed: 'The model directory could not be read; the saved value can still be changed.',
      catalogEmpty: 'The model directory is empty. Configure providers and models under Settings → Models first.',
      readOnly: 'This profile stores settings read-only, so the pin cannot be saved.',
      unknownOption: ' (not in the current directory)',
      hint: 'New sessions use this model. The in-session model picker still works and only affects that session.',
      // ---- periodic model discovery -------------------------------------
      'interval.title': 'Model check interval',
      'interval.label': 'Check interval',
      'interval.hint': 'Periodically checks the official model directory and reminds you when new models appear.',
      'interval.disclaimer':
        'This only reminds you; it never changes your model configuration. Fetch the new models under Settings → Models yourself, then dismiss the reminder.',
      'interval.1d': '1 day',
      'interval.3d': '3 days',
      'interval.7d': '7 days',
      'interval.14d': '14 days',
      'interval.30d': '30 days',
      'interval.manual': 'Manual',
      lastCheck: 'Last check',
      nextCheck: 'Next automatic check',
      checking: 'Checking…',
      lastResult: 'Last result',
      never: 'Never',
      manualMode: 'Manual mode',
      notChecked: 'Not checked yet.',
      noPending: 'No new models found.',
      resultCounts: '{current} total, {added} new',
      resultError: 'read failed',
      pendingTitle: 'New models found',
      checkNow: 'Check now',
      checkAgain: 'Check again now',
      goModels: 'Go to Settings → Models',
      dismiss: 'Dismiss reminder',
      jumpFailed: 'Please open Settings → Models manually',
      serviceUnavailable: 'The model-check service is not ready yet. Restart DeepSeek Harness to load the new plugin version.',
      loadingStatus: 'Reading the model-check status…',
      modelsFooterTitle: 'Model Pin: {count} new models found',
      modelsFooterHint: 'This only reminds you; it never changes your model configuration. Fetch the new models under Settings → Models, then dismiss the reminder.',
      sidebarReminder: '{count} new models found — click to open Settings → Models and fetch them manually',
      listSeparator: ', ',
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
      '.dshmp-status[data-state="muted"]{color:var(--dsw-alias-label-tertiary)}',
      '.dshmp-status[data-state="checking"]{color:var(--dsw-alias-brand-primary)}',
      '.dshmp-note{margin:12px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      // ---- periodic model discovery card ------------------------------------
      '.dshmp-checkCard{margin-top:12px}',
      '.dshmp-checkHead{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px 24px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dshmp-cardTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}',
      '.dshmp-meta{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 16px;margin:0;padding:10px 0 2px;font-size:12px;line-height:18px}',
      '.dshmp-metaKey{color:var(--dsw-alias-label-tertiary)}',
      '.dshmp-metaValue{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.dshmp-pending{padding:10px 0 2px;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.dshmp-pendingTitle{margin:0 0 4px;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:18px}',
      '.dshmp-pendingList{margin:0;padding:0 0 0 16px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}',
      '.dshmp-button{cursor:pointer;padding:7px 16px;border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;font-weight:500;line-height:18px}',
      '.dshmp-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshmp-button:disabled{cursor:default;color:var(--dsw-alias-state-idle-primary)}',
      '.dshmp-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      // ---- official Models page notice --------------------------------------
      '.dshmp-notice{display:flex;flex-direction:column;gap:8px;margin:12px 0 0;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}',
      '.dshmp-noticeHead{display:flex;align-items:flex-start;gap:10px;min-width:0}',
      '.dshmp-noticeIcon{display:inline-flex;flex:none;color:var(--dsw-alias-brand-primary)}',
      '.dshmp-noticeTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}',
      '.dshmp-notice .dshmp-actions{padding:0}',
      // ---- sidebar reminder bell --------------------------------------------
      '.dshmp-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:.5px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dshmp-bell:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshmp-bell:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dshmp-badge{position:absolute;top:-2px;right:-2px;min-width:14px;height:14px;padding:0 3px;border-radius:999px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted);font-size:9px;font-weight:600;line-height:14px;text-align:center}',
    ].join('\n')

    /** Append the stylesheet once; a remount or client HMR refreshes its text. */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      let tag = document.querySelector('style[data-plugin="dsh-model-pin"]')
      if (tag === null) {
        tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-model-pin'
        tag.dataset.pluginCss = STYLE_ID
        document.head.appendChild(tag)
      }
      // Rewrite the text on every activation so a hot-reloaded module never
      // keeps stale rules from the previous generation.
      if (tag.textContent !== CSS) tag.textContent = CSS
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

    //#region model-check status store

    /** Host routes for the periodic model discovery check. */
    const MODEL_CHECK = {
      status: '/api/dsh-model-pin/status',
      check: '/api/dsh-model-pin/check',
      dismiss: '/api/dsh-model-pin/dismiss',
    }

    /** Re-read the Host status at this cadence while the client is mounted. */
    const STATUS_REFRESH_MS = 60000

    /** Accepted values for the `modelCheckInterval` Config field, in UI order. */
    const INTERVAL_IDS = ['1d', '3d', '7d', '14d', '30d', 'manual']

    /** Seeded fallback when the Host form has no `modelCheckInterval` field. */
    const DEFAULT_INTERVAL = '7d'

    /**
     * Turn a thrown value into a message that is only ever written to the
     * debug console. The UI shows a neutral "service not ready yet" line: the
     * browser bundle can hot-reload before the Host, so a `404` here just means
     * "restart DSH to load the new plugin version".
     *
     * @param {unknown} error Thrown value.
     * @returns {string} Short diagnostic message.
     */
    function modelCheckErrorMessage(error) {
      if (error instanceof Error) return error.message
      return String(error)
    }

    /**
     * Log a failed model-check request at debug level only.
     *
     * @param {unknown} error Thrown value.
     */
    function debugModelCheck(error) {
      try {
        console.debug('[dsh-model-pin] model check request unavailable:', modelCheckErrorMessage(error))
      } catch {
        // A missing console must never break a request path.
      }
    }

    /**
     * One same-origin JSON request against a model-check route.
     *
     * @param {string} url Host route.
     * @param {'GET'|'POST'} method Request method.
     * @returns {Promise<object>} The `value` of a `{ok:true, value}` envelope.
     */
    async function requestModelCheck(url, method) {
      const headers = { accept: 'application/json', 'x-dsh-model-pin-client': '1' }
      if (method !== 'GET') headers['content-type'] = 'application/json'
      const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        body: method === 'GET' ? undefined : JSON.stringify({}),
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || typeof payload !== 'object' || payload.ok !== true) {
        throw new Error(`HTTP ${response.status}`)
      }
      const value = payload.value
      return value !== null && typeof value === 'object' ? value : {}
    }

    /**
     * One shared model-check state for every surface.
     *
     * `value` is the last accepted `{ok:true, value}` payload, or `null` while
     * it is unknown. `unavailable` means the Host route answered badly (most
     * often an older Host module without the routes); every reminder surface
     * hides in that state and the settings card explains how to recover.
     */
    const checkStore = {
      state: { value: null, unavailable: false, error: null, busy: null },
      listeners: new Set(),
    }

    /**
     * Publish one partial state update to every mounted surface.
     *
     * @param {object} patch Fields to merge into the current state.
     */
    function publishCheckState(patch) {
      checkStore.state = { ...checkStore.state, ...patch }
      for (const listener of [...checkStore.listeners]) {
        try {
          listener()
        } catch {
          // A listener that is unmounting must not break the other surfaces.
        }
      }
    }

    /**
     * Subscribe a surface to the shared model-check state.
     *
     * @param {() => void} listener Change callback.
     * @returns {() => void} Unsubscribe.
     */
    function subscribeCheckState(listener) {
      checkStore.listeners.add(listener)
      return () => {
        checkStore.listeners.delete(listener)
      }
    }

    /** In-flight status read, shared so a burst of mounts only fetches once. */
    let modelCheckInflight = null

    /**
     * Read the Host model-check status once.
     *
     * Never rejects: a failed route marks the shared state unavailable so all
     * surfaces can render quietly.
     *
     * @returns {Promise<boolean>} Whether the read succeeded.
     */
    function refreshModelCheck() {
      if (modelCheckInflight !== null) return modelCheckInflight
      modelCheckInflight = requestModelCheck(MODEL_CHECK.status, 'GET')
        .then((value) => {
          publishCheckState({ value, unavailable: false, error: null })
          return true
        })
        .catch((error) => {
          debugModelCheck(error)
          publishCheckState({ value: null, unavailable: true, error: modelCheckErrorMessage(error) })
          return false
        })
        .finally(() => {
          modelCheckInflight = null
        })
      return modelCheckInflight
    }

    /**
     * Run one state-changing model-check action (`check` or `dismiss`).
     *
     * The Host answers with the same envelope as the status route, so the
     * answer is published directly and then refreshed once for good measure.
     *
     * @param {'check'|'dismiss'} action Which route to post.
     * @returns {Promise<boolean>} Whether the action succeeded.
     */
    async function runModelCheckAction(action) {
      const url = action === 'dismiss' ? MODEL_CHECK.dismiss : MODEL_CHECK.check
      publishCheckState({ busy: action })
      try {
        const value = await requestModelCheck(url, 'POST')
        publishCheckState({ value, unavailable: false, error: null, busy: null })
        void refreshModelCheck()
        return true
      } catch (error) {
        debugModelCheck(error)
        publishCheckState({
          value: null,
          unavailable: true,
          error: modelCheckErrorMessage(error),
          busy: null,
        })
        return false
      }
    }

    /**
     * Hook: the shared model-check state, re-rendering the surface on change.
     *
     * @returns {{value: object|null, unavailable: boolean, error: string|null, busy: string|null}} State.
     */
    function useModelCheckState() {
      const [state, setState] = useState(() => checkStore.state)
      useEffect(() => {
        const sync = () => setState(checkStore.state)
        const unsubscribe = subscribeCheckState(sync)
        sync()
        return unsubscribe
      }, [])
      return state
    }

    //#endregion

    //#region model-check view helpers

    /**
     * Pick a finite number out of an untrusted payload.
     *
     * @param {unknown} value Raw field.
     * @returns {number|null} The number, or null.
     */
    function finiteNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }

    /**
     * Pick a trimmed string out of an untrusted payload.
     *
     * @param {unknown} value Raw field.
     * @returns {string} Trimmed text, or an empty string.
     */
    function plainText(value) {
      return typeof value === 'string' ? value.trim() : ''
    }

    /**
     * Localized date + time for one Host timestamp.
     *
     * @param {unknown} value Epoch milliseconds.
     * @returns {string|null} Formatted timestamp, or null when unset.
     */
    function formatMoment(value) {
      const stamp = finiteNumber(value)
      if (stamp === null || stamp <= 0) return null
      try {
        const date = new Date(stamp)
        if (Number.isNaN(date.getTime())) return null
        return date.toLocaleString(undefined, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch {
        return null
      }
    }

    /**
     * Normalize `pending` into a renderable view.
     *
     * @param {object|null|undefined} value Accepted status payload.
     * @returns {{total: number, providers: Array<{providerName: string, models: Array<{id: string, name: string}>}>}} Pending view.
     */
    function pendingModels(value) {
      const pending = value !== null && typeof value === 'object' ? value.pending : null
      const list = pending !== null && typeof pending === 'object' && Array.isArray(pending.providers)
        ? pending.providers
        : []
      const providers = []
      let derived = 0
      for (const entry of list) {
        if (entry === null || typeof entry !== 'object') continue
        const added = Array.isArray(entry.added) ? entry.added : []
        const models = []
        for (const model of added) {
          if (model === null || typeof model !== 'object') continue
          const id = plainText(model.id)
          const name = plainText(model.name) || id
          if (id === '' && name === '') continue
          models.push({ id: id === '' ? name : id, name })
        }
        if (models.length === 0) continue
        derived += models.length
        providers.push({ providerName: plainText(entry.providerName) || plainText(entry.provider) || '—', models })
      }
      const declared = pending !== null && typeof pending === 'object' ? finiteNumber(pending.total) : null
      return {
        total: declared !== null && declared > 0 ? Math.floor(declared) : derived,
        providers,
      }
    }

    /**
     * Normalize `results` into a renderable view.
     *
     * @param {object|null|undefined} value Accepted status payload.
     * @returns {Array<{providerName: string, currentCount: number|null, addedCount: number|null, error: string}>} Result rows.
     */
    function lastCheckResults(value) {
      const raw = value !== null && typeof value === 'object' && Array.isArray(value.results) ? value.results : []
      const results = []
      for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') continue
        results.push({
          providerName: plainText(entry.providerName) || plainText(entry.provider) || '—',
          currentCount: finiteNumber(entry.currentCount),
          addedCount: finiteNumber(entry.addedCount),
          error: plainText(entry.error),
        })
      }
      return results
    }

    /**
     * One model list as `Name (id), Name (id)`.
     *
     * @param {Array<{id: string, name: string}>} models Models to print.
     * @param {string} separator Locale-aware list separator.
     * @returns {string} Human-readable list.
     */
    function modelListText(models, separator) {
      return models
        .map((model) => (model.name === model.id ? model.name : `${model.name} (${model.id})`))
        .join(separator)
    }

    /**
     * The accepted `modelCheckInterval` from a configForms snapshot.
     *
     * @param {object|null|undefined} snapshot Shared form snapshot.
     * @returns {string} One of {@link INTERVAL_IDS}.
     */
    function configuredInterval(snapshot) {
      const value = snapshot !== null && typeof snapshot === 'object' ? snapshot.value : undefined
      const interval = value !== null && typeof value === 'object' ? value.modelCheckInterval : undefined
      return typeof interval === 'string' && INTERVAL_IDS.includes(interval) ? interval : DEFAULT_INTERVAL
    }

    //#endregion

    //#region official settings jump

    /** Outcome of the last best-effort jump, shared by the reminder surfaces. */
    const jumpStore = { result: null, listeners: new Set() }

    /**
     * Publish the outcome of the last jump attempt.
     *
     * @param {'opened'|'failed'} result Jump outcome.
     */
    function publishJumpResult(result) {
      jumpStore.result = result
      for (const listener of [...jumpStore.listeners]) {
        try {
          listener()
        } catch {
          // One unmounting listener must not break the others.
        }
      }
    }

    /**
     * Hook: the last jump outcome, so a failed jump can fall back to manual
     * instructions.
     *
     * @returns {'opened'|'failed'|null} Last outcome.
     */
    function useJumpResult() {
      const [result, setResult] = useState(() => jumpStore.result)
      useEffect(() => {
        const sync = () => setResult(jumpStore.result)
        jumpStore.listeners.add(sync)
        sync()
        return () => {
          jumpStore.listeners.delete(sync)
        }
      }, [])
      return result
    }

    /** @param {number} milliseconds Delay to wait. @returns {Promise<void>} */
    function wait(milliseconds) {
      return new Promise((resolve) => {
        setTimeout(resolve, milliseconds)
      })
    }

    /**
     * Resolve after two animation frames, so a just-opened dialog has mounted.
     *
     * @returns {Promise<void>} Fulfillment after the paint.
     */
    function afterPaint() {
      const raf = typeof requestAnimationFrame === 'function'
        ? (callback) => requestAnimationFrame(callback)
        : (callback) => setTimeout(callback, 16)
      return new Promise((resolve) => {
        raf(() => raf(() => resolve()))
      })
    }

    /**
     * Labels the official Models settings nav row may carry.
     *
     * The official namespace is exactly `settings.models` with key `nav`
     * (`模型` / `Models`); the literals are a safety net for a missing or
     * not-yet-loaded official dictionary.
     *
     * @param {object} ctx Client plugin context.
     * @returns {string[]} Candidate labels, no duplicates.
     */
    function modelsNavLabels(ctx) {
      const labels = []
      try {
        const translate = ctx.locale.bind('settings.models')
        const label = typeof translate === 'function' ? translate('nav') : ''
        if (typeof label === 'string' && label !== '' && label !== 'nav') labels.push(label.trim())
      } catch {
        // The official namespace may not be registered yet.
      }
      labels.push('模型', 'Models')
      return [...new Set(labels.filter((label) => label !== ''))]
    }

    /**
     * Labels the official settings trigger may carry (`设置` / `Settings`).
     *
     * @param {object} ctx Client plugin context.
     * @returns {string[]} Candidate labels, no duplicates.
     */
    function settingsTriggerLabels(ctx) {
      const labels = []
      try {
        const translate = ctx.locale.bind('settings')
        const label = typeof translate === 'function' ? translate('trigger') : ''
        if (typeof label === 'string' && label !== '' && label !== 'trigger') labels.push(label.trim())
      } catch {
        // The settings shell namespace may not be registered yet.
      }
      labels.push('设置', 'Settings')
      return [...new Set(labels.filter((label) => label !== ''))]
    }

    /**
     * Find the official settings trigger button.
     *
     * The literal selector matches several unrelated `aria-haspopup="dialog"`
     * buttons (chat usage pills, for example), so the trigger is identified by
     * its localized aria-label or its `aria-keyshortcuts` binding first.
     *
     * @param {object} ctx Client plugin context.
     * @returns {Element|null} Trigger button, when mounted.
     */
    function findSettingsTrigger(ctx) {
      if (typeof document === 'undefined') return null
      const candidates = Array.from(
        document.querySelectorAll('button[aria-haspopup="dialog"][aria-expanded]'),
      )
      if (candidates.length === 0) return null
      const labels = settingsTriggerLabels(ctx)
      const byLabel = candidates.find((button) => {
        const aria = (button.getAttribute('aria-label') || '').trim()
        return labels.includes(aria)
      })
      if (byLabel !== undefined) return byLabel
      const byShortcut = candidates.find((button) => button.hasAttribute('aria-keyshortcuts'))
      if (byShortcut !== undefined) return byShortcut
      return candidates[0]
    }

    /** The mounted settings dialog, if any. @returns {Element|null} */
    function settingsDialog() {
      if (typeof document === 'undefined') return null
      return document.querySelector('[data-shortcut-modal="settings"]')
    }

    /**
     * Dispatch the `settings.open` shortcut: primary+Comma on desktop,
     * primary+alt+Comma for the web client.
     *
     * @param {boolean} withAlt Whether this attempt uses the web binding.
     */
    function dispatchSettingsShortcut(withAlt) {
      if (typeof window === 'undefined' || typeof KeyboardEvent !== 'function') return
      const platform = typeof navigator === 'undefined'
        ? ''
        : `${navigator.platform || ''} ${navigator.userAgent || ''}`
      const isMac = /mac/i.test(platform)
      const init = {
        key: ',',
        code: 'Comma',
        keyCode: 188,
        which: 188,
        altKey: withAlt,
        metaKey: isMac,
        ctrlKey: !isMac,
        shiftKey: false,
        bubbles: true,
        cancelable: true,
        composed: true,
      }
      try {
        // The shortcut service listens on window; dispatching on window (not
        // on document) also avoids delivering the same gesture twice.
        window.dispatchEvent(new KeyboardEvent('keydown', init))
        window.dispatchEvent(new KeyboardEvent('keyup', init))
      } catch {
        // Synthetic keyboard events are best-effort only.
      }
    }

    /**
     * Open the settings dialog, by trigger click or by shortcut.
     *
     * @param {object} ctx Client plugin context.
     * @param {boolean} withAlt Whether this attempt uses the web shortcut binding.
     */
    function openSettingsSurface(ctx, withAlt) {
      const trigger = findSettingsTrigger(ctx)
      if (trigger !== null) {
        if (trigger.getAttribute('aria-expanded') !== 'true') {
          try {
            trigger.click()
          } catch {
            // A throwing trigger must fall through to the retry path.
          }
        }
        return
      }
      dispatchSettingsShortcut(withAlt)
    }

    /**
     * Click the Models nav row inside the open settings dialog.
     *
     * @param {object} ctx Client plugin context.
     * @returns {boolean} Whether a nav row was clicked.
     */
    function clickModelsNav(ctx) {
      const scope = settingsDialog() ?? (typeof document === 'undefined' ? null : document)
      if (scope === null) return false
      const labels = modelsNavLabels(ctx)
      for (const button of Array.from(scope.querySelectorAll('button'))) {
        const text = (button.textContent || '').replace(/\s+/g, ' ').trim()
        if (!labels.includes(text)) continue
        try {
          button.click()
          return true
        } catch {
          return false
        }
      }
      return false
    }

    /**
     * Best-effort DOM navigation to the official Settings → Models page.
     *
     * This DSH build has no public API to open a specific settings section, so
     * the helper clicks the official settings trigger (or dispatches the
     * `settings.open` shortcut), waits for the dialog, then clicks the nav row
     * whose trimmed text equals the official `settings.models` → `nav` label.
     * It retries once because the dialog may mount lazily. Never throws.
     *
     * @param {object} ctx Client plugin context.
     * @returns {Promise<'opened'|'failed'>} Navigation outcome.
     */
    async function openOfficialModelsSettings(ctx) {
      try {
        if (typeof document === 'undefined') return 'failed'
        openSettingsSurface(ctx, true)
        await afterPaint()
        await wait(120)
        if (clickModelsNav(ctx)) return 'opened'
        // Retry once: mount the dialog again (desktop binding this time) and
        // give the lazy section tree a little longer.
        if (settingsDialog() === null) openSettingsSurface(ctx, false)
        await wait(350)
        if (clickModelsNav(ctx)) return 'opened'
        return 'failed'
      } catch {
        return 'failed'
      }
    }

    /**
     * Jump and publish the outcome for the reminder surfaces.
     *
     * @param {object} ctx Client plugin context.
     * @returns {Promise<'opened'|'failed'>} Navigation outcome.
     */
    async function jumpToOfficialModels(ctx) {
      const result = await openOfficialModelsSettings(ctx)
      publishJumpResult(result)
      return result
    }

    //#endregion

    //#region reminder surface atoms

    /** @param {object} props Icon props. @returns {object} Bell icon element. */
    function BellGlyph(props) {
      const size = props && typeof props.size === 'number' ? props.size : 17
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
      }, [
        h('path', {
          key: 'body',
          d: 'M12 3.4a5.4 5.4 0 0 0-5.4 5.4v3.2l-1.25 2.3a.9.9 0 0 0 .79 1.33h11.72a.9.9 0 0 0 .79-1.33l-1.25-2.3V8.8A5.4 5.4 0 0 0 12 3.4Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'clapper',
          d: 'M10 18.2a2.2 2.2 0 0 0 4 0',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
      ])
    }

    /** @param {object} props Icon props. @returns {object} Pin icon element. */
    function PinGlyph(props) {
      const size = props && typeof props.size === 'number' ? props.size : 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
      }, [
        h('path', {
          key: 'pin',
          d: 'M12 21s6.4-5.7 6.4-10.2a6.4 6.4 0 1 0-12.8 0C5.6 15.3 12 21 12 21Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('circle', { key: 'dot', cx: 12, cy: 10.7, r: 2.1, stroke: 'currentColor', strokeWidth: 1.6 }),
      ])
    }

    /**
     * Build the notice shown on the official Settings → Models page while new
     * models are pending.
     *
     * @param {(key: string, params?: object) => string} t Localized copy reader.
     * @returns {Function} React component for `settings.models.footer`.
     */
    function createModelsFooterComponent(t) {
      return function ModelPinModelsFooter() {
        const checkState = useModelCheckState()
        const jumpResult = useJumpResult()
        const pending = pendingModels(checkState.value)
        if (checkState.unavailable || pending.total === 0) return null
        const checking = Boolean(checkState.value && checkState.value.checking === true)
          || checkState.busy === 'check'
        const busy = checkState.busy !== null
        return h(
          'div',
          { className: 'dshmp-notice', role: 'status', 'aria-live': 'polite' },
          h(
            'div',
            { className: 'dshmp-noticeHead' },
            h('span', { className: 'dshmp-noticeIcon' }, h(PinGlyph, { size: 16 })),
            h(
              'div',
              { className: 'dshmp-field' },
              h('p', { className: 'dshmp-noticeTitle' }, t('modelsFooterTitle', { count: pending.total })),
              h('p', { className: 'dshmp-hint' }, t('modelsFooterHint')),
            ),
          ),
          h(
            'ul',
            { className: 'dshmp-pendingList' },
            pending.providers.map((entry) => h(
              'li',
              { key: entry.providerName },
              `${entry.providerName}: ${modelListText(entry.models, t('listSeparator'))}`,
            )),
          ),
          h(
            'div',
            { className: 'dshmp-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dshmp-button',
                disabled: busy,
                onClick: () => {
                  void runModelCheckAction('dismiss')
                },
              },
              t('dismiss'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshmp-save',
                disabled: busy || checking,
                onClick: () => {
                  void runModelCheckAction('check')
                },
              },
              t('checkAgain'),
            ),
          ),
          jumpResult === 'failed'
            ? h('p', { className: 'dshmp-status', 'data-state': 'error' }, t('jumpFailed'))
            : null,
        )
      }
    }

    /**
     * Build the sidebar reminder button shown while new models are pending.
     *
     * @param {object} ctx Client plugin context.
     * @param {(key: string, params?: object) => string} t Localized copy reader.
     * @returns {Function} React component for `sidebar.footer.action`.
     */
    function createSidebarActionComponent(ctx, t) {
      return function ModelPinSidebarAction() {
        const checkState = useModelCheckState()
        const pending = pendingModels(checkState.value)
        if (checkState.unavailable || pending.total === 0) return null
        const label = t('sidebarReminder', { count: pending.total })
        const badge = pending.total > 99 ? '99+' : String(pending.total)
        return h(
          'button',
          {
            type: 'button',
            className: 'dshmp-bell',
            title: label,
            'aria-label': label,
            onClick: () => {
              void jumpToOfficialModels(ctx)
            },
          },
          h(BellGlyph, { size: 17 }),
          h('span', { className: 'dshmp-badge', 'aria-hidden': 'true' }, badge),
        )
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
        const [formStale, setFormStale] = useState(false)
        const mounted = useRef(true)
        // Shared periodic-model-check state for the new card below; the
        // interval draft mirrors the same "local edit until the Host accepts"
        // pattern as the pin draft.
        const checkState = useModelCheckState()
        const jumpResult = useJumpResult()
        const [intervalDraft, setIntervalDraft] = useState(null)
        const [intervalSaving, setIntervalSaving] = useState(false)
        const [intervalStatus, setIntervalStatus] = useState(null)

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
          setIntervalDraft(configuredInterval(snapshot))
        }, [revision, ready])

        // A form that never becomes ready (a Host row that failed to activate
        // or a schema the client could not decode) would otherwise show
        // "正在读取配置…" forever. Turn that into an explicit diagnostic.
        useEffect(() => {
          if (ready) {
            setFormStale(false)
            return
          }
          const timer = setTimeout(() => setFormStale(true), 8000)
          return () => clearTimeout(timer)
        }, [ready])

        const groups = catalog.groups
        const { model: selectedModel } = resolveSelection(groups, draft)
        const efforts = effortsFor(selectedModel)
        const pinnedComplete = pinned !== undefined && fieldText(pinned.provider) !== '' && fieldText(pinned.model) !== ''
        const summary = pinnedComplete ? describeSelection(groups, pinned) : undefined

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

        // The interval is one atomic write of its own: it saves the moment the
        // select changes, so the Host can reschedule without a separate button.
        const saveInterval = useCallback(async (nextInterval) => {
          if (intervalSaving || !INTERVAL_IDS.includes(nextInterval)) return
          setIntervalDraft(nextInterval)
          setIntervalStatus(null)
          setIntervalSaving(true)
          try {
            const accepted = await form.mutate([
              { op: 'set', path: ['modelCheckInterval'], value: nextInterval },
            ])
            if (!mounted.current) return
            if (!accepted) {
              setIntervalStatus('saveFailed')
              setIntervalDraft(configuredInterval(form.getSnapshot()))
              return
            }
            setIntervalStatus('saved')
            // The Host reschedules the check, so refresh the readout now; the
            // pushed `settings/document-updated` event also lands here.
            void refreshModelCheck()
          } catch {
            if (!mounted.current) return
            setIntervalStatus('saveFailed')
            setIntervalDraft(configuredInterval(form.getSnapshot()))
          } finally {
            if (mounted.current) setIntervalSaving(false)
          }
        }, [form, intervalSaving])

        const checkNow = useCallback(() => {
          void runModelCheckAction('check')
        }, [])

        const dismissReminder = useCallback(() => {
          void runModelCheckAction('dismiss')
        }, [])

        const goToModels = useCallback(() => {
          void jumpToOfficialModels(ctx)
        }, [ctx])

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
        // Keep the effort row when a value is pinned even if the selected model
        // advertises none (or is missing from the catalog): otherwise a stale
        // reasoningEffort could never be cleared from this page.
        const showEffort = efforts.length > 0 || fieldText(draft && draft.reasoningEffort) !== ''

        // ---- periodic model check card -----------------------------------
        const intervalChoices = [
          { id: '1d', label: t('interval.1d') },
          { id: '3d', label: t('interval.3d') },
          { id: '7d', label: t('interval.7d') },
          { id: '14d', label: t('interval.14d') },
          { id: '30d', label: t('interval.30d') },
          { id: 'manual', label: t('interval.manual') },
        ]
        const intervalValue = intervalDraft ?? configuredInterval(snapshot)
        const intervalStatusCopy = intervalStatus === 'saved'
          ? t('saved')
          : intervalStatus === 'saveFailed'
            ? t('saveFailed')
            : intervalSaving
              ? t('saving')
              : ''
        const intervalStatusState = intervalStatus === 'saved'
          ? 'saved'
          : intervalStatus === 'saveFailed' ? 'error' : 'muted'
        const checkValue = checkState.value
        const pending = pendingModels(checkValue)
        const lastCheckAt = formatMoment(checkValue && checkValue.lastCheckAt)
        const nextCheckAt = formatMoment(checkValue && checkValue.nextCheckAt)
        const manualInterval = Boolean(checkValue && checkValue.manual === true)
        const checking = Boolean(checkValue && checkValue.checking === true)
          || checkState.busy === 'check'
        const checkLoading = checkValue === null && !checkState.unavailable
        const resultRows = lastCheckResults(checkValue).map((result) => {
          if (result.error !== '') return `${result.providerName}: ${t('resultError')}`
          const current = result.currentCount === null ? 0 : result.currentCount
          const added = result.addedCount === null ? 0 : result.addedCount
          return `${result.providerName}: ${t('resultCounts', { current, added })}`
        })

        if (!ready) {
          const copy = formStale && !(snapshot && snapshot.status === 'unavailable')
            ? t('formStale')
            : snapshot && snapshot.status === 'unavailable'
              ? t('unavailable')
              : t('loadingForm')
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
              h('span', { className: 'dshmp-currentValue' }, summary ? summary.title : t('notConfigured')),
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
            showEffort
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
          h(
            'section',
            { className: 'dshmp-card dshmp-checkCard', 'aria-label': t('interval.title') },
            h(
              'div',
              { className: 'dshmp-checkHead' },
              h(
                'div',
                { className: 'dshmp-field' },
                h('h3', { className: 'dshmp-cardTitle' }, t('interval.title')),
                h('p', { className: 'dshmp-hint' }, t('interval.hint')),
              ),
              h(
                'select',
                {
                  id: 'dshmp-interval',
                  className: 'dshmp-select',
                  'aria-label': t('interval.label'),
                  value: intervalValue,
                  disabled: !writable || intervalSaving,
                  onChange: (event) => {
                    void saveInterval(event.target.value)
                  },
                },
                intervalChoices.map((choice) => h('option', { key: choice.id, value: choice.id }, choice.label)),
              ),
            ),
            intervalStatusCopy !== ''
              ? h(
                  'p',
                  { className: 'dshmp-status', 'data-state': intervalStatusState, 'aria-live': 'polite' },
                  intervalStatusCopy,
                )
              : null,
            checkState.unavailable
              ? h(
                  'p',
                  { className: 'dshmp-status', 'data-state': 'muted', 'aria-live': 'polite' },
                  t('serviceUnavailable'),
                )
              : checkLoading
                ? h('p', { className: 'dshmp-status' }, t('loadingStatus'))
                : h(
                    'div',
                    { className: 'dshmp-meta' },
                    h('span', { className: 'dshmp-metaKey' }, t('lastCheck')),
                    h('span', { className: 'dshmp-metaValue' }, lastCheckAt === null ? t('never') : lastCheckAt),
                    h('span', { className: 'dshmp-metaKey' }, t('nextCheck')),
                    h(
                      'span',
                      { className: 'dshmp-metaValue' },
                      manualInterval ? t('manualMode') : nextCheckAt === null ? '—' : nextCheckAt,
                    ),
                    h('span', { className: 'dshmp-metaKey' }, t('lastResult')),
                    h(
                      'span',
                      { className: 'dshmp-metaValue' },
                      resultRows.length > 0
                        ? resultRows.join(t('listSeparator'))
                        : lastCheckAt === null ? t('notChecked') : t('noPending'),
                    ),
                  ),
            checking
              ? h('p', { className: 'dshmp-status', 'data-state': 'checking', 'aria-live': 'polite' }, t('checking'))
              : null,
            pending.total > 0
              ? h(
                  'div',
                  { className: 'dshmp-pending' },
                  h('p', { className: 'dshmp-pendingTitle' }, `${t('pendingTitle')} · ${pending.total}`),
                  h(
                    'ul',
                    { className: 'dshmp-pendingList' },
                    pending.providers.map((entry) => h(
                      'li',
                      { key: entry.providerName },
                      `${entry.providerName}: ${modelListText(entry.models, t('listSeparator'))}`,
                    )),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'dshmp-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshmp-save',
                  disabled: checkState.unavailable || checkState.busy !== null || checking,
                  onClick: checkNow,
                },
                t('checkNow'),
              ),
              h(
                'button',
                { type: 'button', className: 'dshmp-button', onClick: goToModels },
                t('goModels'),
              ),
              pending.total > 0
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dshmp-button',
                      disabled: checkState.unavailable || checkState.busy !== null,
                      onClick: dismissReminder,
                    },
                    t('dismiss'),
                  )
                : null,
            ),
            jumpResult === 'failed'
              ? h('p', { className: 'dshmp-status', 'data-state': 'error' }, t('jumpFailed'))
              : null,
            h('p', { className: 'dshmp-note' }, t('interval.disclaimer')),
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
     * Keep the shared model-check store fresh for the lifetime of the plugin:
     * an immediate read on mount, a 60 s poll, and every push that can change
     * the interval, the pending set or the connection.
     *
     * @param {object} ctx Client plugin context.
     */
    function startModelCheckLoop(ctx) {
      ctx.effect(() => {
        let disposed = false
        const refresh = () => {
          if (!disposed) void refreshModelCheck()
        }
        const disposers = []
        const listen = (register) => {
          try {
            const dispose = register()
            if (typeof dispose === 'function') disposers.push(dispose)
          } catch {
            // A missing forwarded event channel must not break the plugin.
          }
        }
        listen(() => ctx.on('connection/reset', refresh))
        // A settings write can change `modelCheckInterval`; the Host
        // recalculates `nextCheckAt`, so re-read the status.
        listen(() => ctx.remote.$on('settings/document-updated', refresh))
        refresh()
        const timer = setInterval(refresh, STATUS_REFRESH_MS)
        return () => {
          disposed = true
          clearInterval(timer)
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              // Ignore a listener that already unloaded with its owner.
            }
          }
        }
      }, 'dsh-model-pin: model-check status loop')
    }

    /**
     * Register the Model Pin settings page, the official Models page notice
     * and the sidebar reminder.
     *
     * @param {object} ctx Client plugin context.
     */
    function apply(ctx) {
      ensureStyle()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-model-pin: copy dictionaries')
      const t = ctx.locale.bind(NS)
      const form = ctx.configForms.get(ENTRY_ID)
      startModelCheckLoop(ctx)
      const ModelPinSection = createSectionComponent(ctx, form, t)
      const ModelPinModelsFooter = createModelsFooterComponent(t)
      const ModelPinSidebarAction = createSidebarActionComponent(ctx, t)
      ctx.effect(() =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: SLOT_ID,
              // Sit right after the shipped Models page (order 10) and before
              // Plugins (15) / Agent presets (20); no shipped page uses 12.
              order: 12,
              label: () => t('settings.label'),
            },
            ModelPinSection,
          ),
        ), 'dsh-model-pin: settings page')
      // The official Models page declares this list slot; registrations only
      // render while the section itself is mounted.
      ctx.effect(() =>
        ctx.slots.inject('settings.models.footer', () =>
          ctx.slots.register(
            {
              name: 'settings.models.footer',
              id: 'model-pin-new-models',
              order: 50,
            },
            ModelPinModelsFooter,
          ),
        ), 'dsh-model-pin: official Models page notice')
      // The sidebar declares this list slot beside Settings; the component
      // renders nothing while no reminder is pending.
      ctx.effect(() =>
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'model-pin-new-models-bell',
              order: 10,
            },
            ModelPinSidebarAction,
          ),
        ), 'dsh-model-pin: sidebar new-model reminder')
    }

    /** Services required before the page can mount. */
    const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
