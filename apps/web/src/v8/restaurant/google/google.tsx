'use client'
import type { GoogleNav } from './navigation-types'
export type { GoogleNav } from './navigation-types'

import { useSamePageUrl } from '@/lib/use-same-page-url'
import { requestUnsavedAction } from '@/lib/unsaved-action'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { ApiError } from '@/lib/api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'

import { Tabs } from '@/components/shared/tabs'
import { restaurantGoogleApi, type GoogleConnectionData, type GoogleBusinessStore, type GooglePostKind } from '@/lib/restaurant-google-api'
import { BoundaryBanner, RestaurantPage } from '@/v8/restaurant/common-a/public/frame/index'
import { errorMessage } from './format'
import { ReviewDraft, ReviewsBoard } from './reviews'
import { PostEditor, PostConfirm, PostsBoard, type MediaUploadHelpers } from './posts'
import PerformanceBoard from './performance'
import ProfileBoard from './profile'
import { ChangeConfirmScreen } from './profile-confirm'
import { HistoryScreen } from './profile-history'
import { ProfileEditScreen } from './profile-edit'
import { HoursEditor } from './profile-hours'
import SettingsBoard from './settings'
import styles from './google.module.css'
import StoreFilterTabs from '@/components/shared/store-filter-tabs'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import { entityOptionMetadata } from '@/components/shared/entity-select'

/*
 * ★V8 Googleビジネス（Pencil：口コミ ・返信を作る ・投稿 ・投稿を作る ・
 * パフォーマンス ・プロフィール ・設定 ）。
 *
 * 板の頭（題・説明・店舗を選ぶ欄）→ 検証環境の帯 → タブ（口コミ・投稿・パフォーマンス・プロフィール・設定）
 * → タブの中身。受け付ける URL は今の画面と同じ（?tab=・?view=・?id=・?kind=・?google=）。
 * 営業時間・確認・履歴・編集も共通の V8 部品で出す。動きは BEHAVIOR.md。
 */

export type { MediaUploadHelpers } from './posts'

export const TAB_LABELS = { reviews: '口コミ', posts: '投稿', performance: 'パフォーマンス', profile: 'プロフィール', settings: '設定' } as const
export type GoogleTab = keyof typeof TAB_LABELS

/** 口コミの一覧の帯だけ、返信が実際に Google に届くことを知らせる。 */
/**
 * 板の頭の「？」に入れる説明。画面の中（タブの下・表の下）に説明の行や注記の箱は置かない。
 * 口コミだけは「Googleへ送ると『反映確認中』になる」までを書く。
 */
const HELP_BASE = 'Google の口コミ・投稿・営業時間を、店舗ごとに管理します。'
const TAB_HELP: Record<GoogleTab, string> = {
  reviews: `${HELP_BASE}返信文は手で書くか、AIで下書きを作れます。Googleへ送ると「反映確認中」になり、反映されると「返信済み」になります。`,
  posts: `${HELP_BASE}投稿は Google に出す最新情報・イベント・特典・お知らせです。行の「…」から、中身を見る・Google から削除・Instagram へもう一度送るができます。削除は元に戻せません（確認の窓が出ます）。Instagram が失敗した投稿は再送でき、Google への公開はそのまま残ります。時刻はすべて日本時間（Asia/Tokyo）です。`,
  performance: `${HELP_BASE}Google の検索・地図でどれだけ見られたかを出します。数字は Google ビジネス プロフィールの集計です（前日までの分。2〜3日遅れることがあります）。`,
  profile: HELP_BASE,
  settings: `${HELP_BASE}接続を解除すると、口コミ・投稿・パフォーマンスの取り込みが止まります。解除の前に確認の窓が出ます。`,
}

const REVIEWS_BANNER_NOTE = 'Google への返信は、つないだ設定で実際に Google に届きます。送れない設定のときは送信ボタンを出しません'

/** Googleからの戻り（?google=connected など）の知らせ（今の画面と同じ文）。 */
const RETURN_MESSAGES: Record<string, { tone: 'info' | 'warn' | 'danger'; text: string }> = {
  connected: { tone: 'info', text: 'Googleアカウントを接続しました。口コミを取得します。' },
  reconnected: { tone: 'info', text: 'Googleアカウントを再接続しました。' },
  select_location: { tone: 'warn', text: 'このLINEアカウントに結びつける店舗を1つ選んでください。前につないでいた店舗とは別の店舗を選ぶと、切り替える前に確認します。' },
  'error:invalid_state': { tone: 'danger', text: '認可の確認に失敗しました。もう一度「接続する」からやり直してください。' },
  'error:denied': { tone: 'danger', text: 'Googleでの許可が取り消されました。接続は変更していません。' },
  'error:location_mismatch': { tone: 'danger', text: '選んだ店舗をGoogleで確認できなかったため保存しませんでした。店舗一覧をもう一度読み込んでから選び直してください。' },
  'error:no_locations': { tone: 'danger', text: 'このGoogleアカウントで管理できる店舗が見つかりませんでした。店舗を管理しているGoogleアカウントでログインしてください。' },
  'error:oauth_not_configured': { tone: 'danger', text: 'この環境にはGoogle接続の設定がありません。' },
  'error:no_permission': { tone: 'danger', text: 'Googleの許可画面で「ビジネス情報の管理」の許可が外れていたため、接続していません。もう一度「接続する」から進み、この許可を付けたままにしてください。' },
}

