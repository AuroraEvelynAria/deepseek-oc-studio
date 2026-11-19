import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { android } from '../../app/android.js'
import {
  IconCopyOutline16,
  IconFlagOutline16,
  IconPlayMediaOutline16,
  IconRefreshOutline16,
  IconSelectTextOutline16,
  IconShareArrowOutline16,
  IconShareOutline16,
  IconThumbDown16,
  IconThumbUp16,
  IconWarningOutline16,
} from '../base/icons.js'
import { describeReply } from '../../services/chat/describe.js'
import { canContinueReply } from '../../services/chat/reply.js'
import { continueReply, regenerateReply } from '../../services/chat/store.js'
import {
  describeReadAloudError,
  stopReadAloud,
  toggleReadAloud,
} from '../../services/speech/readAloud.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import type { AssistantMessage as AssistantMessageType } from '../../services/chat/types.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { copyText as copyToClipboard } from '../../utils/clipboard.js'
import { IconButton } from '../base/IconButton.js'
import { Button } from '../base/Button.js'
import { Menu } from '../base/Menu.js'
import { Markdown } from '../markdown/Markdown.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import { ReadAloudButton } from './ReadAloudButton.js'
import { CopyButton } from './CopyButton.js'
import { MessageFeedbackSheet } from './MessageFeedbackSheet.js'
import { ReplyArea } from './ReplyArea.js'
import { useReplyView } from './useReplyView.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import styles from './AssistantMessage.module.css'

const TOP_UP_URL = 'https://platform.deepseek.com/top_up'

