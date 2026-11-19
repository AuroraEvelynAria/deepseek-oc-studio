import { useEffect, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { android } from '../../app/android.js'
import whale from '../../assets/deepseek-whale.svg'
import {
  useAndroidColdStartGreeting,
  useAndroidWelcomeMessages,
  useTranslate,
} from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

let coldStartGreetingPending = true

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const coldStartGreeting = useAndroidColdStartGreeting()
  const androidMessages = useAndroidWelcomeMessages()
  const [coldStart] = useState(coldStartGreetingPending)
  const [greeting] = useState(() => {
    if (!android) {
      return t('welcomeMessageChat250808')
    }
    if (coldStart) {
      return coldStartGreeting
    }
    return androidMessages[Math.floor(Math.random() * androidMessages.length)]
  })
  useEffect(() => {
    if (android) {
      coldStartGreetingPending = false
    }
  }, [])
  return (
    <div className={styles.container} data-drawer-free-pan={android ? '' : undefined}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.greeting}>
          {android ? <img src={whale} alt="" /> : null}
          {android ? (
            <span
              className={styles.greetingText}
              data-android-a11y="welcome-greeting"
              data-android-a11y-label={greeting}
              data-android-a11y-role="textView"
              data-android-a11y-label-kind="selfText"
              data-android-a11y-checkable="false"
              data-android-a11y-clickable="false"
              data-android-a11y-focusable="false"
            >
              {greeting}
            </span>
          ) : (
            greeting
          )}
        </div>
        <ChatInput sessionId={null} />
        {isMobile && !android ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
