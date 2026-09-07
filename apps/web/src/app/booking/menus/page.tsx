'use client'

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
  type BookingSettings,
} from '@/lib/api'
import type { Tag } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { Suspense } from 'react'
import { useMergedTab } from '@/components/layout/merged-tabs'
import BookingStaffPage from '@/app/booking/staff/page'
import { bookingMenuError } from './menu-validation'
import { bookingWindowEnd, businessHourSummary } from '../lib/format-time'

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
  const [supportingLoadState, setSupportingLoadState] = useState<SupportingLoadState>('loading')
  const [page, setPage] = useState(1)
  const loadGenerationRef = useRef(0)

  const load = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current
    if (!selectedAccountId) {
      setItems([])
      setSettings(null)
      setMenuStaff(new Map())
      setSupportingLoadState('loading')
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    setSupportingLoadState('loading')
    // アカウント切替時は前 account の menus が表示・操作可能なまま残らないよう
    // 先にクリア。fetch 失敗でも cross-account の操作事故が起きない。
    setItems([])
    setSettings(null)
    setMenuStaff(new Map())
    try {
      const [r, bookingSettingsResponse] = await Promise.all([
        bookingApi.listMenus(selectedAccountId),
        bookingApi.getSettings(selectedAccountId).catch(() => null),
      ])
      if (loadGenerationRef.current !== requestGeneration) return
      // 状態撮影や移行途中の口が空の器を返しても、画面全体を落とさず0件として扱う。
      const menus = Array.isArray(r.menus) ? r.menus : []
      setItems(menus)
      setMenuStaff(new Map(menus.map((menu) => [
        menu.id,
        (menu.assigned_staff ?? []).map((person) => person.display_name || person.id),
      ])))
      setSupportingLoadState('ready')
      setSettings(bookingSettingsResponse?.success ? bookingSettingsResponse.data : null)
    } catch (e) {
      if (loadGenerationRef.current !== requestGeneration) return
      setError(bookingErrorMessage(e, '読み込み'))
      setSupportingLoadState('error')
    } finally {
      if (loadGenerationRef.current === requestGeneration) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

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

  async function save(m: BookingMenu) {
    if (!selectedAccountId) return
    await bookingApi.updateMenu(selectedAccountId, m.id, m)
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
    if (supportingLoadState !== 'ready' || items.length === 0) return null
    return items.reduce((best, menu) =>
      (bookingCounts.get(menu.id) ?? 0) > (bookingCounts.get(best.id) ?? 0) ? menu : best,
    items[0])
  }, [bookingCounts, items, supportingLoadState])

  const activeWindowDays = useMemo(
    () => [...new Set(items.filter((menu) => menu.is_active).map((menu) => menu.booking_window_days).filter((days): days is number => typeof days === 'number'))].sort((a, b) => a - b),
    [items],
  )
  const businessHours = businessHourSummary(settings?.businessHours)
  const configuredWindowDays = settings?.bookingWindowDays
  const bookingWindowDays = typeof configuredWindowDays === 'number' && configuredWindowDays > 0
    ? configuredWindowDays
    : (activeWindowDays.length === 1 ? activeWindowDays[0] : null)

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
            supportingLoadState,
            favorite ? `この30日で ${bookingCounts.get(favorite.id) ?? 0}件` : '予約実績はありません',
          )}
        />
        <Kpi
          title="受け付けている時間"
          value={loading || error ? '—' : businessHours.value}
          unit=""
          detail={loading || error ? '受付枠で曜日ごとに確認' : businessHours.detail || '受付枠で曜日ごとに確認'}
        />
        <Kpi
          title="先の予約が取れる範囲"
          value={loading || error || bookingWindowDays === null
            ? '—'
            : `${bookingWindowDays}日先まで`}
          unit=""
          detail={bookingWindowDays === null ? '予約のルールで確認' : `今日から ${bookingWindowEnd(bookingWindowDays)} まで`}
        />
      </div>

      <div data-design="Bar" className="bg-info-bg text-info mb-4 rounded-control px-4 py-3 text-xs font-semibold">
        ⓘ　上から並んだ順に、お客様の画面に出ます。かかる時間を長めにしておくと、あとの予約とぶつかりません。金額を空けておくと「お問い合わせ」と出ます。
      </div>

      {activeTab === 'rules' ? (
        <BookingRulesSummary
          items={items}
          loading={loading}
          error={error}
          onRetry={() => void load()}
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
            action={<Button variant="primary" href="/booking/menus/new">＋ 予約メニューを作る</Button>}
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
                  <th className="px-4 py-3 text-right text-xs font-semibold text-ink-faint">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((m) => (
                  <tr key={m.id} className={`hover:bg-canvas-sunken ${m.is_active ? '' : 'text-ink-faint'}`}>
                    <td className="px-4 py-3 text-sm font-medium">
                      <span className="text-ink-faint mr-4" aria-hidden="true">⠿</span>{m.name}{m.is_active ? '' : '（休止中）'}
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
                    <td className={`px-4 py-3 text-sm text-right tabular-nums ${m.base_price === 0 ? 'text-accent font-semibold' : ''}`}>
                      {m.base_price === 0 ? '無料' : `¥${m.base_price.toLocaleString()}`}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-secondary">
                      {!m.is_active ? (
                        <span className="text-warning text-xs">だれもいません</span>
                      ) : supportingLoadState !== 'ready' ? (
                        <span className="text-ink-faint text-xs">—（未取得）</span>
                      ) : (menuStaff.get(m.id) ?? []).length === 0 ? (
                        // 担当が0人だと、公開していても予約フォームに枠が出ない。
                        // 「-」だと設定漏れなのか読み取れないので、はっきり書く。
                        <span className="text-warning text-xs">担当なし</span>
                      ) : (
                        <span className="text-xs">{(menuStaff.get(m.id) ?? []).join('・')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">
                      {supportingLoadState === 'ready' ? `${bookingCounts.get(m.id) ?? 0} 件` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2 text-xs">
                        {/* QSLEH の行操作は共通Button（高さ36px）より小さいため、
                            表の行高を設計どおり保つ専用の小ボタンにする。 */}
                        <button onClick={() => setEditing(m)} className="border-hairline rounded-control border px-2 py-1 font-semibold">
                          中身を見る
                        </button>
                        <button onClick={() => setVisibilityTarget(m)} className="border-hairline rounded-control border px-2 py-1 font-semibold">
                          止める・出す
                        </button>
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
        <span className="text-ink-faint text-xs">メニュー {settings?.menuCount ?? items.length}つのうち {visible.length}つを表示</span>
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} ariaLabel="予約メニューのページ送り" />
      </div>
      </>}

      {editing && <EditMenuModal menu={editing} tags={tags} onSave={save} onClose={() => setEditing(null)} />}

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

function BookingRulesSummary({ items, loading, error, onRetry }: {
  items: BookingMenu[]
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) return <ListState kind="loading" description="予約のルールを読み込んでいます。" />
  if (error) return <ListState kind="error" description={error} onRetry={onRetry} />
  if (items.length === 0) return <ListState kind="empty" title="確認できる予約のルールがありません" description="メニューを作ると、メニューごとの受付期間・締め切り・キャンセル期限をここで見比べられます。" />

  const rows = [
    { label: '先の予約が取れる範囲', key: 'booking_window_days' as const, unit: '日先まで', none: '制限なし' },
    { label: '受付の締め切り', key: 'cutoff_hours_before' as const, unit: '時間前', none: '直前まで' },
    { label: 'キャンセル期限', key: 'cancel_deadline_hours_before' as const, unit: '時間前', none: '制限なし' },
  ]
  return (
    <section data-booking-rules className="space-y-4">
      <div className="bg-accent-soft rounded-card border-accent/30 border p-4">
        <h2 className="text-ink text-base font-semibold">予約のルールをまとめて確認</h2>
        <p className="text-ink-secondary mt-1 text-sm">いまはメニューごとに保存されている3つのルールを、ここで横並びに確認できます。</p>
        <p className="text-ink-faint mt-2 text-xs">店舗共通の初期値を一度で保存するAPIは未接続です。接続後は共通値をここで変更し、各メニューは必要な項目だけ上書きします。</p>
      </div>
      <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
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
      </div>
    </section>
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
  onSave,
  onClose,
}: {
  menu: BookingMenu
  tags: Tag[]
  onSave: (m: BookingMenu) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<BookingMenu>(menu)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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
    try {
      await onSave(form)
    } catch (e) {
      setErr(bookingErrorMessage(e, '保存'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-hairline">
          <h2 className="text-base font-semibold">メニュー編集</h2>
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
            <NumField
              label="料金（円）"
              required
              value={form.base_price ?? 0}
              onChange={(v) => set('base_price', v)}
            />
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
              options={[{ value: '', label: '— なし —' }, ...tags.map((t) => ({ value: t.id, label: t.name }))]}
            />
            <p className="mt-1 text-xs text-ink-faint">
              このメニューが予約されると、申込者の友だちに自動でこのタグが付きます。タグは既存のものから選択してください (友だち画面 / シナリオ等で使われているタグ)。
            </p>
          </Field>

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
          {err && <p className="text-xs text-red-600">{err}</p>}
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
            disabled={saving}
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
              ? 'border-accent text-accent border-b-2 font-medium'
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
