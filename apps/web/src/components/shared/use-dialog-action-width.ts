import { useLayoutEffect, useRef } from 'react'

const controlSelector = 'button, a[href], [role="button"], [role="combobox"]'

function borderWidth(control: HTMLElement) {
  // 整数への丸めと、開閉時のtransformの影響を避ける。
  const style = getComputedStyle(control), used = parseFloat(style.width)
  const edges = style.boxSizing === 'border-box' ? 0 : ['padding-left', 'padding-right', 'border-left-width', 'border-right-width'].reduce((sum, name) => sum + (parseFloat(style.getPropertyValue(name)) || 0), 0)
  return Number.isFinite(used) ? used + edges : control.offsetWidth
}

/** 左右同幅で主操作を中央へ置き、実幅が足りない帯だけ上下の段にする。 */
export function useDialogActionWidth() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = ref.current
    const leading = root?.querySelector<HTMLElement>('[data-dialog-action-leading]')
    const main = leading?.nextElementSibling as HTMLElement | null
    if (!root || !leading || !main) return
    const measure = () => {
      const width = Math.max(0, ...[...leading.querySelectorAll<HTMLElement>(controlSelector)].map(borderWidth))
      const value = `${width}px`
      if (root.style.getPropertyValue('--dialog-leading-min') !== value) root.style.setProperty('--dialog-leading-min', value)
      const center = Math.max(0, ...[...main.querySelectorAll<HTMLElement>(controlSelector)].map(borderWidth))
      const style = getComputedStyle(root)
      const contentWidth = borderWidth(root) - ['padding-left', 'padding-right', 'border-left-width', 'border-right-width'].reduce((sum, name) => sum + (parseFloat(style.getPropertyValue(name)) || 0), 0)
      root.toggleAttribute('data-dialog-actions-stacked', contentWidth < width * 2 + center + (parseFloat(style.columnGap) || 0) * 2)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    observer.observe(leading)
    observer.observe(main)
    for (const control of root.querySelectorAll(controlSelector)) observer.observe(control)
    return () => observer.disconnect()
  })
  return ref
}
