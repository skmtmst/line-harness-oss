'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import {
  api,
  ApiError,
  bookingApi,
  type BookingMenu,
  type BookingRequest,
  type BookingStaff,
} from '@/lib/api'
import type { Tag } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { Suspense } from 'react'
import { useMergedTab } from '@/components/layout/merged-tabs'
import BookingStaffPage from '@/app/booking/staff/page'

/**
 * 予約設定（設計 V2 8-2 / node nFCBf）。
 *
 * 設計は1枚の画面をタブで切り替える形。メニューとスタッフはすでに
 * ここに寄せてあったので、受付時間（8-2-3）とメニュー×スタッフ（8-2-4）
 * への行き先をタブに並べた。別ページではあるが、探す場所は1か所になる。
 */

const MERGED_TABS = [
  { key: 'menus', label: 'メニュー' },
  { key: 'staff', label: '担当スタッフ' },
]

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

/** JSTでの年月。今月の予約を数えるのに使う。 */
function jstMonth(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 7)
}

function monthKey(offset: number): string {
  const now = new Date(Date.now() + 9 * 3600_000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 7)
}

function MenusPageInner() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [items, setItems] = useState<BookingMenu[]>([])
  const [editing, setEditing] = useState<Partial<BookingMenu> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // copy 状態は menu.id 単位で持つ。複数メニューを連続でコピーしたとき
  // 直近にコピーした行だけ「コピー済」が出る。
  const [copiedMenuId, setCopiedMenuId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<BookingMenu | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [tags, setTags] = useState<Tag[]>([])
  const [staff, setStaff] = useState<BookingStaff[]>([])
  /** メニューID → 担当できるスタッフの表示名。 */
  const [menuStaff, setMenuStaff] = useState<Map<string, string[]>>(new Map())
  /** 担当を引けなかったスタッフの表示名。空でなければ「担当なし」は当てにならない。 */
  const [staffReadFailed, setStaffReadFailed] = useState<string[]>([])
  const [bookings, setBookings] = useState<BookingRequest[]>([])
  const [supportingLoadState, setSupportingLoadState] = useState<SupportingLoadState>('loading')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'bookings' | 'order' | 'name'>('bookings')
  const [period, setPeriod] = useState<'current' | 'previous' | 'all'>('current')
  const loadGenerationRef = useRef(0)

  const liffId = selectedAccount?.liffId ?? null
  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''

  async function copyMenuUrl(menuId: string) {
    if (!workerBase || !liffId) return
    const url = `${workerBase}/o?liffId=${encodeURIComponent(liffId)}&page=salon-book&menu_id=${encodeURIComponent(menuId)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedMenuId(menuId)
      setTimeout(() => {
        setCopiedMenuId((cur) => (cur === menuId ? null : cur))
      }, 2000)
    } catch {
      window.prompt('コピーしてください:', url)
    }
  }

  const load = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current
    if (!selectedAccountId) {
      setItems([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    // アカウント切替時は前 account の menus が表示・操作可能なまま残らないよう
    // 先にクリア。fetch 失敗でも cross-account の操作事故が起きない。
    setItems([])
    try {
      const r = await bookingApi.listMenus(selectedAccountId)
      if (loadGenerationRef.current !== requestGeneration) return
      setItems(r.menus)
    } catch (e) {
      if (loadGenerationRef.current !== requestGeneration) return
      setError(bookingErrorMessage(e, '読み込み'))
    } finally {
      if (loadGenerationRef.current === requestGeneration) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

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

  // スタッフ・割り当て・予約件数。表の右半分と上のKPIに要る。
  // 割り当てはスタッフ単位でしか引けないので、人数ぶん引いて裏返す。
  // 店のスタッフは数人なので、この回数で困ることはない。
  useEffect(() => {
    setStaff([])
    setBookings([])
    setMenuStaff(new Map())
    setStaffReadFailed([])
    setSupportingLoadState('loading')
    if (!selectedAccountId) return
    let alive = true
    void (async () => {
      try {
        const [staffRes, bookingRes] = await Promise.all([
          bookingApi.listStaff(selectedAccountId),
          bookingApi.listRequests(selectedAccountId, 'all'),
        ])
        if (!alive) return
        setStaff(staffRes.staff)
        setBookings(bookingRes.requests)

        const map = new Map<string, string[]>()
        const failed: string[] = []
        await Promise.all(
          staffRes.staff.map(async (s) => {
            try {
              const { matrix } = await bookingApi.getStaffMenus(selectedAccountId, s.id)
              for (const row of matrix) {
                if (!row.is_offered) continue
                map.set(row.menu_id, [...(map.get(row.menu_id) ?? []), s.display_name || s.name])
              }
            } catch {
              // 1人ぶん引けなくても、他の行は出せる。ただし黙って捨てると、
              // この人だけが担当のメニューが「担当なし」＝予約枠が出ない、と
              // 誤って読める。名前を控えて表の上で断る。
              failed.push(s.display_name || s.name)
            }
          }),
        )
        if (alive) {
          setMenuStaff(map)
          setStaffReadFailed(failed)
          setSupportingLoadState('ready')
        }
      } catch {
        if (alive) setSupportingLoadState('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [selectedAccountId])

  async function save(m: Partial<BookingMenu>) {
    if (!selectedAccountId) return
    if (m.id) {
      await bookingApi.updateMenu(selectedAccountId, m.id, m)
    } else {
      await bookingApi.createMenu(selectedAccountId, m)
    }
    setEditing(null)
    await load()
  }

  /**
   * 消す前に、**何が消えて何が残るかを本文で読ませる。**
   * ブラウザの `confirm()` は見た目がブラウザ任せで、設計の確認窓と違ううえ、
   * 画像比較にも写らない（確認の絵をそもそも撮れない）。
   */
  async function remove(id: string) {
    if (!selectedAccountId) return
    setDeleting(true)
    try {
      await bookingApi.deleteMenu(selectedAccountId, id)
      setRemoveTarget(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  const thisMonth = monthKey(0)
  const kpi = useMemo(() => {
    const inThis = bookings.filter((b) => jstMonth(b.starts_at) === thisMonth).length
    const inLast = bookings.filter((b) => jstMonth(b.starts_at) === monthKey(-1)).length
    return { inThis, diff: inThis - inLast }
  }, [bookings, thisMonth])

  const periodBookings = useMemo(() => {
    const month = period === 'current' ? thisMonth : period === 'previous' ? monthKey(-1) : null
    return month ? bookings.filter((booking) => jstMonth(booking.starts_at) === month) : bookings
  }, [bookings, period, thisMonth])

  /** メニュー名 → 選択期間の予約件数。 */
  const bookingCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of periodBookings) {
      counts.set(b.menu_name, (counts.get(b.menu_name) ?? 0) + 1)
    }
    return counts
  }, [periodBookings])

  const shown = useMemo(() => {
    const q = query.trim()
    const filtered = q ? items.filter((m) => m.name.includes(q)) : items
    return [...filtered].sort((a, b) => {
      if (sort === 'bookings') {
        const diff = (bookingCounts.get(b.name) ?? 0) - (bookingCounts.get(a.name) ?? 0)
        if (diff !== 0) return diff
      }
      if (sort === 'name') return a.name.localeCompare(b.name, 'ja')
      return a.sort_order - b.sort_order || a.id.localeCompare(b.id)
    })
  }, [bookingCounts, items, query, sort])

  function exportCsv() {
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
    const rows = shown.map((menu) => [
      menu.name,
      menu.category_label ?? '',
      menu.duration_minutes,
      menu.buffer_after_minutes,
      menu.base_price,
      supportingLoadState === 'ready' ? (menuStaff.get(menu.id) ?? []).join('・') : '—',
      supportingLoadState === 'ready' ? bookingCounts.get(menu.name) ?? 0 : '—',
      menu.is_active ? '公開中' : '非公開',
    ])
    const csv = [
      ['メニュー名', '分類', '所要時間（分）', '後片付け（分）', '料金（円）', '担当者', '予約件数', '状態'],
      ...rows,
    ].map((row) => row.map(escape).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `予約メニュー-${period === 'current' ? '今月' : period === 'previous' ? '前月' : '全期間'}.csv`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <div data-design-node="QSLEH">
      <div data-design="Head" className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" href="/booking/menus/new">
          予約メニューを作る
        </Button>
        <div className="ml-auto">
          <Button href="/booking/staff/shifts">受付枠と休業日を設定</Button>
        </div>
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          title="メニュー"
          value={!selectedAccountId || loading || error ? '—' : String(items.length)}
          unit="件"
          detail={
            !selectedAccountId
              ? 'アカウントを選択'
              : loading
                ? '読み込み中'
                : error
                  ? '取得できませんでした'
                  : `公開中 ${items.filter((m) => m.is_active).length}`
          }
        />
        <Kpi
          title="担当スタッフ"
          value={supportingLoadState === 'ready' ? String(staff.length) : '—'}
          unit="人"
          detail={supportingDetail(
            Boolean(selectedAccountId),
            supportingLoadState,
            `稼働中 ${staff.filter((s) => s.is_active).length}`,
          )}
        />
        <Kpi
          title="今月の予約"
          value={supportingLoadState === 'ready' ? String(kpi.inThis) : '—'}
          unit="件"
          detail={supportingDetail(
            Boolean(selectedAccountId),
            supportingLoadState,
            `前月比 ${kpi.diff >= 0 ? '+' : ''}${kpi.diff}`,
          )}
        />
        {/* 枠の稼働率は「公開している枠のうち何割が埋まったか」。
            受付時間の総枠数を数える仕組みがまだ無いので出せない。 */}
        <Kpi title="枠の稼働率" value="—" unit="%" detail="公開枠のうち" />
      </div>

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メニュー名で検索"
          aria-label="メニュー名で検索"
          className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <Select
          aria-label="並び順"
          value={sort}
          onChange={(value) => setSort(value as typeof sort)}
          options={[
            { value: 'bookings', label: '予約が多い順' },
            { value: 'order', label: '公開順' },
            { value: 'name', label: '名前順' },
          ]}
        />
        <Select
          aria-label="集計期間"
          value={period}
          onChange={(value) => setPeriod(value as typeof period)}
          options={[
            { value: 'current', label: '今月' },
            { value: 'previous', label: '前月' },
            { value: 'all', label: '全期間' },
          ]}
        />
        <Button onClick={exportCsv} disabled={loading || Boolean(error) || shown.length === 0}>
          CSVで書き出す
        </Button>
      </div>

      {staffReadFailed.length > 0 && (
        <div className="bg-warning-bg text-warning rounded-card mb-3 px-4 py-3 text-xs">
          {staffReadFailed.join('・')} の担当を読み取れませんでした。
          この人だけが担当しているメニューは、実際には担当がいても「担当なし」と出ます。
          時間をおいて開き直してください。
        </div>
      )}

      {!selectedAccountId ? (
        <div data-design-node="W6465r"><ListState kind="empty" title="LINEアカウントを選んでください" description="共通メニューで、予約設定を開くLINEアカウントを選んでください。" /></div>
      ) : loading ? (
        <div data-design-node="W6465r"><ListState kind="loading" description="予約メニューと実績を読み込んでいます。" /></div>
      ) : error ? (
        <div data-design-node="W6465r"><ListState kind="error" description={error} /></div>
      ) : shown.length === 0 ? (
        <div data-design-node="W6465r">
          <ListState
            kind="empty"
            title={query ? '条件に合う予約メニューはありません' : 'まだ予約メニューがありません'}
            description={query ? '検索語を変えてください。' : '最初の予約メニューを作ると、ここに並びます。'}
            action={query ? undefined : <Button variant="primary" href="/booking/menus/new">予約メニューを作る</Button>}
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint">メニュー名</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint">所要時間</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-ink-faint">料金</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint">担当できるスタッフ</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-ink-faint">
                    {period === 'current' ? '今月' : period === 'previous' ? '前月' : '全期間'}の予約
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint">予約URL</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-ink-faint">状態</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-ink-faint">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((m) => (
                  <tr key={m.id} className="hover:bg-canvas-sunken">
                    <td className="px-4 py-3 text-sm font-medium">
                      {m.name}
                      {m.category_label && (
                        <span className="bg-canvas-sunken text-ink-faint ml-2 inline-block rounded px-2 py-0.5 text-xs">
                          {m.category_label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-secondary tabular-nums">
                      {m.duration_minutes} 分
                      {m.buffer_after_minutes > 0 && (
                        <span className="text-xs text-ink-faint ml-1">+{m.buffer_after_minutes}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">¥{m.base_price.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-ink-secondary">
                      {supportingLoadState !== 'ready' ? (
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
                      {supportingLoadState === 'ready' ? `${bookingCounts.get(m.name) ?? 0} 件` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="inline-flex gap-2 text-xs">
                        {!liffId ? (
                          <span className="text-gray-300" title="LIFF ID 未設定">コピー</span>
                        ) : !m.is_active ? (
                          // is_active=0 のメニューは /api/liff/booking/menus が
                          // 返さないので、URL を送っても LIFF は解決失敗して
                          // 通常のメニュー一覧に fallback する。間違って「指定メニュー
                          // 直通」のつもりで送って別メニュー予約されるのを防ぐため、
                          // 有効化されるまでコピー不可にする。
                          <span className="text-gray-300" title="メニューを有効化するとコピーできます">コピー</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => copyMenuUrl(m.id)}
                            className="text-blue-600 hover:underline"
                            title={`${workerBase}/o?liffId=${encodeURIComponent(liffId)}&page=salon-book&menu_id=${encodeURIComponent(m.id)}`}
                          >
                            {copiedMenuId === m.id ? '✓ コピー済' : 'コピー'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {m.is_active ? (
                        <span className="bg-success-bg text-success rounded-pill inline-block px-2 py-0.5 text-xs">
                          公開中
                        </span>
                      ) : (
                        <span className="bg-canvas-sunken text-ink-faint rounded-pill inline-block px-2 py-0.5 text-xs">
                          非公開
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2 text-xs">
                        <button onClick={() => setEditing(m)} className="text-blue-600 hover:underline">
                          編集
                        </button>
                        <Link
                          href={`/booking/menus/staff?menu_id=${m.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          スタッフ割当
                        </Link>
                        <button onClick={() => setRemoveTarget(m)} className="text-red-600 hover:underline">
                          削除
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

      <div className="mt-3">
        <span className="text-ink-faint text-xs">全 {shown.length} 件</span>
      </div>

      {editing && <Modal menu={editing} tags={tags} onSave={save} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={removeTarget !== null}
        title={`「${removeTarget?.name ?? ''}」を削除しますか？`}
        description="このメニューを一覧から削除します。すでに入っている予約はそのまま残ります。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => { if (removeTarget) void remove(removeTarget.id) }}
      />
    </div>
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

function Modal({
  menu,
  tags,
  onSave,
  onClose,
}: {
  menu: Partial<BookingMenu>
  tags: Tag[]
  onSave: (m: Partial<BookingMenu>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<BookingMenu>>(menu)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof BookingMenu>(k: K, v: BookingMenu[K] | string | null) {
    setForm({ ...form, [k]: v })
  }

  async function submit() {
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
          <h2 className="text-base font-semibold">{form.id ? 'メニュー編集' : '新規メニュー'}</h2>
        </div>
        <div className="px-6 py-4 space-y-4">
          <Field label="名前" required>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例: カット"
            />
          </Field>
          <Field label="カテゴリ">
            <input
              type="text"
              value={form.category_label ?? ''}
              onChange={(e) => set('category_label', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例: カット / カラー / パーマ"
            />
          </Field>
          <Field label="説明">
            <textarea
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
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
            <select
              value={form.auto_tag_id ?? ''}
              onChange={(e) => set('auto_tag_id', e.target.value === '' ? null : e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">— なし —</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
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
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 tabular-nums"
      />
    </Field>
  )
}

function MenusPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  return (
    <div>
      {/* 既存の2タブはこの画面の中で切り替わり、
          受付時間は別URLへ移動する。
          MergedTabs は「同じ画面の中で切り替わるもの」しか扱えないので
          ここは手で並べている。 */}
      <div data-design="Tabs" className="border-hairline mb-4 flex flex-wrap gap-1 border-b">
        <Link
          href="/booking/menus?tab=menus"
          className={`rounded-t-md px-4 py-2 text-sm ${
            tab === 'menus'
              ? 'border-accent text-ink border-b-2 font-medium'
              : 'text-ink-faint hover:text-ink-secondary'
          }`}
        >
          メニュー
        </Link>
        <Link
          href="/booking/menus?tab=staff"
          className={`rounded-t-md px-4 py-2 text-sm ${
            tab === 'staff'
              ? 'border-accent text-ink border-b-2 font-medium'
              : 'text-ink-faint hover:text-ink-secondary'
          }`}
        >
          担当スタッフ
        </Link>
        <Link
          href="/booking/staff/shifts"
          className="text-ink-faint hover:text-ink-secondary rounded-t-md px-4 py-2 text-sm"
        >
          受付時間
        </Link>
      </div>
      {tab === 'menus' && <MenusPageInner />}
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
