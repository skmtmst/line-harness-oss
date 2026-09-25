'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ExternalLink, Link2, RefreshCw, Sparkles, Star } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import SelectField from '@/components/shared/select-field'
import StickyBar from '@/components/shared/sticky-bar'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { Tabs } from '@/components/shared/tabs'
import { TextArea } from '@/components/shared/text-field'
import { ActionCell, DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { ApiError } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import {
  restaurantGoogleApi,
  type GoogleConnectionData,
  type GoogleReview,
  type GoogleReviewFilter,
  type GoogleReviewListData,
  type GoogleReviewOrder,
} from '@/lib/restaurant-google-api'

/**
 * ★V6 Googleビジネス（飲食店向け）第1段：設定タブ＋口コミタブ。
 *
 * Pencil `V6正本.pen`
 *  - GB-1  p9ALPi 設定（未接続）      - GB-13 O4GMOL 設定（接続済み）
 *  - GB-2  lM0zP  口コミ一覧          - GB-3  TJPK5  AI返信下書き
 *  - GB-16 xSudF  返信の公開確認      - GB-15 oQRFu  状態・エラー
 *
 * 投稿・パフォーマンス・プロフィールは第2段以降。タブは見せるが押せない
 * （未対応機能を利用可能に見せない）。
 */

type TabKey = 'reviews' | 'posts' | 'performance' | 'profile' | 'settings'
const TAB_LABELS: Record<TabKey, string> = { reviews: '口コミ', posts: '投稿', performance: 'パフォーマンス', profile: 'プロフィール', settings: '設定' }
const FILTER_LABELS: Record<GoogleReviewFilter, string> = { unreplied: '未返信', draft: '下書きあり', attention: '要確認', all: 'すべて' }
const ORDER_OPTIONS: Array<{ value: GoogleReviewOrder; label: string }> = [
  { value: 'newest', label: '新しい順' },
  { value: 'oldest', label: '古い順' },
  { value: 'rating_low', label: '評価が低い順' },
  { value: 'rating_high', label: '評価が高い順' },
]

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  const time = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(date)
  if (sameDay) return `今日 ${time}`
  return `${new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(date)} ${time}`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-warning inline-flex items-center gap-1" aria-label={`評価 ${rating}／5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} fill={n <= rating ? 'currentColor' : 'none'} strokeWidth={1.5} className={n <= rating ? '' : 'text-ink-faint'} />
      ))}
    </span>
  )
}

function replyBadge(review: GoogleReview): { label: string; tone: StatusBadgeTone } {
  if (review.replyStatus === 'published') return { label: '返信済み', tone: 'success' }
  if (review.replyStatus === 'replied') return { label: '反映確認中', tone: 'info' }
  if (review.replyStatus === 'pending_confirm') return { label: '反映確認中', tone: 'warning' }
  if (review.replyStatus === 'draft') return { label: review.replyDraftAiGenerated ? 'AI下書きあり' : '下書きあり', tone: 'info' }
  if (review.needsAttention) return { label: '要確認', tone: 'danger' }
  return { label: '未返信', tone: 'warning' }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

export default function GoogleBusinessPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <GoogleBusinessInner />
    </Suspense>
  )
}

