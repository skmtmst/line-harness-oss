'use client'

import { formatDateTime } from '@/lib/format'
import Button from './button'
import Notice from './notice'

export type AggregationState =
  | { kind: 'empty' }
  | { kind: 'running'; startedAt: string | null }
  | { kind: 'failed'; reason: string }
  | { kind: 'complete'; dataAt: string | null }

function time(value: string | null) {
  return formatDateTime(value, '未取得')
}

/**  E2：読み込みの404と、件数が0の完成した集計を区別する。 */
export default function AggregationStatus({ state, onRun, disabled = false, canRun = true }: { state: AggregationState; onRun: () => void; disabled?: boolean; canRun?: boolean }) {
  const label = state.kind === 'empty' ? '集計する' : state.kind === 'failed' ? 'もう一度' : '集計し直す'
  return <Notice tone={state.kind === 'failed' ? 'danger' : 'info'} role="status" data-aggregation-state={state.kind}
    action={state.kind === 'running' || !canRun ? undefined : <Button onClick={onRun} disabled={disabled}>{label}</Button>}>
    <strong>集計の状態</strong>
    {state.kind === 'empty' ? <p>まだ集計していません。</p>
      : state.kind === 'running' ? <p>{`集計中です。始めた時刻：${time(state.startedAt)}`}</p>
      : state.kind === 'failed' ? <p>{state.reason}</p>
      : <p>{`集計できました。データの時点：${time(state.dataAt)}`}</p>}
  </Notice>
}
