import { create } from 'zustand'
import { isAndroidWide } from '../../app/viewport.js'

/** 移动端侧边栏：窄屏为浮层抽屉（默认收起），Android 宽屏（>= 840px）为左侧分栏（默认展开） */
export const useMobileSider = create(() => ({ open: isAndroidWide() }))

export const openMobileSider = () => useMobileSider.setState({ open: true })

export const closeMobileSider = () => useMobileSider.setState({ open: false })

export const toggleMobileSider = () => useMobileSider.setState((state) => ({ open: !state.open }))

/** 仅在浮层抽屉模式下收起侧边栏，保留 Android 宽屏常驻分栏的当前开合状态 */
export const closeOverlaySider = () => {
  if (!isAndroidWide()) {
    closeMobileSider()
  }
}
