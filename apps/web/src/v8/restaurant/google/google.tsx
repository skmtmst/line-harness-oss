'use client'

/*
 * ★V8 Googleビジネス（Pencil：口コミ `j0Wcg`・返信を作る `x9HIR`・投稿 `Cfed0`・投稿を作る `T1j2Sw`・
 * パフォーマンス `SrmVs`・プロフィール `JUTGz`・設定 `CuHXG`）。
 *
 * 板の頭（題・説明・店舗を選ぶ欄）→ 検証環境の帯 → タブ（口コミ・投稿・パフォーマンス・プロフィール・設定）
 * → タブの中身。受け付ける URL は今の画面と同じ（?tab=・?view=・?id=・?kind=・?google=）。
 * 営業時間の変更・変更の確認・変更履歴・プロフィールの編集（?tab=profile&view=hours|confirm|history|edit）は
 * 入口の page.tsx が今の画面へ渡す（V8 の絵がまだ無い）。動きは BEHAVIOR.md。
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { ApiError } from '@/lib/api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { Tabs } from '@/components/shared/tabs'
import { restaurantTestApi, type RestaurantStore } from '@/lib/restaurant-test-api'
import { restaurantGoogleApi, type GoogleConnectionData, type GooglePostKind } from '@/lib/restaurant-google-api'
import { BoundaryBanner, RestaurantPage, STORE_PICKER_WIDTH } from '../common-a/frame'
import { errorMessage } from './format'
import { ReviewDraft, ReviewsBoard } from './reviews'
import { PostEditor, PostConfirm, PostsBoard, type MediaUploadHelpers } from './posts'
import PerformanceBoard from './performance'
import ProfileBoard from './profile'
import SettingsBoard from './settings'
import styles from './google.module.css'

export type { MediaUploadHelpers } from './posts'

export const TAB_LABELS = { reviews: '口コミ', posts: '投稿', performance: 'パフォーマンス', profile: 'プロフィール', settings: '設定' } as const
export type GoogleTab = keyof typeof TAB_LABELS
export type GoogleNav = (params: Record<string, string | undefined>) => void

/** 口コミの一覧の帯だけ、返信が実際に Google に届くことを知らせる（j0Wcg）。 */
const REVIEWS_BANNER_NOTE = 'Google への返信は、つないだ設定で実際に Google に届きます。送れない設定のときは送信ボタンを出しません'

/** Googleからの戻り（?google=connected など）の知らせ（今の画面と同じ文）。 */
const RETURN_MESSAGES: Record<string, { tone: 'info' | 'warn' | 'danger'; text: string }> = {
  connected: { tone: 'info', text: 'Googleアカウントを接続しました。口コミを取得します。' },
  reconnected: { tone: 'info', text: 'Googleアカウントを再接続しました。' },
  select_location: { tone: 'warn', text: 'このLINEアカウントに結びつける店舗を1つ選んでください。前につないでいた店舗とは別の店舗を選ぶと、切り替える前に確認します。' },
  'error:invalid_state': { tone: 'danger', text: '認可の確認に失敗しました。もう一度「Googleアカウントを接続」からやり直してください。' },
  'error:denied': { tone: 'danger', text: 'Googleでの許可が取り消されました。接続は変更していません。' },
  'error:location_mismatch': { tone: 'danger', text: '選んだ店舗をGoogleで確認できなかったため保存しませんでした。店舗一覧をもう一度読み込んでから選び直してください。' },
  'error:no_locations': { tone: 'danger', text: 'このGoogleアカウントで管理できる店舗が見つかりませんでした。店舗を管理しているGoogleアカウントでログインしてください。' },
  'error:oauth_not_configured': { tone: 'danger', text: 'この環境にはGoogle接続の設定がありません。' },
  'error:no_permission': { tone: 'danger', text: 'Googleの許可画面で「ビジネス情報の管理」の許可が外れていたため、接続していません。もう一度「Googleアカウントを接続」から進み、この許可を付けたままにしてください。' },
}