function GoogleBusinessInner() {
  usePageTitle('Googleビジネス')
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [data, setData] = useState<GoogleConnectionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [banner, setBanner] = useState<{ tone: 'info' | 'warn' | 'danger'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) { setData(null); setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      setData(await restaurantGoogleApi.connection(selectedAccountId))
    } catch (err) {
      setData(null)
      setError(err instanceof ApiError && err.status === 404 ? 'このLINEアカウントには店舗が紐付いていません。先に店舗管理でLINEアカウントを割り当ててください。' : errorMessage(err, 'Googleビジネスの状態を読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  // Googleからの戻り（?google=connected など）を1回だけ帯に出して、URLから消す。
  useEffect(() => {
    const result = searchParams.get('google')
    if (!result) return
    const messages: Record<string, { tone: 'info' | 'warn' | 'danger'; text: string }> = {
      connected: { tone: 'info', text: 'Googleアカウントを接続しました。口コミを取得します。' },
      reconnected: { tone: 'info', text: 'Googleアカウントを再接続しました。' },
      select_location: { tone: 'warn', text: 'このGoogleアカウントは複数の店舗を管理しています。このLINEアカウントに結びつける店舗を1つ選んでください。' },
      'error:invalid_state': { tone: 'danger', text: '認可の確認に失敗しました。もう一度「Googleアカウントを接続」からやり直してください。' },
      'error:denied': { tone: 'danger', text: 'Googleでの許可が取り消されました。接続は変更していません。' },
      'error:location_mismatch': { tone: 'danger', text: '別の店舗が選ばれたため保存しませんでした。店舗を変えるには、先に接続を解除してください。' },
      'error:no_locations': { tone: 'danger', text: 'このGoogleアカウントで管理できる店舗が見つかりませんでした。店舗を管理しているGoogleアカウントでログインしてください。' },
      'error:oauth_not_configured': { tone: 'danger', text: 'この環境にはGoogle接続の設定がありません。' },
    }
    setBanner(messages[result] ?? { tone: 'danger', text: 'Googleとの接続に失敗しました。あとでもう一度お試しください。' })
    const next = new URLSearchParams(searchParams.toString())
    next.delete('google')
    router.replace(`/restaurant-test/google${next.toString() ? `?${next.toString()}` : ''}`)
  }, [router, searchParams])

  const connected = data?.connection.status === 'connected' || data?.connection.status === 'expired' || data?.connection.status === 'no_permission'
  const requestedTab = searchParams.get('tab') as TabKey | null
  const tab: TabKey = !connected ? 'settings' : requestedTab && requestedTab in TAB_LABELS ? requestedTab : 'reviews'
  const view = searchParams.get('view')
  const reviewId = searchParams.get('id')

  const go = useCallback((params: Record<string, string | undefined>) => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value) next.set(key, value)
    router.push(`/restaurant-test/google${next.toString() ? `?${next.toString()}` : ''}`)
  }, [router])

  if (accountLoading || loading) return <ListState kind="loading" title="Googleビジネスを読み込んでいます" />
  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINE公式アカウントを選んでください" description={accounts.length ? '上のバーで店舗のLINEアカウントを選ぶと表示します。' : '先にLINE公式アカウントを登録してください。'} />
  }
  if (error || !data) return <ListState kind="error" title="Googleビジネスを表示できませんでした" description={error} onRetry={() => void load()} />

  const canPublish = data.permissions.canPublishReply
  const canManageConnection = data.permissions.canManageConnection

  const tabItems = (Object.keys(TAB_LABELS) as TabKey[]).map((key) => ({
    label: TAB_LABELS[key],
    current: tab === key,
    count: key === 'reviews' && connected ? data.summary.newCount : undefined,
    disabled: !connected && key !== 'settings' ? true : key === 'posts' || key === 'performance' || key === 'profile',
    onClick: () => go({ tab: key }),
  }))

  const reviewEditorOpen = tab === 'reviews' && connected && view === 'draft' && Boolean(reviewId)
  const designNode = reviewEditorOpen ? 'TJPK5' : tab === 'settings' ? 'p9ALPi' : 'lM0zP'

  return (
    <section className="border-hairline bg-canvas text-ink min-w-0 overflow-hidden rounded-card border" data-design-node={designNode}>
      <GoogleBusinessTabs items={tabItems} mapsUrl={connected ? data.connection.locationMapsUrl : null} />
      <div className="border-hairline border-t p-5 sm:p-6 lg:p-8">
        {banner && data.connection.status !== 'pending_location' ? <NoteBar tone={banner.tone} className="mb-4" action={<button type="button" className="text-sm font-semibold" onClick={() => setBanner(null)}>閉じる</button>}>{banner.text}</NoteBar> : null}
        {reviewEditorOpen && reviewId ? (
          <ReviewDraftScreen accountId={selectedAccountId} reviewId={reviewId} data={data} canPublish={canPublish} backHref="/restaurant-test/google?tab=reviews" onPublished={() => { void load() }} />
        ) : tab === 'settings' ? (
          <SettingsTab accountId={selectedAccountId} data={data} canManage={canManageConnection} onChanged={() => { void load() }} />
        ) : (
          <ReviewsTab accountId={selectedAccountId} data={data} canPublish={canPublish} onOpen={(id) => go({ tab: 'reviews', view: 'draft', id })} onSynced={() => { void load() }} />
        )}
      </div>
    </section>
  )
}

function GoogleBusinessTabs({ items, mapsUrl }: { items: Array<{ label: string; current?: boolean; count?: number; disabled?: boolean; onClick: () => void }>; mapsUrl?: string | null }) {
  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    const { key } = event
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)'))
    const current = tabs.indexOf(document.activeElement as HTMLElement)
    if (current < 0) return
    event.preventDefault()
    const next = key === 'Home'
      ? 0
      : key === 'End'
        ? tabs.length - 1
        : key === 'ArrowRight'
          ? (current + 1) % tabs.length
          : (current - 1 + tabs.length) % tabs.length
    tabs[next]?.focus()
  }

  return (
    <nav aria-label="Googleビジネスの機能" aria-orientation="horizontal" className="flex flex-wrap items-center gap-2 px-5 py-2.5" role="tablist" onKeyDown={moveFocus} style={{ minHeight: 58 }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="tab"
          aria-selected={item.current ?? false}
          aria-disabled={item.disabled || undefined}
          disabled={item.disabled}
          tabIndex={item.current ? 0 : -1}
          onClick={item.onClick}
          className={`h-9 shrink-0 rounded-control border px-3.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-info disabled:cursor-not-allowed disabled:opacity-40 ${
            item.current
              ? 'bg-accent-soft text-accent-deep'
              : 'bg-canvas text-ink hover:bg-canvas-sunken'
          }`}
          style={{ borderColor: item.current ? 'transparent' : 'var(--color-hairline)' }}
        >
          {item.label}{item.count === undefined ? null : ` ${item.count}`}
        </button>
      ))}
      <span className="grow" />
      {mapsUrl ? <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-status-info text-label inline-flex shrink-0 items-center gap-1 font-semibold">Google マップで見る <ExternalLink size={13} /></a> : null}
    </nav>
  )
}

