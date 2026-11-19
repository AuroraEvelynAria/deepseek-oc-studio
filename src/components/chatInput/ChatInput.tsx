import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { android } from '../../app/android.js'
import {
  IconGlobeLanguageOutline14,
  IconPaperclipOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { AndroidCircle } from '../base/AndroidIcons.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { AndroidAttachments } from './AndroidAttachments.js'
import { AndroidDraftAttachments } from './AndroidDraftAttachments.js'
import { AndroidVoiceOverlay } from './AndroidVoiceOverlay.js'
import { useHoldToTalk } from './useHoldToTalk.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

const useVoiceMode = create<{ enabled: boolean }>(() => ({ enabled: false }))

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const imagesUploading = useUploads((state) =>
    attachments.some(
      (item) =>
        item.isImage && (!state.tasks[item.id] || state.tasks[item.id].status === 'uploading')
    )
  )
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)
  const voiceMode = useVoiceMode((state) => state.enabled)
  const [showAttachments, setShowAttachments] = useState(false)
  const [typing, setTyping] = useState(false)
  const [androidPristine, setAndroidPristine] = useState(true)
  const sendSpoken = useRef(false)

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }
    if (android) {
      toggles.classList.remove(styles.collapsedToggles)
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[], recentPhotoId?: string) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(
      sessionId,
      files,
      useSettings.getState().apiKey ?? '',
      recentPhotoId
    )
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    if (sendSpoken.current) {
      sendSpoken.current = false
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        stopReadAloud()
        sendMessage(sessionId)
      }
      return
    }
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })
  const hold = useHoldToTalk(voice, () => {
    if (importingHistory || streaming || !ensureApiKey()) {
      return false
    }
    setShowAttachments(false)
    sendSpoken.current = true
    return true
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'
  const voiceOverlayActive = recording || voice.status === 'transcribing'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady
  const showSend = !android || streaming || draftReady || typing

  useEffect(() => {
    if (!showAttachments) {
      return
    }
    const closeOnBack = (event: Event) => {
      if (event.defaultPrevented) {
        return
      }
      event.preventDefault()
      setShowAttachments(false)
    }
    window.addEventListener('android-back', closeOnBack)
    return () => window.removeEventListener('android-back', closeOnBack)
  }, [showAttachments])

  useEffect(() => {
    if (!android) {
      return
    }
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      const textarea = textareaRef.current
      if (!root.hasAttribute('data-keyboard') && document.activeElement === textarea) {
        textarea?.blur()
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-keyboard'] })
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!android || !typing) {
      return
    }
    const textarea = textareaRef.current
    textarea?.focus({ preventScroll: true })
    if (androidPristine && !getDraft(sessionId).text) {
      textarea?.setSelectionRange(0, 0)
    }
  }, [androidPristine, sessionId, t, typing])

  const focusComposer = () => {
    if (android) {
      setTyping(true)
      if (!getDraft(sessionId).text) {
        setAndroidPristine(true)
      }
    } else {
      textareaRef.current?.focus({ preventScroll: true })
    }
  }

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    setShowAttachments(false)
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  const androidPlaceholder = android && !voiceMode && !typing && !text.trim()
  const textareaValue =
    android && typing && androidPristine && !text ? t('androidMessageHint') : text
  const photoSuggestions =
    !!android && !text.trim() && attachments.some((item) => item.isImage)

  return (
    <div className={styles.composer} data-photo-suggestions={photoSuggestions ? '' : undefined}>
      <div
        data-drawer-gesture-ignore=""
        className={clsx(
          styles.wrapper,
          sessionId === null ? styles.home : styles.session,
          android && voiceOverlayActive && styles.recordingCard
        )}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            focusComposer()
          }
        }}
      >
        {android ? (
          <AndroidDraftAttachments
            items={attachments}
            suggestions={photoSuggestions}
            loading={imagesUploading}
            canSend={canSend}
            onRetry={retryFile}
            onRemove={removeFile}
            onSuggestion={(message) => {
              if (!canSend || getDraft(sessionId).text.trim()) {
                return
              }
              setText(message)
              send()
            }}
          />
        ) : (
          <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
        )}
        <div
          className={styles.textareaWrapper}
          onClick={(event) => {
            if (android && event.target === event.currentTarget) {
              focusComposer()
            }
          }}
        >
          {android && voiceMode ? (
            <button
              type="button"
              className={styles.holdButton}
              disabled={importingHistory || streaming}
              {...hold.direct}
              onPointerDown={(event) => {
                if (voice.status === 'transcribing') {
                  voice.cancel()
                } else {
                  hold.direct.onPointerDown(event)
                }
              }}
            >
              {t(voice.status === 'transcribing' ? 'voiceInputCancel' : 'androidHoldToTalk')}
            </button>
          ) : (
            <textarea
              ref={textareaRef}
              className={clsx(
                styles.textarea,
                android && styles.androidTextarea,
                android && androidPristine && styles.androidPristine,
                androidPlaceholder && styles.androidTextareaHidden,
                recording && isMobile && styles.textareaHidden
              )}
              placeholder={t(
                android
                  ? typing
                    ? 'androidMessageHint'
                    : 'androidHoldHint'
                  : 'chatInputPlaceholderChat'
              )}
              rows={2}
              // 移动端不自动聚焦，避免一打开就弹出键盘
              autoFocus={!isMobile}
              disabled={importingHistory}
              value={textareaValue}
              onChange={(event) => {
                let value = event.target.value
                if (android && androidPristine) {
                  const prompt = t('androidMessageHint')
                  setAndroidPristine(false)
                  if (value.includes(prompt)) {
                    value = value.replaceAll(prompt, '')
                  }
                }
                setText(value)
              }}
              onFocus={() => {
                setTyping(true)
                if (android && !getDraft(sessionId).text) {
                  setAndroidPristine(true)
                }
                setShowAttachments(false)
              }}
              onBlur={() => {
                setTyping(false)
                if (android) {
                  setAndroidPristine(!getDraft(sessionId).text)
                }
              }}
              {...(android ? hold.delayed : {})}
              onPointerDown={(event) => {
                if (android && !text && !typing) {
                  hold.delayed.onPointerDown(event)
                }
              }}
              onContextMenu={(event) => {
                if (recording && android) {
                  event.preventDefault()
                }
              }}
              onMouseDown={(event) => {
                // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
                if (
                  isMobile &&
                  event.button === 0 &&
                  document.activeElement !== event.currentTarget
                ) {
                  event.preventDefault()
                  event.currentTarget.focus({ preventScroll: true })
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  send()
                }
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files)
                if (files.length > 0) {
                  event.preventDefault()
                  acceptFiles(files)
                }
              }}
            />
          )}
          {androidPlaceholder ? (
            <div className={styles.androidPlaceholder}>{t('androidHoldHint')}</div>
          ) : null}
          {recording && isMobile && !android ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
          {voiceMode ? null : (
            <div className={styles.mirror} aria-hidden>
              {`${text}\n`}
            </div>
          )}
        </div>
        <div
          className={styles.functionRow}
          data-empty-typing={android && typing && !draftReady ? '' : undefined}
        >
          {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
          <div ref={togglesRef} className={styles.toggles}>
            <Tooltip content={t('deactivatedThinkTooltip')}>
              <button
                type="button"
                role="link"
                className={clsx(android ? styles.toggleTarget : styles.toggle, thinking && styles.selected)}
                aria-label={t('thinkingSwitch')}
                aria-pressed={thinking}
                data-android-a11y={android ? 'composer-thinking' : undefined}
                data-android-a11y-label={android ? t('thinkingSwitch') : undefined}
                data-android-a11y-label-kind={android ? 'text' : undefined}
                onClick={() => setThinking(!thinking)}
              >
                {android ? (
                  <span className={clsx(styles.toggle, thinking && styles.selected)}>
                    <IconThinkOutline14 />
                    <span className={styles.toggleLabel} data-android-a11y-label-node="">
                      {t('thinkingSwitch')}
                    </span>
                  </span>
                ) : (
                  <>
                    <IconThinkOutline14 />
                    <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
                  </>
                )}
              </button>
            </Tooltip>
            <Tooltip content={t('deactivatedSearchTooltip')}>
              <button
                type="button"
                role="link"
                className={clsx(
                  android ? styles.toggleTarget : styles.toggle,
                  android && styles.searchToggleTarget,
                  search && styles.selected
                )}
                aria-label={t('search')}
                aria-pressed={search}
                data-android-a11y={android ? 'composer-search' : undefined}
                data-android-a11y-label={android ? t('search') : undefined}
                data-android-a11y-label-kind={android ? 'text' : undefined}
                onClick={() => setSearch(!search)}
              >
                {android ? (
                  <span className={clsx(styles.toggle, search && styles.selected)}>
                    <IconGlobeLanguageOutline14 />
                    <span className={styles.toggleLabel} data-android-a11y-label-node="">
                      {t('search')}
                    </span>
                  </span>
                ) : (
                  <>
                    <IconGlobeLanguageOutline14 />
                    <span className={styles.toggleLabel}>{t('search')}</span>
                  </>
                )}
              </button>
            </Tooltip>
          </div>
          <div className={styles.right}>
            {android ? (
              <>
                <IconButton
                  size="xl"
                  tone="primary"
                  role="link"
                  icon={
                    <span className={styles.androidToolIcon} data-android-a11y-label-node="">
                      <AndroidCircle icon={showAttachments ? 'close' : 'add'} />
                    </span>
                  }
                  aria-label={t(showAttachments ? 'close' : 'uploadFile')}
                  aria-expanded={showAttachments}
                  className={android ? styles.androidUploadTarget : undefined}
                  data-android-a11y={android ? 'composer-upload' : undefined}
                  data-android-a11y-label={android ? t(showAttachments ? 'close' : 'uploadFile') : undefined}
                  data-android-a11y-label-kind={android ? 'description' : undefined}
                  data-android-a11y-checkable={android ? 'false' : undefined}
                  disabled={importingHistory}
                  onClick={() => {
                    textareaRef.current?.blur()
                    setShowAttachments(!showAttachments)
                  }}
                />
                {typing || (draftReady && (attachments.length === 0 || text.trim())) ? null : (
                  <IconButton
                    size="xl"
                    tone="primary"
                    role="link"
                    icon={
                      <span
                        className={clsx(
                          styles.androidToolIcon,
                          styles.androidVoiceIcon
                        )}
                        data-android-a11y-label-node=""
                      >
                        <AndroidCircle icon={voiceMode ? 'keys' : 'voice'} />
                      </span>
                    }
                    aria-label={t(voiceMode ? 'androidTextMode' : 'androidVoiceMode')}
                    aria-pressed={voiceMode}
                    className={android ? styles.androidVoiceTarget : undefined}
                    data-android-a11y={android ? 'composer-voice' : undefined}
                    data-android-a11y-label={android ? t(voiceMode ? 'androidTextMode' : 'androidVoiceMode') : undefined}
                    data-android-a11y-label-kind={android ? 'description' : undefined}
                    data-android-a11y-checkable={android ? 'false' : undefined}
                    data-android-a11y-focusable={android ? 'false' : undefined}
                    onClick={() => {
                      voice.cancel()
                      useVoiceMode.setState({ enabled: !voiceMode })
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <VoiceButton
                  status={voice.status}
                  disabled={!voice.available}
                  seconds={voice.seconds}
                  onClick={() => {
                    if (
                      voice.status !== 'idle' ||
                      (!useChatStore.getState().importingHistory && ensureApiKey())
                    ) {
                      void voice.toggle()
                    }
                  }}
                />
                <IconButton
                  size="m"
                  tone="primary"
                  icon={<IconPaperclipOutline16 />}
                  tooltip={t('uploadFile')}
                  disabled={importingHistory}
                  onClick={() => ensureApiKey() && fileInputRef.current?.click()}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  accept={ACCEPT}
                  onChange={(event) => {
                    acceptFiles(Array.from(event.target.files ?? []))
                    event.target.value = ''
                  }}
                />
              </>
            )}
            {streaming && sessionId ? (
              <button
                type="button"
                className={styles.sendButton}
                aria-label={t('chatInputStopButtonTooltip')}
                onClick={() => {
                  stopReadAloud()
                  stopReply(sessionId)
                }}
              >
                <span className={styles.androidSendVisual}>
                  <IconStopFill16 />
                </span>
              </button>
            ) : showSend ? (
              <button
                type="button"
                className={clsx(styles.sendButton, !canSend && styles.disabled)}
                aria-label={t('send')}
                aria-disabled={!canSend}
                data-android-a11y={android ? 'composer-send' : undefined}
                data-android-a11y-label={android ? t('send') : undefined}
                data-android-a11y-label-kind={android ? 'description' : undefined}
                data-android-a11y-checkable={android ? 'false' : undefined}
                onPointerDown={(event) => {
                  if (android && !canSend) {
                    event.preventDefault()
                  }
                }}
                onClick={send}
              >
                <span className={styles.androidSendVisual}>
                  <span className={styles.androidSendLabel} data-android-a11y-label-node="">
                    <IconSendOutline16 />
                  </span>
                </span>
              </button>
            ) : null}
          </div>
        </div>
        {dragging ? <DragMask /> : null}
      </div>
      {android ? (
        <>
          <AndroidAttachments
            open={showAttachments}
            selectedPhotos={
              new Map(
                attachments.flatMap((item) =>
                  item.recentPhotoId ? [[item.recentPhotoId, item.id] as const] : []
                )
              )
            }
            onRecentFile={(file, photoId) => acceptFiles([file], photoId)}
            onRemove={removeFile}
            onFiles={(files, source) => {
              setShowAttachments(false)
              acceptFiles(files)
              if (source === 'gallery') {
                focusComposer()
              }
            }}
          />
          <AndroidVoiceOverlay
            active={voiceOverlayActive}
            canceling={hold.canceling}
            level={voice.getLevel}
          />
        </>
      ) : null}
    </div>
  )
}