function GoogleInner({ mediaUpload }: { mediaUpload?: MediaUploadHelpers }) {
  const saveErrors = useSaveFormErrors()
  usePageTitle('Googleビジネス')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const samePageUrl = useSamePageUrl()
  const searchParams = useSearchParams()
  const { selectedAccountId, setSelectedAccountId, accounts, loading: accountLoading } = useAccount()
  const [data, setData] = useState<GoogleConnectionData | null>(null)
  const [stores, setStores] = useState<GoogleBusinessStore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [banner, setBanner] = useState<{ tone: 'info' | 'warn' | 'danger'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) { setData(null); setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      const connection = await restaurantGoogleApi.connection(selectedAccountId)
      setData(connection)
      setStores(connection.stores ?? [{ id: connection.store.id, name: connection.store.name, line_account_id: connection.store.lineAccountId }])
    } catch (err) {
      const fieldFailure = saveErrors.capture(err)
      setData(null)
      { if (!fieldFailure)

      setError(err instanceof ApiError && err.status === 404
        ? 'このLINEアカウントには店舗が紐付いていません。先に店舗管理でLINEアカウントを割り当ててください。'
        : errorMessage(err, 'Googleビジネスの状態を読み込めませんでした。'))
    }
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, saveErrors])

  useEffect(() => { void load() }, [load])

  // Googleからの戻り（?google=…）を1回だけ帯に出して、URLから消す（今の画面と同じ）。
  useEffect(() => {
    const result = searchParams.get('google')
    if (!result) return
    setBanner(RETURN_MESSAGES[result] ?? { tone: 'danger', text: 'Googleとの接続に失敗しました。あとでもう一度お試しください。' })
    const next = new URLSearchParams(searchParams.toString())
    next.delete('google')
    samePageUrl.replace(`/restaurant-test/google${next.toString() ? `?${next.toString()}` : ''}`)
  }, [samePageUrl, searchParams])

  const go = useCallback<GoogleNav>((params) => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value) next.set(key, value)
    samePageUrl.push(`/restaurant-test/google${next.toString() ? `?${next.toString()}` : ''}`)
  }, [samePageUrl])

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
    <SaveErrorField names={["currentStoreId","selectedAccountId"]}><StoreFilterTabs

      value={currentStoreId}
      onChange={(value) => {
        const next = stores.find((item) => item.id === value)
        if (next?.line_account_id && next.line_account_id !== selectedAccountId) {
          const nextAccountId = next.line_account_id
          requestUnsavedAction(() => setSelectedAccountId(nextAccountId))
        }
      }}
      options={stores.map((item) => ({ ...entityOptionMetadata(item), value: item.id, label: `店舗：${item.name}`, disabled: !item.line_account_id, disabledReason: !item.line_account_id ? 'LINE公式アカウントが結び付いていません' : undefined }))}
    /></SaveErrorField>
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
          size="compact"
          spacing={boardId === 'j0Wcg' ? 'compact' : undefined}
          label="Googleビジネスの機能"
          items={(Object.keys(TAB_LABELS) as GoogleTab[]).map((key) => {
            const count = !connected ? 0 : key === 'reviews' ? data.summary.storedCount : key === 'posts' ? data.summary.postsAttentionCount : 0
            return {
              label: count ? `${TAB_LABELS[key]} ${count}` : TAB_LABELS[key],
              current: tab === key,
              disabled: !connected && key !== 'settings',
              onClick: () => requestUnsavedAction(() => samePageUrl.replace(`/restaurant-test/google?tab=${key}`)),
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
        ) : tab === 'profile' && view === 'confirm' && id ? (
          <ChangeConfirmScreen key={`${accountId}-${id}`} accountId={accountId} ids={id.split(',').filter(Boolean)} go={go} />
        ) : tab === 'profile' && view === 'history' ? (
          <HistoryScreen key={`${accountId}-${searchParams.get('result') ?? ''}`} accountId={accountId} initialResult={(['all', 'applied', 'pending', 'failed'] as const).find((value) => value === searchParams.get('result'))} go={go} />
        ) : tab === 'profile' && view === 'edit' ? (
          <ProfileEditScreen key={accountId} accountId={accountId} go={go} />
        ) : tab === 'profile' && view === 'hours' ? (
          <HoursEditor key={`${accountId}-${searchParams.get('mode') ?? 'text'}-${searchParams.get('date') ?? ''}`} accountId={accountId} mode={searchParams.get('mode') === 'calendar' ? 'calendar' : searchParams.get('mode') === 'weekly' ? 'weekly' : 'text'} initialDate={searchParams.get('date')} go={go} />
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
    <SaveErrorScope errors={saveErrors}><RestaurantPage
      boardId={boardId}
      title="Googleビジネス"
      description={draftOpen ? HELP_BASE : TAB_HELP[tab]}
      picker={picker}
    >
      <BoundaryBanner note={boardId === 'j0Wcg' ? REVIEWS_BANNER_NOTE : tab === 'settings' && data && !data.writeEnabled ? '外部への更新は止めています' : undefined} />
      {body}
    </RestaurantPage></SaveErrorScope>
  )
}

export default function GoogleV8({ mediaUpload }: { mediaUpload?: MediaUploadHelpers }) {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <GoogleInner mediaUpload={mediaUpload} />
    </Suspense>
  )
}
