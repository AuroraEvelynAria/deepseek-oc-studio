import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { buildReplyView } from '../../services/chat/view.js'
import type { Message, Session } from '../../services/chat/types.js'
import {
  IconCheckedOutline14,
  IconCloseFill14,
  IconCopyOutline16,
  IconEllipsisOutline16,
  IconLinkOutline14,
} from '../base/icons.js'
import styles from './MessageShareView.module.css'

const messageText = (message: Message) => {
  if (message.role === 'user') {
    return message.content
  }
  return buildReplyView(message, false).answer?.text ?? ''
}

const ImageIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="4" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="16.5" cy="9" r="1.5" fill="currentColor" />
    <path
      d="m4 17 4.4-4.4a2.4 2.4 0 0 1 3.4 0l4.1 4.1M12.6 15.4l2.2-2.2a2.4 2.4 0 0 1 3.4 0L21 16"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
)

const WeChatIcon = () => (
  <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M9.6 4.1c-3.3 0-6 2.2-6 4.9 0 1.5.8 2.9 2.1 3.8l-.6 2 2.3-1.1c.7.2 1.4.3 2.2.3.3 0 .7 0 1-.1a4.4 4.4 0 0 1-.2-1.3c0-2.9 2.7-5.2 6-5.2h.4c-.7-1.9-3.2-3.3-6.2-3.3Z"
      fill="currentColor"
    />
    <path
      d="M20.9 13.4c0-2.2-2.2-4-4.9-4s-4.9 1.8-4.9 4 2.2 4 4.9 4c.6 0 1.1-.1 1.7-.2l1.9.9-.5-1.6c1.1-.7 1.8-1.8 1.8-3.1Z"
      fill="currentColor"
    />
    <circle cx="7.4" cy="8.2" r="1" fill="#24c466" />
    <circle cx="11.4" cy="8.2" r="1" fill="#24c466" />
    <circle cx="14.2" cy="13" r=".9" fill="#24c466" />
    <circle cx="17.4" cy="13" r=".9" fill="#24c466" />
  </svg>
)

export const MessageShareView = ({
  session,
  onClose,
}: {
  session: Session
  onClose: () => void
}) => {
  const t = useTranslate()
  const messages = useMemo(() => getVisibleMessages(session), [session])
  const [selected, setSelected] = useState(() => new Set(messages.map((message) => message.id)))

  useEffect(() => {
    const root = document.getElementById('root')
    const wasInert = root?.inert ?? false
    if (root) {
      root.inert = true
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (root) {
        root.inert = wasInert
      }
    }
  }, [onClose])

  const allSelected = selected.size === messages.length
  const selectedGroups = messages.filter(
    (message) => message.role === 'user' && selected.has(message.id)
  ).length
  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return createPortal(
    <section className={styles.view} role="dialog" aria-modal="true" aria-label={t('share')}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.selectAll}
          onClick={() => setSelected(allSelected ? new Set() : new Set(messages.map((m) => m.id)))}
        >
          <span data-checked={allSelected}>
            <IconCheckedOutline14 />
          </span>
          {t('selectAll')}
        </button>
      </header>
      <div className={styles.messages}>
        {messages.map((message) => {
          const text = messageText(message)
          return (
            <div key={message.id} className={styles.message} data-role={message.role}>
              <label
                data-checked={selected.has(message.id)}
                className={styles.check}
              >
                <input
                  type="checkbox"
                  checked={selected.has(message.id)}
                  aria-labelledby={`share-message-${message.id}`}
                  onChange={() => toggle(message.id)}
                />
                <span>
                  <IconCheckedOutline14 />
                </span>
              </label>
              <div
                id={`share-message-${message.id}`}
                className={message.role === 'user' ? styles.bubble : styles.answer}
              >
                {text}
              </div>
            </div>
          )
        })}
        <div className={styles.fadedActions} aria-hidden="true">
          <IconCopyOutline16 />
          <span className={styles.thumb}>◡</span>
          <span className={styles.thumb}>◠</span>
          <span>◖</span>
          <IconLinkOutline14 />
          <span className={styles.refresh}>↻</span>
        </div>
      </div>
      <footer className={styles.footer}>
        <div className={styles.selectionState}>
          <span>{t('selectedGroups', { count: selectedGroups })}</span>
          <button type="button" className={styles.close} aria-label={t('back')} onClick={onClose}>
            <IconCloseFill14 />
          </button>
        </div>
        <div className={styles.shareActions}>
          <button type="button">
            <span className={styles.imageCircle}>
              <ImageIcon />
            </span>
            <small>{t('generateImage')}</small>
          </button>
          <button type="button">
            <span className={styles.linkCircle}>
              <IconLinkOutline14 />
            </span>
            <small>{t('copyLink')}</small>
          </button>
          <button type="button">
            <span className={styles.wechatCircle}>
              <WeChatIcon />
            </span>
            <small>{t('shareToWeChat')}</small>
          </button>
          <button type="button">
            <span className={styles.moreCircle}>
              <IconEllipsisOutline16 />
            </span>
            <small>{t('moreSharing')}</small>
          </button>
        </div>
      </footer>
    </section>,
    document.body
  )
}
