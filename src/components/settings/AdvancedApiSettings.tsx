import { useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  CHAT_API_FORMATS,
  DEFAULT_CHAT_CONFIG,
  DEFAULT_CHAT_MODEL,
  chatBaseUrl,
  resolveChatEndpoint,
  type ChatApiFormat,
} from '../../services/api/chatConfig.js'
import { setChatConfig, useSettings } from '../../services/settings.js'
import { activatePreset, savePreset, useModels } from '../../services/models/store.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import styles from './AdvancedApiSettings.module.css'

const formats = (Object.keys(CHAT_API_FORMATS) as ChatApiFormat[]).map((value) => ({
  value,
  label: CHAT_API_FORMATS[value],
}))

const endpointExamples: Record<ChatApiFormat, string> = {
  messages: 'https://api.deepseek.com/anthropic',
  chat: 'https://api.deepseek.com',
  responses: 'https://api.deepseek.com',
}

export const AdvancedApiDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('advancedSettings')}
      closable
      className={styles.dialog}
      mainClassName={styles.dialogMain}
      onClose={onClose}
    >
      <AdvancedApiSettings onSave={onClose} />
    </Modal>
  )
}

export const AdvancedApiSettings = ({ onSave }: { onSave: () => void }) => {
  const t = useTranslate()
  const [saved] = useState(() => useSettings.getState().chatConfig)
  const [draft, setDraft] = useState(() => ({
    ...saved,
    endpoint: chatBaseUrl(saved.endpoint, saved.format) ?? '',
  }))
  const [error, setError] = useState<TranslationKey>()
  const customEndpoint = draft.endpoint.trim()
  const format = draft.format
  const save = () => {
    const model = draft.model.trim()
    const endpoint = resolveChatEndpoint(customEndpoint, format, saved)
    if (endpoint === null) {
      setError('advancedInvalidEndpoint')
      return
    }
    if (endpoint && !model) {
      setError('modelIdRequired')
      return
    }
    const config = {
      model,
      endpoint,
      format,
      apiKey: endpoint ? draft.apiKey.trim() : '',
    }
    // 高级设置即「编辑当前激活预设」：保存后立即以该预设生效，避免双入口不同步
    const active = useModels.getState().presets.find(
      (item) => item.id === useModels.getState().activeId
    )
    if (!active) {
      if (setChatConfig(config)) {
        onSave()
      } else {
        setError('advancedSaveFailed')
      }
      return
    }
    // 换端点时丢弃旧预设的自定义头，避免把原网关的会话头带给另一个服务。
    const endpointChanged =
      chatBaseUrl(saved.endpoint, saved.format) !== chatBaseUrl(endpoint, format)
    const next = savePreset({
      ...active,
      ...config,
      headers: endpointChanged ? undefined : active.headers,
    })
    activatePreset(next.id)
    onSave()
  }
  const reset = () => {
    // 重置 = 回到官方端点；当前激活预设也要一起切走，否则下次启动会被预设覆盖回来。
    const official = useModels.getState().presets.find((preset) => preset.endpoint === '')
    if (official) {
      activatePreset(official.id)
      onSave()
      return
    }
    if (setChatConfig(DEFAULT_CHAT_CONFIG)) {
      onSave()
    } else {
      setError('advancedSaveFailed')
    }
  }
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <label>
        {t('advancedModel')}
        <input
          value={draft.model}
          placeholder={DEFAULT_CHAT_MODEL}
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            const model = event.target.value
            setDraft((current) => ({ ...current, model }))
            setError(undefined)
          }}
        />
      </label>
      <div className={styles.field}>
        <span>{t('advancedProtocol')}</span>
        <Select
          ariaLabel={t('advancedProtocol')}
          value={format}
          options={formats}
          onChange={(value) => {
            setDraft((current) => ({ ...current, format: value }))
            setError(undefined)
          }}
        />
      </div>
      <label>
        {t('advancedEndpoint')}
        <input
          value={draft.endpoint}
          placeholder={endpointExamples[format]}
          inputMode="url"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            const endpoint = event.target.value
            setDraft((current) => ({
              ...current,
              endpoint,
              apiKey:
                chatBaseUrl(endpoint, current.format) ===
                chatBaseUrl(current.endpoint, current.format)
                  ? current.apiKey
                  : '',
            }))
            setError(undefined)
          }}
        />
      </label>
      <p>{t(customEndpoint ? 'advancedEndpointHint' : 'advancedDefaultHint')}</p>
      {customEndpoint ? (
        <>
          <label>
            {t('advancedEndpointKey')}
            <input
              type="password"
              value={draft.apiKey}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => {
                const apiKey = event.target.value
                setDraft((current) => ({ ...current, apiKey }))
              }}
            />
          </label>
          <p>{t('advancedProviderHint')}</p>
        </>
      ) : null}
      {error ? <p role="alert">{t(error)}</p> : null}
      <div className={styles.actions}>
        <Button variant="outlined" onClick={reset}>
          {t('advancedReset')}
        </Button>
        <Button variant="primary" type="submit">
          {t('advancedSave')}
        </Button>
      </div>
    </form>
  )
}
