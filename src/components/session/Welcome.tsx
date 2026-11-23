import { useEffect, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { android } from '../../app/android.js'
import whale from '../../assets/deepseek-whale.svg'
import {
  useAndroidColdStartGreeting,
  useAndroidWelcomeMessages,
  useTranslate,
} from '../../i18n/index.js'
import { resolveCharacter, useCharacters } from '../../services/characters/store.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { openList as openCharacters } from '../characters/charactersDialogState.js'
import charStyles from '../characters/Characters.module.css'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

let coldStartGreetingPending = true

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const coldStartGreeting = useAndroidColdStartGreeting()
  const androidMessages = useAndroidWelcomeMessages()
  const [hasPhotoSuggestions, setHasPhotoSuggestions] = useState(false)
  const selectedId = useCharacters((state) => state.selectedCharacterId)
  const selected = resolveCharacter(selectedId)
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
      <div
        className={styles.welcome}
        data-side-shift={android ? 'center' : undefined}
        data-has-photo-suggestions={hasPhotoSuggestions ? 'true' : undefined}
      >
        <div className={styles.greeting}>
          {android ? <img src={whale} alt="" /> : null}
          {android ? <span className={styles.greetingText}>{greeting}</span> : greeting}
        </div>
        <button
          type="button"
          className={charStyles.chip}
          onClick={openCharacters}
          aria-label={t('charactersTitle')}
        >
          {selected?.avatar ? (
            <img className={charStyles.chipAvatar} src={selected.avatar} alt="" />
          ) : (
            <span className={charStyles.chipAvatar}>
              {selected ? selected.name.slice(0, 1) : <img src={whale} alt="" />}
            </span>
          )}
          <span>{selected?.name ?? 'DeepSeek'}</span>
        </button>
        <ChatInput sessionId={null} onPhotoSuggestionsChange={setHasPhotoSuggestions} />
        {isMobile && !android ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
