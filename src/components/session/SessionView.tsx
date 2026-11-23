import clsx from 'clsx'
import { memo, useState } from 'react'
import { android } from '../../app/android.js'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { exportSessionMarkdown, saveExportFile } from '../../services/chat/exportMarkdown.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { IconButton } from '../base/IconButton.js'
import { IconDownloadOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = memo(function SessionView({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [attachmentPanelOpen, setAttachmentPanelOpen] = useState(false)
  const title = session.title || t('untitledChat')
  const exportChat = () => {
    const { name, blob } = exportSessionMarkdown(session)
    saveExportFile(name, blob)
      .then((saved) => showToast({ key: saved ? 'chatExported' : 'chatExportCancelled' }))
      .catch(() => showToast({ key: 'chatExportFailed', type: 'error' }))
  }
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} onExport={exportChat} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <div className={styles.headerActions}>
            <IconButton
              size="xl"
              tone="primary"
              icon={<IconDownloadOutline16 />}
              aria-label={t('exportChat')}
              onClick={exportChat}
            />
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div
            className={styles.inputContainer}
            data-side-shift={android ? 'center' : undefined}
            data-attachment-open={attachmentPanelOpen ? 'true' : undefined}
          >
            <ChatInput sessionId={session.id} onAttachmentPanelChange={setAttachmentPanelOpen} />
            <div className={styles.caveatSlot}>
              <div className={styles.caveat}>
                {t(android ? 'androidContentCaveat' : 'contentCaveat')}
              </div>
            </div>
          </div>
        }
      />
    </div>
  )
})
