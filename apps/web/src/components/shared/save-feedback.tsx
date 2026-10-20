'use client'

import { useRef, useState } from 'react'
import Button from './button'
import Notice from './notice'

export type SaveFeedbackState =
  | { kind: 'idle' }
  | { kind: 'saving'; subject: string }
  | { kind: 'success'; subject: string }
  | { kind: 'failed' | 'partial'; reason: string; completed: string[]; remaining: string[] }

/**  D1：失敗後も入力を保つ。再試行の保存処理は完了した工程を再送しない。 */
export function useSaveFeedback() {
  const [state, setState] = useState<SaveFeedbackState>({ kind: 'idle' })
  const inFlight = useRef(false)
  const begin = (subject: string) => {
    if (inFlight.current) return false
    inFlight.current = true
    setState({ kind: 'saving', subject })
    return true
  }
  const success = (subject: string) => { inFlight.current = false; setState({ kind: 'success', subject }) }
  const failure = (reason: string, completed: string[] = [], remaining: string[] = []) => {
    inFlight.current = false
    setState({ kind: completed.length ? 'partial' : 'failed', reason, completed, remaining })
  }
  const reset = () => { if (!inFlight.current) setState({ kind: 'idle' }) }
  return { state, begin, success, failure, reset, busy: state.kind === 'saving' }
}

export default function SaveFeedback({ state, onRetry, retryDisabled = false, retryLabel }: { state: SaveFeedbackState; onRetry: () => void | Promise<void>; retryDisabled?: boolean; retryLabel?: string }) {
  if (state.kind === 'idle' || state.kind === 'saving') return null
  if (state.kind === 'success') return <Notice tone="success" role="status" data-save-state="success">{state.subject}を保存しました。</Notice>
  return <Notice tone={state.kind === 'partial' ? 'warn' : 'danger'} role="alert" data-save-state={state.kind}
    action={<Button onClick={onRetry} disabled={retryDisabled} busyLabel="保存しています…">{retryLabel ?? (state.kind === 'partial' ? '残りだけもう一度' : 'もう一度保存する')}</Button>}>
    {state.kind === 'partial' ? <><p>{`できた分：${state.completed.join('・')}`}</p><p>{`残り：${state.remaining.join('・')}`}</p></> : null}
    <p>{state.reason}</p><p>入力は残っています。</p>
  </Notice>
}
