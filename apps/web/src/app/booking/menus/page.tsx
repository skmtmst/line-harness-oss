'use client'

import { X } from 'lucide-react'
import SelectField from '@/components/shared/select-field'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import Breadcrumb from '@/components/shared/breadcrumb'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import {
  api,
  ApiError,
  bookingApi,
  type BookingMenu,
  type BookingResource,
  type BookingSettings,
} from '@/lib/api'
import type { Tag } from '@line-crm/shared'
import { canEditFeature } from '@/lib/staff-capability'
import { useAccount } from '@/contexts/account-context'
import { Suspense } from 'react'
import { useMergedTab } from '@/components/layout/merged-tabs'
import BookingStaffPage from '@/app/booking/staff/page'
import ListRange from '@/components/ui/list-range'
import { bookingMenuError } from './menu-validation'
import { bookingWindowEnd, businessHourSummary, minutesBeforeLabel } from '../lib/format-time'
import { formatHoursBeforeHint, formatMinutesLengthHint } from '@/lib/format-duration'

/**
 * 予約設定（設計 V2 8-2 / node nFCBf）。
 *
 * 設計は1枚の画面をタブで切り替える形。メニューとスタッフはすでに
 * ここに寄せてあったので、受付時間（8-2-3）とメニュー×スタッフ（8-2-4）
 * への行き先をタブに並べた。別ページではあるが、探す場所は1か所になる。
 */

const MERGED_TABS = [
  { key: 'menus', label: 'メニュー' },
  { key: 'rules', label: '予約のルール' },
  { key: 'staff', label: '担当スタッフ' },
]

const MENU_PAGE_SIZE = 6

type SupportingLoadState = 'loading' | 'ready' | 'error'

function bookingErrorMessage(error: unknown, action: '読み込み' | '保存'): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return `予約メニューを${action}する権限がありません。`
    if (error.status === 409) return `ほかの変更と重なったため、予約メニューを${action}できませんでした。`
  }
  return `予約メニューを${action}できませんでした。通信状態を確認して、もう一度お試しください。`
}

function bookingRulesErrorMessage(error: unknown, action: '読み込み' | '保存'): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return `予約の基本ルールを${action}する権限がありません。`
    if (error.status === 409) return 'ほかの担当者が先に保存しました。最新の内容を読み直してから、もう一度変更してください。'
  }
  return `予約の基本ルールを${action}できませんでした。通信状態を確認して、もう一度お試しください。`
}

/**
 * 一覧の金額列。料金モードが先で、金額はその次。
 * 「お問い合わせ」は金額ではないので ¥ を付けず、無料とも混ぜない。
 */
function menuPriceLabel(menu: BookingMenu): string {
  if (menu.price_mode === 'inquiry') return 'お問い合わせ'
  return menu.base_price === 0 ? '無料' : `¥${menu.base_price.toLocaleString()}`
}

function supportingDetail(
  hasAccount: boolean,
  state: SupportingLoadState,
  readyDetail: string,
): string {
  if (!hasAccount) return 'アカウントを選択'
  if (state === 'loading') return '読み込み中'
  if (state === 'error') return '取得できませんでした'
  return readyDetail
}

