import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { android } from '../../app/android.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import styles from './MessageFeedbackSheet.module.css'

const reasons: ReadonlyArray<{ id: string; label: TranslationKey }> = [
  { id: 'harmful', label: 'feedbackHarmful' },
  { id: 'false', label: 'feedbackFalse' },
  { id: 'unhelpful', label: 'feedbackUnhelpful' },
  { id: 'other', label: 'feedbackOther' },
]

export const MessageFeedbackSheet = ({
  onClose,
  variant = 'feedback',
}: {
  onClose: () => void
  variant?: 'feedback' | 'report'
}) => {
  const t = useTranslate()
  const report = variant === 'report'
  const [reason, setReason] = useState<string | null>(null)
  const [detail, setDetail] = useState('')
  const [inputFocused, setInputFocused] = useState(false)

  useEffect(() => {
    const app = document.querySelector<HTMLElement>('[data-drawer-open]')
    const wasInert = app?.inert ?? false
    if (app) {
      app.inert = true
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (app) {
        app.inert = wasInert
      }
    }
  }, [onClose])

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className={clsx(styles.mask, report && styles.reportMask)}
        data-android-a11y={android ? 'feedback-close-mask' : undefined}
        data-android-a11y-label={t('close')}
        data-android-a11y-checkable="false"
        data-android-a11y-focusable="false"
        data-android-a11y-label-kind="none"
        onClick={onClose}
      />
      <section className={clsx(styles.sheet, report && styles.reportSheet)}>
        <header className={clsx(styles.header, report && styles.reportHeader)}>
          <h2 className={styles.title}>{t(report ? 'report' : 'feedback')}</h2>
          <button
            type="button"
            className={styles.close}
            aria-label={t('close')}
            data-android-a11y={android ? 'feedback-close' : undefined}
            data-android-a11y-label={t('close')}
            data-android-a11y-checkable="false"
            data-android-a11y-label-kind="description"
            data-android-a11y-extra-button="true"
            onClick={onClose}
          >
            <IconCloseOutline16 />
          </button>
        </header>
        {report ? null : (
          <div className={styles.reasons}>
            {reasons.map((item) => (
              <button
                key={item.id}
                type="button"
                role="checkbox"
                aria-checked={reason === item.id}
                data-android-a11y={android ? `feedback-${item.id}` : undefined}
                data-android-a11y-label={t(item.label)}
                data-android-a11y-checkable="true"
                data-android-a11y-checked={reason === item.id ? 'true' : 'false'}
                onClick={() => setReason(reason === item.id ? null : item.id)}
              >
                {android ? (
                  <span data-android-a11y-label-node>{t(item.label)}</span>
                ) : (
                  t(item.label)
                )}
              </button>
            ))}
          </div>
        )}
        <textarea
          className={clsx(styles.input, report && styles.reportInput)}
          value={detail}
          placeholder={t('feedbackPlaceholder')}
          aria-label={t('feedbackPlaceholder')}
          aria-hidden={android && !inputFocused ? true : undefined}
          data-android-a11y={android ? 'feedback-detail' : undefined}
          data-android-a11y-label={t('feedbackPlaceholder')}
          data-android-a11y-checkable="false"
          data-android-a11y-role="editText"
          data-android-a11y-label-kind="hint"
          data-android-a11y-keep-interactive="true"
          onChange={(event) => setDetail(event.target.value)}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
        />
        <button
          type="button"
          className={styles.submit}
          data-android-a11y={android ? 'feedback-submit' : undefined}
          data-android-a11y-label={t('submit')}
          data-android-a11y-checkable="false"
          data-android-a11y-label-kind="text"
          data-android-a11y-extra-button="true"
          onClick={onClose}
        >
          {t('submit')}
        </button>
      </section>
    </div>,
    document.getElementById('android-overlays') ?? document.body
  )
}
