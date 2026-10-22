'use client'

import dynamic from 'next/dynamic'
import { createContext, useContext, useEffect, useRef, useState, type ComponentType } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import type { BroadcastFormProps } from './broadcast-form-props'

type Form = ComponentType<BroadcastFormProps>
// Code only: never cache a form instance, account data, or draft values.
let recoveredForm: Form | null = null
const CancelLoading = createContext<() => void>(() => {})

function LoadingForm() {
  const cancel = useContext(CancelLoading)
  return <><ListState kind="loading" title="配信作成画面を読み込んでいます" /><Button variant="secondary" onClick={cancel}>作成をやめる</Button></>
}

/** Only an import rejection enters this state; save/permission errors stay in BroadcastForm. */
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
      // A fresh import retries the chunk request, rather than reusing React.lazy's rejected promise.
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

// Stable component identity: changing parent props must not recreate an entered form.
const LazyForm = dynamic<BroadcastFormProps>(
  () => import('./broadcast-form').catch(() => ({ default: FormLoadFailed })),
  { loading: LoadingForm },
)

export default function BroadcastFormLazy(props: BroadcastFormProps) {
  return <CancelLoading.Provider value={props.onCancel}><LazyForm {...props} /></CancelLoading.Provider>
}
