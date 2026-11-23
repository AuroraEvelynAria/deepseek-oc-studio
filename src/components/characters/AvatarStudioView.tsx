import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import {
  AVATAR_CANDIDATES,
  AVATAR_STYLES,
  adoptCandidate,
  generateCandidates,
  isImageGenAvailable,
  useAvatarStudio,
  type AvatarSlot,
} from '../../services/characters/avatarStudio.js'
import { saveCharacter, resolveCharacter } from '../../services/characters/store.js'
import { openList } from './charactersDialogState.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from '../characters/Characters.module.css'

/** 空槽位：候选图只属于生成时选中的角色，换角色时不显示别人的图。 */
const EMPTY_SLOTS: AvatarSlot[] = Array.from({ length: AVATAR_CANDIDATES }, () => ({
  state: 'empty',
}))

/** 形象工作室：描述 → 四候选 → 定妆设为头像（nanoMuse 流程的 OC 版）。 */
export const AvatarStudioView = ({ id }: { id: string }) => {
  const t = useTranslate()
  const character = resolveCharacter(id)
  const owner = useAvatarStudio((state) => state.characterId)
  const storedSlots = useAvatarStudio((state) => state.slots)
  const generating = useAvatarStudio((state) => state.generating) && owner === id
  const slots = owner === id ? storedSlots : EMPTY_SLOTS
  const [description, setDescription] = useState(
    () => character?.prompt.split('\n').find((line) => line.trim()) ?? ''
  )
  const [styleId, setStyleId] = useState(useAvatarStudio.getState().styleId)
  const [error, setError] = useState<string | null>(null)
  const available = isImageGenAvailable()

  const generate = () => {
    if (!description.trim()) {
      setError(t('avatarNeedDescription'))
      return
    }
    if (!available) {
      setError(t('avatarNeedSiliconflow'))
      return
    }
    if (!character) {
      return
    }
    setError(null)
    generateCandidates(description, styleId, character.id)
  }

  return (
    <div className={styles.editForm}>
      <button type="button" className={styles.back} onClick={openList}>
        <span className={styles.backIcon}>
          <IconChevronRightOutline14 />
        </span>
        {t('back')}
      </button>
      <p className={styles.rowName}>{character?.name ?? ''} · {t('studioTitle')}</p>
      <label className={styles.field}>
        <span>{t('avatarDescription')}</span>
        <textarea
          rows={3}
          value={description}
          placeholder={t('avatarDescriptionPlaceholder')}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </label>
      <div className={styles.field}>
        <span>{t('avatarStyle')}</span>
        <div className={styles.dimensionPicker}>
          {AVATAR_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              className={styles.dimensionChip}
              data-active={styleId === style.id ? '' : undefined}
              onClick={() => setStyleId(style.id)}
            >
              {t(style.labelKey)}
            </button>
          ))}
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className={styles.grid}>
        {slots.map((slot, index) => (
          <button
            key={index}
            type="button"
            className={styles.cell}
            data-state={slot.state}
            disabled={slot.state !== 'ready' || generating}
            onClick={() => {
              if (slot.state !== 'ready') {
                return
              }
              void adoptCandidate(slot.url, (dataUrl) => {
                if (character) {
                  saveCharacter({ ...character, avatar: dataUrl })
                  showToast({ key: 'avatarAdopted', params: { name: character.name } })
                }
                openList()
              }).catch(() => {
                setError(t('avatarAdoptFailed'))
              })
            }}
          >
            {slot.state === 'ready' ? (
              <img src={slot.url} alt="" loading="lazy" />
            ) : slot.state === 'loading' ? (
              <span className={styles.cellLoading}>{t('studioDrawing')}</span>
            ) : slot.state === 'failed' ? (
              <span className={styles.cellFailed}>{t('studioFailed')}</span>
            ) : null}
          </button>
        ))}
      </div>
      {!available ? <p className={styles.fieldHint}>{t('avatarNeedSiliconflow')}</p> : null}
      <div className={styles.editActions}>
        <Button size="m" disabled={generating} onClick={generate}>
          {generating ? t('studioGenerating') : t('studioGenerate', { count: AVATAR_CANDIDATES })}
        </Button>
      </div>
    </div>
  )
}
