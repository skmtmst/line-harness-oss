'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { bookingApi, type BookingRequest } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'requested', label: '未承認' },
  { key: 'confirmed', label: '確定' },
  { key: 'rejected', label: '拒否' },
  { key: 'expired', label: '期限切れ' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'all', label: '全件' },
]

const statusBadgeColor: Record<string, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-100 text-gray-700',
  expired: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-600',
  completed: 'bg-blue-100 text-blue-800',
  no_show: 'bg-red-100 text-red-800',
}

const statusLabel: Record<string, string> = {
  requested: 'リクエスト',
  confirmed: '確定',
  rejected: '拒否',
  expired: '期限切れ',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: '無断',
}

const actionLabel: Record<string, string> = {
  approve: '承認',
  reject: '拒否',
  cancel: 'キャンセル',
  no_show: '無断キャンセル',
  complete: '完了',
}

function formatJpDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function formatJpTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export default function BookingsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [tab, setTab] = useState<string>('requested')
  const [items, setItems] = useState<BookingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // copied 状態は URL 単位で持つ。アカウント切替で shareUrl が変わると
  // 自動で「コピー済」が消えるので、A の URL をコピーしたまま B 画面で
  // 「B フォームと思い込んで送信」する事故を防ぐ。
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  // 詳細パネルは行の実体ではなく id を保持する。承認などで再読み込みしたあとも
  // 最新の行を引き直せるので、パネルに古い状態が残らない。
  const [detailId, setDetailId] = useState<string | null>(null)

  const liffId = selectedAccount?.liffId ?? null
  // Worker `/o` は ref 解決・追跡なしで liffId を直接受けるラップ URL。
  // `liff.line.me` を直貼りすると OpenChat / IG DM 等で削除されるため、
  // LINE 内配信も SNS 配信もこの 1 本で完結させる。/o は LINE 内 UA でも
  // 「LINEで開く」ボタン経由で Universal Link → LIFF を起動する。
  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const shareUrl = workerBase && liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(liffId)}&page=salon-book`
    : null
  const copied = copiedUrl !== null && copiedUrl === shareUrl

  async function copyUrl(url: string | null) {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      setTimeout(() => {
        setCopiedUrl((cur) => (cur === url ? null : cur))
      }, 2000)
    } catch {
      window.prompt('コピーしてください:', url)
    }
  }

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    // タブ/アカウント切り替えで先に list をクリア。fetch 失敗時に前タブの行が
    // 残ってしまい、誤って別ステータスの予約を操作してしまう事故を防ぐ。
    setItems([])
    try {
      const r = await bookingApi.listRequests(selectedAccountId, tab)
      setItems(r.requests)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, tab])

  useEffect(() => {
    load()
  }, [load])

  async function handleDecide(id: string, action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') {
    if (!selectedAccountId) return
    if (!confirm(`この予約を「${actionLabel[action]}」しますか？`)) return
    try {
      await bookingApi.decideRequest(selectedAccountId, id, action)
      await load()
    } catch (e) {
      alert(`操作に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // タブ切替やアカウント切替で items が入れ替わったとき、開いていた予約が
  // 一覧から消えることがある。その場合はパネルを閉じる。
  const detail = detailId ? (items.find((b) => b.id === detailId) ?? null) : null
  useEffect(() => {
    if (detailId && !items.some((b) => b.id === detailId)) setDetailId(null)
  }, [items, detailId])

  return (
    <div>
      <Header
        title="予約管理"
        description="顧客からの予約リクエストを承認・拒否します"
      />

      {selectedAccountId && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-900 mb-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.828 10.172a4 4 0 015.656 0l1.414 1.414a4 4 0 010 5.656l-3 3a4 4 0 01-5.656 0L10 18.343M10.172 13.828a4 4 0 01-5.656 0L3.1 12.414a4 4 0 010-5.656l3-3a4 4 0 015.656 0L14 5.657"
              />
            </svg>
            お客様向け 予約フォーム LIFF URL
          </div>
          {shareUrl ? (
            <>
              <div className="flex gap-2 items-center">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 border border-blue-200 rounded-lg px-3 py-2 text-xs bg-white font-mono"
                />
                <button
                  type="button"
                  onClick={() => copyUrl(shareUrl)}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {copied ? 'コピー済' : 'コピー'}
                </button>
              </div>
              <p className="text-xs text-blue-700 mt-2">
                LINE / OpenChat / IG DM どこでも貼れます。受信者がタップすると LINE で予約画面が開きます。
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-700">
              このアカウントには LIFF ID が未設定です。
              <a href="/accounts" className="underline ml-1">アカウント設定</a> で LIFF ID を登録してください。
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-pill px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === key
                ? 'bg-accent text-on-accent'
                : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!selectedAccountId ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          サイドバーでアカウントを選択してください
        </div>
      ) : loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          読み込み中…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          該当する予約はありません
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">日時</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">顧客</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">メニュー</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">担当</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">要望</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">料金</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">状態</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm whitespace-nowrap">{formatJpDateTime(b.starts_at)}</td>
                    <td className="px-4 py-3 text-sm">
                      <Link
                        href={`/chats?friend=${b.friend_id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {b.friend_name ?? '-'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm">{b.menu_name}</td>
                    <td className="px-4 py-3 text-sm">{b.staff_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate" title={b.customer_note ?? ''}>
                      {b.customer_note ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">¥{b.price_at_booking.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs ${statusBadgeColor[b.status] ?? 'bg-gray-100'}`}>
                        {statusLabel[b.status] ?? b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setDetailId(b.id)}
                          className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md"
                        >
                          詳細
                        </button>
                        <ActionButtons status={b.status} onAction={(a) => handleDecide(b.id, a)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail && (
        <BookingDetailPanel
          booking={detail}
          onClose={() => setDetailId(null)}
          onAction={(a) => handleDecide(detail.id, a)}
        />
      )}
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-2.5 border-b border-gray-100 last:border-b-0">
      <span className="w-28 shrink-0 text-xs font-medium text-gray-500 pt-0.5">{label}</span>
      <div className="flex-1 text-sm text-gray-900 break-words">{children}</div>
    </div>
  )
}

function BookingDetailPanel({
  booking: b,
  onClose,
  onAction,
}: {
  booking: BookingRequest
  onClose: () => void
  onAction: (a: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <aside className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-gray-500">予約の詳細</p>
            <h2 className="truncate text-base font-semibold text-gray-900">{b.menu_name}</h2>
          </div>
          <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${statusBadgeColor[b.status] ?? 'bg-gray-100'}`}>
            {statusLabel[b.status] ?? b.status}
          </span>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
          >
            閉じる
          </button>
        </div>

        <div className="px-5 py-4">
          <section className="mb-6">
            <h3 className="mb-1 text-sm font-semibold text-gray-900">予約内容</h3>
            <DetailRow label="日時">
              {formatJpDateTime(b.starts_at)} 〜 {formatJpTime(b.ends_at)}
            </DetailRow>
            <DetailRow label="担当">{b.staff_name}</DetailRow>
            <DetailRow label="料金">
              <span className="tabular-nums">¥{b.price_at_booking.toLocaleString()}</span>
            </DetailRow>
            <DetailRow label="予約番号">
              <span className="font-mono text-xs text-gray-600">{b.id}</span>
            </DetailRow>
          </section>

          <section className="mb-6">
            <h3 className="mb-1 text-sm font-semibold text-gray-900">お客様</h3>
            <DetailRow label="お名前">
              <Link href={`/chats?friend=${b.friend_id}`} className="text-blue-600 hover:underline">
                {b.friend_name ?? '名前未設定'}
              </Link>
            </DetailRow>
            <DetailRow label="ご要望">
              {b.customer_note ? (
                <span className="whitespace-pre-wrap">{b.customer_note}</span>
              ) : (
                <span className="text-gray-400">記入なし</span>
              )}
            </DetailRow>
          </section>

          <section className="mb-6">
            <h3 className="mb-1 text-sm font-semibold text-gray-900">記録</h3>
            <DetailRow label="申込日時">{formatJpDateTime(b.requested_at)}</DetailRow>
            <DetailRow label="決定日時">
              {b.decided_at ? formatJpDateTime(b.decided_at) : <span className="text-gray-400">未決定</span>}
            </DetailRow>
            <DetailRow label="カレンダー">
              {b.external_event_id ? (
                <span className="text-green-700">Googleカレンダーに登録済み</span>
              ) : (
                <span className="text-gray-400">未連携</span>
              )}
            </DetailRow>
          </section>

          <div className="border-t border-gray-200 pt-4">
            <p className="mb-2 text-xs text-gray-500">
              承認するとお客様のLINEに確定のお知らせが届きます。
            </p>
            <ActionButtons status={b.status} onAction={onAction} />
          </div>
        </div>
      </aside>
    </div>
  )
}

function ActionButtons({
  status,
  onAction,
}: {
  status: string
  onAction: (a: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') => void
}) {
  if (status === 'requested') {
    return (
      <div className="inline-flex gap-1">
        <button
          onClick={() => onAction('approve')}
          className="rounded-control bg-accent px-3 py-1 text-xs font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          承認
        </button>
        <button
          onClick={() => onAction('reject')}
          className="px-3 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md"
        >
          拒否
        </button>
      </div>
    )
  }
  if (status === 'confirmed') {
    return (
      <div className="inline-flex gap-1">
        <button
          onClick={() => onAction('complete')}
          className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md"
        >
          完了
        </button>
        <button
          onClick={() => onAction('no_show')}
          className="px-3 py-1 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-md"
        >
          無断
        </button>
        <button
          onClick={() => onAction('cancel')}
          className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md"
        >
          取消
        </button>
      </div>
    )
  }
  return <span className="text-xs text-gray-400">-</span>
}
