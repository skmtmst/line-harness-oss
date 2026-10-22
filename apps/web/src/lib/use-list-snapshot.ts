'use client'

import { useCallback, useRef, useState, type SetStateAction } from 'react'

/** 取得条件と表示を結び、条件が変わった描画から旧データを隠す。 */
export function useListSnapshot<T>(key: string, initial: T) {
  // 同じ条件へ戻る場合も別の取得として扱い、前の応答と表示を復活させない。
  const scopeRef = useRef({ key, initial })
  if (scopeRef.current.key !== key) scopeRef.current = { key, initial }
  const scope = scopeRef.current
  const [snapshot, setSnapshot] = useState<{ scope: typeof scope; value: T } | null>(null)
  const setValue = useCallback((update: SetStateAction<T>) => {
    if (scopeRef.current !== scope) return
    setSnapshot(previous => {
      if (scopeRef.current !== scope) return previous
      const value = previous?.scope === scope ? previous.value : scope.initial
      return { scope, value: typeof update === 'function' ? (update as (value: T) => T)(value) : update }
    })
  }, [scope])
  return { value: snapshot?.scope === scope ? snapshot.value : scope.initial, setValue, hasValue: snapshot?.scope === scope }
}
