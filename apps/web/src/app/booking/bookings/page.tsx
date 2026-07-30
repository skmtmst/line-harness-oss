'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { bookingApi, type BookingActionRequest, type BookingRequest } from '@/lib/api'
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

export default function BookingsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [tab, setTab] = useState<string>('requested')
  const [items, setItems] = useState<BookingRequest[]>([])
  const [actionRequests, setActionRequests] = useState<BookingActionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // copied 状態は URL 単位で持つ。アカウント切替で shareUrl が変わると
  // 自動で「コピー済」が消えるので、A の URL をコピーしたまま B 画面で
  // 「B フォームと思い込んで送信」する事故を防ぐ。
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  const liffId = selectedAccount?.liffId ?? null
  // リッチメニューは LINE 内から開くため、LIFF の Universal Link を直接使う。
  // /o ラップを挟まないので「LINEで開く」の中間画面が出ず、予約画面へ直行する。
  const shareUrl = liffId
    ? `https://liff.line.me/${encodeURIComponent(liffId)}/?page=salon-book&liffId=${encodeURIComponent(liffId)}`
    : null
  const historyUrl = liffId
    ? `https://liff.line.me/${encodeURIComponent(liffId)}/?page=salon-book&view=history&liffId=${encodeURIComponent(liffId)}`
    : null
  const copied = copiedUrl !== null && copiedUrl === shareUrl
  const historyCopied = copiedUrl !== null && copiedUrl === historyUrl

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
      const [r, actions] = await Promise.all([
        bookingApi.listRequests(selectedAccountId, tab),
        bookingApi.listActionRequests(selectedAccountId, 'requested'),
      ])
      setItems(r.requests)
      // 変更・キャンセルは「未承認」で処理するものだけを同じ承認導線に出す。
      // 予約本体の「確定」「キャンセル」タブと、アクション申請の内部状態を混在させない。
      setActionRequests(tab === 'requested' ? actions.requests : [])
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

  async function handleActionRequest(id: string, decision: 'approve' | 'reject') {
    if (!selectedAccountId) return
    if (!confirm(decision === 'approve' ? 'このリクエストを承認しますか？' : 'このリクエストを否認しますか？')) return
    try {
      await bookingApi.decideActionRequest(selectedAccountId, id, decision)
      await load()
    } catch (e) {
      alert(`操作に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div>
      <Header
        title="予約管理"
        description="顧客からの予約リクエストを承認・拒否します"
      />

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
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              tab === key ? 'text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
            }`}
            style={tab === key ? { backgroundColor: '#06C755' } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {selectedAccountId && actionRequests.length > 0 && (
        <section className="mb-5 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <h2 className="mb-3 font-semibold text-orange-900">変更・キャンセルリクエスト</h2>
          <div className="space-y-3">
            {actionRequests.map((request) => (
              <div key={request.id} className="rounded-lg border border-orange-100 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800">
                      {request.request_type === 'change' ? '予約変更' : 'キャンセル'}
                    </span>
                    <p className="mt-2 text-sm font-semibold text-gray-900">
                      {request.customer_name ?? 'お客様'}　
                      {formatJpDateTime(request.current_starts_at)}
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      現在：{request.current_location_name ?? '店舗未設定'}／{request.current_menu_name}／{request.current_staff_name}
                    </p>
                    {request.request_type === 'change' && request.requested_starts_at && (
                      <p className="mt-1 text-xs font-semibold text-green-700">
                        変更後：{formatJpDateTime(request.requested_starts_at)}／
                        {request.requested_location_name ?? '店舗未設定'}／
                        {request.requested_menu_name}／{request.requested_staff_name}
                      </p>
                    )}
                  </div>
                  {request.status === 'requested' && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void handleActionRequest(request.id, 'reject')} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">否認</button>
                      <button type="button" onClick={() => void handleActionRequest(request.id, 'approve')} className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white">承認</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
        <>
        <div className="space-y-3 md:hidden">
          {items.map((booking) => (
            <article key={booking.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-gray-900">{formatJpDateTime(booking.starts_at)}</p>
                  <Link
                    href={`/chats?friend=${booking.friend_id}`}
                    className="mt-1 inline-block text-sm font-semibold text-blue-600"
                  >
                    {booking.friend_name ?? 'お客様'}へメッセージ
                  </Link>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeColor[booking.status] ?? 'bg-gray-100'}`}>
                  {statusLabel[booking.status] ?? booking.status}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-gray-500">店舗</dt>
                <dd className="font-medium text-gray-800">{booking.location_name ?? '-'}</dd>
                <dt className="text-gray-500">メニュー</dt>
                <dd className="font-medium text-gray-800">{booking.menu_name}</dd>
                <dt className="text-gray-500">担当</dt>
                <dd className="text-gray-800">{booking.staff_name}</dd>
                <dt className="text-gray-500">料金</dt>
                <dd className="font-semibold tabular-nums text-gray-900">¥{booking.price_at_booking.toLocaleString()}</dd>
                {booking.customer_note && (
                  <>
                    <dt className="text-gray-500">要望</dt>
                    <dd className="whitespace-pre-wrap text-gray-700">{booking.customer_note}</dd>
                  </>
                )}
              </dl>
              <div className="mt-4 border-t border-gray-100 pt-3 text-right">
                <ActionButtons status={booking.status} onAction={(action) => handleDecide(booking.id, action)} />
              </div>
            </article>
          ))}
        </div>
        <div className="hidden bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">日時</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">顧客</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">メニュー</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">店舗</th>
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
                    <td className="px-4 py-3 text-sm">{b.location_name ?? '-'}</td>
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
                      <ActionButtons status={b.status} onAction={(a) => handleDecide(b.id, a)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {selectedAccountId && (
        <section className="mt-8 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-900">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
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
            リッチメニュー用 予約URL
          </div>
          {shareUrl ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="shrink-0 text-xs font-semibold text-blue-900 sm:w-28">予約する</div>
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => copyUrl(shareUrl)}
                  className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {copied ? 'コピー済' : 'コピー'}
                </button>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="shrink-0 text-xs font-semibold text-blue-900 sm:w-28">予約の確認</div>
                <input
                  readOnly
                  value={historyUrl ?? ''}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => copyUrl(historyUrl)}
                  className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {historyCopied ? 'コピー済' : 'コピー'}
                </button>
              </div>
              <p className="mt-2 text-xs text-blue-700">
                上段は「予約する」、下段は「予約の確認」ボタンに設定します。確認画面から詳細・履歴・キャンセルへ進めます。
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-700">
              このアカウントには LIFF ID が未設定です。
              <a href="/accounts" className="ml-1 underline">アカウント設定</a> で LIFF ID を登録してください。
            </p>
          )}
        </section>
      )}
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
      <div className="inline-flex gap-2">
        <button
          onClick={() => onAction('approve')}
          className="min-h-10 px-4 py-2 text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#06C755' }}
        >
          承認
        </button>
        <button
          onClick={() => onAction('reject')}
          className="min-h-10 px-4 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md"
        >
          拒否
        </button>
      </div>
    )
  }
  if (status === 'confirmed') {
    return (
      <div className="inline-flex flex-wrap justify-end gap-2">
        <button
          onClick={() => onAction('complete')}
          className="min-h-10 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md"
        >
          完了
        </button>
        <button
          onClick={() => onAction('no_show')}
          className="min-h-10 px-3 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-md"
        >
          無断
        </button>
        <button
          onClick={() => onAction('cancel')}
          className="min-h-10 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md"
        >
          取消
        </button>
      </div>
    )
  }
  return <span className="text-xs text-gray-400">-</span>
}