export const AssistantMessage = memo(function AssistantMessage({
  sessionId,
  message,
  isLast,
  streaming,
  busy,
  versions,
  onSelectVersion,
  onShare,
}: {
  sessionId: string
  message: AssistantMessageType
  isLast: boolean
  streaming: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
  onShare: () => void
}) {
  const t = useTranslate()
  const view = useReplyView(message, streaming)
  const panelEntry = useSearchPanel((state) => state.entry)
  const notice = streaming ? null : describeReply(message)
  // 安全拒绝：已下发的思考与正文按协议丢弃，只显示模板答复。
  const refused = message.stopReason === 'refusal'
  const answer = refused ? null : view.answer
  const responseText = [answer?.text, notice?.presentation === 'response' ? notice.text : null]
    .filter(Boolean)
    .join('\n\n')
  const copyText = responseText || notice?.text
  const [liked, setLiked] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectionRects, setSelectionRects] = useState<{
    start: { x: number; y: number }
    end: { x: number; y: number }
    toolbarTop: number
  } | null>(null)
  const selectableRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const wasStreaming = useRef(streaming)

  const stopSelecting = useCallback(() => {
    setSelecting(false)
    setSelectionRects(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  const startSelecting = () => {
    setSelecting(true)
    requestAnimationFrame(() => {
      const root = contentRef.current
      const positionRoot = selectableRef.current
      if (!root || !positionRoot) {
        return
      }
      const range = document.createRange()
      range.selectNodeContents(root)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      const rects = [...range.getClientRects()].filter(
        (rect) => rect.width > 1 && rect.height > 1
      )
      if (rects.length === 0) {
        return
      }
      const rootRect = positionRoot.getBoundingClientRect()
      const first = rects[0]
      const last = rects[rects.length - 1]
      setSelectionRects({
        start: { x: first.left - rootRect.left, y: first.top - rootRect.top - 6 },
        end: { x: last.right - rootRect.left, y: last.top - rootRect.top - 6 },
        toolbarTop: first.top - rootRect.top - 56,
      })
    })
  }

  useEffect(() => {
    if (!selecting) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!selectableRef.current?.contains(event.target as Node)) {
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

  const copyAssistantText = () => {
    if (!copyText) {
      return
    }
    void copyToClipboard(copyText).then((copied) =>
      showToast({ key: copied ? 'copied' : 'copyFailed' }, copied ? 1990 : undefined)
    )
  }
  useEffect(() => {
    if (
      android &&
      wasStreaming.current &&
      !streaming &&
      isLast &&
      responseText &&
      message.stopReason === 'end_turn' &&
      useSettings.getState().autoRead
    ) {
      toggleReadAloud(message.id, responseText, (error) => showToast(describeReadAloudError(error)))
    }
    wasStreaming.current = streaming
  }, [isLast, message.id, message.stopReason, responseText, streaming])
  const waiting =
    streaming && view.steps.length === 0 && !view.answer && (android || !message.thinking)
  const summaryEntry = `${message.id}-summary`
  return (
    <div className={styles.message}>
      {refused ? null : (
        <ReplyArea
          message={message}
          view={view}
          streaming={streaming}
          hasResponse={!!responseText}
        />
      )}
      <div
        ref={selectableRef}
        className={clsx(styles.selectable, android && selecting && styles.selecting)}
        onContextMenu={(event) => {
          if (!android || !responseText) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          stopSelecting()
          menuTriggerRef.current?.click()
        }}
        onClick={selecting ? stopSelecting : undefined}
      >
        {android && responseText ? (
          <Menu
            variant="assistantMessage"
            anchorClassName={styles.menuAnchor}
            options={[
              {
                key: 'copy',
                label: t('copy'),
                icon: <IconCopyOutline16 />,
                onSelect: copyAssistantText,
              },
              {
                key: 'selectText',
                label: t('androidSelectText'),
                icon: <IconSelectTextOutline16 />,
                onSelect: startSelecting,
              },
              {
                key: 'regenerate',
                label: t('regenerate'),
                icon: <IconRefreshOutline16 />,
                onSelect: () => {
                  stopReadAloud()
                  regenerateReply(sessionId, message.id)
                },
              },
              {
                key: 'like',
                label: t('like'),
                icon: <IconThumbUp16 filled={liked} />,
                onSelect: () => setLiked((value) => !value),
              },
              {
                key: 'dislike',
                label: t('dislike'),
                icon: <IconThumbDown16 />,
                onSelect: () => setFeedbackOpen(true),
              },
              {
                key: 'read',
                label: t('ttsPlay'),
                icon: <IconPlayMediaOutline16 />,
                onSelect: () =>
                  toggleReadAloud(message.id, responseText, (error) =>
                    showToast(describeReadAloudError(error))
                  ),
              },
              {
                key: 'share',
                label: t('share'),
                icon: <IconShareArrowOutline16 />,
                onSelect: onShare,
              },
              {
                key: 'report',
                label: t('report'),
                icon: <IconFlagOutline16 />,
                onSelect: () => setFeedbackOpen(true),
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
        ) : null}
        <div ref={contentRef} className={styles.selectableContent}>
          {answer ? (
            <Markdown
              className="ds-assistant-message-main-content"
              content={answer.markdown}
              loading={streaming}
              cacheKey={message.id}
              disableLink={false}
              a11yKeyPrefix={android ? `assistant-answer-${message.id}` : undefined}
              sources={view.sources}
            />
          ) : null}
          {notice?.presentation === 'response' ? (
            <Markdown
              className="ds-assistant-message-main-content"
              content={notice.text}
              loading={false}
              cacheKey={`${message.id}-template`}
              disableLink={false}
            />
          ) : notice ? (
            <div className={styles.notice}>
              <IconWarningOutline16 />
              <span>
                {notice.text}
                {notice.action === 'apiKey' ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className={styles.noticeAction}
                      onClick={() => openSettings('data')}
                    >
                      {t('changeApiKey')}
                    </button>
                  </>
                ) : null}
                {notice.action === 'topUp' ? (
                  <>
                    {' '}
                    <a
                      className={styles.noticeAction}
                      href={TOP_UP_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('topUp')}
                    </a>
                  </>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
        {android && selecting ? (
          <>
            <span
              className={styles.selectionHandle}
              style={{
                left: selectionRects?.start.x,
                top: selectionRects?.start.y,
              }}
              aria-hidden="true"
            />
            <span
              className={styles.selectionHandle}
              style={{
                left: selectionRects?.end.x,
                top: selectionRects?.end.y,
              }}
              aria-hidden="true"
            />
            <div
              className={styles.selectionToolbar}
              role="toolbar"
              style={{ top: selectionRects?.toolbarTop }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label={t('copy')}
                onClick={() => {
                  copyAssistantText()
                  stopSelecting()
                }}
              >
                <IconCopyOutline16 />
                <span>{t('copy')}</span>
              </button>
              <button
                type="button"
                aria-label={t('share')}
                onClick={() => {
                  stopSelecting()
                  onShare()
                }}
              >
                <IconShareArrowOutline16 />
                <span>{t('share')}</span>
              </button>
            </div>
          </>
        ) : null}
      </div>
      {waiting ? (
        <div className={styles.waiting}>
          {[0, 1, 2].map((index) => (
            <span key={index} className={styles.waitingDot} />
          ))}
        </div>
      ) : null}
      {!streaming && !refused && view.searchResults.length > 0 ? (
        <div
          className={clsx(styles.summary, panelEntry === summaryEntry && styles.summaryActive)}
          role="button"
          tabIndex={0}
          aria-expanded={panelEntry === summaryEntry}
          onClick={() => toggleSearchPanel(summaryEntry, view.searchResults)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggleSearchPanel(summaryEntry, view.searchResults)
            }
          }}
        >
          <SiteThumbnails sources={view.searchResults} />
          <span>
            {t(
              view.searchResults.length === 1 ? 'messageSearchSummary' : 'messageSearchSummaries',
              { count: view.searchResults.length }
            )}
          </span>
        </div>
      ) : null}
      {streaming ? null : (
        <div className={styles.bottom}>
          <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
          <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
            {copyText ? (
              <CopyButton
                className={styles.actionCopy}
                text={copyText}
                buttonProps={
                  android
                    ? {
                        'data-android-a11y': `reply-copy-${message.id}`,
                        'data-android-a11y-label': t('copy'),
                        'data-android-a11y-checkable': 'false',
                        'data-android-a11y-label-kind': 'description',
                        'data-android-a11y-touch-through': 'true',
                        tabIndex: -1,
                        onMouseDown: (event) => event.preventDefault(),
                      }
                    : undefined
                }
                iconWrapperClassName={android ? styles.actionIcon : undefined}
              />
            ) : null}
            {responseText && !refused ? (
              <label
                className={clsx(styles.reaction, styles.actionLike)}
                data-checked={liked}
                data-disabled={busy}
                data-android-a11y={android ? `reply-like-${message.id}` : undefined}
                data-android-a11y-label={t('like')}
                data-android-a11y-checked={liked ? 'true' : 'false'}
                data-android-a11y-label-kind="description"
              >
                <input
                  type="checkbox"
                  checked={liked}
                  disabled={busy}
                  aria-label={t('like')}
                  onChange={() => setLiked((value) => !value)}
                />
                <span
                  className={android ? styles.actionIcon : undefined}
                  data-android-a11y-label-node=""
                >
                  <IconThumbUp16 filled={liked} />
                </span>
              </label>
            ) : null}
            {responseText && !refused ? (
              <IconButton
                icon={
                  <span
                    className={android ? styles.actionIcon : undefined}
                    data-android-a11y-label-node=""
                  >
                    <IconThumbDown16 />
                  </span>
                }
                tooltip={t('dislike')}
                tooltipPlacement="bottom"
                className={styles.actionDislike}
                disabled={busy}
                data-android-a11y={android ? `reply-dislike-${message.id}` : undefined}
                data-android-a11y-label={t('dislike')}
                data-android-a11y-checked="false"
                data-android-a11y-label-kind="description"
                onClick={() => setFeedbackOpen(true)}
              />
            ) : null}
            {responseText && !refused ? (
              <ReadAloudButton
                className={styles.actionRead}
                messageId={message.id}
                text={responseText}
                androidA11yKey={android ? `reply-read-${message.id}` : undefined}
              />
            ) : null}
            {responseText && !refused ? (
              <IconButton
                icon={
                  android ? (
                    <span className={styles.actionIcon} data-android-a11y-label-node="">
                      <IconShareOutline16 />
                    </span>
                  ) : (
                    <IconShareOutline16 />
                  )
                }
                tooltip={t('share')}
                tooltipPlacement="bottom"
                className={styles.actionShare}
                disabled={busy}
                data-android-a11y={android ? `reply-share-${message.id}` : undefined}
                data-android-a11y-label={t('share')}
                data-android-a11y-checkable="false"
                data-android-a11y-label-kind="description"
                data-android-a11y-touch-through={android ? 'true' : undefined}
                onClick={onShare}
              />
            ) : null}
            <IconButton
              className={clsx(styles.regenerate, styles.actionRegenerate)}
              icon={
                android ? (
                  <span className={styles.actionIcon} data-android-a11y-label-node="">
                    <IconRefreshOutline16 />
                  </span>
                ) : (
                  <IconRefreshOutline16 />
                )
              }
              tooltip={t('regenerate')}
              tooltipPlacement="bottom"
              disabled={busy || refused}
              data-android-a11y={android ? `reply-regenerate-${message.id}` : undefined}
              data-android-a11y-label={t('regenerate')}
              data-android-a11y-checkable="false"
              data-android-a11y-label-kind="description"
              data-android-a11y-touch-through={android ? 'true' : undefined}
              onClick={() => {
                stopReadAloud()
                regenerateReply(sessionId, message.id)
              }}
            />
          </div>
          {isLast && canContinueReply(message) ? (
            <Button
              variant="outlined"
              size="s"
              className={styles.continueButton}
              disabled={busy}
              onClick={() => {
                stopReadAloud()
                continueReply(sessionId, message.id)
              }}
            >
              {t('continueGenerating')}
            </Button>
          ) : null}
        </div>
      )}
      {feedbackOpen ? <MessageFeedbackSheet onClose={() => setFeedbackOpen(false)} /> : null}
    </div>
  )
})
