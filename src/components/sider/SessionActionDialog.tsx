import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isTopOverlay, pushOverlay } from '../../app/overlayStack.js'
import { useAndroidBackInterception } from '../../app/useAndroidBackInterception.js'
import styles from './SessionActionDialog.module.css'

/** 侧边栏会话动作弹窗；与 Modal 共用浮层栈，叠放时 Esc 只关闭最上层。 */
export const SessionActionDialog = ({
  title,
  description,
  children,
  cancelLabel,
  confirmLabel,
  danger = false,
  stacked = false,
  closeDisabled = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: {
  title: string
  description?: string
  children?: ReactNode
  cancelLabel: string
  confirmLabel: string
  danger?: boolean
  stacked?: boolean
  closeDisabled?: boolean
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
}) => {
  useAndroidBackInterception(!closeDisabled)

  useEffect(() => {
    const token = {}
    const release = pushOverlay(token)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopOverlay(token) && !closeDisabled) {
        onCancel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      release()
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeDisabled, onCancel])

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (!closeDisabled && event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.title}>{title}</div>
        {description ? <p className={styles.description}>{description}</p> : null}
        {children ? <div className={styles.body}>{children}</div> : null}
        <div className={stacked ? styles.stackedActions : styles.actions}>
          {stacked ? (
            <>
              <button
                type="button"
                className={styles.danger}
                disabled={confirmDisabled}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
              <button type="button" disabled={closeDisabled} onClick={onCancel}>
                {cancelLabel}
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={closeDisabled} onClick={onCancel}>
                {cancelLabel}
              </button>
              <button
                type="button"
                className={danger ? styles.confirmDanger : styles.confirm}
                disabled={confirmDisabled}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body
  )
}