// ---------- 設定タブ（GB-1 / GB-13） ----------

function SettingsTab({ accountId, data, canManage, onChanged }: { accountId: string; data: GoogleConnectionData; canManage: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState('')
  const { connection } = data

  const startConnect = async () => {
    setBusy(true)
    setActionError('')
    try {
      const response = await restaurantGoogleApi.connectStart(accountId)
      window.location.assign(response.authorizeUrl)
    } catch (err) {
      setActionError(errorMessage(err, 'Googleの認可画面を開けませんでした。'))
      setBusy(false)
    }
  }

  const selectLocation = async () => {
    if (!selectedLocation) return
    setBusy(true)
    setActionError('')
    try {
      await restaurantGoogleApi.selectLocation(accountId, selectedLocation)
      onChanged()
    } catch (err) {
      setActionError(errorMessage(err, '店舗を選べませんでした。'))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setActionError('')
    try {
      await restaurantGoogleApi.disconnect(accountId)
      setConfirmDisconnect(false)
      onChanged()
    } catch (err) {
      setActionError(errorMessage(err, '接続を解除できませんでした。'))
    } finally {
      setBusy(false)
    }
  }

  if (connection.status === 'disconnected') {
    return (
      <div data-design-node="p9ALPi" className="flex flex-col gap-6">
        <header className="space-y-1.5">
          <h2 className="text-metric leading-relaxed font-bold">設定</h2>
          <p className="text-ink-secondary text-sm leading-relaxed">このLINEアカウントとGoogleビジネスプロフィールを接続します。</p>
        </header>
        <div className="flex justify-center pt-4 sm:pt-8">
          <section className="border-hairline bg-canvas flex w-full flex-col gap-5 rounded-card border p-5 sm:p-8" style={{ maxWidth: 680 }} aria-labelledby="google-connect-title">
            <div className="flex items-center gap-4">
              <span className="bg-accent-soft flex h-12 w-12 shrink-0 items-center justify-center rounded-card text-accent-deep" aria-hidden="true"><Link2 size={24} /></span>
              <div className="min-w-0">
                <h3 id="google-connect-title" className="text-xl leading-relaxed font-bold">Googleアカウントを接続</h3>
                <p className="text-ink-faint text-label leading-relaxed">未接続</p>
              </div>
            </div>
            <p className="text-ink-secondary whitespace-pre-line text-sm leading-relaxed">{'店舗を管理しているGoogleアカウントでログインしてください。\n接続する店舗は、1つのLINEアカウントにつき1店舗です。'}</p>
            {!data.oauthConfigured ? <NoteBar tone="warn">この環境にはGoogle接続の設定がありません。運営に連絡してください。</NoteBar> : null}
            {actionError ? <NoteBar tone="danger">{actionError}</NoteBar> : null}
            <div>
              <Button className="min-h-11 px-5" variant="primary" onClick={() => void startConnect()} disabled={busy || !canManage || !data.oauthConfigured}><Link2 size={17} />Googleアカウントを接続</Button>
            </div>
            <div className="border-hairline border-t pt-5">
              <p className="text-ink-secondary text-label whitespace-pre-line leading-relaxed">{'初回接続時に、Googleで管理できる店舗から接続先を1店舗確認します。\n接続後は、このLINEアカウントの店舗だけを表示します。'}</p>
              {!canManage ? <p className="text-ink-faint mt-3 text-xs">Googleアカウントの接続は、統括の管理者へ依頼してください。</p> : null}
            </div>
          </section>
        </div>
      </div>
    )
  }

  if (connection.status === 'pending_location') {
    return (
      <div data-design-node="p9ALPi" className="flex flex-col gap-6">
        <header className="space-y-1.5">
          <h2 className="text-metric leading-relaxed font-bold">設定</h2>
          <p className="text-ink-secondary text-sm leading-relaxed">このLINEアカウントとGoogleビジネスプロフィールを接続します。</p>
        </header>
        <div className="flex justify-center pt-2 sm:pt-4">
          <section className="border-hairline bg-canvas flex w-full flex-col gap-4 rounded-card border p-5 sm:p-7" style={{ maxWidth: 880 }} aria-labelledby="google-location-title">
            <div className="flex items-center gap-4">
              <span className="bg-accent-soft flex h-12 w-12 shrink-0 items-center justify-center rounded-card text-accent-deep" aria-hidden="true"><Link2 size={24} /></span>
              <div className="min-w-0">
                <h3 id="google-location-title" className="text-heading leading-relaxed font-bold">接続する店舗を選ぶ</h3>
                <p className="text-ink-faint text-label leading-relaxed">Googleアカウントの認証は完了しています</p>
              </div>
            </div>
            <p className="text-ink-secondary text-sm leading-relaxed">このLINEアカウント（{data.store.name}）に接続する店舗を1つ選んでください。接続後は、選んだ店舗だけを表示します。</p>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="接続するGoogleビジネスプロフィール">
            {data.candidates.map((candidate) => (
              <label
                key={candidate.locationName}
                className={`gb-location-option flex min-w-0 cursor-pointer items-center gap-3 rounded-control border px-3.5 py-2 transition-colors ${
                  selectedLocation === candidate.locationName
                    ? 'border-accent bg-accent-soft'
                    : 'border-hairline bg-surface-pearl hover:bg-canvas-sunken'
                }`}
              >
                <input type="radio" name="location" value={candidate.locationName} checked={selectedLocation === candidate.locationName} onChange={() => setSelectedLocation(candidate.locationName)} className="gb-accent-control h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold" title={candidate.locationTitle}>{candidate.locationTitle}</span>
                  {candidate.addressText ? <span className="text-ink-secondary block truncate text-xs" title={candidate.addressText}>{candidate.addressText}</span> : null}
                </span>
              </label>
            ))}
            </div>
            {actionError ? <NoteBar tone="danger">{actionError}</NoteBar> : null}
            <div className="border-hairline flex flex-wrap justify-center gap-2 border-t pt-4">
              <Button onClick={() => setConfirmDisconnect(true)} disabled={busy || !canManage}>Googleアカウントを選び直す</Button>
              <Button variant="primary" onClick={() => void selectLocation()} disabled={busy || !selectedLocation || !canManage}>この店舗を接続する</Button>
            </div>
          </section>
        </div>
        <ConfirmDialog open={confirmDisconnect} title="接続をやり直しますか？" description="いま進めている接続を取り消します。口コミの履歴は残ります。" confirmLabel="取り消す" destructive busy={busy} onConfirm={() => void disconnect()} onCancel={() => setConfirmDisconnect(false)} />
      </div>
    )
  }

  const statusBadge = connection.status === 'connected'
    ? <StatusBadge tone="success">接続済み</StatusBadge>
    : connection.status === 'expired'
      ? <StatusBadge tone="danger">認可切れ</StatusBadge>
      : <StatusBadge tone="danger">権限なし</StatusBadge>

  return (
    <div data-design-node="O4GMOL" className="flex flex-col gap-6">
      <header className="space-y-1.5">
        <h2 className="text-metric leading-relaxed font-bold">設定</h2>
        <p className="text-ink-secondary text-sm leading-relaxed">このLINEアカウントに接続しているGoogleアカウントを確認できます。</p>
      </header>
      {connection.status === 'expired' ? <NoteBar tone="danger" className="mb-4">Googleとの接続を確認してください。認可が切れています。店舗を管理するGoogleアカウントで再接続してください。保存中の下書きは残っています。</NoteBar> : null}
      {connection.status === 'no_permission' ? <NoteBar tone="danger" className="mb-4">この店舗を操作する権限がありません。接続済み店舗の管理権限をGoogle側で確認してください。</NoteBar> : null}
      <div className="flex justify-center pt-4 sm:pt-8">
        <section className="border-hairline bg-canvas flex w-full flex-col gap-5 rounded-card border p-5 sm:p-8" style={{ maxWidth: 680 }} aria-labelledby="google-connected-title">
          <div className="flex items-center gap-4">
            <span className="bg-accent-soft flex h-12 w-12 shrink-0 items-center justify-center rounded-card text-accent-deep" aria-hidden="true"><Link2 size={24} /></span>
            <div className="min-w-0">
              <h3 id="google-connected-title" className="text-xl leading-relaxed font-bold">Googleアカウント接続済み</h3>
              <div className="mt-0.5">{statusBadge}</div>
            </div>
          </div>
          <dl className="text-ink-secondary grid grid-cols-1 gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
            <dt>LINEアカウント</dt><dd className="text-ink font-semibold">{data.store.name}</dd>
            <dt>接続店舗</dt><dd className="text-ink font-semibold">{connection.locationTitle ?? '—'}</dd>
            <dt>Googleアカウント</dt><dd className="text-ink font-semibold">{connection.googleAccountEmail ?? '—'}</dd>
            <dt>接続日時</dt><dd className="text-ink">{formatDateTime(connection.connectedAt)}</dd>
            <dt>最終同期</dt><dd className="text-ink">{formatDateTime(connection.lastSyncedAt)}</dd>
          </dl>
          {actionError ? <NoteBar tone="danger">{actionError}</NoteBar> : null}
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11 px-5" variant="primary" onClick={() => void startConnect()} disabled={busy || !canManage}><Link2 size={17} />Googleアカウントを再接続</Button>
            <Button className="min-h-11" variant="danger" onClick={() => setConfirmDisconnect(true)} disabled={busy || !canManage}>接続を解除</Button>
          </div>
          <div className="border-hairline border-t pt-5">
            <p className="text-ink-secondary text-label leading-relaxed">認可が切れた場合は、店舗を管理するGoogleアカウントで再接続してください。接続解除後は口コミの同期とGoogleへの返信を止めますが、取得済みの口コミと下書きは残ります。</p>
            {!canManage ? <p className="text-ink-faint mt-3 text-xs">Googleアカウントの接続は、統括の管理者へ依頼してください。</p> : null}
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={confirmDisconnect}
        title="Googleアカウントの接続を解除しますか？"
        description="解除すると、口コミの同期とGoogleへの返信を止めます。取得済みの口コミ・下書き・記録は残ります。もう一度使うには再接続が必要です。"
        confirmLabel="接続を解除する"
        destructive
        busy={busy}
        error={actionError}
        onConfirm={() => void disconnect()}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  )
}

// ---------- 口コミ一覧（GB-2 / GB-15） ----------

function ReviewsTab({ accountId, data, canPublish, onOpen, onSynced }: { accountId: string; data: GoogleConnectionData; canPublish: boolean; onOpen: (id: string) => void; onSynced: () => void }) {
  const [filter, setFilter] = useState<GoogleReviewFilter>('unreplied')
  const [rating, setRating] = useState('')
  const [order, setOrder] = useState<GoogleReviewOrder>('newest')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<GoogleReviewListData | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [syncedOnce, setSyncedOnce] = useState(false)
  const { connection } = data

  const load = useCallback(async () => {
    setListLoading(true)
    setListError('')
    try {
      const ratingNumber = Number.parseInt(rating, 10)
      setList(await restaurantGoogleApi.listReviews(accountId, { filter, order, q: appliedSearch || undefined, page, perPage: 20, rating: Number.isInteger(ratingNumber) ? ratingNumber : undefined }))
    } catch (err) {
      setList(null)
      setListError(errorMessage(err, '口コミを読み込めませんでした。'))
    } finally {
      setListLoading(false)
    }
  }, [accountId, appliedSearch, filter, order, page, rating])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = setTimeout(() => { setAppliedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const sync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    setSyncError('')
    try {
      await restaurantGoogleApi.syncReviews(accountId)
      onSynced()
      await load()
    } catch (err) {
      setSyncError(errorMessage(err, 'Googleから口コミを取得できませんでした。前回取得した内容を表示しています。'))
    } finally {
      setSyncing(false)
    }
  }, [accountId, load, onSynced, syncing])

  // 画面を開いたとき、最終同期が古ければ裏で1回だけ同期する（前回の一覧はそのまま見せる）。
  useEffect(() => {
    if (syncedOnce || connection.status !== 'connected' || !data.summary.syncStale) return
    setSyncedOnce(true)
    void sync()
  }, [connection.status, data.summary.syncStale, sync, syncedOnce])

  const pageCount = list ? Math.max(1, Math.ceil(list.total / list.perPage)) : 1
  const filterCounts: Record<GoogleReviewFilter, number> = {
    unreplied: data.summary.unrepliedCount,
    draft: data.summary.draftCount,
    attention: data.summary.attentionCount,
    all: data.summary.storedCount,
  }

  return (
    <div data-design-node="lM0zP">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">口コミ</h2>
        {data.summary.newCount > 0 ? <StatusBadge tone="success">新着 {data.summary.newCount}件</StatusBadge> : null}
        <span className="text-ink-secondary text-sm">{data.summary.storedCount}件{connection.lastSyncError === 'partial' ? 'を一部取得済み' : 'すべて取得済み'}</span>
        <span className="grow" />
        <Button onClick={() => void sync()} disabled={syncing || connection.status !== 'connected'}><RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />{syncing ? '取得中…' : '同期する'}</Button>
      </div>

      {connection.status === 'expired' ? <NoteBar tone="danger" className="mb-3" action={<a href="/restaurant-test/google?tab=settings" className="text-sm font-semibold">設定で再接続</a>}>Googleとの接続を確認してください（認可切れ）。前回取得した口コミを表示しています。</NoteBar> : null}
      {connection.status === 'no_permission' ? <NoteBar tone="danger" className="mb-3" action={<a href="/restaurant-test/google?tab=settings" className="text-sm font-semibold">設定で接続を確認</a>}>この店舗を操作する権限がありません。</NoteBar> : null}
      {syncError ? <NoteBar tone="warn" className="mb-3" action={<button type="button" className="text-sm font-semibold" onClick={() => void sync()}>もう一度</button>}>{syncError}</NoteBar> : null}
      {syncing && (list?.total ?? 0) === 0 ? <NoteBar className="mb-3">口コミを取得中… すべてのページを取得してから表示します。</NoteBar> : null}

      <Tabs
        className="gb-review-filters mb-3"
        label="口コミの状態"
        items={(Object.keys(FILTER_LABELS) as GoogleReviewFilter[]).map((key) => ({
          label: FILTER_LABELS[key],
          current: filter === key,
          count: filterCounts[key],
          onClick: () => { setFilter(key); setPage(1) },
        }))}
        actions={(
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <SelectField size="compact" aria-label="評価で絞り込み" value={rating} onChange={(event) => { setRating(event.target.value); setPage(1) }} options={[{ value: '', label: '評価：すべて' }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `★${n}` }))]} />
            <SelectField size="compact" aria-label="並び順" value={order} onChange={(event) => { setOrder(event.target.value as GoogleReviewOrder); setPage(1) }} options={ORDER_OPTIONS} />
            <SearchField placeholder="口コミを検索" aria-label="口コミを検索" value={search} onChange={setSearch} onClear={() => setSearch('')} />
          </div>
        )}
      />

      {listLoading && !list ? <ListState kind="loading" title="口コミを読み込んでいます" /> : null}
      {listError ? <ListState kind="error" title="口コミを表示できませんでした" description={listError} onRetry={() => void load()} /> : null}
      {list && list.total === 0 && !listLoading ? (
        <ListState kind="empty" title={filter === 'all' ? 'まだ口コミがありません' : `${FILTER_LABELS[filter]}の口コミはありません`} description={filter === 'all' ? '同期しても0件のときは、Google側にまだ口コミがありません。評価を推測して表示することはしません。' : '絞り込みを変えると他の口コミを確認できます。'} emptyPreset="readonly" />
      ) : null}
      {list && list.total > 0 ? (
        <>
          <DataTable>
            <TableHeadRow>
              <Th>投稿者・評価</Th>
              <Th>口コミ</Th>
              <Th>受信</Th>
              <Th>状態</Th>
              <Th align="right">操作</Th>
            </TableHeadRow>
            {list.reviews.map((review) => {
              const badge = replyBadge(review)
              const actionable = review.replyStatus === 'unreplied' || review.replyStatus === 'draft' || review.replyStatus === 'pending_confirm'
              return (
                <Tr key={review.id}>
                  <NameCell name={review.reviewerDisplayName ?? '匿名'} sub={<Stars rating={review.starRating} />} />
                  <Td><span className="line-clamp-2 text-sm" title={review.comment ?? undefined}>{review.comment ?? '（本文なし・評価のみ）'}</span></Td>
                  <Td><span className="text-ink-secondary whitespace-nowrap text-sm">{formatDateTime(review.createTime)}</span></Td>
                  <Td><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></Td>
                  <ActionCell>
                    {actionable ? (
                      <Button size="field" onClick={() => onOpen(review.id)}>{review.replyStatus === 'draft' ? '下書きを確認' : review.replyStatus === 'pending_confirm' ? '状態を確認' : '返信を作成'}</Button>
                    ) : (
                      <Button size="field" onClick={() => onOpen(review.id)}>返信を見る</Button>
                    )}
                  </ActionCell>
                </Tr>
              )
            })}
          </DataTable>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-ink-faint text-xs">{list.total}件 ・ 新着と未返信は別に管理</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
        </>
      ) : null}
      <p className="text-ink-faint mt-4 text-xs">自動取得・AI下書きはできます。返信は、{canPublish ? '内容を確認してから公開します。' : '店舗管理者が内容を確認してから公開します。'}</p>
    </div>
  )
}

