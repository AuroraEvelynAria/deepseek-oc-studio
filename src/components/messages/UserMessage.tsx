import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { android } from '../../app/android.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  IconCopyOutline16,
  IconEditOutline16,
  IconSelectTextOutline16,
  IconShareArrowOutline16,
} from '../base/icons.js'
import { editMessage, retryUpload } from '../../services/chat/store.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import type { UserMessage as UserMessageType } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { showToast } from '../base/toastState.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { copyText } from '../../utils/clipboard.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import { MessageFile } from './MessageFile.js'
import { CopyButton } from './CopyButton.js'
import styles from './UserMessage.module.css'

export const UserMessage = memo(function UserMessage({
  sessionId,
  message,
  retryUploadId,
  isFirst,
  isLast,
  busy,
  versions,
  onSelectVersion,
  onShare,
}: {
  sessionId: string
  message: UserMessageType
  /** 回答因补传附件失败可重试时为该回答 id */
  retryUploadId: string | null
  isFirst: boolean
  isLast: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
  onShare: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const bubbleTextRef = useRef<HTMLSpanElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const isMobile = useIsMobile()
  const canSend = !busy && (draft.trim() !== '' || message.files.length > 0)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (editing && textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 202)}px`
    }
  }, [editing, draft])

  const sendEdit = () => {
    if (canSend && ensureApiKey() && editMessage(sessionId, message.id, draft.trim())) {
      stopReadAloud()
      setEditing(false)
    }
  }

  const startEdit = () => {
    if (!busy) {
      setSelecting(false)
      setDraft(message.content)
      setEditing(true)
    }
  }

  const stopSelecting = useCallback(() => {
    setSelecting(false)
    window.getSelection()?.removeAllRanges()
  }, [])

  const startSelecting = () => {
    setSelecting(true)
    requestAnimationFrame(() => {
      const text = bubbleTextRef.current
      if (!text) {
        return
      }
      const range = document.createRange()
      range.selectNodeContents(text)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  useEffect(() => {
    if (!selecting) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!bubbleRef.current?.contains(event.target as Node)) {
        stopSelecting()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        stopSelecting()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [selecting, stopSelecting])

  const copyMessage = () => {
    void copyText(message.content).then((copied) =>
      showToast({ key: copied ? 'copied' : 'copyFailed' }, copied ? 1990 : undefined)
    )
  }

  return (
    <div className={clsx(styles.container, isFirst && styles.isFirst)}>
      {message.files.length > 0 ? (
        <div
          className={clsx(
            styles.files,
            message.files.some((file) => !file.isImage) && styles.filesWithDocuments
          )}
        >
          {message.files.map((file) => (
            <MessageFile
              key={file.id}
              file={file}
              onRetry={retryUploadId ? () => retryUpload(sessionId, retryUploadId) : null}
            />
          ))}
        </div>
      ) : null}
      {editing ? (
        <div className={styles.editor}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            aria-label={t('editMessage')}
            autoFocus
            rows={1}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return
              }
              if (event.key === 'Escape') {
                setEditing(false)
              } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !isMobile) {
                event.preventDefault()
                sendEdit()
              }
            }}
          />
          <div className={styles.editorActions}>
            <Button size="s" variant="outlined" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button size="s" disabled={!canSend} onClick={sendEdit}>
              {t('send')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {message.content ? (
            <div
              ref={bubbleRef}
              className={styles.bubble}
              data-selecting={android && selecting ? 'true' : undefined}
              role={android ? 'button' : undefined}
              tabIndex={android ? 0 : undefined}
              data-android-a11y={android ? `user-message-${message.id}` : undefined}
              data-android-a11y-label={android ? message.content : undefined}
              data-android-a11y-role={android ? 'view' : undefined}
              data-android-a11y-checkable={android ? 'false' : undefined}
              aria-disabled={android && busy ? true : undefined}
              onClick={android ? (selecting ? stopSelecting : startEdit) : undefined}
              onKeyDown={(event) => {
                if (android && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  startEdit()
                }
              }}
              onContextMenu={(event) => {
                if (android) {
                  event.preventDefault()
                  stopSelecting()
                  menuTriggerRef.current?.click()
                }
              }}
            >
              <span
                ref={bubbleTextRef}
                className={styles.bubbleText}
                data-android-a11y-label-node={android ? '' : undefined}
              >
                {message.content}
                {android && selecting ? (
                  <>
                    <span
                      className={clsx(styles.selectionHandle, styles.selectionHandleStart)}
                      aria-hidden="true"
                    />
                    <span
                      className={clsx(styles.selectionHandle, styles.selectionHandleEnd)}
                      aria-hidden="true"
                    />
                  </>
                ) : null}
              </span>
              {android ? (
                <>
                  <Menu
                    variant="userMessage"
                    anchorClassName={styles.menuAnchor}
                    options={[
                      {
                        key: 'copy',
                        label: t('copy'),
                        icon: (
                          <span className={styles.menuCopyIcon}>
                            <IconCopyOutline16 />
                          </span>
                        ),
                        onSelect: copyMessage,
                      },
                      {
                        key: 'selectText',
                        label: t('androidSelectText'),
                        icon: <IconSelectTextOutline16 />,
                        onSelect: startSelecting,
                      },
                      {
                        key: 'edit',
                        label: t('androidEditMessage'),
                        icon: <IconEditOutline16 />,
                        onSelect: startEdit,
                      },
                      {
                        key: 'share',
                        label: t('share'),
                        icon: <IconShareArrowOutline16 />,
                        onSelect: onShare,
                      },
                    ]}
                  >
                    {({ toggle }) => (
                      <button
                        ref={menuTriggerRef}
                        className={styles.menuTrigger}
                        type="button"
                        aria-hidden="true"
                        tabIndex={-1}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggle()
                        }}
                      />
                    )}
                  </Menu>
                  {selecting ? (
                    <div
                      className={styles.selectionToolbar}
                      role="toolbar"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        aria-label={t('copy')}
                        onClick={() => {
                          copyMessage()
                          stopSelecting()
                        }}
                      >
                        <IconCopyOutline16 />
                        <span>{t('copy')}</span>
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          {!android || versions.ids.length > 1 ? (
            <div className={styles.bottom}>
              {!android ? (
                <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
                  {message.content ? <CopyButton text={message.content} /> : null}
                  <IconButton
                    icon={<IconEditOutline16 />}
                    tooltip={t('editMessage')}
                    tooltipPlacement="bottom"
                    disabled={busy}
                    onClick={startEdit}
                  />
                </div>
              ) : null}
              <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
})
