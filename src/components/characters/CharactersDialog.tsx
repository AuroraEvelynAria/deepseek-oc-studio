import { memo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import whale from '../../assets/deepseek-whale.svg'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  CHAT_API_FORMATS,
  chatBaseUrl,
  resolveChatEndpoint,
  type ChatApiFormat,
} from '../../services/api/chatConfig.js'
import { bindSessionCharacter, useChatStore } from '../../services/chat/store.js'
import {
  activatePreset,
  removePreset,
  savePreset,
  useModels,
  type ModelPreset,
} from '../../services/models/store.js'
import { PROVIDER_TEMPLATES } from '../../services/models/providers.js'
import {
  isMemoryEnabled,
  removeCharacter,
  removeMemory,
  resolveCharacter,
  saveCharacter,
  setMemoryEnabled,
  setSelectedCharacter,
  upsertMemory,
  useCharacters,
} from '../../services/characters/store.js'
import {
  DEFAULT_CHARACTER_ID,
  MEMORY_CONTENT_LIMIT,
  MEMORY_DIMENSIONS,
  type Character,
  type MemoryCard,
  type MemoryDimension,
} from '../../services/characters/types.js'
import { createId } from '../../utils/id.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import {
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconEditOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { SessionActionDialog } from '../sider/SessionActionDialog.js'
import {
  openMemory as openMemoryView,
  openEdit as openEditView,
  openModelEdit as openModelEditView,
  openList,
  useCharactersDialog,
} from './charactersDialogState.js'
import styles from './Characters.module.css'

const FORMATS = (Object.keys(CHAT_API_FORMATS) as ChatApiFormat[]).map((value) => ({
  value,
  label: CHAT_API_FORMATS[value],
}))

const endpointExamples: Record<ChatApiFormat, string> = {
  messages: 'https://api.deepseek.com/anthropic',
  chat: 'https://api.deepseek.com',
  responses: 'https://api.deepseek.com',
}

const MAX_AVATAR_EDGE = 256
const MAX_NAME_LENGTH = 40

/** 与个人资料头像一致的处理：居中裁剪并缩放为 webp dataURL。 */
const prepareAvatar = async (file: File) => {
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    image.src = url
    await image.decode()
    const { naturalWidth: width, naturalHeight: height } = image
    const crop = Math.min(width, height)
    const edge = Math.min(crop, MAX_AVATAR_EDGE)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = edge
    const context = canvas.getContext('2d')
    if (!context || edge === 0) {
      throw new Error('Unable to resize avatar')
    }
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, edge, edge)
    const avatar = canvas.toDataURL('image/webp', 0.85)
    if (avatar === 'data:,') {
      throw new Error('Unable to encode avatar')
    }
    return avatar
  } finally {
    URL.revokeObjectURL(url)
  }
}

const Avatar = ({ character, size = 'm' }: { character: Character | null; size?: 'm' | 'l' }) => {
  if (character?.avatar) {
    return <img className={`${styles.avatar} ${styles[size]}`} src={character.avatar} alt="" />
  }
  const name = character?.name ?? 'DeepSeek'
  return (
    <span className={`${styles.avatarFallback} ${styles[size]}`}>
      {character ? name.slice(0, 1) : <img src={whale} alt="" />}
    </span>
  )
}

/** 小开关；样式对齐设置页的行内控件。 */
const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={styles.toggle}
    data-checked={checked ? '' : undefined}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.toggleThumb} />
  </button>
)