// ---------- AI返信下書き（GB-3）＋公開確認（GB-16） ----------

function ReviewDraftScreen({ accountId, reviewId, data, canPublish, backHref, onPublished }: { accountId: string; reviewId: string; data: GoogleConnectionData; canPublish: boolean; backHref: string; onPublished: () => void }) {
  const [review, setReview] = useState<GoogleReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [text, setText] = useState('')
  const [aiGenerated, setAiGenerated] = useState(false)
  const [busy, setBusy] = useState<'generate' | 'save' | 'publish' | null>(null)
  const [actionError, setActionError] = useState('')
  const [saved, setSaved] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [checked, setChecked] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [done, setDone] = useState<{ comment: string } | null>(null)
  // 未保存の下書きがあるまま一覧や他画面へ移ろうとしたら止める（DETAIL-04系）。
  const dirty = review !== null && done === null && review.replyStatus !== 'published' && review.replyStatus !== 'replied' && text !== (review.replyDraft ?? '')
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: busy !== null })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await restaurantGoogleApi.review(accountId, reviewId)
      setReview(response.review)
      setText(response.review.replyDraft ?? '')
      setAiGenerated(response.review.replyDraftAiGenerated)
    } catch (err) {
      setLoadError(errorMessage(err, '口コミを読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [accountId, reviewId])

  useEffect(() => { void load() }, [load])

  const generate = async (mode: 'new' | 'shorter' | 'polite') => {
    setBusy('generate')
    setActionError('')
    setSaved('')
    try {
      const response = await restaurantGoogleApi.generateDraft(accountId, reviewId, mode)
      setText(response.draft)
      setAiGenerated(true)
    } catch (err) {
      setActionError(errorMessage(err, 'AIの下書き作成に失敗しました。もう一度お試しください。'))
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy('save')
    setActionError('')
    try {
      const response = await restaurantGoogleApi.saveDraft(accountId, reviewId, text)
      setReview(response.review)
      setAiGenerated(false)
      setSaved('下書きを保存しました。まだGoogleには送信していません。')
    } catch (err) {
      setActionError(errorMessage(err, '下書きを保存できませんでした。'))
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    setBusy('publish')
    setActionError('')
    try {
      const response = await restaurantGoogleApi.publishReply(accountId, reviewId, text)
      setDone({ comment: response.reply.comment })
      setConfirming(false)
      onPublished()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === 'already_replied') {
        const existing = (err.data as { existingReply?: string } | undefined)?.existingReply
        setConflict(existing ?? '（返信文を取得できませんでした）')
        setConfirming(false)
      } else if (err instanceof ApiError && err.status === 502) {
        setActionError('Googleへの送信結果を確認できませんでした。重複を防ぐため、次に開いたときGoogle側の状態を照合してから再送します。')
        setConfirming(false)
        await load()
      } else {
        setActionError(errorMessage(err, 'Googleへの返信に失敗しました。'))
      }
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <ListState kind="loading" title="口コミを読み込んでいます" />
  if (loadError || !review) return <ListState kind="error" title="口コミを表示できませんでした" description={loadError} onRetry={() => void load()} action={<Button href={backHref}>口コミ一覧へ戻る</Button>} />

  const alreadyReplied = review.replyStatus === 'published' || review.replyStatus === 'replied' || Boolean(done)
  const pendingConfirm = review.replyStatus === 'pending_confirm'
  const textLength = text.trim().length
  const canOpenConfirm = canPublish && data.writeEnabled && textLength > 0 && textLength <= 4096 && !alreadyReplied && busy === null
  const googleReviewSourceUrl = data.connection.locationMapsUrl
    ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.connection.locationTitle ?? data.store.name)}`

  if (confirming) {
    return (
      <div data-design-node="xSudF" className="text-ink flex min-w-0 flex-col gap-4">
        <div><Button onClick={() => setConfirming(false)} disabled={busy !== null}>編集に戻る</Button></div>
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="text-heading font-bold">この返信をGoogleに公開しますか？</h2>
          <StatusBadge tone="warning">まだ送信していません</StatusBadge>
        </header>
        <div className="gb-confirm-grid grid min-w-0 grid-cols-1 gap-4">
          <Card padding="roomy">
            <p className="text-ink-secondary mb-4 text-sm">返信先と内容を確認してください。公開後、Googleの口コミに表示されます。</p>
            <dl className="gb-confirm-details mb-4 grid grid-cols-1 gap-x-8 gap-y-2 text-sm">
              <dt className="text-ink-secondary">返信先の店舗</dt><dd className="min-w-0 truncate font-semibold" title={data.connection.locationTitle ?? data.store.name}>{data.connection.locationTitle ?? data.store.name}</dd>
              <dt className="text-ink-secondary">返信する口コミ</dt><dd><span className="font-semibold">{review.reviewerDisplayName ?? '匿名'}</span> <Stars rating={review.starRating} /> <span className="text-ink-faint text-xs">{formatDate(review.createTime)}</span></dd>
              <dt className="text-ink-secondary">公開のタイミング</dt><dd>送信後、Googleの処理を経て表示</dd>
            </dl>
            <div className="border-hairline mb-3 rounded-card border p-4">
              <p className="text-ink-secondary mb-2 text-xs font-semibold">返信文</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
            </div>
            <div className="bg-canvas-sunken rounded-card p-4">
              <p className="text-ink-secondary mb-2 text-xs font-semibold">元の口コミ</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{review.comment ?? '（本文なし・評価のみ）'}</p>
            </div>
          </Card>
          <Card padding="roomy">
            <h3 className="mb-3 text-base font-bold">公開前の確認</h3>
            <label className="mb-4 flex items-start gap-2 text-sm leading-relaxed">
              <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} className="gb-accent-control mt-1 h-4 w-4 shrink-0" />
              <span>返信先・内容・個人情報の有無を確認しました</span>
            </label>
            <ul className="text-ink-secondary flex flex-col gap-2 text-xs leading-relaxed">
              <li>・予約内容や来店履歴などを追記していません</li>
              <li>・返信は店舗を代表して公開されます</li>
              <li>・通信結果が不明な場合はGoogle側を先に確認します</li>
            </ul>
            {actionError ? <NoteBar tone="danger" className="mt-4">{actionError}</NoteBar> : null}
          </Card>
        </div>
        <StickyBar actions={<><Button onClick={() => setConfirming(false)} disabled={busy !== null}>修正する</Button><Button variant="primary" onClick={() => void publish()} disabled={!checked || busy !== null}>{busy === 'publish' ? '送信中…' : 'この内容で返信する'}</Button></>} />
      </div>
    )
  }

  return (
    <div data-design-node="TJPK5" className="text-ink flex min-w-0 flex-col gap-4">
      <div><Button href={backHref} data-gb3-action="back-to-reviews">口コミ一覧へ戻る</Button></div>
      {done ? <NoteBar className="mb-4">Googleに返信を送信しました。反映を確認できるまで「反映確認中」と表示します。</NoteBar> : null}
      {conflict !== null ? <NoteBar tone="danger" className="mb-4">別の担当者がすでに返信しています。表示されている返信：「{conflict}」</NoteBar> : null}
      {pendingConfirm && !done ? <NoteBar tone="warn" className="mb-4">前回の送信結果を確認できていません。「この内容で返信する」を押すと、先にGoogle側の状態を照合してから送信します。</NoteBar> : null}
      {!data.writeEnabled ? <NoteBar tone="warn" className="mb-4">この環境ではGoogleへの公開が許可されていません。下書きの作成と保存はできます。</NoteBar> : null}
      <div className="gb-draft-grid grid min-w-0 grid-cols-1 gap-4">
        <div className="flex min-w-0 flex-col gap-4" data-gb3-column="editor">
          <Card padding="roomy">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">返信する口コミ</h2>
              <Stars rating={review.starRating} />
            </div>
            <p className="text-sm font-semibold">{review.reviewerDisplayName ?? '匿名'} <span className="text-ink-faint text-xs font-normal">{formatDateTime(review.createTime)}</span></p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{review.comment ?? '（本文なし・評価のみ）'}</p>
            <p className="text-ink-faint mt-4 text-xs">Googleの口コミ原文です。投稿者の個人情報や来店履歴を返信に追加しないでください。</p>
            <a href={googleReviewSourceUrl} target="_blank" rel="noreferrer" className="text-action mt-3 inline-flex items-center gap-1 text-xs font-semibold" data-gb3-action="open-google-review">Googleで原文を確認 <ExternalLink size={12} /></a>
            {alreadyReplied && (review.replyComment || done) ? (
              <div className="bg-canvas-sunken mt-4 rounded-card p-3">
                <p className="text-ink-secondary mb-1 text-xs font-semibold">公開済みの返信{review.replyUpdateTime ? `（${formatDateTime(review.replyUpdateTime)}）` : ''}</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{done?.comment ?? review.replyComment}</p>
              </div>
            ) : null}
          </Card>
          {!alreadyReplied ? (
            <Card padding="roomy">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold">{aiGenerated ? 'AIが作った返信の下書き' : '返信の下書き'}</h2>
                <StatusBadge tone="neutral">未公開</StatusBadge>
                <span className="grow" />
                {data.aiAvailable ? <Button size="field" onClick={() => void generate('new')} disabled={busy !== null} data-gb3-action="generate-draft"><Sparkles size={14} />{busy === 'generate' ? '作成中…' : text ? '作り直す' : 'AIで下書きを作る'}</Button> : null}
              </div>
              {aiGenerated ? <NoteBar className="mb-3">AIが作成した文章です。事実・表現を確認し、必要に応じて修正してください。</NoteBar> : null}
              <TextArea value={text} onChange={(event) => { setText(event.target.value); setSaved('') }} rows={12} placeholder="返信文を入力するか、AIで下書きを作ります。" aria-label="返信文" invalid={textLength > 4096} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {data.aiAvailable ? <><Button size="field" onClick={() => void generate('shorter')} disabled={busy !== null || !text} data-gb3-action="shorten-draft">短くする</Button><Button size="field" onClick={() => void generate('polite')} disabled={busy !== null || !text} data-gb3-action="polish-draft">丁寧にする</Button></> : <span className="text-ink-faint text-xs">この環境ではAI下書きは使えません。</span>}
                <span className="grow" />
                <span className={`text-xs ${textLength > 4096 ? 'text-danger' : 'text-ink-faint'}`}>{textLength.toLocaleString()} / 4,096</span>
              </div>
              {saved ? <p className="text-success mt-3 text-xs">{saved}</p> : null}
              {actionError ? <NoteBar tone="danger" className="mt-3">{actionError}</NoteBar> : null}
            </Card>
          ) : <Card padding="roomy"><p className="text-ink-secondary text-sm">この口コミへの返信は公開済みです。</p></Card>}
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="公開前の確認" data-gb3-column="publish-actions">
          <Card padding="roomy">
            <h3 className="mb-3 text-base font-bold">公開前の確認</h3>
            <ul className="text-ink-secondary flex flex-col gap-2 text-xs leading-relaxed">
              <li>☑ 事実と異なる説明や、約束できない対応がない</li>
              <li>☑ 個人情報・予約内容・問い合わせ履歴を含まない</li>
              <li>☑ 返信先：{data.connection.locationTitle ?? data.store.name} ／ {review.reviewerDisplayName ?? '匿名'}さんの口コミ</li>
            </ul>
            {!canPublish ? <p className="text-ink-faint mt-3 text-xs">Googleへの公開は店舗管理者以上が行います。下書きを保存しておくと、管理者が確認して公開できます。</p> : null}
          </Card>
          {!alreadyReplied ? (
            <div className="flex flex-col gap-2">
              <Button variant="secondary" onClick={() => void save()} disabled={busy !== null || textLength === 0 || textLength > 4096} data-gb3-action="save-draft">{busy === 'save' ? '保存中…' : '下書き保存'}</Button>
              <Button variant="primary" onClick={() => { setChecked(false); setActionError(''); setConfirming(true) }} disabled={!canOpenConfirm} data-gb3-action="open-publish-confirm">返信内容を確認</Button>
            </div>
          ) : null}
        </aside>
      </div>
      <ConfirmDialog
        open={leaveTarget !== null}
        title="保存していない下書きがあります"
        description="このまま移動すると、返信文の変更は失われます。下書き保存をしてから移動するか、保存せずに移動してください。"
        confirmLabel="保存せずに移動"
        cancelLabel="編集を続ける"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}
