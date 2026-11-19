import { useEffect, useRef, useState, type ReactNode } from 'react'
import { android, saveAndroidHistory } from '../../app/android.js'
import { openAndroidPage } from '../../app/openAndroidPage.js'
import { useTranslate, type LinkedMessage } from '../../i18n/index.js'
import type { TtsVoice } from '../../services/api/speech.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  setApiKey,
  setFoldThinking,
  setFontSize,
  setLocale,
  setThemePreference,
  setTtsVoice,
  useSettings,
  type LocalePreference,
  type ThemePreference,
} from '../../services/settings.js'
import { AndroidSound } from '../base/AndroidIcons.js'
import {
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconDataOutline16,
  IconGlobeLanguageOutline14,
  IconLightOutline16,
  IconLinkOutline16,
  IconSettingsOutline16,
} from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { closeSettings, useSettingsDialog } from './settingsDialogState.js'
import styles from './AndroidSettings.module.css'

const appVersion = document.querySelector<HTMLMetaElement>(
  'meta[name="application-version"]'
)?.content
const policiesUrl = 'https://cdn.deepseek.com/policies'
const chinesePoliciesUrl = `${policiesUrl}/zh-CN`
const faqUrl = 'https://static.deepseek.com/faq/index.html'

type Page = 'root' | 'account' | 'data' | 'export' | 'font' | 'personalization' | 'agreements'
type Popup = 'locale' | 'theme' | 'voice' | 'logout' | 'delete' | 'import'

const Profile = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 21a7.5 6 0 0 1 15 0" />
  </svg>
)

const Info = ({ glyph = 'i' }: { glyph?: string }) => <span className={styles.info}>{glyph}</span>

const Group = ({
  label,
  children,
  spaced,
}: {
  label?: string
  children: ReactNode
  spaced?: boolean
}) => (
  <section className={styles.group} data-spaced={spaced ? '' : undefined}>
    {label ? <h2>{label}</h2> : null}
    <div className={styles.card}>{children}</div>
  </section>
)

const Row = ({
  label,
  icon,
  value,
  onClick,
  href,
  control,
  danger = false,
  disabled = false,
  arrow = Boolean(onClick || href),
}: {
  label: string
  icon?: ReactNode
  value?: string
  onClick?: () => void
  href?: string
  control?: ReactNode
  danger?: boolean
  disabled?: boolean
  arrow?: boolean
}) => {
  const contents = (
    <>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.rowLabel}>{label}</span>
      {value ? <span className={styles.value}>{value}</span> : null}
      {control}
      {arrow ? (
        <span className={styles.arrow}>
          <IconChevronRightOutline14 />
        </span>
      ) : null}
    </>
  )
  if (href) {
    return (
      <a className={styles.row} href={href}>
        {contents}
      </a>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={styles.row}
        data-danger={danger}
        disabled={disabled}
        onClick={onClick}
      >
        {contents}
      </button>
    )
  }
  return <div className={styles.row}>{contents}</div>
}

const Switch = ({
  label,
  checked,
  toggle,
}: {
  label: string
  checked: boolean
  toggle?: () => void
}) => (
  <button
    type="button"
    className={styles.switch}
    role="switch"
    aria-label={label}
    aria-checked={checked}
    disabled={!toggle}
    onClick={toggle}
  >
    <span />
  </button>
)

const Choice = <T extends string>({
  title,
  icon,
  value,
  fields,
  confirm,
  dismiss,
}: {
  title: string
  icon?: ReactNode
  value: T
  fields: ReadonlyArray<{ id: T; label: string }>
  confirm: (value: T) => void
  dismiss: () => void
}) => {
  const t = useTranslate()
  const [next, setNext] = useState(value)
  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          dismiss()
        }
      }}
    >
      <section className={styles.choice} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          {icon}
          {title}
        </header>
        <div className={styles.options} role="radiogroup" aria-label={title}>
          {fields.map((field) => (
            <button
              key={field.id}
              type="button"
              role="radio"
              aria-checked={next === field.id}
              onClick={() => setNext(field.id)}
            >
              {field.label}
            </button>
          ))}
        </div>
        <button type="button" className={styles.confirm} onClick={() => confirm(next)}>
          {t('confirm')}
        </button>
      </section>
    </div>
  )
}

