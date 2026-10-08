'use client'

/*
 * 画面で使う「古い応答を捨てる」印（監査 WEB190 ほか、遅い応答が今の対象に入る系）。
 *
 * `createResponseGate()`（lib/latest-request.ts）を画面ごとに1つ持ち、
 * 画面が閉じたら進行中の要求をすべて古い扱いにする。読み込み・保存の
 * 応答は、届いた時点で `gate.current(token)` を確かめてから画面へ書く。
 *
 *   const gate = useResponseGate()
 *   const token = gate.begin()
 *   const res = await api...
 *   if (!gate.current(token)) return
 */
import { useEffect, useRef } from 'react'
import { createResponseGate, type ResponseGate } from './latest-request'

export function useResponseGate(): ResponseGate {
  const ref = useRef<ResponseGate | null>(null)
  if (!ref.current) ref.current = createResponseGate()
  useEffect(() => {
    const gate = ref.current
    return () => gate?.invalidate()
  }, [])
  return ref.current
}
