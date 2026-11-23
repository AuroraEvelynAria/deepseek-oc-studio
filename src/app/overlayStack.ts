/**
 * 全应用共用的浮层栈。Modal 与 SessionActionDialog 各自维护栈时，
 * 一次 Esc / Android 返回会同时命中两套监听，把确认框和底层对话框一起关掉。
 */

const stack: object[] = []

/** 压入浮层，返回出栈函数。 */
export const pushOverlay = (token: object): (() => void) => {
  stack.push(token)
  return () => {
    const index = stack.indexOf(token)
    if (index >= 0) {
      stack.splice(index, 1)
    }
  }
}

/** 只有最上层浮层响应 Esc / 返回键。 */
export const isTopOverlay = (token: object): boolean => stack.at(-1) === token
