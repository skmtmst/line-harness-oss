'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { bookingApi, type BookingMenu, type BookingStaff, type StaffMenuMatrix } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Notice from '@/components/shared/notice'
import { isForbiddenOrRateLimited, loadFailureCopy, loadFailureNotice } from '@/components/shared/api-error-message'
import ListState from '@/components/shared/list-state'
import { describeSaveFailure } from '@/lib/api'
import { canEditFeature } from '@/lib/staff-capability'
import { useAdminTheme } from '@/lib/use-admin-theme'
import AssignMatrixV8 from './assign-v8'
import StatusBadge from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { notifyToast } from '@/components/shared/toast'
/* R309: 標準の料金は一覧・スタッフ追加の候補と同じ共通表示にする。 */
import { menuPriceLabel } from '../../lib/menu-price'

/**
 * メニューごとの担当スタッフ（設計 V2 8-2-4 / node B88kuI）。
 *
 * 以前はメニューを1つ指定しないと開けず、そのメニューの担当だけを
 * 編集する画面だった。設計の狙いは逆で、「どのメニューに担当が
 * いないのか」を1画面で見つけること。担当が0人のメニューは公開して
 * いても予約フォームに枠が出ないのに、それに気づく場所が無かった。
 *
 * staff_menus は staff_id × menu_id が主キー。保存は一括口
 * （PUT /api/booking/admin/staff-menus）に全スタッフ分を1回で送り、
 * 途中失敗で半分だけ残る状態を作らない。
 */
