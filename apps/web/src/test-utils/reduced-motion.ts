const nativeMatchMedia = typeof window === 'undefined' ? null : window.matchMedia.bind(window)

/** 動きの試験は false を指定する。ほかの操作試験は動きを減らす設定で確定状態を確認する。 */
export function setTestReducedMotion(reduced: boolean) {
  if (typeof window === 'undefined' || !nativeMatchMedia) return
  window.matchMedia = (query: string) => {
    const result = nativeMatchMedia(query)
    if (query === '(prefers-reduced-motion: reduce)' || query === '(prefers-reduced-motion: no-preference)') {
      Object.defineProperty(result, 'matches', { configurable: true, value: query.endsWith('no-preference)') ? !reduced : reduced })
    }
    return result
  }
}
