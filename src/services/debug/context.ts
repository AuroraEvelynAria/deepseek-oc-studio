import { useChatStore } from '../chat/store.js'
import { useCharacters } from '../characters/store.js'
import { useModels } from '../models/store.js'
import { useSettings } from '../settings.js'
import { useDebugLog } from './log.js'

declare global {
  interface Window {
    __debug?: Record<string, unknown>
  }
}

/** 终端控制台的求值上下文：把常用 store 挂到 window.__debug，供表达式求值访问。 */
export const installDebugContext = () => {
  window.__debug = {
    useSettings,
    useChatStore,
    useCharacters,
    useModels,
    useDebugLog,
  }
}
