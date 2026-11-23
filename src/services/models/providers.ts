import type { ChatApiFormat } from '../api/chatConfig.js'
import type { ModelPreset } from '../models/store.js'
import opencodeIcon from '../../assets/provider-opencode.png'
import commandcodeIcon from '../../assets/provider-commandcode.png'
import siliconflowIcon from '../../assets/provider-siliconflow.svg'

/**
 * 模型提供商适配器：知名 DeepSeek 网关的预设模板。
 * 新建模型预设时可直接套用模板，只需填 API Key（和模型 ID 微调）。
 * 端点/能力标记按各提供商公开文档维护；`headers` 值支持 {sessionId} 占位符。
 */

export type ProviderTemplate = Omit<
  ModelPreset,
  'id' | 'name' | 'apiKey' | 'createdAt' | 'updatedAt'
> & {
  /** 模板展示名（也是预设的默认名） */
  name: string
  /** 说明：DeepSeek 模型 ID 变体 / 需要用户注意的事项 */
  hint: string
  /** 建议的 DeepSeek 模型 ID 列表（供用户参考或快速替换） */
  modelIds: string[]
  /** 提供商官方图标（assets 内的构建期资源 URL） */
  icon: string
}

const OPENCODE_GO: ProviderTemplate = {
  name: 'Opencode Go',
  model: 'deepseek-v4.1-flash',
  endpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
  format: 'chat' as ChatApiFormat,
  vision: true,
  reasoning: true,
  search: true,
  headers: { 'x-opencode-session': '{sessionId}' },
  hint: '每个对话需携带会话头（已按模板配置）。免费档模型仅限 OpenCode 客户端使用，Go 计划可用 API。',
  modelIds: ['deepseek-v4.1-flash', 'deepseek-v4-pro'],
  icon: opencodeIcon,
}

const COMMANDCODE: ProviderTemplate = {
  name: 'CommandCode',
  model: 'deepseek/deepseek-v4.1-flash',
  endpoint: 'https://api.commandcode.ai/provider/v1/chat/completions',
  format: 'chat' as ChatApiFormat,
  vision: true,
  reasoning: true,
  search: false,
  headers: undefined,
  hint: '模型 ID 带命名空间前缀（deepseek/…）。标准 OpenAI 端点，不透传 DeepSeek 官方扩展。',
  modelIds: [
    'deepseek/deepseek-v4.1-flash',
    'deepseek/deepseek-v4-flash',
    'deepseek/deepseek-v4-pro',
  ],
  icon: commandcodeIcon,
}

const SILICONFLOW: ProviderTemplate = {
  name: '硅基流动',
  model: 'deepseek-ai/DeepSeek-V4-Flash',
  endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
  format: 'chat' as ChatApiFormat,
  vision: false,
  reasoning: true,
  search: false,
  headers: undefined,
  hint: '模型 ID 带 all-hands 命名空间（deepseek-ai/…）。思考强度经 reasoning_effort 传递（low/medium 映射为 high）。',
  modelIds: [
    'deepseek-ai/DeepSeek-V4-Flash',
    'Pro/deepseek-ai/DeepSeek-V4',
    'deepseek-ai/DeepSeek-V4',
  ],
  icon: siliconflowIcon,
}

/** 顺序即 UI 中的展示顺序。 */
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  OPENCODE_GO,
  COMMANDCODE,
  SILICONFLOW,
]
