import { memo, useMemo, useState } from 'react'
import { android } from '../../app/android.js'
import { useTranslate } from '../../i18n/index.js'
import { useCharacters } from '../../services/characters/store.js'
import { resolveActivePreset } from '../../services/models/store.js'
import { clearDebugLog, useDebugLog, type DebugEntry } from '../../services/debug/log.js'
import { useSettings } from '../../services/settings.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './DeveloperConsole.module.css'

/** 汇总当前应用状态，供状态区展示与一键复制。 */
const collectState = () => {
  const settings = useSettings.getState()
  const preset = resolveActivePreset()
  const characters = useCharacters.getState()
  return {
    chatConfig: settings.chatConfig,
    activePreset: preset ? { name: preset.name, model: preset.model, endpoint: preset.endpoint, format: preset.format, vision: preset.vision, reasoning: preset.reasoning, search: preset.search } : null,
    thinkingLevel: settings.thinkingLevel,
    apiKeySaved: Boolean(settings.apiKey),
    characters: characters.characters.length,
    memories: Object.values(characters.memories).reduce((sum, list) => sum + list.length, 0),
    locale: settings.locale,
    android: Boolean(android),
  }
}

const KIND_LABELS: Record<DebugEntry['kind'], string> = {
  request: '请求',
  native: '原生',
  error: '错误',
  event: '事件',
  state: '状态',
  eval: '求值',
}

const formatTime = (at: number) => {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 开发者控制台：日志查看 + 应用状态 + 终端式 JS 求值。 */
export const DeveloperConsole = memo(function DeveloperConsole({ onClose }: { onClose: () => void }) {
  const t = useTranslate()
  const entries = useDebugLog((state) => state.entries)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [expression, setExpression] = useState('')
  const [evalResult, setEvalResult] = useState<string | null>(null)
  const [showState, setShowState] = useState(false)

  // 倒序渲染：最新日志在最上
  const ordered = useMemo(() => [...entries].reverse(), [entries])
  const stateText = showState ? JSON.stringify(collectState(), null, 2) : null

  const runExpression = () => {
    const code = expression.trim()
    if (!code) {
      return
    }
    try {
      // 本地个人 App 的调试求值：直接在页面上下文执行
      // eslint-disable-next-line no-eval
      const result = eval(code)
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? String(result)
      setEvalResult(text?.slice(0, 4000) ?? 'undefined')
      useDebugLog.setState((state) => ({
        entries: [
          ...state.entries,
          { id: state.entries.length + 1, at: Date.now(), kind: 'eval' as const, title: code.slice(0, 120), detail: text?.slice(0, 4000) ?? 'undefined' },
        ].slice(-300),
      }))
    } catch (error) {
      const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      setEvalResult(text)
    }
  }

  const copyAll = () => {
    const text = [
      JSON.stringify(collectState(), null, 2),
      '',
      ...[...entries].reverse().map(
        (entry) =>
          `[${formatTime(entry.at)}] [${entry.kind}] ${entry.title}${entry.detail ? `\n${entry.detail}` : ''}`
      ),
    ].join('\n')
    void copyText(text).then((copied) =>
      showToast({ key: copied ? 'devCopied' : 'devCopyFailed', type: copied ? undefined : 'error' })
    )
  }

  return (
    <Modal title={t('devConsole')} closable className={styles.dialog} mainClassName={styles.main} onClose={onClose}>
      <div className={styles.toolbar}>
        <Button size="s" variant="outlined" onClick={() => setShowState(!showState)}>
          {t('devState')}
        </Button>
        <Button size="s" variant="outlined" onClick={copyAll}>
          {t('devCopyAll')}
        </Button>
        <Button
          size="s"
          variant="outlined"
          onClick={() => {
            clearDebugLog()
            setExpanded(null)
            setEvalResult(null)
          }}
        >
          {t('devClear')}
        </Button>
      </div>
      {showState ? <pre className={styles.stateBlock}>{stateText}</pre> : null}
      <div className={styles.logList}>
        {ordered.length === 0 ? (
          <div className={styles.empty}>{t('devEmpty')}</div>
        ) : (
          ordered.map((entry) => (
            <div key={entry.id} className={styles.entry} data-kind={entry.kind}>
              <button
                type="button"
                className={styles.entryHeader}
                onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
              >
                <span className={styles.entryTime}>{formatTime(entry.at)}</span>
                <span className={styles.entryKind}>{KIND_LABELS[entry.kind] ?? entry.kind}</span>
                <span className={styles.entryTitle}>{entry.title}</span>
              </button>
              {expanded === entry.id && entry.detail ? (
                <pre className={styles.entryDetail}>{entry.detail}</pre>
              ) : null}
            </div>
          ))
        )}
      </div>
      <div className={styles.evalRow}>
        <input
          type="text"
          className={styles.evalInput}
          placeholder={t('devEvalPlaceholder')}
          value={expression}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(event) => setExpression(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              runExpression()
            }
          }}
        />
        <Button size="m" onClick={runExpression}>
          {t('devEvalRun')}
        </Button>
      </div>
      {evalResult !== null ? <pre className={styles.evalResult}>{evalResult}</pre> : null}</Modal>
  )
})