export const AndroidSettings = () => {
  const open = useSettingsDialog((state) => state.open)
  const section = useSettingsDialog((state) => state.section)
  return open ? <Settings start={section === 'data' ? 'account' : 'root'} key={section} /> : null
}

const Settings = ({ start }: { start: Page }) => {
  const t = useTranslate()
  const { locale, localePreference, themePreference, fontSize, foldThinking, ttsVoice } =
    useSettings()
  const tr = (chinese: string, english: string) => (locale === 'zh-CN' ? chinese : english)
  const [page, setPage] = useState<Page>(start)
  const [popup, setPopup] = useState<Popup | null>(null)
  const [tone, setTone] = useState(ttsVoice)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [importStatus, setImportStatus] = useState<LinkedMessage | null>(null)
  const [archive, setArchive] = useState<Awaited<ReturnType<typeof exportHistory>> | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const sessions = useChatStore((state) => state.sessions.length)
  const editor = useApiKeyEditor()

  const labels: Record<Page, string> = {
    root: t('settings'),
    account: tr('账号管理', 'Account management'),
    data: tr('数据管理', 'Data management'),
    export: t('exportAllLabel'),
    font: tr('字体大小', 'Text size'),
    personalization: tr('个性化', 'Personalization'),
    agreements: tr('服务协议', 'Service agreement'),
  }
  const language = tr('语言', 'Language')
  const appearance = tr('外观', 'Appearance')
  const voice = tr('朗读音色', 'Read-aloud voice')
  const autoFold = tr('思考内容自动折叠', 'Collapse thinking automatically')
  const follow = tr('跟随系统', 'Follow system')
  const logout = tr('退出登录', 'Sign out')
  const clear = tr('删除所有历史对话', 'Delete all conversations')
  const themes: { id: ThemePreference; label: string }[] = [
    { id: 'system', label: tr('系统', 'System') },
    { id: 'light', label: tr('浅色', 'Light') },
    { id: 'dark', label: tr('深色', 'Dark') },
  ]
  const languages: { id: LocalePreference; label: string }[] = [
    { id: 'system', label: tr('系统', 'System') },
    { id: 'zh-CN', label: '中文（简体中文）' },
    { id: 'en-US', label: 'English' },
  ]
  const tones: { id: TtsVoice; label: string; description: string }[] = [
    {
      id: 'stella',
      label: t('settingsTtsVoiceStella'),
      description: tr('清晰明亮', 'Clear and bright'),
    },
    {
      id: 'tide',
      label: t('settingsTtsVoiceTide'),
      description: tr('沉稳自然', 'Calm and natural'),
    },
  ]
  const currentTone = tones.find((item) => item.id === tone) ?? tones[0]
  const languageLabel = languages.find((item) => item.id === locale)?.label
  const themeLabel = themes.find((item) => item.id === themePreference)?.label
  const localizedPoliciesUrl = `${policiesUrl}/${locale}`
  const checkForUpdates = () => {
    showToast(tr('当前已是最新版本', 'You are using the latest version'), 2000)
  }

  const back = () => {
    if (busy) {
      return
    }
    if (popup) {
      setPopup(null)
      setFile(null)
    } else if (page === 'root') {
      closeSettings()
    } else {
      setPage(page === 'export' ? 'data' : 'root')
    }
  }

  useEffect(() => {
    const onBack = (event: Event) => {
      event.preventDefault()
      back()
    }
    window.addEventListener('android-back', onBack)
    return () => window.removeEventListener('android-back', onBack)
  })

  const runExportAction = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      showToast({
        key: 'historyExportFailed',
        params: { message: error instanceof Error ? error.message : String(error) },
        type: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const confirmAction = async () => {
    if (busy) {
      return
    }
    if (popup === 'logout') {
      if (setApiKey(null)) {
        closeSettings()
      } else {
        showToast({ key: 'apiKeyStorageFailed' })
      }
      return
    }
    setBusy(true)
    try {
      if (popup === 'import' && file) {
        setPopup(null)
        setFile(null)
        setImportStatus({ key: 'historyImporting' })
        const count = await importHistory(file)
        setImportStatus({
          key: count === 1 ? 'historyImportedOne' : 'historyImported',
          params: { count },
        })
      } else if (popup === 'delete') {
        await clearHistory()
        showToast({ key: 'historyDeleted' })
        setPopup(null)
      }
    } catch (error) {
      if (popup === 'import') {
        setImportStatus({
          key: error instanceof BackupError ? error.key : 'historyImportFailed',
          type: 'error',
        })
      } else {
        showToast({ key: 'historyDeleteFailed', type: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.page} role="region" aria-label={labels[page]}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          aria-label={tr('返回', 'Back')}
          onClick={back}
        >
          <IconChevronRightOutline14 />
        </button>
        <h1>{labels[page]}</h1>
      </header>
      <div className={styles.scroll} key={page}>
        {page === 'root' ? (
          <>
            <Group label={tr('账户', 'Account')}>
              <Row label={labels.account} icon={<Profile />} onClick={() => setPage('account')} />
              <Row
                label={labels.data}
                icon={<IconDataOutline16 />}
                onClick={() => setPage('data')}
              />
            </Group>
            <Group label={tr('应用', 'App')}>
              <Row
                label={language}
                value={languageLabel}
                icon={<IconGlobeLanguageOutline14 />}
                onClick={() => setPopup('locale')}
              />
              <Row
                label={appearance}
                value={themeLabel}
                icon={<IconLightOutline16 />}
                onClick={() => setPopup('theme')}
              />
              <Row
                label={labels.font}
                icon={<span className={styles.fontIcon}>ᴀA</span>}
                onClick={() => setPage('font')}
              />
              <Row
                label={labels.personalization}
                icon={<IconSettingsOutline16 />}
                onClick={() => setPage('personalization')}
              />
            </Group>
            <Group label={tr('语音', 'Voice')}>
              <Row
                label={voice}
                icon={<AndroidSound muted={false} />}
                arrow={false}
                onClick={() => {
                  setTone(ttsVoice)
                  setPopup('voice')
                }}
              />
            </Group>
            <Group label={tr('关于', 'About')}>
              <Row
                label={tr('版本信息', 'Version')}
                value={appVersion}
                icon={<Info />}
                onClick={checkForUpdates}
                arrow={false}
              />
              <Row
                label={labels.agreements}
                icon={<IconLinkOutline16 />}
                onClick={() => setPage('agreements')}
              />
            </Group>
            <Group spaced>
              <Row
                label={tr('帮助与反馈', 'Help & Feedback')}
                icon={<Info glyph="?" />}
                onClick={() => openAndroidPage(faqUrl, { showBrowserAction: false })}
              />
            </Group>
            <Group spaced>
              <Row label={logout} danger arrow={false} onClick={() => setPopup('logout')} />
            </Group>
          </>
        ) : null}
        {page === 'account' ? (
          <Group label={tr('账户', 'Account')}>
            <Row
              label="DeepSeek API Key"
              icon={<Profile />}
              value="••••••••"
              onClick={() => editor.setEditing(true)}
            />
            {editor.editing ? (
              <div className={styles.credentials}>
                <ApiKeyField editor={editor} />
                <ApiKeyConfirm editor={editor} />
              </div>
            ) : null}
            <Row
              label={tr('开放平台', 'Open platform')}
              href="https://platform.deepseek.com/api_keys"
            />
            <Row
              label={tr('开放平台帮助', 'API help')}
              href="https://api-docs.deepseek.com/zh-cn/"
            />
          </Group>
        ) : null}
        {page === 'data' ? (
          <>
            <p className={styles.caption}>
              {tr(
                '历史对话保存在此设备。API 数据处理适用 ',
                'Chat history is stored on this device. API usage is subject to the '
              )}
              <a href={`${chinesePoliciesUrl}/deepseek-open-platform-privacy-policy.html`}>
                {tr('DeepSeek 开放平台隐私政策', 'DeepSeek Open Platform Privacy Policy')}
              </a>
              {tr('。', '.')}
            </p>
            <Group>
              <Row label={labels.export} disabled={busy} onClick={() => setPage('export')} />
            </Group>
            <Group>
              <Row
                label={clear}
                danger
                arrow={false}
                disabled={busy}
                onClick={() => setPopup('delete')}
              />
            </Group>
            <Group>
              <Row
                label={t('historyImport')}
                arrow={false}
                disabled={busy}
                onClick={() => importInput.current?.click()}
              />
              <input
                ref={importInput}
                hidden
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  event.target.value = ''
                  if (selected) {
                    setFile(selected)
                    setPopup('import')
                  }
                }}
              />
            </Group>
            {importStatus ? (
              <p
                className={styles.caption}
                role={importStatus.type === 'error' ? 'alert' : 'status'}
              >
                {t(importStatus.key, importStatus.params)}
              </p>
            ) : null}
          </>
        ) : null}
        {page === 'export' ? (
          <>
            <Group>
              <Row
                label={archive ? tr('重新导出', 'Export again') : tr('导出', 'Export')}
                arrow={false}
                disabled={busy || !sessions}
                onClick={() =>
                  void runExportAction(async () => {
                    setArchive(await exportHistory())
                  })
                }
              />
            </Group>
            {archive ? (
              <Group>
                <Row
                  label={tr('保存到设备', 'Save to device')}
                  arrow={false}
                  disabled={busy}
                  onClick={() =>
                    void runExportAction(() => saveAndroidHistory(archive.name, archive.blob))
                  }
                />
              </Group>
            ) : null}
            <p className={styles.caption} role="status">
              {busy
                ? tr('正在处理归档…', 'Working on the archive…')
                : (archive?.name ?? t(sessions ? 'historyExportDescription' : 'androidNoChats'))}
            </p>
          </>
        ) : null}
        {page === 'font' ? (
          <div
            className={styles.preview}
            style={{
              fontSize: `${16 * (fontSize === null ? (android?.systemFontScale() ?? 1) : 1 + (fontSize - 3) * 0.09)}px`,
            }}
          >
            <span>{tr('预览文字大小', 'Preview text size')}</span>
            <p>
              {tr('你可以拖动滑块来调整字体大小。', 'Drag the slider to adjust the text size.')}
            </p>
            <p>
              {tr(
                '如果在使用过程中存在问题或建议，可反馈给 DeepSeek 团队。',
                'You can share questions or suggestions with DeepSeek.'
              )}
            </p>
          </div>
        ) : null}
        {page === 'personalization' ? (
          <>
            <Group>
              <Row
                label={autoFold}
                control={
                  <Switch
                    label={autoFold}
                    checked={foldThinking}
                    toggle={() => setFoldThinking(!foldThinking)}
                  />
                }
              />
            </Group>
            <p className={styles.caption}>
              {tr(
                '开启后，思考结束后将自动折叠思考内容',
                'Collapse thinking once an answer is ready.'
              )}
            </p>
          </>
        ) : null}
        {page === 'agreements' ? (
          <Group>
            <Row
              label={tr('用户协议', 'Terms of Use')}
              onClick={() => openAndroidPage(`${localizedPoliciesUrl}/deepseek-terms-of-use.html`)}
            />
            <Row
              label={tr('隐私政策', 'Privacy Policy')}
              onClick={() =>
                openAndroidPage(`${localizedPoliciesUrl}/deepseek-privacy-policy.html`)
              }
            />
            <Row
              label={tr('第三方信息共享清单', 'SDK Sharing List')}
              onClick={() =>
                openAndroidPage(`${chinesePoliciesUrl}/third-party-info-sharing-list.html`)
              }
            />
            <Row
              label={tr('个人信息收集清单', 'Collected Personal Information')}
              onClick={() =>
                openAndroidPage(`${chinesePoliciesUrl}/collected-personal-information.html`)
              }
            />
            <Row
              label={tr('应用权限', 'App Permissions')}
              onClick={() => android?.openAppPermissions()}
            />
          </Group>
        ) : null}
      </div>
      {page === 'font' ? (
        <div className={styles.fontPanel}>
          <Row
            label={follow}
            control={
              <Switch
                label={follow}
                checked={fontSize === null}
                toggle={() => setFontSize(fontSize === null ? 3 : null)}
              />
            }
          />
          <div className={styles.fontLabels}>
            <small>A</small>
            <span>{tr('标准', 'Standard')}</span>
            <strong>A</strong>
          </div>
          <input
            type="range"
            aria-label={labels.font}
            min="0"
            max="6"
            step="1"
            value={fontSize ?? 3}
            disabled={fontSize === null}
            onChange={(event) => setFontSize(event.target.valueAsNumber)}
          />
        </div>
      ) : null}
      {popup === 'locale' ? (
        <Choice
          title={language}
          icon={<IconGlobeLanguageOutline14 />}
          value={localePreference}
          fields={languages}
          confirm={(value) => {
            setLocale(value)
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'theme' ? (
        <Choice
          title={appearance}
          value={themePreference}
          fields={themes}
          confirm={(value) => {
            setThemePreference(value)
            setPopup(null)
          }}
          dismiss={back}
        />
      ) : null}
      {popup === 'voice' ? (
        <div className={styles.overlay} data-sheet="">
          <section className={styles.voiceSheet} role="dialog" aria-modal="true" aria-label={voice}>
            <header>
              {voice}
              <button type="button" aria-label={t('close')} onClick={back}>
                <IconCloseOutline16 />
              </button>
            </header>
            <div
              className={styles.voiceBody}
              onTouchStart={(event) => {
                event.currentTarget.dataset.swipeX = String(event.touches[0].clientX)
              }}
              onTouchEnd={(event) => {
                const dx =
                  event.changedTouches[0].clientX - Number(event.currentTarget.dataset.swipeX)
                if (Math.abs(dx) > 32) {
                  setTone(dx > 0 ? 'stella' : 'tide')
                }
              }}
            >
              <div className={styles.voiceArt} data-tone={tone} aria-hidden="true" />
              <div>{currentTone.label}</div>
              <small>{currentTone.description}</small>
              <div className={styles.dots} role="radiogroup" aria-label={voice}>
                {tones.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-label={item.label}
                    aria-checked={tone === item.id}
                    onClick={() => setTone(item.id)}
                  />
                ))}
              </div>
            </div>
            <button
              className={styles.primary}
              type="button"
              onClick={() => {
                setTtsVoice(tone)
                setPopup(null)
              }}
            >
              {t('confirm')}
            </button>
          </section>
        </div>
      ) : null}
      {popup === 'logout' || popup === 'delete' || popup === 'import' ? (
        <div className={styles.overlay}>
          <section className={styles.choice} role="dialog" aria-modal="true">
            <header>
              {popup === 'logout'
                ? logout
                : popup === 'delete'
                  ? clear
                  : t('historyImportConfirmTitle')}
            </header>
            <p className={styles.message}>
              {popup === 'logout'
                ? tr('确认退出当前 API Key？', 'Sign out of this API Key?')
                : popup === 'delete'
                  ? t('deleteAllSessionsModalDescription')
                  : t('historyImportConfirmDescription')}
            </p>
            <div className={styles.confirmActions}>
              <button className={styles.confirm} disabled={busy} onClick={back}>
                {t('cancel')}
              </button>
              <button
                className={styles.confirm}
                disabled={busy}
                data-danger={popup !== 'import'}
                onClick={() => void confirmAction()}
              >
                {t(popup === 'import' ? 'historyImportConfirm' : 'confirm')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
