import { android } from './android.js'

type Target = {
  key: string
  label: string
  checked: boolean
  disabled: boolean
  checkable: boolean
  clickable: boolean
  longClickable: boolean
  scrollable: boolean
  focusable: boolean
  touchThrough: boolean
  role: 'view' | 'editText' | 'textView'
  extraButton: boolean
  keepInteractive: boolean
  bounds: [number, number, number, number]
  labelBounds: [number, number, number, number] | null
  labelKind: 'description' | 'text' | 'hint' | 'selfText' | 'none'
}

const targetSelector = '[data-android-a11y]'

const visible = (element: HTMLElement) => {
  if (element.parentElement?.closest('[inert]')) {
    return false
  }
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false
    }
  }
  const rect = element.getBoundingClientRect()
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < innerHeight &&
    rect.right > 0 &&
    rect.left < innerWidth
  )
}

const physicalBounds = (
  rect: DOMRect,
  scale: number
): [number, number, number, number] => [
  Math.round(rect.left * scale),
  Math.round(rect.top * scale),
  Math.round(rect.right * scale),
  Math.round(rect.bottom * scale),
]

const labelElement = (element: HTMLElement) =>
  element.querySelector<HTMLElement>('[data-android-a11y-label-node]') ??
  element.querySelector<HTMLElement>('svg') ??
  element

const textBounds = (element: HTMLElement) => {
  const range = document.createRange()
  range.selectNodeContents(element)
  const rect = range.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? rect : null
}

const collectTargets = () => {
  const scale = devicePixelRatio || 1
  return [...document.querySelectorAll<HTMLElement>(targetSelector)]
    .filter(visible)
    .filter(
      (element) =>
        element.dataset.androidA11yKeepInteractive !== 'true' ||
        !element.contains(document.activeElement)
    )
    .map((element): Target | null => {
      const key = element.getAttribute('data-android-a11y')
      const label = element.dataset.androidA11yLabel ?? ''
      if (key === null) {
        return null
      }
      const labelNode = labelElement(element)
      const labelRect = labelNode.getBoundingClientRect()
      const labelBounds =
        labelNode === element ? textBounds(element) : labelRect
      return {
        key,
        label,
        checked: element.dataset.androidA11yChecked === 'true',
        disabled:
          element.matches(':disabled') || element.querySelector(':disabled') !== null,
        checkable: element.dataset.androidA11yCheckable !== 'false',
        clickable: element.dataset.androidA11yClickable !== 'false',
        longClickable: element.dataset.androidA11yLongClickable === 'true',
        scrollable: element.dataset.androidA11yScrollable === 'true',
        focusable: element.dataset.androidA11yFocusable !== 'false',
        touchThrough: element.dataset.androidA11yTouchThrough === 'true',
        role:
          element.dataset.androidA11yRole === 'editText'
            ? 'editText'
            : element.dataset.androidA11yRole === 'textView'
              ? 'textView'
              : 'view',
        extraButton: element.dataset.androidA11yExtraButton === 'true',
        keepInteractive: element.dataset.androidA11yKeepInteractive === 'true',
        bounds: physicalBounds(element.getBoundingClientRect(), scale),
        labelBounds: labelBounds ? physicalBounds(labelBounds, scale) : null,
        labelKind: (() => {
          const kind = element.dataset.androidA11yLabelKind
          return kind === 'description' ||
            kind === 'hint' ||
            kind === 'selfText' ||
            kind === 'none'
            ? kind
            : 'text'
        })(),
      }
    })
    .filter((target): target is Target => target !== null)
}

const sendTargets = () => {
  android?.setA11yTargets(JSON.stringify(collectTargets()))
}

const enabled = () => android?.a11yEnabled() === true

let burstUntil = 0
let frame = 0

const pump = (time: number) => {
  sendTargets()
  if (time < burstUntil) {
    frame = requestAnimationFrame(pump)
  } else {
    frame = 0
  }
}

export const scheduleAndroidA11ySync = () => {
  if (!android?.setA11yTargets) {
    return
  }
  const active = enabled()
  for (const element of document.querySelectorAll<HTMLElement>(targetSelector)) {
    const touchThrough = element.dataset.androidA11yTouchThrough === 'true'
    const interactive =
      element.dataset.androidA11yKeepInteractive === 'true' &&
      element.contains(document.activeElement)
    element.inert =
      active &&
      element.dataset.androidA11yKeepInteractive !== 'true' &&
      !touchThrough
    if (touchThrough) {
      if (active && !interactive) {
        if (element.getAttribute('aria-hidden') !== 'true') {
          element.setAttribute('aria-hidden', 'true')
        }
      } else if (element.hasAttribute('aria-hidden')) {
        element.removeAttribute('aria-hidden')
      }
    }
  }
  if (!active) {
    android.setA11yTargets('[]')
    return
  }
  burstUntil = performance.now() + 350
  if (!frame) {
    frame = requestAnimationFrame(pump)
  }
}

export const startAndroidA11ySync = () => {
  if (!android?.setA11yTargets) {
    return
  }
  const observer = new MutationObserver(scheduleAndroidA11ySync)
  observer.observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: [
      'aria-checked',
      'aria-hidden',
      'class',
      'data-android-a11y',
      'data-android-a11y-checked',
      'data-android-a11y-label',
      'disabled',
      'style',
    ],
  })
  window.addEventListener('resize', scheduleAndroidA11ySync)
  window.addEventListener('scroll', scheduleAndroidA11ySync, true)
  document.addEventListener('focusin', scheduleAndroidA11ySync)
  document.addEventListener('focusout', scheduleAndroidA11ySync)
  window.addEventListener('android-a11y-state', scheduleAndroidA11ySync)
  window.addEventListener('android-a11y-click', (event) => {
    const key = (event as CustomEvent<string>).detail
    const target = [...document.querySelectorAll<HTMLElement>(targetSelector)].find(
      (element) => element.getAttribute('data-android-a11y') === key
    )
    if (target?.dataset.androidA11yKeepInteractive === 'true') {
      const focusTarget = target.querySelector<HTMLElement>(
        '[data-android-a11y-focus-target]'
      )
      ;(focusTarget ?? target).focus()
    } else {
      target?.click()
    }
  })
  window.addEventListener('android-a11y-long-click', (event) => {
    const key = (event as CustomEvent<string>).detail
    const target = [...document.querySelectorAll<HTMLElement>(targetSelector)].find(
      (element) => element.getAttribute('data-android-a11y') === key
    )
    target?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    )
  })
  window.addEventListener('android-a11y-scroll', (event) => {
    const { key, direction } = (event as CustomEvent<{ key: string; direction: number }>)
      .detail
    const target = [...document.querySelectorAll<HTMLElement>(targetSelector)].find(
      (element) => element.getAttribute('data-android-a11y') === key
    )
    target?.scrollBy({ top: direction * target.clientHeight * 0.8, behavior: 'smooth' })
  })
  scheduleAndroidA11ySync()
}