/** 角色列表：官方 DeepSeek + 自定义角色；点击行设为新对话默认。下方为模型预设区块。 */
const ListView = () => {
  const t = useTranslate()
  const characters = useCharacters((state) => state.characters)
  const selectedId = useCharacters((state) => state.selectedCharacterId)
  const presets = useModels((state) => state.presets)
  const activeModelId = useModels((state) => state.activeId)
  const activeId = useChatStore((state) => state.activeId)
  const sessionCharacterId = useChatStore((state) => {
    const session =
      state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
        ? state.sessionCache[state.activeId]
        : undefined
    return session?.characterId ?? null
  })
  const [deleting, setDeleting] = useState<Character | null>(null)
  const [deletingModel, setDeletingModel] = useState<ModelPreset | null>(null)

  const rows: (Character | null)[] = [null, ...characters]
  return (
    <>
      <div className={styles.sectionTitle}>{t('charactersSection')}</div>
      <div className={styles.list}>
        {rows.map((character) => {
          const id = character?.id ?? null
          const isDefault = selectedId === id
          const memoryOn = isMemoryEnabled(id)
          const inUse = activeId !== null && sessionCharacterId === id
          return (
            <div key={id ?? 'default'} className={styles.row} data-selected={isDefault ? '' : undefined}>
              <button
                type="button"
                className={styles.rowMain}
                onClick={() => setSelectedCharacter(id)}
                aria-label={t('useForNewChats')}
              >
                <Avatar character={character} />
                <span className={styles.rowText}>
                  <span className={styles.rowName}>
                    {character?.name ?? 'DeepSeek'}
                    {isDefault ? (
                      <span className={styles.checkIcon}>
                        <IconCheckOutline16 />
                      </span>
                    ) : null}
                    {inUse ? <span className={styles.inUse}>{t('currentChatUsing')}</span> : null}
                  </span>
                  <span className={styles.rowSub}>
                    {character ? character.prompt.trim() || t('characterNoPrompt') : t('defaultCharacterSubtitle')}
                  </span>
                </span>
              </button>
              <div className={styles.rowActions}>
                {character ? (
                  <IconButton
                    size="m"
                    tone="primary"
                    icon={<IconEditOutline16 />}
                    tooltip={t('characterEdit')}
                    onClick={() => openEditView(character.id)}
                  />
                ) : null}
                <IconButton
                  size="m"
                  tone="primary"
                  icon={<IconTrashOutline16 />}
                  tooltip={t('delete')}
                  disabled={!character}
                  onClick={() => character && setDeleting(character)}
                />
                <Button size="s" variant="outlined" onClick={() => openMemoryView(id)}>
                  {t('memoryTitle')}
                </Button>
                {activeId !== null && !inUse ? (
                  <Button
                    size="s"
                    variant="outlined"
                    onClick={() => bindSessionCharacter(activeId, id)}
                  >
                    {t('useInCurrentChat')}
                  </Button>
                ) : null}
              </div>
              <div className={styles.rowMeta}>
                <span>{t('memoryAutoExtract')}</span>
                <Toggle
                  checked={memoryOn}
                  label={t('memoryAutoExtract')}
                  onChange={(value) => setMemoryEnabled(id, value)}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div className={styles.listFooter}>
        <Button size="m" variant="outlined" block onClick={() => openEditView(null)}>
          {t('newCharacter')}
        </Button>
      </div>
      <div className={styles.sectionTitle}>{t('modelsSection')}</div>
      <div className={styles.list}>
        {presets.map((preset) => {
          const isActive = activeModelId === preset.id
          const subtitle =
            preset.endpoint === ''
              ? t('modelOfficialSubtitle')
              : `${preset.model || t('modelUnnamed')} · ${CHAT_API_FORMATS[preset.format]}`
          return (
            <div key={preset.id} className={styles.row} data-selected={isActive ? '' : undefined}>
              <button
                type="button"
                className={styles.rowMain}
                onClick={() => activatePreset(preset.id)}
                aria-label={t('modelActivate')}
              >
                {(() => {
                  // 官方端点用官方鲸鱼 logo；命中提供商模板给官方图标；其余用首字占位
                  if (preset.endpoint === '') {
                    return (
                      <span className={styles.modelBadgeIcon}>
                        <img src={whale} alt="" />
                      </span>
                    )
                  }
                  const template = PROVIDER_TEMPLATES.find(
                    (item) => item.endpoint === preset.endpoint && item.format === preset.format
                  )
                  return template ? (
                    <span className={styles.modelBadgeIcon}>
                      <img src={template.icon} alt="" />
                    </span>
                  ) : (
                    <span className={styles.modelBadge}>{preset.name.slice(0, 1)}</span>
                  )
                })()}
                <span className={styles.rowText}>
                  <span className={styles.rowName}>
                    {preset.name}
                    {isActive ? (
                      <span className={styles.checkIcon}>
                        <IconCheckOutline16 />
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.rowSub}>{subtitle}</span>
                </span>
              </button>
              <div className={styles.rowActions}>
                <IconButton
                  size="m"
                  tone="primary"
                  icon={<IconEditOutline16 />}
                  tooltip={t('modelEdit')}
                  onClick={() => openModelEditView(preset.id)}
                />
                <IconButton
                  size="m"
                  tone="primary"
                  icon={<IconTrashOutline16 />}
                  tooltip={t('delete')}
                  disabled={presets.length <= 1}
                  onClick={() => setDeletingModel(preset)}
                />
              </div>
              <div className={styles.capChips}>
                {preset.vision ? <span className={styles.capChip}>{t('modelVision')}</span> : null}
                {preset.reasoning ? (
                  <span className={styles.capChip}>{t('modelReasoning')}</span>
                ) : null}
                {preset.search && preset.endpoint !== '' ? (
                  <span className={styles.capChip}>{t('modelSearch')}</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      <div className={styles.listFooter}>
        <Button size="m" variant="outlined" block onClick={() => openModelEditView(null)}>
          {t('modelNew')}
        </Button>
      </div>
      {deletingModel ? (
        <SessionActionDialog
          title={t('modelDeleteConfirmTitle', { name: deletingModel.name })}
          description={t('modelDeleteConfirmDescription')}
          cancelLabel={t('cancel')}
          confirmLabel={t('delete')}
          danger
          onCancel={() => setDeletingModel(null)}
          onConfirm={() => {
            removePreset(deletingModel.id)
            setDeletingModel(null)
          }}
        />
      ) : null}
      {deleting ? (
        <SessionActionDialog
          title={t('characterDeleteConfirmTitle', { name: deleting.name })}
          description={t('characterDeleteConfirmDescription', { name: deleting.name })}
          cancelLabel={t('cancel')}
          confirmLabel={t('delete')}
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            removeCharacter(deleting.id)
            setDeleting(null)
          }}
        />
      ) : null}
    </>
  )
}

/** 角色编辑：新建（id 为 null）或修改名称、头像、人设与记忆开关。 */
const EditView = ({ id }: { id: string | null }) => {
  const t = useTranslate()
  const existing = id ? resolveCharacter(id) : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [prompt, setPrompt] = useState(existing?.prompt ?? '')
  const [avatar, setAvatar] = useState(existing?.avatar ?? null)
  const [memoryEnabled, setMemoryFlag] = useState(existing?.memoryEnabled ?? true)
  const [loadingAvatar, setLoadingAvatar] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) {
      return
    }
    setLoadingAvatar(true)
    try {
      setAvatar(await prepareAvatar(file))
    } catch {
      /* 无法解码的图片保持原样 */
    } finally {
      setLoadingAvatar(false)
    }
  }

  const canSave = name.trim().length > 0 && !loadingAvatar
  return (
    <form
      className={styles.editForm}
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSave) {
          return
        }
        const saved = saveCharacter({
          id: existing?.id,
          name: name.trim(),
          avatar,
          prompt: prompt.trim(),
          memoryEnabled,
        })
        // 新建或编辑后直接把记忆管理指到该角色。
        openMemoryView(saved.id)
      }}
    >
      <button type="button" className={styles.back} onClick={openList}>
        <span className={styles.backIcon}>
          <IconChevronRightOutline14 />
        </span>
        {t('back')}
      </button>
      <div className={styles.avatarField}>
        {avatar ? (
          <img className={`${styles.avatar} ${styles.l}`} src={avatar} alt="" />
        ) : (
          <span className={`${styles.avatarFallback} ${styles.l}`}>{name.trim().slice(0, 1) || '?'}</span>
        )}
        <div className={styles.avatarActions}>
          <Button
            size="s"
            variant="outlined"
            type="button"
            disabled={loadingAvatar}
            onClick={() => input.current?.click()}
          >
            {t(avatar ? 'characterChangeAvatar' : 'characterChooseAvatar')}
          </Button>
          {avatar ? (
            <Button size="s" variant="outlined" type="button" onClick={() => setAvatar(null)}>
              {t('characterRemoveAvatar')}
            </Button>
          ) : null}
          <input ref={input} type="file" accept="image/*" hidden onChange={chooseAvatar} />
        </div>
      </div>
      <label className={styles.field}>
        <span>{t('characterName')}</span>
        <input
          type="text"
          maxLength={MAX_NAME_LENGTH}
          value={name}
          placeholder={t('characterNamePlaceholder')}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <label className={styles.field}>
        <span>{t('characterPrompt')}</span>
        <textarea
          rows={6}
          value={prompt}
          placeholder={t('characterPromptPlaceholder')}
          onChange={(event) => setPrompt(event.currentTarget.value)}
        />
      </label>
      <div className={styles.switchRow}>
        <span>{t('memoryAutoExtract')}</span>
        <Toggle
          checked={memoryEnabled}
          label={t('memoryAutoExtract')}
          onChange={setMemoryFlag}
        />
      </div>
      <div className={styles.editActions}>
        <Button size="m" variant="outlined" type="button" onClick={openList}>
          {t('cancel')}
        </Button>
        <Button size="m" type="submit" disabled={!canSave}>
          {t('characterSave')}
        </Button>
      </div>
    </form>
  )
}

const DIMENSION_KEYS: Record<MemoryDimension, TranslationKey> = {
  preference: 'memoryDimPreference',
  daily: 'memoryDimDaily',
  social: 'memoryDimSocial',
  experience: 'memoryDimExperience',
  goal: 'memoryDimGoal',
  communication: 'memoryDimCommunication',
  trait: 'memoryDimTrait',
  emotion: 'memoryDimEmotion',
}

/** 记忆编辑的小弹窗：维度 + 内容 + 启用开关。 */
const MemoryEditor = ({
  characterId,
  card,
  onClose,
}: {
  characterId: string | null
  card: MemoryCard | null
  onClose: () => void
}) => {
  const t = useTranslate()
  const [dimension, setDimension] = useState<MemoryDimension>(card?.dimension ?? 'preference')
  const [content, setContent] = useState(card?.content ?? '')
  const [enabled, setEnabled] = useState(card?.enabled ?? true)
  const targetId = characterId ?? DEFAULT_CHARACTER_ID
  const canSave = content.trim().length > 0
  return (
    <Modal title={t(card ? 'memoryEditTitle' : 'memoryAddTitle')} closable onClose={onClose}>
      <div className={styles.memoryEditor}>
        <div className={styles.dimensionPicker}>
          {MEMORY_DIMENSIONS.map((item) => (
            <button
              key={item}
              type="button"
              className={styles.dimensionChip}
              data-active={dimension === item ? '' : undefined}
              onClick={() => setDimension(item)}
            >
              {t(DIMENSION_KEYS[item])}
            </button>
          ))}
        </div>
        <textarea
          className={styles.memoryContent}
          rows={5}
          maxLength={MEMORY_CONTENT_LIMIT}
          value={content}
          placeholder={t('memoryContentPlaceholder')}
          onChange={(event) => setContent(event.currentTarget.value)}
        />
        <div className={styles.switchRow}>
          <span>{t('memoryEnabledLabel')}</span>
          <Toggle checked={enabled} label={t('memoryEnabledLabel')} onChange={setEnabled} />
        </div>
        <div className={styles.editActions}>
          {card ? (
            <Button
              size="m"
              variant="dangerOutlined"
              onClick={() => {
                removeMemory(targetId, card.id)
                onClose()
              }}
            >
              {t('delete')}
            </Button>
          ) : null}
          <Button
            size="m"
            disabled={!canSave}
            onClick={() => {
              const now = Date.now()
              upsertMemory({
                id: card?.id ?? createId(),
                characterId: targetId,
                dimension,
                content: content.trim(),
                source: card?.source ?? null,
                enabled,
                createdAt: card?.createdAt ?? now,
                updatedAt: now,
              })
              onClose()
            }}
          >
            {t('characterSave')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** 记忆库：按角色隔离的卡片列表，支持维度筛选、启用开关与来源查看。 */
const MemoryView = ({ id }: { id: string | null }) => {
  const t = useTranslate()
  const character = resolveCharacter(id)
  const targetId = character?.id ?? DEFAULT_CHARACTER_ID
  const cards = useCharacters((state) => state.memories[targetId] ?? [])
  const memoryOn = isMemoryEnabled(id)
  const [filter, setFilter] = useState<MemoryDimension | 'all'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<MemoryCard | null>(null)
  const [adding, setAdding] = useState(false)

  const keyword = query.trim().toLowerCase()
  const visible = cards
    .filter((card) => (filter === 'all' ? true : card.dimension === filter))
    .filter((card) =>
      keyword
        ? card.content.toLowerCase().includes(keyword) ||
          (card.source?.quote ?? '').toLowerCase().includes(keyword)
        : true
    )
  const counts = Object.fromEntries(
    MEMORY_DIMENSIONS.map((dimension) => [
      dimension,
      cards.filter((card) => card.dimension === dimension).length,
    ])
  ) as Record<MemoryDimension, number>

  return (
    <div className={styles.memoryView}>
      <button type="button" className={styles.back} onClick={openList}>
        <span className={styles.backIcon}>
          <IconChevronRightOutline14 />
        </span>
        {t('back')}
      </button>
      <div className={styles.memoryHeader}>
        <span className={styles.memoryTitle}>
          {t('memoryTitle')} · {character?.name ?? 'DeepSeek'}
        </span>
        <Button size="s" onClick={() => setAdding(true)}>
          {t('memoryAdd')}
        </Button>
      </div>
      <div className={styles.switchRow}>
        <span>{t('memoryAutoExtract')}</span>
        <Toggle
          checked={memoryOn}
          label={t('memoryAutoExtract')}
          onChange={(value) => setMemoryEnabled(id, value)}
        />
      </div>
      <input
        type="search"
        className={styles.search}
        placeholder={t('memorySearchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className={styles.dimensionPicker}>
        <button
          type="button"
          className={styles.dimensionChip}
          data-active={filter === 'all' ? '' : undefined}
          onClick={() => setFilter('all')}
        >
          {t('memoryFilterAll')} ({cards.length})
        </button>
        {MEMORY_DIMENSIONS.map((dimension) => (
          <button
            key={dimension}
            type="button"
            className={styles.dimensionChip}
            data-active={filter === dimension ? '' : undefined}
            onClick={() => setFilter(dimension)}
          >
            {t(DIMENSION_KEYS[dimension])} ({counts[dimension]})
          </button>
        ))}
      </div>
      <div className={styles.memoryList}>
        {visible.length === 0 ? (
          <div className={styles.memoryEmpty}>{t('memoryEmpty')}</div>
        ) : (
          visible.map((card) => (
            <div key={card.id} className={styles.memoryCard} data-disabled={!card.enabled ? '' : undefined}>
              <div className={styles.memoryCardTop}>
                <span className={styles.dimensionTag}>{t(DIMENSION_KEYS[card.dimension])}</span>
                <div className={styles.memoryCardActions}>
                  <Toggle
                    checked={card.enabled}
                    label={t('memoryEnabledLabel')}
                    onChange={(value) =>
                      upsertMemory({ ...card, enabled: value, updatedAt: Date.now() })
                    }
                  />
                  <IconButton
                    size="m"
                    tone="primary"
                    icon={<IconEditOutline16 />}
                    tooltip={t('edit')}
                    onClick={() => setEditing(card)}
                  />
                </div>
              </div>
              <div className={styles.memoryCardContent}>{card.content}</div>
              {card.source?.quote ? (
                <details className={styles.memorySource}>
                  <summary>{t('memorySource')}</summary>
                  <blockquote>{card.source.quote}</blockquote>
                </details>
              ) : null}
            </div>
          ))
        )}
      </div>
      {adding || editing ? (
        <MemoryEditor
          characterId={id}
          card={editing}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}

/** 把「Name: Value」行文本解析为请求头表；空文本返回 undefined，格式错误返回 null。 */
const parseHeadersText = (text: string): Record<string, string> | null | undefined => {
  const trimmed = text.trim()
  if (!trimmed) {
    return undefined
  }
  const headers: Record<string, string> = {}
  for (const line of trimmed.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) {
      return null
    }
    const name = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!name || !value) {
      return null
    }
    headers[name] = value
  }
  return headers
}

const headersToText = (headers: Record<string, string> | undefined) =>
  Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')

/** 模型预设编辑：新建（id 为 null）或修改名称、模型、端点与能力标记。 */
const ModelEditView = ({ id }: { id: string | null }) => {
  const t = useTranslate()
  const existing = id ? useModels.getState().presets.find((item) => item.id === id) : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [model, setModel] = useState(existing?.model ?? '')
  const [endpoint, setEndpoint] = useState(
    existing ? (chatBaseUrl(existing.endpoint, existing.format) ?? '') : ''
  )
  const [format, setFormat] = useState<ChatApiFormat>(existing?.format ?? 'chat')
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '')
  const [vision, setVision] = useState(existing?.vision ?? true)
  const [reasoning, setReasoning] = useState(existing?.reasoning ?? true)
  const [search, setSearch] = useState(existing?.search ?? false)
  const [headersText, setHeadersText] = useState(() => headersToText(existing?.headers))
  const [error, setError] = useState<TranslationKey | null>(null)
  const [templateHint, setTemplateHint] = useState<string | null>(null)
  const official = endpoint.trim() === ''

  /** 套用提供商模板：预填端点/模型/格式/能力标记/请求头，用户只需填 Key。 */
  const applyTemplate = (index: number) => {
    const template = PROVIDER_TEMPLATES[index]
    if (!template) {
      return
    }
    setName(template.name)
    setModel(template.modelIds[0] ?? template.model)
    setEndpoint(chatBaseUrl(template.endpoint, template.format) ?? template.endpoint)
    setFormat(template.format)
    setHeadersText(headersToText(template.headers))
    setVision(template.vision)
    setReasoning(template.reasoning)
    setSearch(template.search)
    setTemplateHint(template.hint)
    setError(null)
  }

  const save = () => {
    const resolved = resolveChatEndpoint(
      endpoint.trim(),
      format,
      existing ?? { model: '', endpoint: '', format, apiKey: '' }
    )
    if (resolved === null) {
      setError('advancedInvalidEndpoint')
      return
    }
    const headers = parseHeadersText(headersText)
    if (headers === null) {
      setError('modelHeadersInvalid')
      return
    }
    const saved = savePreset({
      id: existing?.id,
      name: name.trim(),
      model: model.trim(),
      endpoint: resolved,
      format,
      apiKey,
      vision,
      reasoning,
      search: search && resolved !== '',
      headers,
    })
    // 新建或编辑后立即以该预设生效
    activatePreset(saved.id)
    openList()
  }

  return (
    <div className={styles.editForm}>
      <button type="button" className={styles.back} onClick={openList}>
        <span className={styles.backIcon}>
          <IconChevronRightOutline14 />
        </span>
        {t('back')}
      </button>
      {!existing ? (
        <>
          <div className={styles.field}>
            <span>{t('providerTemplates')}</span>
            <div className={styles.dimensionPicker}>
              {PROVIDER_TEMPLATES.map((template, index) => (
                <button
                  key={template.name}
                  type="button"
                  className={styles.templateChip}
                  onClick={() => applyTemplate(index)}
                >
                  <span className={styles.templateIcon}>
                    <img src={template.icon} alt="" />
                  </span>
                  {template.name}
                </button>
              ))}
            </div>
            {templateHint ? <p className={styles.fieldHint}>{templateHint}</p> : null}
          </div>
        </>
      ) : null}
      <label className={styles.field}>
        <span>{t('modelName')}</span>
        <input
          type="text"
          maxLength={MAX_NAME_LENGTH}
          value={name}
          placeholder={t('modelNamePlaceholder')}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <label className={styles.field}>
        <span>{t('advancedModel')}</span>
        <input
          type="text"
          value={model}
          placeholder={official ? 'deepseek-flash' : ''}
          onChange={(event) => setModel(event.currentTarget.value)}
        />
      </label>
      {(() => {
        // 当前端点匹配某家模板时，展示该家的 DeepSeek 模型 ID 变体供快速切换
        const match = PROVIDER_TEMPLATES.find((template) => template.endpoint === endpoint.trim())
        if (!match) {
          return null
        }
        return (
          <div className={styles.field}>
            <div className={styles.dimensionPicker}>
              {match.modelIds.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={styles.dimensionChip}
                  data-active={model === candidate ? '' : undefined}
                  onClick={() => setModel(candidate)}
                >
                  {candidate.split('/').at(-1)}
                </button>
              ))}
            </div>
          </div>
        )
      })()}
      <label className={styles.field}>
        <span>{t('advancedEndpoint')}</span>
        <input
          type="url"
          value={endpoint}
          placeholder={endpointExamples[format]}
          inputMode="url"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => setEndpoint(event.currentTarget.value)}
        />
      </label>
      <div className={styles.field}>
        <span>{t('advancedProtocol')}</span>
        <div className={styles.dimensionPicker}>
          {FORMATS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={styles.dimensionChip}
              data-active={format === item.value ? '' : undefined}
              onClick={() => setFormat(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {official ? null : (
        <label className={styles.field}>
          <span>{t('advancedEndpointKey')}</span>
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
        </label>
      )}
      <div className={styles.capSwitches}>
        <div className={styles.switchRow}>
          <span>{t('modelVision')}</span>
          <Toggle checked={vision} label={t('modelVision')} onChange={setVision} />
        </div>
        <div className={styles.switchRow}>
          <span>{t('modelReasoning')}</span>
          <Toggle checked={reasoning} label={t('modelReasoning')} onChange={setReasoning} />
        </div>
        {official ? null : (
          <>
            <div className={styles.switchRow}>
              <span>{t('modelSearch')}</span>
              <Toggle checked={search} label={t('modelSearch')} onChange={setSearch} />
            </div>
            <p className={styles.fieldHint}>{t('modelSearchHint')}</p>
            <label className={styles.field}>
              <span>{t('modelHeaders')}</span>
              <textarea
                rows={3}
                value={headersText}
                placeholder={t('modelHeadersPlaceholder')}
                spellCheck={false}
                autoCapitalize="off"
                onChange={(event) => setHeadersText(event.currentTarget.value)}
              />
            </label>
          </>
        )}
      </div>
      {error ? <p role="alert">{t(error)}</p> : null}
      <div className={styles.editActions}>
        <Button size="m" variant="outlined" onClick={openList}>
          {t('cancel')}
        </Button>
        <Button size="m" disabled={!name.trim()} onClick={save}>
          {t('characterSave')}
        </Button>
      </div>
    </div>
  )
}

/** 角色与模型管理对话框；在侧边栏、欢迎页与 App 根节点挂载。 */
export const CharactersDialog = memo(function CharactersDialog() {
  const t = useTranslate()
  const open = useCharactersDialog((state) => state.open)
  const view = useCharactersDialog((state) => state.view)
  const close = useCharactersDialog((state) => state.close)
  if (!open) {
    return null
  }
  const title: ReactNode =
    view.type === 'edit'
      ? t(view.id ? 'characterEdit' : 'newCharacter')
      : view.type === 'memory'
        ? t('memoryTitle')
        : view.type === 'model-edit'
          ? t(view.id ? 'modelEdit' : 'modelNew')
          : t('charactersTitle')
  return (
    <Modal title={title} closable className={styles.dialog} onClose={close}>
      <div key={view.type} className={styles.viewFade}>
        {view.type === 'list' ? (
          <ListView />
        ) : view.type === 'edit' ? (
          <EditView id={view.id} />
        ) : view.type === 'memory' ? (
          <MemoryView id={view.id} />
        ) : (
          <ModelEditView id={view.id} />
        )}
      </div>
    </Modal>
  )
})
