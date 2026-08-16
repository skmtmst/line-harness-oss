'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { bookingApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

const STATUS_LABELS: Record<string, string> = {
  requested: '承認待ち',
  confirmed: '確定',
  rejected: 'お断り',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: '来店なし',
  expired: '期限切れ',
}

function BookingDetailInner() {
  const { selectedAccountId } = useAccount()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const [booking, setBooking] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!id || !selectedAccountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await bookingApi.listRequests(selectedAccountId, 'all')
      const found = res.requests.find((r) => (r as { id: string }).id === id)
      setBooking((found as unknown as Record<string, unknown>) ?? null)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const decide = async (action: 'approve' | 'reject' | 'cancel' | 'complete' | 'no_show') => {
    if (!selectedAccountId) return
    const labels: Record<typeof action, string> = {
      approve: '承認',
      reject: 'お断り',
      cancel: 'キャンセル',
      complete: '完了',
      no_show: '来店なし',
    }
    if (!confirm(`この予約を「${labels[action]}」にしますか？`)) return
    setActing(true)
    setError('')
    try {
      await bookingApi.decideRequest(selectedAccountId, id, action)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '変更に失敗しました')
    } finally {
      setActing(false)
    }
  }

  const text = (key: string) => String(booking?.[key] ?? '')

  if (!id) {
    return (
      <div>
        <Header title="予約の詳細" />
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          予約が指定されていません。
          <Link href="/booking/bookings" className="text-accent ml-1 hover:underline">
            一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  const status = text('status')

  return (
    <div>
      <Header title="予約の詳細" />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/booking/bookings" className="hover:underline">
          予約管理
        </Link>
        <span className="mx-1.5">›</span>
        <span>詳細</span>
      </nav>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : !booking ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          この予約は見つかりませんでした。
        </p>
      ) : (
        <div className="max-w-2xl space-y-5">
          <div className="bg-canvas rounded-card border-hairline border p-5">
            <dl className="space-y-2 text-sm">
              {[
                ['お客様', 'friend_name'],
                ['メニュー', 'menu_name'],
                ['担当', 'staff_name'],
                ['開始', 'starts_at'],
                ['終了', 'ends_at'],
                ['お客様からのメモ', 'customer_note'],
              ].map(([label, key]) => (
                <div key={key} className="flex justify-between gap-4">
                  <dt className="text-ink-faint shrink-0">{label}</dt>
                  <dd className="text-ink-secondary text-right break-all">
                    {key.endsWith('_at') && text(key)
                      ? new Date(text(key)).toLocaleString('ja-JP')
                      : text(key) || '—'}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-4">
                <dt className="text-ink-faint">状態</dt>
                <dd className="text-ink-secondary">{STATUS_LABELS[status] ?? status}</dd>
              </div>
            </dl>
          </div>

          <div className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink-secondary mb-3 text-sm font-medium">この予約をどうするか</p>
            <div className="flex flex-wrap gap-2">
              {status === 'requested' && (
                <>
                  <button
                    onClick={() => decide('approve')}
                    disabled={acting}
                    className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium disabled:opacity-40"
                  >
                    承認する
                  </button>
                  <button
                    onClick={() => decide('reject')}
                    disabled={acting}
                    className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
                  >
                    お断りする
                  </button>
                </>
              )}
              {status === 'confirmed' && (
                <>
                  <button
                    onClick={() => decide('complete')}
                    disabled={acting}
                    className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium disabled:opacity-40"
                  >
                    完了にする
                  </button>
                  <button
                    onClick={() => decide('no_show')}
                    disabled={acting}
                    className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
                  >
                    来店なし
                  </button>
                  <button
                    onClick={() => decide('cancel')}
                    disabled={acting}
                    className="text-danger hover:bg-danger-bg rounded-control px-4 py-2 text-sm font-medium disabled:opacity-40"
                  >
                    キャンセル
                  </button>
                </>
              )}
              {!['requested', 'confirmed'].includes(status) && (
                <p className="text-ink-faint text-sm">
                  この状態からは変えられません。新しく予約を取り直してください。
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function BookingDetailPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <BookingDetailInner />
    </Suspense>
  )
}