function MenusPageInner({ activeTab, onMenuCount }: { activeTab: string; onMenuCount: (count: number | null) => void }) {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<BookingMenu[]>([])
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [editing, setEditing] = useState<BookingMenu | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // copy 状態は menu.id 単位で持つ。複数メニューを連続でコピーしたとき
  // 直近にコピーした行だけ「コピー済」が出る。
  const [visibilityTarget, setVisibilityTarget] = useState<BookingMenu | null>(null)
  const [updatingVisibility, setUpdatingVisibility] = useState(false)
  const [visibilityError, setVisibilityError] = useState<string | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  /** メニューID → 担当できるスタッフの表示名。 */
  const [menuStaff, setMenuStaff] = useState<Map<string, string[]>>(new Map())
  /**
   * DEEP-26: 店舗設定(getSettings)の読込状態は一覧(listMenus)と分ける。
   * 設定が遅い・失敗しても、取れている一覧を隠さない。
   */
  const [settingsLoadState, setSettingsLoadState] = useState<SupportingLoadState>('loading')
  const [page, setPage] = useState(1)
  const [canManageResources, setCanManageResources] = useState(false)
  // N-411: メニュー編集は '/booking/menus'、予約設定・資源は 'booking.settings' の
  // 実効permissionで出し分ける。役割だけで見せるとAPIが403で落ちる。
  const [canEditMenus, setCanEditMenus] = useState(false)
  const loadGenerationRef = useRef(0)
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId

  const load = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current
    if (!selectedAccountId) {
      setItems([])
      setSettings(null)
      setSettingsError(null)
      setMenuStaff(new Map())
      setSettingsLoadState('loading')
      setLoading(false)
      setError(null)
      return
    }
    const accountId = selectedAccountId
    setLoading(true)
    setError(null)
    setSettingsError(null)
    setSettingsLoadState('loading')
    // アカウント切替時は前 account の menus が表示・操作可能なまま残らないよう
    // 先にクリア。fetch 失敗でも cross-account の操作事故が起きない。
    setItems([])
    setSettings(null)
    setMenuStaff(new Map())

    // DEEP-26: 一覧と補助設定を別々に待つ。設定の応答が遅れても、
    // 取れている一覧はその時点で表示する。どちらの応答も世代を確認し、
    // 切替前アカウントの遅い応答を新しい対象へ反映しない。
    void bookingApi.listMenus(accountId)
      .then((r) => {
        if (loadGenerationRef.current !== requestGeneration) return
        // 状態撮影や移行途中の口が空の器を返しても、画面全体を落とさず0件として扱う。
        const menus = Array.isArray(r.menus) ? r.menus : []
        setItems(menus)
        setMenuStaff(new Map(menus.map((menu) => [
          menu.id,
          (menu.assigned_staff ?? []).map((person) => person.display_name || person.id),
        ])))
      })
      .catch((e) => {
        if (loadGenerationRef.current !== requestGeneration) return
        setError(bookingErrorMessage(e, '読み込み'))
      })
      .finally(() => {
        if (loadGenerationRef.current === requestGeneration) setLoading(false)
      })

    void bookingApi.getSettings(accountId)
      .then((response) => {
        if (loadGenerationRef.current !== requestGeneration) return
        setSettings(response.success ? response.data : null)
        setSettingsLoadState('ready')
      })
      .catch((settingsLoadError: unknown) => {
        if (loadGenerationRef.current !== requestGeneration) return
        setSettings(null)
        setSettingsError(bookingRulesErrorMessage(settingsLoadError, '読み込み'))
        setSettingsLoadState('error')
      })
  }, [selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setCanManageResources(canEditFeature('booking.settings'))
    setCanEditMenus(canEditFeature('/booking/menus'))
  }, [])

  useEffect(() => {
    // 切替前accountの編集窓を、新しいaccount上へ残さない。
    setEditing(null)
  }, [selectedAccountId])

  useEffect(() => {
    onMenuCount(!loading && !error ? settings?.menuCount ?? items.length : null)
  }, [error, items.length, loading, onMenuCount, settings?.menuCount])

  useEffect(() => {
    let cancelled = false
    api.tags
      .list()
      .then((r) => {
        if (!cancelled && r.success) setTags(r.data)
      })
      .catch(() => {
        // タグ取得失敗時はセレクタが空になるが、メニュー編集自体は継続可能。
      })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * モーダル保存は読み込んだ版を expectedVersion として送る。
   * 版が無ければ送らずに読み直し、Worker 側で古い版は 409 に倒れる。
   */
  async function save(m: BookingMenu) {
    if (!selectedAccountId) return
    const version = m.version
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      await load()
      throw new ApiError(409, 'version_conflict', 'version_conflict')
    }
    await bookingApi.updateMenu(selectedAccountId, m.id, version, m)
    setEditing(null)
    await load()
  }

  /**
   * 公開状態を変える前に、**何が止まり何が残るかを本文で読ませる。**
   * 既存予約を残したまま新規受付だけを止めるため、確認窓を挟む。
   */
  /**
   * 公開切替だけを版付きで送る(PATCH)。PUT は送らなかった項目まで
   * 既定値で上書きしてしまうため、ここでは使わない。
   */
  async function toggleVisibility(menu: BookingMenu) {
    if (!selectedAccountId) return
    setUpdatingVisibility(true)
    setVisibilityError(null)
    try {
      const version = menu.version
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        // 版が無ければ最新を読み直してからやり直してもらう。
        await load()
        setVisibilityError('最新の状態を読み直しました。もう一度お試しください。')
        return
      }
      await bookingApi.patchMenu(selectedAccountId, menu.id, version, { is_active: !menu.is_active })
      setVisibilityTarget(null)
      setVisibilityError(null)
      await load()
    } catch (error) {
      // 失敗しても窓は開けたままにし、理由を窓の中で伝える。
      setVisibilityError(bookingErrorMessage(error, '保存'))
    } finally {
      setUpdatingVisibility(false)
    }
  }

  /** メニューID → Workerで集計済みの直近30日予約件数。 */
  const bookingCounts = useMemo(() => {
    return new Map(items.map((menu) => [menu.id, menu.booking_count_30_days ?? 0]))
  }, [items])

  const shown = useMemo(() => {
    return [...items].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
  }, [items])

  const pageCount = Math.max(1, Math.ceil(shown.length / MENU_PAGE_SIZE))
  const visible = shown.slice((page - 1) * MENU_PAGE_SIZE, page * MENU_PAGE_SIZE)

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount))
  }, [pageCount])

  const favorite = useMemo(() => {
    // 直近30日の件数は一覧応答に載るので、設定の到着を待たずに出せる。
    if (items.length === 0) return null
    return items.reduce((best, menu) =>
      (bookingCounts.get(menu.id) ?? 0) > (bookingCounts.get(best.id) ?? 0) ? menu : best,
    items[0])
  }, [bookingCounts, items])

  const activeWindowDays = useMemo(
    () => [...new Set(items.filter((menu) => menu.is_active).map((menu) => menu.booking_window_days).filter((days): days is number => typeof days === 'number'))].sort((a, b) => a - b),
    [items],
  )
  const businessHours = businessHourSummary(settings?.businessHours)
  const configuredWindowDays = settings?.bookingWindowDays
  // 店舗設定がまだ確定していない間は、メニュー側の値を既定値として
  // 見せない（DEEP-26）。設定が取れた・失敗した後だけフォールバックする。
  const bookingWindowDays = settingsLoadState === 'ready'
      && typeof configuredWindowDays === 'number' && configuredWindowDays > 0
    ? configuredWindowDays
    : (settingsLoadState !== 'loading' && activeWindowDays.length === 1 ? activeWindowDays[0] : null)

  return (
    <div data-design-node="QSLEH">
      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          title="出しているメニュー"
          value={!selectedAccountId || loading || error ? '—' : String(settings?.activeMenuCount ?? items.filter((m) => m.is_active).length)}
          unit="つ"
          detail={
            !selectedAccountId
              ? 'アカウントを選択'
              : loading
                ? '読み込み中'
                : error
                  ? '取得できませんでした'
                  : `止めているもの ${settings?.inactiveMenuCount ?? items.filter((m) => !m.is_active).length}つ`
          }
        />
        <Kpi
          title="いちばん選ばれた"
          value={favorite?.name ?? '—'}
          unit=""
          detail={supportingDetail(
            Boolean(selectedAccountId),
            loading ? 'loading' : error ? 'error' : 'ready',
            favorite ? `この30日で ${bookingCounts.get(favorite.id) ?? 0}件` : '予約実績はありません',
          )}
        />
        <Kpi
          title="受け付けている時間"
          value={settingsLoadState === 'ready' ? businessHours.value : '—'}
          unit=""
          detail={supportingDetail(
            Boolean(selectedAccountId),
            settingsLoadState,
            businessHours.detail || '受付枠で曜日ごとに確認',
          )}
        />
        <Kpi
          title="先の予約が取れる範囲"
          value={settingsLoadState === 'loading' || bookingWindowDays === null
            ? '—'
            : `${bookingWindowDays}日先まで`}
          unit=""
          detail={settingsLoadState === 'loading'
            ? '読み込み中'
            : bookingWindowDays === null
              ? '予約のルールで確認'
              : `今日から ${bookingWindowEnd(bookingWindowDays)} まで`}
        />
      </div>

      <div data-design="Bar" className="bg-info-bg text-info mb-4 rounded-control px-4 py-3 text-xs font-semibold">
        ⓘ　上から並んだ順に、お客様の画面に出ます。かかる時間を長めにしておくと、あとの予約とぶつかりません。金額を空けておくと「お問い合わせ」と出ます。
      </div>

      {activeTab === 'rules' ? (
        <BookingRulesSummary
          accountId={selectedAccountId}
          settings={settings}
          items={items}
          loading={settingsLoadState === 'loading'}
          error={error ?? settingsError}
          canManageResources={canManageResources}
          onRetry={() => void load()}
          onSaved={(next) => {
            // 保存中に店舗を切り替えた場合、旧店舗の遅い応答を新店舗へ反映しない。
            if (selectedAccountIdRef.current !== selectedAccountId) return
            setSettings(next)
            setSettingsError(null)
          }}
        />
      ) : <>
      {!selectedAccountId ? (
        <div data-design-node="W6465r"><ListState kind="empty" title="LINEアカウントを選んでください" description="共通メニューで、予約設定を開くLINEアカウントを選んでください。" /></div>
      ) : loading ? (
        <div data-design-node="W6465r"><ListState kind="loading" description="予約メニューと実績を読み込んでいます。" /></div>
      ) : error ? (
        <div data-design-node="W6465r"><ListState kind="error" description={error} onRetry={() => void load()} /></div>
      ) : shown.length === 0 ? (
        <div data-design-node="W6465r">
          <ListState
            kind="empty"
            title="まだ予約メニューがありません"
            description="メニューを作ると、お客様の予約画面に出ます。"
            action={canEditMenus ? <Button variant="primary" href="/booking/menus/new">＋ 予約メニューを作る</Button> : undefined}
          />
        </div>
      ) : (
        <div
          data-design="Table"
          className="bg-canvas rounded-card border border-hairline overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead>
                <tr className="bg-canvas-sunken border-b border-hairline">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint">メニュー</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint">かかる時間</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-ink-faint">金額</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint">だれが受けられるか</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-ink-faint">
                    この30日
                  </th>
                  {/* #707: 390pxで表を横スクロールしても操作列を右端へ留める */}
                  <th className="sticky right-0 bg-canvas-sunken px-4 py-3 text-right text-xs font-semibold text-ink-faint">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((m) => (
                  <tr key={m.id} className={`hover:bg-canvas-sunken ${m.is_active ? '' : 'text-ink-faint'}`}>
                    <td className="px-4 py-3 text-sm font-medium">
                      {/*
                        行頭の持ち手の飾りは外した。ドラッグで並び替えられる
                        ように見えるが実際は押せず、並び順は「中身を見る」の
                        中の数値欄で変える（監査 A12）。動かせない印を置くと
                        壊れているように見える。
                      */}
                      {m.name}{m.is_active ? '' : '（休止中）'}
                      {m.description && <span className="text-ink-faint mt-1 block max-w-72 truncate text-xs" title={m.description}>{m.description}</span>}
                      {m.category_label && (
                        <span className="bg-canvas-sunken text-ink-faint ml-2 inline-block rounded px-2 py-0.5 text-xs">
                          {m.category_label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-secondary tabular-nums">
                      {m.duration_minutes} 分
                    </td>
                    <td className={`px-4 py-3 text-sm text-right tabular-nums ${menuPriceLabel(m) === '無料' ? 'text-ink font-semibold' : ''}`}>
                      {menuPriceLabel(m)}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-secondary">
                      {/*
                       * #953 E-05: 休止中でも担当の割当は残る。is_active を先に見て
                       * 「だれもいません」と出すと、割当済みなのに未割当に見える。
                       * 実際の割当をそのまま出し、0人のときだけ「担当なし」と書く。
                       */}
                      {(menuStaff.get(m.id) ?? []).length === 0 ? (
                        // 担当が0人だと、公開していても予約フォームに枠が出ない。
                        // 「-」だと設定漏れなのか読み取れないので、はっきり書く。
                        <span className={`${m.is_active ? 'text-warning' : 'text-ink-faint'} text-xs`}>担当なし</span>
                      ) : (
                        <span className="text-xs">{(menuStaff.get(m.id) ?? []).join('・')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">
                      {`${bookingCounts.get(m.id) ?? 0} 件`}
                    </td>
                    <td className="sticky right-0 bg-canvas px-4 py-3 text-right">
                      <div className="inline-flex gap-2 text-xs">
                        {/* QSLEH の行操作は共通Button（高さ36px）より小さいため、
                            表の行高を設計どおり保つ専用の小ボタンにする。 */}
                        <button onClick={() => setEditing(m)} className="border-hairline rounded-control border px-2 py-1 font-semibold">
                          中身を見る
                        </button>
                        {canEditMenus && (
                          <button onClick={() => setVisibilityTarget(m)} className="border-hairline rounded-control border px-2 py-1 font-semibold">
                            止める・出す
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <ListRange label="メニュー" total={settings?.menuCount ?? items.length} first={visible.length === 0 ? 0 : 1} last={visible.length} />
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} ariaLabel="予約メニューのページ送り" />
      </div>
      </>}

      {editing && (
        <EditMenuModal
          menu={editing}
          tags={tags}
          accountId={selectedAccountId}
          canManageResources={canManageResources}
          canEdit={canEditMenus}
          onSave={save}
          onReloadLatest={async () => {
            await load()
            setEditing(null)
          }}
          onResourcesSaved={(menuId, version, assignedResources) => {
            setItems((current) => current.map((item) => item.id === menuId
              ? { ...item, version, assigned_resources: assignedResources }
              : item))
          }}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={visibilityTarget !== null}
        title={`「${visibilityTarget?.name ?? ''}」を${visibilityTarget?.is_active ? '止め' : '公開し'}ますか？`}
        description={visibilityTarget?.is_active
          ? 'お客様の画面から外し、新しい予約を止めます。すでに入っている予約はそのまま残ります。'
          : 'お客様の画面へ出し、新しい予約を受け付けます。担当と受付枠を確認してから公開してください。'}
        confirmLabel={visibilityTarget?.is_active ? '新しい予約を止める' : 'お客様の画面へ出す'}
        destructive={Boolean(visibilityTarget?.is_active)}
        busy={updatingVisibility}
        error={visibilityError ?? undefined}
        onCancel={() => { setVisibilityTarget(null); setVisibilityError(null) }}
        onConfirm={() => { if (visibilityTarget) void toggleVisibility(visibilityTarget) }}
      />
    </div>
  )
}

function BookingRulesSummary({ accountId, settings, items, loading, error, canManageResources, onRetry, onSaved }: {
  accountId: string | null
  settings: BookingSettings | null
  items: BookingMenu[]
  loading: boolean
  error: string | null
  canManageResources: boolean
  onRetry: () => void
  onSaved: (settings: BookingSettings) => void
}) {
  if (!accountId) return <ListState kind="empty" title="LINEアカウントを選んでください" description="共通メニューで、基本ルールを設定するLINEアカウントを選んでください。" />
  if (loading) return <ListState kind="loading" description="予約のルールを読み込んでいます。" />
  if (error || !settings) {
    return <ListState kind="error" description={error ?? '予約の基本ルールを読み込めませんでした。'} onRetry={onRetry} />
  }

  const rows = [
    { label: '先の予約が取れる範囲', key: 'booking_window_days' as const, unit: '日先まで', none: '制限なし' },
    { label: '受付の締め切り', key: 'cutoff_hours_before' as const, unit: '時間前', none: '直前まで' },
    { label: 'キャンセル期限', key: 'cancel_deadline_hours_before' as const, unit: '時間前', none: '制限なし' },
  ]
  return (
    <section data-booking-rules className="space-y-4">
      <div className="bg-accent-soft rounded-card border-accent/30 border p-4">
        <h2 className="text-ink text-base font-semibold">店舗共通の予約ルール</h2>
        <p className="text-ink-secondary mt-1 text-sm">新しく作るメニューや、個別の指定がないメニューに使う基本値です。</p>
      </div>
      <BookingRulesEditor
        key={accountId}
        accountId={accountId}
        initial={settings}
        canEdit={canManageResources}
        onRetry={onRetry}
        onSaved={onSaved}
      />
      {items.length > 0 && <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
        <div className="border-hairline border-b px-4 py-3">
          <h3 className="text-ink text-sm font-semibold">メニューごとの上書き</h3>
          <p className="text-ink-faint mt-1 text-xs">個別に値を入れたメニューは、下の値が優先されます。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-canvas-sunken text-ink-secondary">
              <tr><th className="px-4 py-3 text-left font-medium">メニュー</th>{rows.map((row) => <th key={row.key} className="px-4 py-3 text-left font-medium">{row.label}</th>)}</tr>
            </thead>
            <tbody className="divide-hairline divide-y">
              {items.map((menu) => (
                <tr key={menu.id}>
                  <td className="px-4 py-3 font-medium">{menu.name}</td>
                  {rows.map((row) => <td key={row.key} className="text-ink-secondary px-4 py-3 tabular-nums">{menu[row.key] == null ? row.none : `${menu[row.key]}${row.unit}`}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}
    </section>
  )
}

/** 予約で使いうる主要タイムゾーン。既定は Asia/Tokyo。 */
const TIME_ZONE_CHOICES = [
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'UTC',
]

/**
 * 保存済みのタイムゾーンが候補にもIANAの一覧にも無いときだけ true（監査6 #710）。
 * 昔の自由入力で残った綴り違いに気づけるよう、注意書きを出すための判定。
 * IANAの一覧を取れない環境では警告しない（選択自体は動く）。
 */
function isUnknownTimeZone(zone: string): boolean {
  if (TIME_ZONE_CHOICES.includes(zone)) return false
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof supportedValuesOf !== 'function') return false
    return !supportedValuesOf.call(Intl, 'timeZone').includes(zone)
  } catch {
    return false
  }
}

function BookingRulesEditor({ accountId, initial, canEdit, onRetry, onSaved }: {
  accountId: string
  initial: BookingSettings
  /** false のとき閲覧のみ。入力を無効化し保存ボタンを出さない（APIも403で拒否）。 */
  canEdit: boolean
  onRetry: () => void
  onSaved: (settings: BookingSettings) => void
}) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function set<K extends keyof BookingSettings>(key: K, value: BookingSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  async function submit() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const response = await bookingApi.saveSettings(accountId, {
        expectedVersion: draft.version,
        timeZone: draft.timeZone.trim(),
        bookingWindowDays: draft.bookingWindowDays,
        cutoffMinutesBefore: draft.cutoffMinutesBefore,
        cancelDeadlineMinutesBefore: draft.cancelDeadlineMinutesBefore,
        maxActiveBookingsPerFriend: draft.maxActiveBookingsPerFriend,
        approvalMode: draft.approvalMode,
        holdMinutes: draft.holdMinutes,
        slotGranularityMinutes: draft.slotGranularityMinutes,
        reminderDayBeforeTime: draft.reminderDayBeforeTime || null,
        reminderHoursBefore: draft.reminderHoursBefore,
      })
      if (!response.success) throw new Error('booking_settings_save_failed')
      setDraft(response.data)
      setSaved(true)
      onSaved(response.data)
    } catch (saveFailure) {
      setSaveError(bookingRulesErrorMessage(saveFailure, '保存'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-canvas rounded-card border-hairline border p-5">
      <fieldset disabled={!canEdit} className="contents">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="タイムゾーン" required>
          {/*
           * IANA名の自由入力は綴り違いで予約全体がずれるため、候補から選ぶ形へ。
           * 保存済みの値が候補に無いときは先頭に足して、黙って書き換えない。
           */}
          <SelectField
            value={draft.timeZone}
            onChange={(event) => set('timeZone', event.target.value)}
            options={(TIME_ZONE_CHOICES.includes(draft.timeZone)
              ? TIME_ZONE_CHOICES
              : [draft.timeZone, ...TIME_ZONE_CHOICES]
            ).map((zone) => ({ value: zone, label: zone }))}
          />
          {isUnknownTimeZone(draft.timeZone) ? (
            <p className="text-danger mt-1 text-xs">一覧にないタイムゾーンです。綴りを確認してください（よく使う値: Asia/Tokyo）。</p>
          ) : null}
        </Field>
        <RuleNumberField label="何日先まで受け付けるか" unit="日" min={1} max={365} value={draft.bookingWindowDays} onChange={(value) => set('bookingWindowDays', value)} />
        <RuleNumberField label="受付の締め切り" unit="分前" min={0} max={43200} value={draft.cutoffMinutesBefore} onChange={(value) => set('cutoffMinutesBefore', value)} humanize={minutesBeforeLabel} />
        <RuleNumberField label="キャンセルの期限" unit="分前" min={0} max={43200} value={draft.cancelDeadlineMinutesBefore} onChange={(value) => set('cancelDeadlineMinutesBefore', value)} humanize={minutesBeforeLabel} />
        <RuleNumberField label="1人が同時に持てる予約" unit="件" min={1} max={100} value={draft.maxActiveBookingsPerFriend} onChange={(value) => set('maxActiveBookingsPerFriend', value)} />
        <Field label="予約の承認" required>
          <SelectField
            value={draft.approvalMode}
            onChange={(event) => set('approvalMode', event.target.value as 'automatic' | 'manual')}
            options={[{ value: 'automatic', label: '自動で確定' }, { value: 'manual', label: '確認してから確定' }]}
          />
        </Field>
        <RuleNumberField label="仮押さえの保持時間" unit="分" min={1} max={1440} value={draft.holdMinutes} onChange={(value) => set('holdMinutes', value)} humanize={formatMinutesLengthHint} />
        <Field label="予約枠の間隔" required>
          <SelectField
            value={String(draft.slotGranularityMinutes)}
            onChange={(event) => set(
              'slotGranularityMinutes',
              Number(event.target.value) as BookingSettings['slotGranularityMinutes'],
            )}
            options={[5, 10, 15, 30, 60].map((value) => ({ value: String(value), label: `${value}分` }))}
          />
        </Field>
        {/* N-395: 前日・当日のお知らせ時刻を店舗ごとに変えられるようにする。
            空欄にすると従来どおり（前日=24時間前、当日=2時間前）。 */}
        <Field label="前日のお知らせを送る時刻">
          <div className="flex items-center gap-2">
            <input
              aria-label="前日のお知らせを送る時刻"
              type="time"
              value={draft.reminderDayBeforeTime ?? ''}
              onChange={(event) => set('reminderDayBeforeTime', event.target.value || null)}
              className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2"
            />
            <span className="text-ink-faint whitespace-nowrap text-xs">空欄は24時間前</span>
          </div>
        </Field>
        <RuleNumberField label="当日のお知らせを送るタイミング" unit="時間前" min={1} max={72} value={draft.reminderHoursBefore} onChange={(value) => set('reminderHoursBefore', value)} humanize={formatHoursBeforeHint} />
      </div>
      <p className="text-ink-faint mt-4 text-xs">0分前は、開始直前まで受け付ける・キャンセルできる設定です。</p>
      {saveError && (
        <div className="bg-danger-bg text-danger mt-4 rounded-control p-3 text-sm" role="alert">
          <p>{saveError}</p>
          {saveError.includes('先に保存') && <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">最新の内容を読み直す</button>}
        </div>
      )}
      {saved && <p className="text-success mt-4 text-sm font-semibold" role="status">予約の基本ルールを保存しました。</p>}
      </fieldset>
      {canEdit ? (
        <div className="border-hairline mt-5 flex justify-end border-t pt-4">
          <Button
            onClick={() => void submit()}
            disabled={saving}
            variant="primary"
          >
            {saving ? '保存中…' : initial.version === 0 ? '基本ルールを作成' : '変更を保存'}
          </Button>
        </div>
      ) : (
        <p className="text-ink-faint mt-5 border-t border-hairline pt-4 text-xs">
          予約設定の変更権限がないため、閲覧のみです。
        </p>
      )}
    </div>
  )
}

function RuleNumberField({ label, unit, min, max, value, onChange, humanize }: {
  label: string
  unit: string
  min: number
  max: number
  value: number
  onChange: (value: number) => void
  /** 入力値を時間・日の単位へ読み替える（例: 1440分 → 24時間前）。 */
  humanize?: (value: number) => string | null
}) {
  const hint = humanize?.(value)
  return (
    <Field label={label} required>
      <div className="flex items-center gap-2">
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2"
        />
        <span className="text-ink-faint whitespace-nowrap text-xs">{unit}</span>
      </div>
      {hint ? <p className="text-ink-faint mt-1 text-xs">＝{hint}</p> : null}
    </Field>
  )
}

function Kpi({
  title,
  value,
  unit,
  detail,
}: {
  title: string
  value: string
  unit: string
  detail: string
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <p className="text-ink-faint text-xs">{title}</p>
      <p className="text-ink mt-1 text-2xl font-semibold tabular-nums">
        {value}
        <span className="text-ink-faint ml-1 text-xs font-normal">{unit}</span>
      </p>
      <p className="text-ink-faint mt-1 text-xs">{detail}</p>
    </div>
  )
}

function EditMenuModal({
  menu,
  tags,
  accountId,
  canManageResources,
  canEdit,
  onSave,
  onReloadLatest,
  onResourcesSaved,
  onClose,
}: {
  menu: BookingMenu
  tags: Tag[]
  accountId: string | null
  canManageResources: boolean
  /** false のとき閲覧のみ。保存ボタンを無効化する（APIも403で拒否）。 */
  canEdit: boolean
  onSave: (m: BookingMenu) => Promise<void>
  /** 版競合(409)のとき。一覧を読み直して、この窓は閉じる。 */
  onReloadLatest: () => Promise<void>
  onResourcesSaved: (
    menuId: string,
    version: number,
    resources: NonNullable<BookingMenu['assigned_resources']>,
  ) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<BookingMenu>(menu)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [resources, setResources] = useState<BookingResource[]>([])
  const [resourceLoadError, setResourceLoadError] = useState<string | null>(null)
  const [resourceSaving, setResourceSaving] = useState(false)
  const [resourceMessage, setResourceMessage] = useState<string | null>(null)
  const [resourceAssignments, setResourceAssignments] = useState<Map<string, number>>(() => new Map(
    (menu.assigned_resources ?? []).map((item) => [item.resourceId, item.quantity]),
  ))
  const resourceSubmitRef = useRef(false)
  const resourceLoadGenerationRef = useRef(0)

  useEffect(() => {
    const generation = ++resourceLoadGenerationRef.current
    setResourceLoadError(null)
    setResources([])
    if (!accountId) return
    bookingApi.listResources(accountId)
      .then((response) => {
        if (resourceLoadGenerationRef.current === generation) {
          setResources(response.data.resources)
        }
      })
      .catch(() => {
        if (resourceLoadGenerationRef.current === generation) {
          setResourceLoadError('設備を読み込めませんでした。編集内容はそのままです。')
        }
      })
    return () => { resourceLoadGenerationRef.current += 1 }
  }, [accountId])

  /*
   * 候補は「今のアカウントの有効なタグ」だけ。api.tags.list() は見えている
   * アカウント全部と整理済み(archived)まで返すので、そのまま並べると別アカウントの
   * タグが選べてしまい、保存時に Worker が tag_not_found で落とす。新規作成画面
   * (new/page.tsx)と同じ絞り方にそろえ、保存側の検証と二重化する。
   */
  const tagCandidates = tags.filter(
    (t) => t.lineAccountId === accountId && t.status !== 'archived',
  )
  /*
   * 設定した後にタグが整理された既存メニューは、候補に無い ID を抱えたまま開く。
   * 黙って「なし」に見せると気付かないまま保存で消えるので、選択は残したまま
   * 何が起きたかを出して選び直させる。保存し直せば Worker 側の active 検証で
   * 400 になるため、ここで先に知らせる。
   */
  const storedTagId = form.auto_tag_id ?? null
  const danglingAutoTag = storedTagId != null && !tagCandidates.some((t) => t.id === storedTagId)
  const danglingTagName = tags.find((t) => t.id === storedTagId)?.name ?? null

  /** 数値欄に文字列が入らないよう、鍵と値の型をそろえる。 */
  function set<K extends keyof BookingMenu>(k: K, v: BookingMenu[K]) {
    setForm({ ...form, [k]: v })
  }

  async function submit() {
    const validationError = bookingMenuError({
      name: form.name,
      durationMinutes: form.duration_minutes,
      bufferAfterMinutes: form.buffer_after_minutes,
      sortOrder: form.sort_order,
      assignedStaffCount: form.assigned_staff?.length ?? 0,
    })
    if (validationError) {
      setErr(validationError)
      return
    }
    setSaving(true)
    setErr(null)
    setConflict(false)
    try {
      await onSave(form)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 窓は閉じず、読み直してからやり直す流れをここに出す。
        setConflict(true)
        setErr('ほかの担当者が先に保存しました。最新の内容を読み直してから、もう一度変更してください。')
      } else {
        setErr(bookingErrorMessage(e, '保存'))
      }
    } finally {
      setSaving(false)
    }
  }

  function toggleResource(resourceId: string, checked: boolean) {
    setResourceMessage(null)
    setResourceAssignments((current) => {
      const next = new Map(current)
      if (checked) next.set(resourceId, current.get(resourceId) ?? 1)
      else next.delete(resourceId)
      return next
    })
  }

  function setResourceQuantity(resourceId: string, quantity: number) {
    setResourceMessage(null)
    setResourceAssignments((current) => new Map(current).set(resourceId, quantity))
  }

  async function submitResources() {
    if (resourceSubmitRef.current || !accountId) return
    const submissionGeneration = resourceLoadGenerationRef.current
    const expectedVersion = form.version
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      setResourceMessage('最新のメニュー情報を読み直してから、もう一度お試しください。')
      return
    }
    const selected = [...resourceAssignments.entries()].map(([resourceId, quantity]) => ({ resourceId, quantity }))
    if (selected.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000)) {
      setResourceMessage('必要数は1〜1000の整数で入力してください。')
      return
    }
    resourceSubmitRef.current = true
    setResourceSaving(true)
    setResourceMessage(null)
    try {
      const response = await bookingApi.saveMenuResources(accountId, menu.id, {
        expectedVersion: Number(expectedVersion), resources: selected,
      })
      if (resourceLoadGenerationRef.current !== submissionGeneration) return
      const assigned = selected.map((item) => {
        const candidate = resources.find((resource) => resource.id === item.resourceId)
          ?? menu.assigned_resources?.find((resource) => resource.resourceId === item.resourceId)
        return {
          menuId: menu.id,
          resourceId: item.resourceId,
          name: candidate?.name ?? '不明な設備',
          type: candidate && 'type' in candidate ? candidate.type : '',
          capacity: candidate?.capacity ?? item.quantity,
          quantity: item.quantity,
          isActive: candidate && 'isActive' in candidate ? candidate.isActive : false,
          warning: candidate && 'isActive' in candidate && candidate.isActive ? null : 'resource_inactive' as const,
        }
      })
      setForm((current) => ({ ...current, version: response.data.version, assigned_resources: assigned }))
      onResourcesSaved(menu.id, response.data.version, assigned)
      setResourceMessage('設備の割当を保存しました。新しい予約枠から反映されます。')
    } catch (error) {
      if (resourceLoadGenerationRef.current !== submissionGeneration) return
      setResourceMessage(error instanceof ApiError && error.status === 409
        ? 'ほかの担当者が先に保存しました。画面を閉じて最新の内容を読み直してください。'
        : '設備の割当を保存できませんでした。入力は残っています。もう一度お試しください。')
    } finally {
      resourceSubmitRef.current = false
      if (resourceLoadGenerationRef.current === submissionGeneration) setResourceSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-6 py-4">
          <h2 className="text-base font-semibold">メニュー編集</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <Field label="名前" required>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:outline-none focus:ring-2"
              placeholder="例: カット"
            />
          </Field>
          <Field label="カテゴリ">
            <input
              type="text"
              value={form.category_label ?? ''}
              onChange={(e) => set('category_label', e.target.value)}
              className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:outline-none focus:ring-2"
              placeholder="例: カット / カラー / パーマ"
            />
          </Field>
          <Field label="説明">
            <textarea
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
              className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-y"
              rows={2}
              placeholder="顧客に表示される説明文"
            />
          </Field>
          <Field label="料金の形" required>
            <SelectField
              aria-label="料金の形"
              value={form.price_mode ?? 'fixed'}
              onChange={(e) => {
                const mode = e.target.value as NonNullable<BookingMenu['price_mode']>
                // 無料・お問い合わせは金額を持たない。DB CHECK と Worker の
                // readPriceModeAndAmount に合わせて base_price=0 にそろえる。
                setForm((current) => ({
                  ...current,
                  price_mode: mode,
                  base_price: mode === 'fixed' ? current.base_price : 0,
                }))
              }}
              options={[
                { value: 'fixed', label: '固定料金' },
                { value: 'free', label: '無料' },
                { value: 'inquiry', label: 'お問い合わせ' },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <NumField
              label="所要時間（分）"
              required
              value={form.duration_minutes ?? 60}
              onChange={(v) => set('duration_minutes', v)}
            />
            <NumField
              label="後バッファ（分）"
              value={form.buffer_after_minutes ?? 0}
              onChange={(v) => set('buffer_after_minutes', v)}
            />
            {(form.price_mode ?? 'fixed') === 'fixed' && (
              <NumField
                label="料金（円）"
                required
                value={form.base_price ?? 0}
                onChange={(v) => set('base_price', v)}
              />
            )}
            <NumField
              label="並び順"
              value={form.sort_order ?? 0}
              onChange={(v) => set('sort_order', v)}
            />
          </div>
          <Field label="予約申込時に自動付与するタグ">
            <SelectField
              value={form.auto_tag_id ?? ''}
              onChange={(e) => set('auto_tag_id', e.target.value === '' ? null : e.target.value)}
              options={[
                { value: '', label: '— なし —' },
                ...(danglingAutoTag
                  ? [{
                      value: storedTagId as string,
                      label: `${danglingTagName ?? '不明なタグ'}（今は使えません）`,
                    }]
                  : []),
                ...tagCandidates.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            {danglingAutoTag && (
              <p className="mt-1 text-xs text-danger">
                設定されていたタグは整理済みか、このアカウントのタグではありません。選び直すか「なし」にしてください。
              </p>
            )}
            {!danglingAutoTag && tagCandidates.length === 0 && (
              <p className="mt-1 text-xs text-ink-faint">
                このアカウントに使えるタグがありません。タグなしで保存できます。
              </p>
            )}
            <p className="mt-1 text-xs text-ink-faint">
              このメニューが予約されると、申込者の友だちに自動でこのタグが付きます。タグは既存のものから選択してください (友だち画面 / シナリオ等で使われているタグ)。
            </p>
          </Field>

          <div className="border-hairline space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-ink-secondary text-sm font-semibold">このメニューで使う設備</p>
              <p className="text-ink-faint mt-1 text-xs">部屋・席・機材を複数選び、1件の予約に必要な数を指定します。</p>
            </div>
            {resourceLoadError ? (
              <p role="alert" className="text-danger text-xs">{resourceLoadError}</p>
            ) : resources.length === 0 && (menu.assigned_resources ?? []).length === 0 ? (
              <p className="text-ink-faint text-xs">利用できる設備がありません。設備設定で作成してください。</p>
            ) : (
              <div className="space-y-2">
                {[
                  ...resources,
                  ...(menu.assigned_resources ?? [])
                    .filter((assigned) => !resources.some((resource) => resource.id === assigned.resourceId))
                    .map((assigned) => ({
                      id: assigned.resourceId, name: assigned.name, type: assigned.type,
                      capacity: assigned.capacity, isActive: assigned.isActive,
                    } as BookingResource)),
                ].map((resource) => {
                  const checked = resourceAssignments.has(resource.id)
                  return (
                    <div key={resource.id} className="bg-canvas-sunken rounded-control flex items-center gap-3 p-2">
                      <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canManageResources || (!resource.isActive && !checked)}
                          onChange={(event) => toggleResource(resource.id, event.target.checked)}
                        />
                        <span className="truncate" title={resource.name}>{resource.name}</span>
                        {!resource.isActive && <span className="text-warning text-xs">停止中・新規受付不可</span>}
                        {resource.isActive && checked
                          && (resourceAssignments.get(resource.id) ?? 1) > resource.capacity
                          && <span className="text-warning text-xs">必要数が受付上限超過・新規受付不可</span>}
                      </label>
                      {checked && (
                        <label className="flex items-center gap-1 text-xs">
                          必要数
                          <input
                            aria-label={`${resource.name}の必要数`}
                            type="number" min={1} max={Math.min(1000, resource.capacity)}
                            value={resourceAssignments.get(resource.id) ?? 1}
                            disabled={!canManageResources || !resource.isActive}
                            onChange={(event) => setResourceQuantity(resource.id, Number(event.target.value))}
                            className="border-hairline rounded-control w-20 border px-2 py-1 tabular-nums"
                          />
                          / {resource.capacity}
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {canManageResources ? (
              <button
                type="button"
                onClick={() => void submitResources()}
                disabled={resourceSaving || resourceLoadError !== null}
                className="border-accent text-accent-deep rounded-control border px-3 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {resourceSaving ? '設備の割当を保存中…' : '設備の割当を保存'}
              </button>
            ) : (
              <p className="text-ink-faint text-xs">設備の割当は閲覧のみです。変更は管理者へ依頼してください。</p>
            )}
            {resourceMessage && <p role="status" className="text-xs text-ink-secondary">{resourceMessage}</p>}
          </div>

          {/* 受付条件。空欄は「制限しない」で、これまでと同じ動きになる。 */}
          <div className="border-hairline space-y-3 rounded-lg border p-3">
            <p className="text-ink-secondary text-sm font-semibold">受付条件</p>
            <div className="grid grid-cols-2 gap-3">
              <NumField
                label="同時に受ける件数"
                value={form.concurrent_capacity ?? 1}
                onChange={(v) => set('concurrent_capacity', v)}
              />
              <NullableNumField
                label="何日先まで受けるか"
                unit="日"
                value={form.booking_window_days ?? null}
                onChange={(v) => set('booking_window_days', v)}
              />
              <NullableNumField
                label="受付の締め切り"
                unit="時間前"
                value={form.cutoff_hours_before ?? null}
                onChange={(v) => set('cutoff_hours_before', v)}
              />
              <NullableNumField
                label="キャンセルの期限"
                unit="時間前"
                value={form.cancel_deadline_hours_before ?? null}
                onChange={(v) => set('cancel_deadline_hours_before', v)}
              />
            </div>
            <p className="text-ink-faint text-xs leading-relaxed">
              空欄は「制限しない」です。<br />
              「同時に受ける件数」を2以上にすると、<strong>このメニュー同士だけ</strong>が同じ枠に入ります。
              別のメニューの予約が入っている時間には、件数にかかわらず入りません。<br />
              キャンセルの期限はお客様の画面に表示されます。管理画面からはいつでもキャンセルできます。
            </p>
            <Field label="予約時にお客様へ聞くこと">
              <input
                type="text"
                value={form.intake_question ?? ''}
                onChange={(e) => set('intake_question', e.target.value === '' ? null : e.target.value)}
                placeholder="例: 気になっている箇所はありますか？"
                maxLength={200}
                className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:outline-none focus:ring-2"
              />
              <p className="text-ink-faint mt-1 text-xs">
                空欄なら質問しません。回答は予約のメモとして残ります。
              </p>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.is_active)}
              onChange={(e) => set('is_active', e.target.checked ? 1 : 0)}
              className="rounded"
            />
            有効（顧客に表示する）
          </label>
          {err && (
            <div role="alert">
              <p className="text-xs text-red-600">{err}</p>
              {conflict && (
                <button
                  type="button"
                  onClick={() => void onReloadLatest()}
                  className="text-action mt-1 text-xs font-semibold underline"
                >
                  最新の内容を読み直す
                </button>
              )}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-hairline flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-ink-secondary bg-canvas-sunken hover:bg-gray-200 rounded-lg"
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={saving || !canEdit}
            title={canEdit ? undefined : '予約メニューの変更権限がありません'}
            className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium transition-colors hover:brightness-92 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-secondary mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}

/**
 * 空欄を「制限しない」として扱う数値欄。
 *
 * 0 を「制限しない」に使わないのは、0時間前・0日先という読み方も
 * できてしまい、どちらの意味か画面から判断できないため。
 */
function NullableNumField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          value={value ?? ''}
          placeholder="なし"
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2"
        />
        <span className="text-ink-faint whitespace-nowrap text-xs">{unit}</span>
      </div>
    </Field>
  )
}

function NumField({
  label,
  required,
  value,
  onChange,
}: { label: string; required?: boolean; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label} required={required}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:outline-none focus:ring-2 tabular-nums"
      />
    </Field>
  )
}

function MenusPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  const { selectedAccount } = useAccount()
  const [menuCount, setMenuCount] = useState<number | null>(null)
  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = selectedAccount?.liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(selectedAccount.liffId)}&page=salon-book`
    : null
  return (
    <div>
      <div data-design="Head" className="mb-5 flex min-h-10 flex-wrap items-center justify-between gap-3">
        <Breadcrumb items={[{ label: '予約' }, { label: '予約設定' }]} />
        {previewUrl && <Button href={previewUrl}>お客様に見える画面を確かめる</Button>}
      </div>
      {/* 既存の2タブはこの画面の中で切り替わり、
          受付時間は別URLへ移動する。
          MergedTabs は「同じ画面の中で切り替わるもの」しか扱えないので
          ここは手で並べている。 */}
      <div data-design="Tabs" className="border-hairline mb-4 flex flex-wrap gap-1 border-b">
        <Link
          href="/booking/menus?tab=menus"
          className={`rounded-t-md px-4 py-2 text-sm ${
            tab === 'menus'
              ? 'border-accent text-accent-deep border-b-2 font-medium'
              : 'text-ink-faint hover:text-ink-secondary'
          }`}
        >
          メニュー {menuCount ?? '—'}
        </Link>
        <Link
          href="/booking/staff/shifts"
          className={`rounded-t-md px-4 py-2 text-sm ${
            'text-ink-faint hover:text-ink-secondary'
          }`}
        >
          受付枠
        </Link>
        <Link
          href="/booking/staff/shifts#special"
          className="text-ink-faint hover:text-ink-secondary rounded-t-md px-4 py-2 text-sm"
        >
          休業日
        </Link>
        <Link
          href="/booking/menus?tab=rules"
          className={`rounded-t-md px-4 py-2 text-sm ${tab === 'rules' ? 'border-accent text-ink border-b-2 font-medium' : 'text-ink-faint hover:text-ink-secondary'}`}
        >
          予約のルール
        </Link>
      </div>
      {(tab === 'menus' || tab === 'rules') && <MenusPageInner activeTab={tab} onMenuCount={setMenuCount} />}
      {tab === 'staff' && <BookingStaffPage />}
    </div>
  )
}

export default function MenusPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <MenusPageHost />
    </Suspense>
  )
}