function GoogleInner({ mediaUpload }: { mediaUpload?: MediaUploadHelpers }) {
  usePageTitle('Googleビジネス')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId, setSelectedAccountId, accounts, loading: accountLoading } = useAccount()
  const [data, setData] = useState<GoogleConnectionData | null>(null)
  const [stores, setStores] = useState<RestaurantStore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [banner, setBanner] = useState<{ tone: 'info' | 'warn' | 'danger'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) { setData(null); setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      const [connection, snapshot] = await Promise.all([
        restaurantGoogleApi.connection(selectedAccountId),
        restaurantTestApi.snapshot(selectedAccountId).catch(() => null),
      ])
      setData(connection)
      setStores(snapshot?.data.stores ?? [])
    } catch (err) {
      setData(null)
      setError(err instanceof ApiError && err.status === 404
        ? 'このLINEアカウントには店舗が紐付いていません。先に店舗管理でLINEアカウントを割り当ててください。'
        : errorMessage(err, 'Googleビジネスの状態を読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  // Googleからの戻り（?google=…）を1回だけ帯に出して、URLから消す（今の画面と同じ）。
  useEffect(() => {
    const result = searchParams.get('google')
    if (!result) return
    setBanner(RETURN_MESSAGES[result] ?? { tone: 'danger', text: 'Googleとの接続に失敗しました。あとでもう一度お試しください。' })
    const next = new URLSearchParams(searchParams.toString())
    next.delete('google')
    router.replace(`/restaurant-test/google${next.toString() ? `?${next.toString()}` : ''}`)
  }, [router, searchParams])

  const go = useCallback<GoogleNav>((params) => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value) next.set(key, value)
    router.push(`/restaurant-test/google${next.toString() ? `?${next.toString()}` : ''}`)
  }, [router])

  const connected = data?.connection.status === 'connected' || data?.connection.status === 'expired' || data?.connection.status === 'no_permission'
  const requestedTab = searchParams.get('tab') as GoogleTab | null
  const tab: GoogleTab = !connected ? 'settings' : requestedTab && requestedTab in TAB_LABELS ? requestedTab : 'reviews'
  const view = searchParams.get('view')
  const id = searchParams.get('id')
  const kindParam = searchParams.get('kind')
  const postKind: GooglePostKind = kindParam === 'event' ? 'event' : kindParam === 'offer' ? 'offer' : 'standard'
  const draftOpen = tab === 'reviews' && view === 'draft' && Boolean(id)
  const postsView = tab === 'posts' ? (view === 'new' || view === 'edit' || view === 'confirm' ? view : 'list') : null

  /* 子板の印（撮影と見張りの試験が読む）。 */
  const boardId = draftOpen ? 'x9HIR'
    : tab === 'posts' ? (postsView === 'list' ? 'Cfed0' : 'T1j2Sw')
      : tab === 'performance' ? 'SrmVs'
        : tab === 'profile' ? 'JUTGz'
          : tab === 'settings' ? 'CuHXG'
            : 'j0Wcg'

  const currentStoreId = useMemo(() => stores.find((item) => item.line_account_id === selectedAccountId)?.id
    ?? stores.find((item) => item.id === data?.store.id)?.id ?? '', [stores, selectedAccountId, data])

  const picker = stores.length > 0 ? (
    <Select
      aria-label="店舗を選ぶ"
      width={STORE_PICKER_WIDTH}
      value={currentStoreId}
      onChange={(value) => {
        const next = stores.find((item) => item.id === value)
        if (next?.line_account_id && next.line_account_id !== selectedAccountId) setSelectedAccountId(next.line_account_id)
      }}
      options={stores.map((item) => ({ value: item.id, label: `店舗：${item.name}`, disabled: !item.line_account_id }))}
    />
  ) : null

  const body = (() => {
    if (accountLoading || loading) return <div className={styles.stateBox}><ListState kind="loading" title="Googleビジネスを読み込んでいます" /></div>
    if (!selectedAccountId) {
      return <div className={styles.stateBox}><ListState kind="empty" title="LINE公式アカウントを選んでください" description={accounts.length ? '上のバーで店舗のLINEアカウントを選ぶと表示します。' : '先にLINE公式アカウントを登録してください。'} /></div>
    }
    if (error || !data) return <ListState kind="error" title="Googleビジネスを表示できませんでした" description={error} onRetry={() => void load()} />
    const accountId = selectedAccountId
    return (
      <>
        <Tabs
          className={boardId === 'j0Wcg' ? styles.tabsCompact : styles.tabs}
          label="Googleビジネスの機能"
          items={(Object.keys(TAB_LABELS) as GoogleTab[]).map((key) => {
            const count = !connected ? 0 : key === 'reviews' ? data.summary.storedCount : key === 'posts' ? data.summary.postsAttentionCount : 0
            return {
              label: count ? `${TAB_LABELS[key]} ${count}` : TAB_LABELS[key],
              current: tab === key,
              disabled: !connected && key !== 'settings',
              onClick: () => go({ tab: key }),
            }
          })}
        />
        {banner && data.connection.status !== 'pending_location' ? (
          <Notice tone={banner.tone} onClose={() => setBanner(null)}>{banner.text}</Notice>
        ) : null}
        {draftOpen && id ? (
          <ReviewDraft key={id} accountId={accountId} reviewId={id} data={data} go={go} onPublished={() => { void load() }} />
        ) : postsView === 'new' || postsView === 'edit' ? (
          <PostEditor key={`${postsView}-${id ?? ''}-${postKind}`} accountId={accountId} kind={postKind} postId={postsView === 'edit' ? id : null} go={go} mediaUpload={mediaUpload} />
        ) : postsView === 'confirm' && id ? (
          <PostConfirm key={id} accountId={accountId} id={id} go={go} />
        ) : postsView ? (
          <PostsBoard accountId={accountId} go={go} />
        ) : tab === 'performance' ? (
          <PerformanceBoard accountId={accountId} />
        ) : tab === 'profile' ? (
          <ProfileBoard accountId={accountId} go={go} />
        ) : tab === 'settings' ? (
          <SettingsBoard accountId={accountId} data={data} onChanged={() => { void load() }} />
        ) : (
          <ReviewsBoard accountId={accountId} data={data} go={go} onSynced={() => { void load() }} />
        )}
      </>
    )
  })()

  return (
    <RestaurantPage
      boardId={boardId}
      title="Googleビジネス"
      description="Google の口コミ・投稿・営業時間を、店舗ごとに管理します。"
      picker={picker}
    >
      <BoundaryBanner note={boardId === 'j0Wcg' ? REVIEWS_BANNER_NOTE : undefined} />
      {body}
    </RestaurantPage>
  )
}

export default function GoogleV8({ mediaUpload }: { mediaUpload?: MediaUploadHelpers }) {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <GoogleInner mediaUpload={mediaUpload} />
    </Suspense>
  )
}
