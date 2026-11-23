import { android, saveAndroidHistory } from '../../app/android.js'
import { translate } from '../../i18n/index.js'
import { resolveCharacter } from '../characters/store.js'
import { useSettings } from '../settings.js'
import { getVisibleMessages } from './branches.js'
import { getReplyText, getThinkingSeconds } from './reply.js'
import type { AssistantMessage, Session, UserMessage } from './types.js'

/**
 * 单会话导出：把当前选中的分支路径写成可读的 Markdown 文件。
 * 深度思考放折叠块，附件只保留文件名，引用来源去重后列在对应回答末尾。
 */

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const locale = useSettings.getState().locale
  return `${new Intl.DateTimeFormat(locale).format(date)} ${new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)}`
}

const sanitizeFileName = (title: string, fallback: string) =>
  title
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .trim()
    .slice(0, 80) || fallback

const appendAttachments = (lines: string[], message: UserMessage) => {
  if (message.files.length === 0) {
    return
  }
  lines.push('', `> ${translate('exportAttachments')}${message.files.map((file) => file.name).join('、')}`)
}

const appendCitations = (lines: string[], reply: AssistantMessage) => {
  const seen = new Set<string>()
  const citations: { title: string; url: string }[] = []
  for (const block of reply.blocks) {
    if (block.type !== 'text' || !block.citations) {
      continue
    }
    for (const citation of block.citations) {
      if (citation.url && !seen.has(citation.url)) {
        seen.add(citation.url)
        citations.push({ title: citation.title ?? citation.url, url: citation.url })
      }
    }
  }
  if (citations.length === 0) {
    return
  }
  lines.push('', `${translate('exportCitations')}`)
  citations.forEach((citation, index) => {
    lines.push(`${index + 1}. [${citation.title}](${citation.url})`)
  })
}

const appendReply = (lines: string[], reply: AssistantMessage) => {
  for (const block of reply.blocks) {
    if (block.type === 'thinking' && block.thinking.trim()) {
      const seconds =
        block.startedAt !== undefined && block.endedAt !== undefined
          ? getThinkingSeconds(block.startedAt, block.endedAt)
          : undefined
      lines.push(
        '',
        `<details><summary>${translate('exportThinking')}${seconds ? `（${seconds}s）` : ''}</summary>`,
        '',
        block.thinking.trim(),
        '',
        '</details>'
      )
    }
  }
  const text = getReplyText(reply).trim()
  if (text) {
    lines.push('', text)
    appendCitations(lines, reply)
  } else if (reply.status === 'error') {
    lines.push('', translate('exportReplyError'))
  } else {
    lines.push('', translate('exportReplyEmpty'))
  }
}

export const buildSessionMarkdown = (session: Session): string => {
  const path = getVisibleMessages(session)
  const lines: string[] = [`# ${session.title || translate('untitledChat')}`, '']
  lines.push(`- ${translate('exportTime')}${formatTime(Date.now())}`)
  const character = resolveCharacter(session.characterId)
  const characterName = character?.name ?? 'DeepSeek'
  lines.push(`- ${translate('exportRole')}${characterName}`)
  lines.push('', '---')
  for (const message of path) {
    const time = formatTime(message.createdAt)
    if (message.role === 'user') {
      lines.push('', `### ${translate('exportMe')} · ${time}`, '')
      if (message.content.trim()) {
        lines.push(message.content.trim())
      }
      appendAttachments(lines, message)
    } else {
      lines.push('', `### ${characterName} · ${time}`)
      appendReply(lines, message)
    }
  }
  return `${lines.join('\n').trim()}\n`
}

export const exportSessionMarkdown = (session: Session): { name: string; blob: Blob } => ({
  name: `${sanitizeFileName(session.title || translate('untitledChat'), 'chat')}.md`,
  blob: new Blob([buildSessionMarkdown(session)], { type: 'text/markdown;charset=utf-8' }),
})

/** 保存导出文件：Android 走系统保存文档，网页走浏览器下载；用户取消返回 false。 */
export const saveExportFile = async (name: string, blob: Blob): Promise<boolean> => {
  if (android) {
    return saveAndroidHistory(name, blob)
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    return true
  } finally {
    requestAnimationFrame(() => URL.revokeObjectURL(url))
  }
}
