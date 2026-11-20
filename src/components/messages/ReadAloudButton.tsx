import { useTranslate } from '../../i18n/index.js'
import {
  describeReadAloudError,
  toggleReadAloud,
  useReadAloud,
} from '../../services/speech/readAloud.js'
import { IconPlayMediaOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'
import { ReadingBars } from './ReadingBars.js'

/** 朗读按钮：未朗读时点击开始，加载中或朗读中点击停止；正文原样提交，由服务端过滤 markdown */
export const ReadAloudButton = ({
  messageId,
  text,
  className,
  androidA11yKey,
}: {
  messageId: string
  text: string
  className?: string
  androidA11yKey?: string
}) => {
  const t = useTranslate()
  const status = useReadAloud((state) => (state.messageId === messageId ? state.status : 'idle'))
  const label = status === 'idle' ? t('ttsPlay') : t('ttsStop')
  return (
    <IconButton
      icon={status === 'idle' ? <IconPlayMediaOutline16 /> : <ReadingBars mode={status} />}
      tooltip={label}
      tooltipPlacement="bottom"
      className={className}
      data-android-a11y={androidA11yKey}
      data-android-a11y-label={androidA11yKey ? label : undefined}
      data-android-a11y-checkable={androidA11yKey ? 'false' : undefined}
      data-android-a11y-role={androidA11yKey ? 'button' : undefined}
      data-android-a11y-label-kind={androidA11yKey ? 'none' : undefined}
      data-android-a11y-touch-through={androidA11yKey ? 'true' : undefined}
      tabIndex={androidA11yKey ? -1 : undefined}
      onMouseDown={androidA11yKey ? (event) => event.preventDefault() : undefined}
      onClick={() =>
        toggleReadAloud(messageId, text, (error) => showToast(describeReadAloudError(error)))
      }
    />
  )
}
