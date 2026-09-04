'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { bookingApi, type BookingRequest } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import ConfirmDialog from '@/components/shared/confirm-dialog'

type BookingAction = 'approve' | 'reject' | 'cancel' | 'complete' | 'no_show'

/** 運用者に見せる言葉。内部の値をそのまま出さない。 */
const ACTION_LABELS: Record<BookingAction, string> = {
  approve: '承認',
  reject: 'お断り',
  cancel: 'キャンセル',
  complete: '完了',
  no_show: '来店なし',
}

/**
 * 予約の詳細（設計 V2 8-1-1 / node IHRKE）。
 *
 * 設計は左右2列。左が「予約の中身・お客さま・申込時の回答」、
 * 右が「どうするか・承認したときの通知・記録」。
 *
 * 以前は1列の定義リストだけで、承認したときにお客様へ何が届くのかが
 * 画面から分からなかった。承認は取り消せないので、押す前に届く文面が
 * 見えている必要がある。
 */

const STATUS_LABELS: Record<string, string> = {
  requested: '未承認',
  confirmed: '確定',
  rejected: 'お断り',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: '来店なし',
  expired: '期限切れ',
}

const STATUS_BADGE: Record<string, string> = {
  requested: 'bg-warning-bg text-warning',
  confirmed: 'bg-success-bg text-success',
}

function jpDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function jpTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function jpStamp(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

/** 予約番号。id は UUID なので、そのままだと読み上げられない。 */
function bookingNumber(id: string): string {
  return `#R-${id.replace(/[^0-9a-zA-Z]/g, '').slice(-6).toUpperCase()}`
}

/**
 * 承認したときにお客様へ届く文面。
 *
 * 実際に送っているのは apps/worker/src/services/booking-notifier.ts の
 * renderNotificationText('approved', ...)。ここは同じ形をなぞっている。
 * 向こうを変えたらここも直すこと。
 */
function approvedText(b: BookingRequest): string {
  const jst = new Date(new Date(b.starts_at).getTime() + 9 * 3600_000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
  return [
    '予約が確定しました。',
    `メニュー: ${b.menu_name}`,
    `担当: ${b.staff_name}`,
    `日時: ${jst}`,
    '',
    '変更・キャンセルはお店に直接ご連絡ください。',
  ].join('\n')
}

function BookingDetailInner() {
  const { selectedAccountId } = useAccount()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const [booking, setBooking] = useState<BookingRequest | null>(null)
  /** 同じ友だちの予約。「これまでの予約」に使う。 */
  const [history, setHistory] = useState<BookingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [decideTarget, setDecideTarget] = useState<BookingAction | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!id || !selectedAccountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await bookingApi.listRequests(selectedAccountId, 'all')
      const found = res.requests.find((r) => r.id === id) ?? null
      setBooking(found)
      setHistory(
        found ? res.requests.filter((r) => r.friend_id === found.friend_id && r.id !== found.id) : [],
      )
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 予約の状態を変える。**押す前に確認を出す。**
   *
   * ブラウザの `confirm()` は見た目がブラウザ任せで、設計の確認窓と違ううえ、
   * **画像比較に写らない**（確認の絵をそもそも撮れない）。
   */
  const decide = async (action: BookingAction) => {
    if (!selectedAccountId) return
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

  const lastVisit = useMemo(() => {
    const past = history
      .filter((r) => r.status === 'completed' || r.status === 'confirmed')
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    return past[0] ?? null
  }, [history])

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

  const status = booking?.status ?? ''

  return (
    <div>
      <div data-design="Head">
        <nav className="text-ink-faint mb-2 text-xs">
          <Link href="/booking/bookings" className="hover:underline">
            予約管理
          </Link>
          <span className="mx-1.5">/</span>
          <span>予約の詳細</span>
        </nav>
        <Header
          title="予約の詳細"
          description="内容を確認して、承認・拒否・日時の変更を行います。"
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Link
            href="/booking/bookings"
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-2 text-sm"
          >
            一覧に戻る
          </Link>
          <button
            disabled
            title="この画面から予約の中身を書き換える仕組みは準備中です"
            className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium opacity-50"
          >
            変更を保存
          </button>
        </div>
      </div>

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
        <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
          <div data-design="Left" className="min-w-0 flex-1 space-y-4">
            <section data-design="Sum" className="bg-canvas rounded-card border-hairline border p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-ink text-base font-semibold">{booking.menu_name}</h2>
                <span
                  className={`rounded-pill px-2 py-0.5 text-xs ${STATUS_BADGE[status] ?? 'bg-canvas-sunken text-ink-secondary'}`}
                >
                  {STATUS_LABELS[status] ?? status}
                </span>
                <span className="text-ink-faint font-mono text-xs">
                  予約番号 {bookingNumber(booking.id)}
                </span>
              </div>
              <Row label="日時">
                {jpDateTime(booking.starts_at)}〜{jpTime(booking.ends_at)}
              </Row>
              <Row label="担当">{booking.staff_name}</Row>
              <Row label="料金">
                <span className="tabular-nums">
                  ¥{booking.price_at_booking.toLocaleString()}（税込）
                </span>
              </Row>
              <Row label="申込日時">{jpStamp(booking.requested_at)}</Row>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-ink text-sm font-semibold">お客さま</h2>
                <Link
                  href={`/friends/detail?id=${encodeURIComponent(booking.friend_id)}`}
                  className="text-accent text-xs hover:underline"
                >
                  友だち詳細を見る
                </Link>
              </div>
              <Row label="お名前">
                {booking.friend_name ? `${booking.friend_name} さま` : '未設定'}
              </Row>
              <Row label="LINEの表示名">{booking.friend_name ?? '未設定'}</Row>
              {/* 電話番号は友だち情報欄に入れる決まりで、bookings にも friends にも
                  列が無い。ここで作り話をせず、どこを見ればよいかだけ書く。 */}
              <Row label="連絡先">
                <span className="text-ink-faint">友だち情報欄で管理しています</span>
              </Row>
              <Row label="これまでの予約">
                {history.length === 0 ? (
                  <span className="text-ink-faint">この予約がはじめてです</span>
                ) : (
                  <>
                    {history.length}件
                    {lastVisit && `（直近 ${jpStamp(lastVisit.starts_at).slice(0, 10)}）`}
                  </>
                )}
              </Row>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <h2 className="text-ink mb-3 text-sm font-semibold">申込時にいただいた回答</h2>
              {booking.customer_note ? (
                <>
                  <p className="text-ink-faint text-xs">気になっていること</p>
                  <p className="text-ink mt-1 text-sm whitespace-pre-wrap">
                    {booking.customer_note}
                  </p>
                </>
              ) : (
                <p className="text-ink-faint text-sm">記入はありませんでした。</p>
              )}
            </section>
          </div>

          <div data-design="Right" className="w-full shrink-0 space-y-4 xl:w-96">
            <section
              data-design="sec この予約をどうするか"
              className="bg-canvas rounded-card border-hairline border p-5"
            >
              <h2 className="text-ink mb-1 text-sm font-semibold">この予約をどうするか</h2>
              <p className="text-ink-faint mb-3 text-xs">
                承認するとお客様のLINEに確定のお知らせが届きます。
              </p>
              <div className="flex flex-col gap-2">
                {status === 'requested' && (
                  <>
                    <button
                      onClick={() => setDecideTarget('approve')}
                      disabled={acting}
                      className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium disabled:opacity-40"
                    >
                      承認する
                    </button>
                    <button
                      disabled
                      title="日時の変更は準備中です。いったん拒否して取り直してください"
                      className="border-hairline text-ink-secondary rounded-control border px-4 py-2 text-sm font-medium opacity-50"
                    >
                      日時を変更する
                    </button>
                    <button
                      onClick={() => setDecideTarget('reject')}
                      disabled={acting}
                      className="text-danger hover:bg-danger-bg rounded-control px-4 py-2 text-sm font-medium disabled:opacity-40"
                    >
                      拒否する
                    </button>
                  </>
                )}
                {status === 'confirmed' && (
                  <>
                    <button
                      onClick={() => setDecideTarget('complete')}
                      disabled={acting}
                      className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium disabled:opacity-40"
                    >
                      完了にする
                    </button>
                    <button
                      onClick={() => setDecideTarget('no_show')}
                      disabled={acting}
                      className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
                    >
                      来店なし
                    </button>
                    <button
                      onClick={() => setDecideTarget('cancel')}
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

              <div className="border-hairline mt-4 border-t pt-4">
                <p className="text-ink text-xs font-medium">承認時にひとことを添える</p>
                <p className="text-ink-faint mt-0.5 text-xs">
                  定型のお知らせに、この予約だけのメッセージを追加できます。
                </p>
                <textarea
                  disabled
                  rows={2}
                  title="ひとことの追加は準備中です"
                  placeholder="準備中です"
                  aria-label="承認時に添えるひとこと"
                  className="border-hairline rounded-control mt-2 w-full resize-none border px-3 py-2 text-sm opacity-50"
                />
              </div>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <h2 className="text-ink mb-1 text-sm font-semibold">承認したときの通知</h2>
              <p className="text-ink-faint mb-3 text-xs">お客様に届く内容</p>
              <div className="bg-canvas-sunken rounded-card p-3">
                <p className="text-ink-faint mb-1 text-xs">然-NEN-</p>
                <p className="text-ink rounded-2xl bg-white px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
                  {approvedText(booking)}
                </p>
              </div>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <h2 className="text-ink mb-3 text-sm font-semibold">この予約の記録</h2>
              <ol className="space-y-3">
                <LogRow at={jpStamp(booking.requested_at)} text="お客様が予約を申し込みました" />
                <LogRow at={jpStamp(booking.requested_at)} text="受付のお知らせを自動送信しました" />
                {booking.decided_at && (
                  <LogRow
                    at={jpStamp(booking.decided_at)}
                    text={`スタッフが「${STATUS_LABELS[status] ?? status}」にしました`}
                  />
                )}
              </ol>
            </section>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={decideTarget !== null}
        title={`この予約を「${decideTarget ? ACTION_LABELS[decideTarget] : ''}」にしますか？`}
        description="予約した人へ、この結果がLINEで届きます。取り消すには、もう一度状態を変える必要があります。"
        confirmLabel={decideTarget ? ACTION_LABELS[decideTarget] : '実行する'}
        destructive={decideTarget === 'reject' || decideTarget === 'cancel' || decideTarget === 'no_show'}
        busy={acting}
        onCancel={() => setDecideTarget(null)}
        onConfirm={() => { const a = decideTarget; setDecideTarget(null); if (a) void decide(a) }}
      />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-hairline flex gap-4 border-b py-2.5 last:border-b-0">
      <span className="text-ink-faint w-28 shrink-0 pt-0.5 text-xs font-medium">{label}</span>
      <div className="text-ink flex-1 text-sm break-words">{children}</div>
    </div>
  )
}

function LogRow({ at, text }: { at: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="text-ink-faint w-32 shrink-0 text-xs tabular-nums">{at}</span>
      <span className="text-ink-secondary text-xs">{text}</span>
    </li>
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