function MenuStaffMatrixContent() {
  usePageTitle('予約設定')
  const sp = useSearchParams()
  /** 一覧から「スタッフ割当」で来たときに、その行を目立たせる。 */
  const focusMenuId = sp.get('menu_id') ?? ''
  const { selectedAccountId } = useAccount()
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [staff, setStaff] = useState<BookingStaff[]>([])
  /** staffId → menuId → 設定。 */
  const [grid, setGrid] = useState<Record<string, Record<string, StaffMenuMatrix>>>({})
  /*
   * #975 U075: 「変えていない」「変えたが未保存」「保存済み」「失敗」を
   * 区別するため、最後に読み込み・保存した時点の表を控えておく。
   */
  const [savedGrid, setSavedGrid] = useState<Record<string, Record<string, StaffMenuMatrix>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** R537: 捕まえた読み込み失敗。403・429の出し分けと再試行の有無に使う。 */
  const [loadError, setLoadError] = useState<unknown>(null)
  /*
   * R538: 担当割当の変更は '/booking/menus' の実効permission。閲覧のみの
   * 担当者は読めるが変えられない。Worker の一括PUTも同じ鍵で守られている。
   */
  const [canEditMenus] = useState(() =>
    typeof window === 'undefined' ? true : canEditFeature('/booking/menus'))
  /*
   * R538: スタッフ追加の行き先は予約設定の権限。鍵の無い人には入口を
   * 出さず、行き先の画面で権限不足にぶつかる手間を省く。
   */
  const [canAddStaff] = useState(() =>
    typeof window === 'undefined' ? true : canEditFeature('booking.settings'))


  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    setLoadError(null)
    // 前アカウントの内容が残ったまま保存すると、別アカウントの設定を
    // 上書きする事故になる。先に空にする。
    setMenus([])
    setStaff([])
    setGrid({})
    setSavedGrid(null)
    try {
      const [menusRes, staffRes] = await Promise.all([
        bookingApi.listMenus(selectedAccountId),
        bookingApi.listStaff(selectedAccountId),
      ])
      setMenus(menusRes.menus)
      setStaff(staffRes.staff)

      /*
       * #1060: スタッフ数ぶん往復していた表の読み込みを1要求の一括口へ。
       * 一括口をまだ持たない Worker では 404 で落ちるので、そのときだけ
       * 従来のスタッフごと取得へ退く（段階配備の互換）。
       */
      const matrices = new Map<string, StaffMenuMatrix[]>()
      try {
        const bulk = await bookingApi.listStaffMenusBulk(selectedAccountId)
        for (const entry of bulk.staff) matrices.set(entry.staff_id, entry.matrix)
      } catch {
        await Promise.all(
          staffRes.staff.map(async (s) => {
            const r = await bookingApi.getStaffMenus(selectedAccountId, s.id)
            matrices.set(s.id, r.matrix)
          }),
        )
      }
      const next: Record<string, Record<string, StaffMenuMatrix>> = {}
      for (const s of staffRes.staff) {
        const matrix = matrices.get(s.id) ?? []
        const byMenu: Record<string, StaffMenuMatrix> = {}
        for (const m of menusRes.menus) {
          byMenu[m.id] = matrix.find((x) => x.menu_id === m.id) ?? {
            menu_id: m.id,
            name: m.name,
            is_offered: 0,
            override_duration_minutes: null,
            override_price: null,
          }
        }
        next[s.id] = byMenu
      }
      setGrid(next)
      setSavedGrid(next)
    } catch (e) {
      // m23m: 403・429は共通の1枚（権限の案内・待ち案内）へ切り替える。
      // それ以外は画面の文のまま。生の `API error: NNN` は出さない。
      // R537: 失敗をそのまま残し、再試行の有無と空状態の出し分けに使う。
      setLoadError(e)
      if (isForbiddenOrRateLimited(e)) {
        setError(loadFailureNotice(e, '担当スタッフの割り当て'))
      } else {
        const message = e instanceof Error ? e.message : ''
        setError(message && !/^API error: /.test(message) ? message : '読み込めませんでした。画面を再読み込みして確認してください。')
      }
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
      await bookingApi.putStaffMenusBulk(
        selectedAccountId,
        staff.map((s) => ({
          staff_id: s.id,
          menus: menus.map((m) => {
            const row = grid[s.id]?.[m.id]
            return {
              menu_id: m.id,
              is_offered: Boolean(row?.is_offered),
              override_duration_minutes: row?.override_duration_minutes ?? null,
              override_price: row?.override_price ?? null,
            }
          }),
        })),
      )
      /* #975 U075: 保存できた時点の表を新しい基準にする。以後の差分が未保存。 */
      setSavedGrid(grid)
      notifyToast('保存しました')
    } catch (e) {
      // 全件不適用のはずだが、画面の表示とDBの状態が食い違う可能性を
      // 残さないため再読み込みを促す。
      // m23m: 生の内部文は出さず、共通の保存失敗文にする。
      setError(
        `${describeSaveFailure(e)}（保存は取り消されました。画面を再読み込みして最新の状態を確認してください）`,
      )
    } finally {
      setSaving(false)
    }
  }

  /*
   * R308: 「割ってある人数」と「いま受付できる人数」を分ける。
   * 非公開（is_active=0）の担当は割当としては数えるが、受付できる数には
   * 入れない。受付できない担当だけを見て「足りている」と見逃さないため。
   */
  /** メニューID → 割ってある人数（非公開の担当を含む）。 */
  const assignedCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of menus) {
      let n = 0
      for (const s of staff) if (grid[s.id]?.[m.id]?.is_offered) n += 1
      counts.set(m.id, n)
    }
    return counts
  }, [menus, staff, grid])
  /** メニューID → いま受付できる人数（稼働中の担当だけ）。 */
  const availableCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of menus) {
      let n = 0
      for (const s of staff) if (s.is_active && grid[s.id]?.[m.id]?.is_offered) n += 1
      counts.set(m.id, n)
    }
    return counts
  }, [menus, staff, grid])

  /** 受付できる担当がいないメニュー。誰も割っていない場合と、非公開しかいない場合。 */
  const orphans = menus.filter((m) => (availableCounts.get(m.id) ?? 0) === 0)
  /** 誰にも割っていないメニュー。 */
  const unassigned = orphans.filter((m) => (assignedCounts.get(m.id) ?? 0) === 0)
  /** 割ってはあるが非公開の担当しかいないメニュー。 */
  const inactiveOnly = orphans.filter((m) => (assignedCounts.get(m.id) ?? 0) > 0)
  const assigned = [...assignedCounts.values()].reduce((a, b) => a + b, 0)
  const pairs = menus.length * staff.length

  /*
   * #975 U075: 読み込み直後と同じなら保存は要らない。差分があるときだけ
   * 「未保存の変更があります」と出し、保存ボタンを押せるようにする。
   */
  const dirty = useMemo(
    () => savedGrid !== null && JSON.stringify(grid) !== JSON.stringify(savedGrid),
    [grid, savedGrid],
  )
  /*
   * 未保存の割り当て変更がある間、画面を離れる操作を止める共通の番兵（DETAIL-04系）。
   * 左メニュー・画面内リンク・戻る操作・再読込を同じ確認対話へ寄せる。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })
  /*
   * R537: 読み込みに失敗して表が無いときの出し分け。失敗を「未登録」と
   * 混ぜない。403は押しても直らないので再試行なし、429と通信失敗は
   * 同じ画面から取り直せる。
   */
  const loadFailed = error !== null && savedGrid === null
  const loadFailure = loadError ? loadFailureCopy(loadError, '担当スタッフの割り当て') : null
  const saveStateLabel = loading
    ? '読み込み中…'
    : error
      ? savedGrid
        ? '保存できませんでした。画面を再読み込みして確認してください。'
        : '読み込めませんでした。画面を再読み込みして確認してください。'
      : !savedGrid
        ? ''
        : dirty
          ? '未保存の変更があります'
          : '変更はありません'

  return (
    <div className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <nav data-design="Crumb" className="text-ink-faint text-xs">
        <Link href="/booking/menus" className="hover:underline">
          予約設定
        </Link>
        <span className="mx-1.5">/</span>
        <span>担当スタッフ</span>
      </nav>

      <div data-design="Actions" className="flex flex-wrap items-center gap-2">
          {/*
            * R538: スタッフ追加の行き先は予約設定の権限。鍵の無い人には押せない
            * 姿で置き、理由を行き先ではなくこの場で言う。
            */}
          {canAddStaff ? (
            <Button variant="secondary" className="text-ink-secondary px-3 py-2 h-auto whitespace-normal" href="/booking/staff/new">
              スタッフを追加する
            </Button>
          ) : (
            <span
              aria-disabled="true"
              title="予約設定の変更権限がありません"
              className="border-hairline text-ink-faint rounded-control cursor-not-allowed border px-3 py-2 text-sm opacity-50"
            >
              スタッフを追加する
            </span>
          )}
          {/*
            * #975 U075: 差分がないときは保存の押し口自体を出さず、中立の札で
            * 状態だけ言う。押せない緑の塗りボタンは主役に見えてしまう。
            * error が出ている間は押させない。読み込みに失敗した状態で
            * 保存すると、空の割り当てで上書きしてしまう。
            */}
          {/*
            * R538: 閲覧のみの担当者には保存の押し口を出さない。入力欄も
            * 押せないので dirty にはならないが、ここでも鍵を見る。
            */}
          {canEditMenus && (saving || dirty) ? (
            <Button
              variant="primary"
              onClick={saveAll}
              disabled={saving || !selectedAccountId || loading || Boolean(error) || !dirty} busy={saving}>保存する
            </Button>
          ) : (
            <StatusBadge tone="neutral" size="compact">変更なし</StatusBadge>
          )}
          {/* #975 U075: 未保存・保存済み・失敗を色だけでなく文字で出す。 */}
          <span className="text-ink-faint self-center text-xs" role="status" aria-live="polite">
            {saveStateLabel}
          </span>
          {!canEditMenus && (
            <span className="text-ink-faint self-center text-xs">
              担当割当の変更権限がありません。変更は予約メニューの権限を持つログインユーザーが行ってください。
            </span>
          )}
      </div>

      {/*
        * R537: 読み込みに失敗したときは0ではなく「—」。取れていない数を
        * 0件・0人と出すと、未登録と誤読される。
        */}
      <div data-design="KPIs" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          title="メニュー"
          value={loadFailed ? '—' : String(menus.length)}
          unit="件"
          detail={loadFailed ? '—' : `公開中 ${menus.filter((m) => m.is_active).length}`}
        />
        <Kpi
          title="担当スタッフ"
          value={loadFailed ? '—' : String(staff.length)}
          unit="人"
          detail={loadFailed ? '—' : `稼働中 ${staff.filter((s) => s.is_active).length}`}
        />
        <Kpi
          title="割り当て済み"
          value={loadFailed ? '—' : String(assigned)}
          unit="組"
          detail={loadFailed ? '—' : `全${pairs}組のうち`}
        />
        {/*
         * R308: 非公開しかいない場合もここに入るため、「誰も担当していない」
         * では言葉がずれる。受付できる担当がいない、と言い換える。
         */}
        <Kpi
          title="受付できる担当がいない"
          value={loadFailed ? '—' : String(orphans.length)}
          unit="件"
          detail={loadFailed ? '—' : orphans.length === 0 ? 'なし' : orphans.map((m) => m.name).join('・')}
        />
      </div>

      {/*
        * R537: 読み込み自体に失敗したときは、下の表の場所に共通の失敗の1枚を
        * 出すので、ここでは帯を重ねない。保存の失敗（表あり）のときだけ帯を出す。
        */}
      {error && !loadFailed && (
        <Notice tone="danger" message={error} onClose={() => setError(null)} className="mb-4" />
      )}

      {orphans.length > 0 && (
        <div
          data-design="Warn"
          className="bg-warning-bg rounded-card flex flex-wrap items-center justify-between gap-2 p-4"
        >
          <div>
            {unassigned.length > 0 && (
              <p className="text-warning text-sm font-medium">
                「{unassigned.map((m) => m.name).join('」「')}」は担当できるスタッフがいません。
              </p>
            )}
            {inactiveOnly.length > 0 && (
              <p className="text-warning text-sm font-medium">
                「{inactiveOnly.map((m) => m.name).join('」「')}」は非公開の担当しかいません。
              </p>
            )}
            <p className="text-ink-secondary mt-0.5 text-xs">
              このままでは予約フォームに枠が出ません。
            </p>
          </div>
          <Button
            href={`#menu-${orphans[0].id}`}
            variant="secondary"
            size="field"
          >
            割り当てる
          </Button>
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
      ) : loadFailed ? (
        // R537: 取得の失敗は「未登録」と別の1枚にする。共通の失敗表示が
        // 403（再試行なし）と429・通信失敗（再試行あり）を言い分ける。
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState
            kind="error"
            title={loadFailure?.title}
            description={loadFailure?.description}
            error={loadError ?? undefined}
            onRetry={loadFailure?.retryable ? () => void load() : undefined}
          />
        </div>
      ) : staff.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
          先にスタッフを登録してください
        </div>
      ) : (
        <DataTable data-design="Table">
              <thead>
                <TableHeadRow>
                  <Th>
                    メニュー
                  </Th>
                  <Th>
                    標準の設定
                  </Th>
                  {staff.map((s) => (
                    <Th
                      key={s.id}
                    >
                      {s.display_name || s.name}
                      {/* R308: 列見出しで非公開と分かるようにする。 */}
                      {!s.is_active && (
                        <span className="text-ink-faint text-micro block font-normal">
                          非公開
                        </span>
                      )}
                      {s.is_designation_optional === 1 && (
                        <span className="text-ink-faint block text-nano font-normal">
                          指名なし
                        </span>
                      )}
                    </Th>
                  ))}
                  <Th align="right">
                    提供できる数
                  </Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {menus.map((m) => (
                  <Tr
                    key={m.id}
                    id={`menu-${m.id}`}
                    className={focusMenuId === m.id ? 'bg-accent-soft' : undefined}
                  >
                    <Td className="align-top">
                      <p className="text-ink font-medium">{m.name}</p>
                      <p className="mt-1">
                        {m.is_active ? (
                          <span className="bg-success-bg text-success rounded-pill px-2 py-0.5 text-nano">
                            公開中
                          </span>
                        ) : (
                          <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-nano">
                            非公開
                          </span>
                        )}
                      </p>
                    </Td>
                    <Td className="text-ink-secondary align-top text-xs tabular-nums">
                      {m.duration_minutes} 分
                      <br />{menuPriceLabel(m)}
                    </Td>
                    {staff.map((s) => {
                      const row = grid[s.id]?.[m.id]
                      const offered = Boolean(row?.is_offered)
                      const overridden =
                        row?.override_duration_minutes != null || row?.override_price != null
                      return (
                        <Td key={s.id} className="align-top">
                          <Checkbox
                            checked={offered}
                            disabled={!canEditMenus}
                            onCheckedChange={(checked) =>
                              update(s.id, m.id, { is_offered: checked ? 1 : 0 })
                            }
                          >{offered ? '対応できる' : '対応しない'}</Checkbox>
                          {offered ? (
                            <>
                              <div className="mt-1.5 flex items-center gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  disabled={!canEditMenus}
                                  value={row?.override_duration_minutes ?? ''}
                                  onChange={(e) =>
                                    update(s.id, m.id, {
                                      override_duration_minutes:
                                        e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  placeholder={String(m.duration_minutes)}
                                  aria-label={`${s.display_name || s.name} の ${m.name} の所要時間`}
                                  className="border-hairline rounded-control h-8 w-14 border px-1.5 text-xs tabular-nums"
                                />
                                <span className="text-ink-faint text-nano">分</span>
                                <span className="text-ink-faint text-nano">・¥</span>
                                <input
                                  type="number"
                                  min={0}
                                  disabled={!canEditMenus}
                                  value={row?.override_price ?? ''}
                                  onChange={(e) =>
                                    update(s.id, m.id, {
                                      override_price:
                                        e.target.value === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  placeholder={String(m.base_price)}
                                  aria-label={`${s.display_name || s.name} の ${m.name} の料金`}
                                  className="border-hairline rounded-control h-8 w-20 border px-1.5 text-xs tabular-nums"
                                />
                              </div>
                              {overridden && (
                                <span className="bg-warning-bg text-warning rounded-pill mt-1 inline-block px-1.5 py-0.5 text-nano">
                                  上書きあり
                                </span>
                              )}
                            </>
                          ) : (
                            <p className="text-ink-faint mt-1.5 text-xs">—</p>
                          )}
                        </Td>
                      )
                    })}
                    <Td align="right" className="align-top text-sm tabular-nums">
                      {/*
                       * R308: 「提供できる数」は稼働中の担当だけ。非公開の割当が
                       * あるときは割当数も添えて、両者を区別できるようにする。
                       */}
                      <span
                        className={
                          (availableCounts.get(m.id) ?? 0) === 0 ? 'text-warning' : 'text-ink'
                        }
                      >
                        {availableCounts.get(m.id) ?? 0} 人
                      </span>
                      {(assignedCounts.get(m.id) ?? 0) > (availableCounts.get(m.id) ?? 0) && (
                        <span className="text-ink-faint text-micro block">
                          割当{assignedCounts.get(m.id)}（非公開{(assignedCounts.get(m.id) ?? 0) - (availableCounts.get(m.id) ?? 0)}）
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
        </DataTable>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-ink-faint text-xs">{loadFailed ? '—' : `全 ${menus.length} 件`}</span>
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

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="担当割り当てへの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
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
      <MenuStaffMatrixEntry />
    </Suspense>
  )
}

/**
 * 見た目テーマが v8 のときは新しい「担当メニューをまとめて決める」
 * （assign-v8.tsx、板 ooufy）、v7 では従来の割当表をそのまま出す。
 */
function MenuStaffMatrixEntry() {
  const theme = useAdminTheme()
  if (theme === 'v8') return <AssignMatrixV8 />
  return <MenuStaffMatrixContent />
}
