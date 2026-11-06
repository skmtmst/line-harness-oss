'use client'

import dynamic from 'next/dynamic'
import { createContext, useContext, useEffect, useRef, useState, type ComponentType } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import type { BroadcastFormProps } from './broadcast-form-props'

type Form = ComponentType<BroadcastFormProps>
// 読み込んだコードだけを再利用し、フォームの実体・店舗情報・下書きは保存しない。
let recoveredForm: Form | null = null
const CancelLoading = createContext<() => void>(() => {})

function LoadingForm() {
  const cancel = useContext(CancelLoading)
  return <><ListState kind="loading" title="配信作成画面を読み込んでいます" /><Button variant="secondary" onClick={cancel}>作成をやめる</Button></>
}

/** コードの読込み失敗だけを扱い、保存・権限の失敗は元のフォームで扱う。 */
function FormLoadFailed(props: BroadcastFormProps) {
  const [Recovered, setRecovered] = useState<Form | null>(() => recoveredForm)
  const [loadError, setLoadError] = useState(true)
  const live = useRef(false)
  const inFlight = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const retry = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoadError(false)
    try {
      // 失敗済みの読込み結果を使わず、コードの取得をやり直す。
      const loaded = await import('./broadcast-form')
      recoveredForm = loaded.default
      if (live.current) setRecovered(() => loaded.default)
    } catch {
      if (live.current) setLoadError(true)
    } finally {
      inFlight.current = false
    }
  }
  if (Recovered) return <Recovered {...props} />
  if (!loadError) return <LoadingForm />
  return <ListState kind="error" title="配信作成画面を読み込めませんでした" onRetry={() => void retry()} action={<Button variant="secondary" onClick={props.onCancel}>作成をやめる</Button>} />
}

// 親の値が変わっても、入力中のフォームを作り直さない。
const LazyForm = dynamic<BroadcastFormProps>(
  () => import('./broadcast-form').catch(() => ({ default: FormLoadFailed })),
  { loading: LoadingForm },
)

export default function BroadcastFormLazy(props: BroadcastFormProps) {
  return <CancelLoading.Provider value={props.onCancel}><LazyForm {...props} /></CancelLoading.Provider>
}
