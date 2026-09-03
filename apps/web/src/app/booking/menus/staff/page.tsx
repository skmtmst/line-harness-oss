'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import { bookingApi, type BookingMenu, type BookingStaff, type StaffMenuMatrix } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

/**
 * メニューごとの担当スタッフ（設計 V2 8-2-4 / node B88kuI）。
 *
 * 以前はメニューを1つ指定しないと開けず、そのメニューの担当だけを
 * 編集する画面だった。設計の狙いは逆で、「どのメニューに担当が
 * いないのか」を1画面で見つけること。担当が0人のメニューは公開して
 * いても予約フォームに枠が出ないのに、それに気づく場所が無かった。
 *
 * staff_menus は staff_id × menu_id が主キー。書き込みはスタッフ単位に
 * まとめてしか送れないので、保存は人数ぶんのPUTになる。
 */
function MenuStaffMatrixContent() {
  const sp = useSearchParams()
  /** 一覧から「スタッフ割当」で来たときに、その行を目立たせる。 */
  const focusMenuId = sp.get('menu_id') ?? ''
  const { selectedAccountId } = useAccount()
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [staff, setStaff] = useState<BookingStaff[]>([])
  /** staffId → menuId → 設定。 */
  const [grid, setGrid] = useState<Record<string, Record<string, StaffMenuMatrix>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    // 前アカウントの内容が残ったまま保存すると、別アカウントの設定を
    // 上書きする事故になる。先に空にする。
    setMenus([])
    setStaff([])
    setGrid({})
    try {
      const [menusRes, staffRes] = await Promise.all([
        bookingApi.listMenus(selectedAccountId),
        bookingApi.listStaff(selectedAccountId),
      ])
      setMenus(menusRes.menus)
      setStaff(staffRes.staff)

      const next: Record<string, Record<string, StaffMenuMatrix>> = {}
      await Promise.all(
        staffRes.staff.map(async (s) => {
          const r = await bookingApi.getStaffMenus(selectedAccountId, s.id)
          const byMenu: Record<string, StaffMenuMatrix> = {}
          for (const m of menusRes.menus) {
            byMenu[m.id] = r.matrix.find((x) => x.menu_id === m.id) ?? {
              menu_id: m.id,
              name: m.name,
              is_offered: 0,
              override_duration_minutes: null,
              override_price: null,
            }
          }
          next[s.id] = byMenu
        }),
      )
      setGrid(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

  function update(staffId: string, menuId: string, patch: Partial<StaffMenuMatrix>) {
    setGrid((cur) => ({
      ...cur,
      [staffId]: { ...cur[staffId], [menuId]: { ...cur[staffId][menuId], ...patch } },
    }))
  }

  async function saveAll() {
    if (!selectedAccountId) return
    setSaving(true)
    setError(null)
    try {
      for (const s of staff) {
        await bookingApi.putStaffMenus(
          selectedAccountId,
          s.id,
          menus.map((m) => {
            const row = grid[s.id]?.[m.id]
            return {
              menu_id: m.id,
              is_offered: Boolean(row?.is_offered),
              override_duration_minutes: row?.override_duration_minutes ?? null,
              override_price: row?.override_price ?? null,
            }
          }),
        )
      }
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /** メニューID → 担当できる人数。 */
  const offeredCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of menus) {
      let n = 0
      for (const s of staff) if (grid[s.id]?.[m.id]?.is_offered) n += 1
      counts.set(m.id, n)
    }
    return counts
  }, [menus, staff, grid])

  const orphans = menus.filter((m) => (offeredCounts.get(m.id) ?? 0) === 0)
  const assigned = [...offeredCounts.values()].reduce((a, b) => a + b, 0)
  const pairs = menus.length * staff.length

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/booking/menus" className="hover:underline">
          予約設定
        </Link>
        <span className="mx-1.5">/</span>
        <span>担当スタッフ</span>
      </nav>

      <div data-design="Head">
        <Header
          title="メニューごとの担当スタッフ"
          description="どのスタッフがどのメニューを提供できるかを決めます。スタッフごとに料金と所要時間を上書きできます。"
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            disabled
            title="操作マニュアルは準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
          >
            マニュアル
          </button>
          <Link
            href="/booking/staff/new"
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-2 text-sm"
          >
            スタッフを追加
          </Link>
          <button
            onClick={saveAll}
            // error が出ている間は押させない。読み込みに失敗した状態で
            // 保存すると、空の割り当てで上書きしてしまう。
            disabled={saving || !selectedAccountId || loading || Boolean(error)}
            className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saving ? '保存中…' : '変更を保存'}
          </button>
        </div>
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          title="メニュー"
          value={String(menus.length)}
          unit="件"
          detail={`公開中 ${menus.filter((m) => m.is_active).length}`}
        />
        <Kpi
          title="担当スタッフ"
          value={String(staff.length)}
          unit="人"
          detail={`稼働中 ${staff.filter((s) => s.is_active).length}`}
        />
        <Kpi
          title="割り当て済み"
          value={String(assigned)}
          unit="組"
          detail={`全${pairs}組のうち`}
        />
        <Kpi
          title="誰も担当していない"
          value={String(orphans.length)}
          unit="件"
          detail={orphans.length === 0 ? 'なし' : orphans.map((m) => m.name).join('・')}
        />
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}
      {savedAt && Date.now() - savedAt < 3000 && (
        <div className="bg-success-bg text-success mb-4 rounded-lg p-3 text-sm">保存しました</div>
      )}

      {orphans.length > 0 && (
        <div
          data-design="Warn"
          className="bg-warning-bg rounded-card mb-4 flex flex-wrap items-center justify-between gap-2 p-4"
        >
          <div>
            <p className="text-warning text-sm font-medium">
              「{orphans.map((m) => m.name).join('」「')}」は担当できるスタッフがいません。
            </p>
            <p className="text-ink-secondary mt-0.5 text-xs">
              このままでは予約フォームに枠が出ません。
            </p>
          </div>
          <a
            href={`#menu-${orphans[0].id}`}
            className="bg-accent-deep text-on-accent rounded-control px-3 py-2 text-xs font-medium"
          >
            割り当てる
          </a>
        </div>
      )}

      {!selectedAccountId ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
          サイドバーでアカウントを選択してください
        </div>
      ) : loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
          読み込み中…
        </div>
      ) : staff.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
          先にスタッフを登録してください
        </div>
      ) : (
        <div
          data-design="Table"
          className="bg-canvas rounded-card border-hairline overflow-hidden border"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-canvas-sunken border-hairline border-b">
                  <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold">
                    メニュー
                  </th>
                  <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold">
                    標準の設定
                  </th>
                  {staff.map((s) => (
                    <th
                      key={s.id}
                      className="text-ink-faint px-4 py-3 text-left text-xs font-semibold"
                    >
                      {s.display_name || s.name}
                      {s.is_designation_optional === 1 && (
                        <span className="text-ink-faint block text-[10px] font-normal">
                          指名なし
                        </span>
                      )}
                    </th>
                  ))}
                  <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold">
                    提供できる数
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {menus.map((m) => (
                  <tr
                    key={m.id}
                    id={`menu-${m.id}`}
                    className={focusMenuId === m.id ? 'bg-accent-soft' : undefined}
                  >
                    <td className="px-4 py-3 align-top text-sm">
                      <p className="text-ink font-medium">{m.name}</p>
                      <p className="mt-1">
                        {m.is_active ? (
                          <span className="bg-success-bg text-success rounded-pill px-2 py-0.5 text-[10px]">
                            公開中
                          </span>
                        ) : (
                          <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-[10px]">
                            非公開
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="text-ink-secondary px-4 py-3 align-top text-xs tabular-nums">
                      {m.duration_minutes} 分
                      <br />¥{m.base_price.toLocaleString()}
                    </td>
                    {staff.map((s) => {
                      const row = grid[s.id]?.[m.id]
                      const offered = Boolean(row?.is_offered)
                      const overridden =
                        row?.override_duration_minutes != null || row?.override_price != null
                      return (
                        <td key={s.id} className="px-4 py-3 align-top">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={offered}
                              onChange={(e) =>
                                update(s.id, m.id, { is_offered: e.target.checked ? 1 : 0 })
                              }
                              className="accent-accent"
                            />
                            <span className={offered ? 'text-ink' : 'text-ink-faint'}>
                              {offered ? '対応できる' : '対応しない'}
                            </span>
                          </label>
                          {offered ? (
                            <>
                              <div className="mt-1.5 flex items-center gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  value={row?.override_duration_minutes ?? ''}
                                  onChange={(e) =>
                                    update(s.id, m.id, {
                                      override_duration_minutes:
                                        e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  placeholder={String(m.duration_minutes)}
                                  aria-label={`${s.display_name || s.name} の ${m.name} の所要時間`}
                                  className="border-hairline rounded-control w-14 border px-1.5 py-1 text-xs tabular-nums"
                                />
                                <span className="text-ink-faint text-[10px]">分</span>
                                <span className="text-ink-faint text-[10px]">・¥</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={row?.override_price ?? ''}
                                  onChange={(e) =>
                                    update(s.id, m.id, {
                                      override_price:
                                        e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  placeholder={String(m.base_price)}
                                  aria-label={`${s.display_name || s.name} の ${m.name} の料金`}
                                  className="border-hairline rounded-control w-20 border px-1.5 py-1 text-xs tabular-nums"
                                />
                              </div>
                              {overridden && (
                                <span className="bg-warning-bg text-warning rounded-pill mt-1 inline-block px-1.5 py-0.5 text-[10px]">
                                  上書きあり
                                </span>
                              )}
                            </>
                          ) : (
                            <p className="text-ink-faint mt-1.5 text-xs">—</p>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-4 py-3 text-right align-top text-sm tabular-nums">
                      <span
                        className={
                          (offeredCounts.get(m.id) ?? 0) === 0 ? 'text-warning' : 'text-ink'
                        }
                      >
                        {offeredCounts.get(m.id) ?? 0} 人
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-ink-faint text-xs">全 {menus.length} 件</span>
        <span className="text-ink-faint text-xs">
          チェックを外すと、そのスタッフはこのメニューの予約枠に出なくなります。
        </span>
      </div>

      <div data-design="note" className="bg-canvas-sunken rounded-card mt-3 p-4">
        <p className="text-ink text-sm font-medium">この画面でできること</p>
        <ul className="text-ink-secondary mt-2 space-y-1.5 text-xs leading-5">
          <li>
            ・上書きした料金・所要時間は、そのスタッフを選んだときだけ適用されます。空欄なら標準の設定を使います
          </li>
          <li>・担当が0人のメニューは、公開していても予約フォームに枠が出ません</li>
          <li>
            ・旧デザインでは「メニュー」と「スタッフ」が別ページで、割り当ての全体像が見えませんでした。ここでは1画面で見比べられます
          </li>
        </ul>
      </div>
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
      <p className="text-ink-faint mt-1 truncate text-xs" title={detail}>
        {detail}
      </p>
    </div>
  )
}

// useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
export default function MenuStaffMatrix() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <MenuStaffMatrixContent />
    </Suspense>
  )
}
