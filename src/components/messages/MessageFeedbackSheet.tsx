import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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

export const MessageFeedbackSheet = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [reason, setReason] = useState<string | null>(null)
  const [detail, setDetail] = useState('')

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
      <section
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={t('feedback')}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{t('feedback')}</h2>
          <button type="button" className={styles.close} aria-label={t('close')} onClick={onClose}>
            <IconCloseOutline16 />
          </button>
        </header>
        <div className={styles.reasons}>
          {reasons.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={reason === item.id}
              data-android-a11y={android ? `feedback-${item.id}` : undefined}
              data-android-a11y-label={t(item.label)}
              data-android-a11y-checked={reason === item.id ? 'true' : 'false'}
              onClick={() => setReason(reason === item.id ? null : item.id)}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
        <textarea
          className={styles.input}
          value={detail}
          placeholder={t('feedbackPlaceholder')}
          aria-label={t('feedbackPlaceholder')}
          onChange={(event) => setDetail(event.target.value)}
        />
        <button type="button" className={styles.submit} onClick={onClose}>
          {t('submit')}
        </button>
      </section>
    </div>,
    document.getElementById('android-overlays') ?? document.body
  )
}
