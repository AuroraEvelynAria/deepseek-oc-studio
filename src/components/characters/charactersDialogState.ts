import { create } from 'zustand'

/** 对话框内的视图：角色列表 → 编辑角色 / 记忆库 / 编辑模型（id 为 null 表示官方 DeepSeek 或新建）。 */
export type CharactersView =
  | { type: 'list' }
  | { type: 'edit'; id: string | null }
  | { type: 'memory'; id: string | null }
  | { type: 'model-edit'; id: string | null }

type CharactersDialogState = {
  open: boolean
  view: CharactersView
  openList: () => void
  openEdit: (id: string | null) => void
  openMemory: (id: string | null) => void
  openModelEdit: (id: string | null) => void
  close: () => void
}

export const useCharactersDialog = create<CharactersDialogState>(() => ({
  open: false,
  view: { type: 'list' },
  openList: () => useCharactersDialog.setState({ open: true, view: { type: 'list' } }),
  openEdit: (id) => useCharactersDialog.setState({ open: true, view: { type: 'edit', id } }),
  openMemory: (id) => useCharactersDialog.setState({ open: true, view: { type: 'memory', id } }),
  openModelEdit: (id) =>
    useCharactersDialog.setState({ open: true, view: { type: 'model-edit', id } }),
  close: () => useCharactersDialog.setState({ open: false }),
}))

/** 供非订阅场景直接调用：侧边栏、欢迎页的入口按钮。 */
export const openList = () => useCharactersDialog.getState().openList()
export const openEdit = (id: string | null) => useCharactersDialog.getState().openEdit(id)
export const openMemory = (id: string | null) => useCharactersDialog.getState().openMemory(id)
export const openModelEdit = (id: string | null) =>
  useCharactersDialog.getState().openModelEdit(id)
export const closeDialog = () => useCharactersDialog.getState().close()
