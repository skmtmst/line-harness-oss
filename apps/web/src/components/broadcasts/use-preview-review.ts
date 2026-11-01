import { useCallback, useEffect, useRef, useState } from 'react'

type Variant = 'A' | 'B'
type Seen = { key: string; variants: Variant[] }

/** 確認した見本の中身と案を記録する。端末や案の切り替えでは記録を捨てない。 */
export function usePreviewReview(key: string, hasB: boolean, confirmed: boolean, onConfirmed: (value: boolean) => void) {
  const [seen, setSeen] = useState<Seen>(() => ({ key, variants: confirmed ? hasB ? ['A', 'B'] : ['A'] : [] }))
  const seenRef = useRef(seen)
  const currentKey = useRef(key)
  const previousKey = useRef(key)
  currentKey.current = key
  useEffect(() => {
    if (previousKey.current === key) return
    previousKey.current = key
    const next: Seen = { key, variants: [] }
    seenRef.current = next
    setSeen(next)
    onConfirmed(false)
  }, [key, onConfirmed])
  const markVariant = useCallback((variant: Variant) => {
    if (currentKey.current !== key || (variant === 'B' && !hasB)) return
    const previous = seenRef.current
    const variants = previous.key === key ? [...previous.variants] : []
    if (!variants.includes(variant)) variants.push(variant)
    const next = { key, variants }
    seenRef.current = next
    setSeen(next)
    if (variants.includes('A') && (!hasB || variants.includes('B'))) onConfirmed(true)
  }, [key, hasB, onConfirmed])
  return { ready: seen.key === key && seen.variants.includes('A') && (!hasB || seen.variants.includes('B')), markVariant }
}
