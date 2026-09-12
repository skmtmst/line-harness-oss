'use client'

import { useRef, useState } from 'react'
import { ApiError, api, type BroadcastLedger } from '@/lib/api'
import Button from '@/components/shared/button'

/*
 * 送信中の一斉配信を止める／再開する／失敗した相手だけ送り直す（#662 / N-059）。
 *
 * **画面で守っているのは見た目だけ。**押している間ボタンを無効にするのは
 * 二度押しの見栄えを整えるためで、本当の守りはサーバー側の版（version）付き
 * 条件付き更新。2人が別々の端末から同時に押しても、勝つのは1人だけで、
 * 負けた側は 409 を受け取ってここで読み直しを促す。
 *
 * 数の出し方にも理由がある。「送信成功 N人」だけを出すと、運用者は
 * 「残りは失敗したのだから送り直せる」と読む。**送達不明は送り直せない。**
 * 外へ出たかもしれない相手へもう一度送ると、相手のトークに2通残って
 * 取り消せないため。だから届いた・届かなかった・分からない を分けて出す。
 */

export interface BroadcastStopControlsProps {
  broadcastId: string
  /** 配信の状態。停止できるのは送信中だけ。 */
  status: string
  /** 停止を受け付け済みか。`status === 'sending' && stopped` が「停止中」。 */
  stopped: boolean
  /** 楽観ロックの版。押した時点で画面が読み込んでいた版を送る。 */
  version: number
  ledger: BroadcastLedger | null
  /** 全員配信は宛先の一覧を持たないため、停止も失敗分の再送もできない。 */
  targetType: string
  /** 状態が変わったので読み直してほしい、という合図。 */
  onChanged: () => void
}

type PendingAction = 'stop' | 'resume' | 'retry' | null

function errorMessageFor(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return typeof err.message === 'string' && err.message
        ? err.message
        : '別の操作が先に入りました。画面を読み直してからやり直してください。'
    }
    if (err.status === 403) return 'この操作を行う権限がありません。'
    if (err.status === 428) return '確認の手順を経ていないため実行できませんでした。もう一度お試しください。'
    if (err.message) return err.message
  }
  return fallback
}

export default function BroadcastStopControls({
  broadcastId,
  status,
  stopped,
  version,
  ledger,
  targetType,
  onChanged,
}: BroadcastStopControlsProps) {
  const [pending, setPending] = useState<PendingAction>(null)
  /*
   * 連打の見張りは ref で持つ。
   *
   * `pending` は描き直しで入れ替わる値なので、**同じ描き直しの中で2回
   * 押された場合は2つ目の呼び出しも `null` を読む**（閉じ込めた古い値）。
   * `disabled` は描き直しのあとにしか効かないので、これも間に合わない。
   * 押した瞬間に同期で立つ印が要る。
   */
  const runningRef = useRef(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // 全員配信は LINE 側に宛先の一覧も停止の口も無い。できないことを
  // できるように見せない。
  if (targetType === 'all') return null

  const sending = status === 'sending'
  const isStopped = sending && stopped
  const retryable = ledger?.retryableCount ?? 0
  const canRetry = (status === 'sent' || isStopped) && retryable > 0

  if (!sending && !canRetry) return null

  const run = async (action: Exclude<PendingAction, null>) => {
    // 二度押しは、まずここで弾く。ここを抜けても、サーバー側の版が
    // 二重の適用を止める。
    if (runningRef.current) return
    runningRef.current = true
    setPending(action)
    setError('')
    setMessage('')
    try {
      if (action === 'stop') {
        const res = await api.broadcasts.stop(broadcastId, version)
        setMessage(
          res.alreadyStopped
            ? 'この配信はすでに停止しています。'
            : `配信を停止しました。送達不明 ${res.stoppedUnknownCount ?? 0}人は、二重に届くのを避けるため再送しません。`,
        )
      } else if (action === 'resume') {
        await api.broadcasts.resume(broadcastId, version)
        setMessage('配信を再開しました。届いた相手と送達不明の相手は飛ばします。')
      } else {
        const res = await api.broadcasts.retryFailed(broadcastId, version)
        setMessage(`失敗した ${res.retryTargets ?? retryable}人へ送り直します（${res.attemptNo ?? 2}回目）。`)
      }
      onChanged()
    } catch (err) {
      setError(errorMessageFor(err, '操作に失敗しました'))
      // 版が食い違ったときは、正しい版を取り直さないと次も失敗する。
      if (err instanceof ApiError && err.status === 409) onChanged()
    } finally {
      runningRef.current = false
      setPending(null)
    }
  }

  return (
    <section
      className="bg-canvas border-hairline rounded-card mb-4 border p-4"
      aria-label="配信の停止と再送"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-ink text-sm font-bold">
            {isStopped ? '停止中' : sending ? '送信中' : '送信完了'}
          </h3>
          <p className="text-ink-secondary mt-1 text-xs">
            {isStopped
              ? '新しい送信は行っていません。続きを送るか、失敗した相手だけ送り直せます。'
              : sending
                ? '停止すると、いま送っている束を送り終えたところで止まります。'
                : '届かなかった相手だけを送り直せます。'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sending && !isStopped && (
            <Button type="button" onClick={() => run('stop')} disabled={pending !== null}>
              {pending === 'stop' ? '停止しています…' : '配信を停止'}
            </Button>
          )}
          {isStopped && (
            <Button type="button" onClick={() => run('resume')} disabled={pending !== null}>
              {pending === 'resume' ? '再開しています…' : '続きを送る'}
            </Button>
          )}
          {canRetry && (
            <Button type="button" onClick={() => run('retry')} disabled={pending !== null}>
              {pending === 'retry'
                ? '送り直しています…'
                : `失敗した${retryable.toLocaleString('ja-JP')}人へ送り直す`}
            </Button>
          )}
        </div>
      </div>

      {ledger && (
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { key: 'sent', label: '届いた', value: ledger.sent, note: '送達を確かめられた相手' },
            { key: 'failed', label: '届かなかった', value: ledger.failed, note: '送り直せます' },
            { key: 'unknown', label: '送達不明', value: ledger.unknown, note: '二重に届くのを避けるため送り直しません' },
            { key: 'inFlight', label: '送信中', value: ledger.inFlight, note: 'いま送っている相手' },
          ].map((item) => (
            <div key={item.key} className="bg-canvas-sunken rounded-card p-3" data-testid={`ledger-${item.key}`}>
              <dt className="text-ink-secondary text-xs font-semibold">{item.label}</dt>
              <dd className="text-ink mt-1 text-lg font-bold">{item.value.toLocaleString('ja-JP')}人</dd>
              <p className="text-ink-faint mt-1 text-xs">{item.note}</p>
            </div>
          ))}
        </dl>
      )}

      {message && (
        <p role="status" className="text-ink-secondary mt-3 text-sm">{message}</p>
      )}
      {error && (
        <p role="alert" className="text-danger mt-3 text-sm">{error}</p>
      )}
    </section>
  )
}
