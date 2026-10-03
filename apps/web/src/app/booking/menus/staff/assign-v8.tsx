'use client'

/*
 * ★V8「担当メニューをまとめて決める」（板 ooufy）。
 *
 * 白い板1枚：頭（←予約へ・題・未保存の印・5タブ）→ 中身（左＝メニュー×
 * スタッフの升目表と升の中身を変える段、右＝空きの欄）→ 書きかけがある間だけ
 * 下に保存帯（キャンセル・保存）。タブは押すと予約設定のそのタブへ移る
 * （未保存なら共通の離脱確認が出る）。
 *
 * 升の緑の升を押すと「受ける／受けない」が切り替わり、その升の時間と料金を
 * 変える段が下に出る。担当が0人のメニューは黄色い帯で知らせる。
 * 動き（一括保存・未保存の離脱確認・権限での閲覧のみ化・失敗時の扱い）は
 * v7 の /booking/menus/staff と同じ。テーマが v7 のときはこのファイルは
 * 読まれず、従来の見た目が出る。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import { Tabs } from '@/components/shared/tabs'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { notifyToast } from '@/components/shared/toast'
import { isForbiddenOrRateLimited, loadFailureCopy } from '@/components/shared/api-error-message'
import { useAccount } from '@/contexts/account-context'
import { canEditFeature } from '@/lib/staff-capability'
import { describeSaveFailure } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import {
  bookingApi,
  type BookingMenu,
  type BookingStaff,
  type StaffMenuMatrix,
} from '@/lib/api'
import { menuPriceLabel } from '../../lib/menu-price'
import shell from '../settings-v8.module.css'
import styles from './assign-v8.module.css'

/* 予約設定の5タブ（settings-v8.tsx の V8_TABS と同じ並び）。 */
const V8_TABS = [
  { key: 'menus', label: 'メニュー' },
  { key: 'hours', label: '受付枠' },
  { key: 'holidays', label: '休業日' },
  { key: 'rules', label: '予約のルール' },
  { key: 'staff', label: '担当スタッフ' },
] as const

type SelectedCell = { staffId: string; menuId: string }

function staffLabel(person: BookingStaff): string {
  return person.display_name || person.name
}

/** 升目表の読み込み待ちの骨組み（見出し行＋5行・メニュー列＋担当3列の形）。 */
function MatrixSkeleton() {
  return (
    <section className={shell.section} data-design="Table" aria-hidden="true">
      <div className={shell.sectionHead}>
        <Skeleton width={200} height={18} />
      </div>
      <div className={styles.matrixWrap}>
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th className={styles.matrixMenuHead} scope="col"><Skeleton width={80} height={14} /></th>
              {[0, 1, 2].map((i) => (
                <th key={i} className={styles.matrixStaffHead} scope="col"><Skeleton width={64} height={14} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4].map((row) => (
              <tr key={row}>
                <th scope="row" className={styles.matrixMenuCell}><Skeleton width="80%" height={15} /></th>
                {[0, 1, 2].map((col) => (
                  <td key={col} className={styles.matrixCell}><Skeleton width={18} height={18} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function AssignMatrixV8() {
  usePageTitle('予約設定')
  const sp = useSearchParams()
  /** 一覧から「スタッフ割当」で来たときに、その行を目立たせる。 */
  const focusMenuId = sp.get('menu_id') ?? ''
  const { selectedAccountId } = useAccount()
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [staff, setStaff] = useState<BookingStaff[]>([])
  /** staffId → menuId → 設定。 */
  const [grid, setGrid] = useState<Record<string, Record<string, StaffMenuMatrix>>>({})
  /* 保存済みの表を控えておき、差分が未保存と分かるようにする（v7 #975 U075 と同じ）。 */
  const [savedGrid, setSavedGrid] = useState<Record<string, Record<string, StaffMenuMatrix>> | null>(null)
  /** 「元に戻す」が新しい書きかけを消さないための、今の表の写し。 */
  const gridRef = useRef(grid)
  gridRef.current = grid
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  /** 保存が終わった直後の1.2秒だけ、保存ボタンに完了（✓）を出す。 */
  const [saveDone, setSaveDone] = useState(false)
  const saveDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (saveDoneTimerRef.current !== null) clearTimeout(saveDoneTimerRef.current)
  }, [])
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  /** 升を押したあと、時間・料金を変える段が対象にする升。 */
  const [selected, setSelected] = useState<SelectedCell | null>(null)
  const [canEditMenus] = useState(() =>
    typeof window === 'undefined' ? true : canEditFeature('/booking/menus'))

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    setLoadError(null)
    setMenus([])
    setStaff([])
    setGrid({})
    setSavedGrid(null)
    setSelected(null)
    try {
      const [menusRes, staffRes] = await Promise.all([
        bookingApi.listMenus(selectedAccountId),
        bookingApi.listStaff(selectedAccountId),
      ])
      setMenus(menusRes.menus)
      setStaff(staffRes.staff)

      /* #1060 と同じ：一括口が無い Worker ではスタッフごとの取得へ退く。 */
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
      setLoadError(e)
      if (isForbiddenOrRateLimited(e)) {
        setError(loadFailureCopy(e, '担当スタッフの割り当て').description ?? '読み込めませんでした。')
      } else {
        const message = e instanceof Error ? e.message : ''
        setError(message && !/^API error: /.test(message) ? message : '読み込めませんでした。画面を再読み込みして確認してください。')
      }
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  function update(staffId: string, menuId: string, patch: Partial<StaffMenuMatrix>) {
    setGrid((cur) => ({
      ...cur,
      [staffId]: { ...cur[staffId], [menuId]: { ...cur[staffId][menuId], ...patch } },
    }))
  }

  /** 表1枚ぶんを一括の口へ流す。元に戻すときも同じ口を使う。 */
  async function putGrid(next: Record<string, Record<string, StaffMenuMatrix>>) {
    await bookingApi.putStaffMenusBulk(
      selectedAccountId!,
      staff.map((s) => ({
        staff_id: s.id,
        menus: menus.map((m) => {
          const row = next[s.id]?.[m.id]
          return {
            menu_id: m.id,
            is_offered: Boolean(row?.is_offered),
            override_duration_minutes: row?.override_duration_minutes ?? null,
            override_price: row?.override_price ?? null,
          }
        }),
      })),
    )
  }

  function flashDone() {
    setSaveDone(true)
    if (saveDoneTimerRef.current !== null) clearTimeout(saveDoneTimerRef.current)
    saveDoneTimerRef.current = setTimeout(() => setSaveDone(false), 1600)
  }

  async function saveAll() {
    if (!selectedAccountId) return
    const before = savedGrid ?? grid
    setSaving(true)
    setSaveDone(false)
    setError(null)
    try {
      await putGrid(grid)
      setSavedGrid(grid)
      flashDone()
      notifyToast('保存しました', {
        actionLabel: '元に戻す',
        onAction: () => void undoSave(before, grid),
      })
    } catch (e) {
      setError(
        `${describeSaveFailure(e)}（保存は取り消されました。画面を再読み込みして最新の状態を確認してください）`,
      )
    } finally {
      setSaving(false)
    }
  }

  /** 保存直後の「元に戻す」：保存前の表を同じ一括の口で入れ直す。 */
  async function undoSave(before: Record<string, Record<string, StaffMenuMatrix>>, after: Record<string, Record<string, StaffMenuMatrix>>) {
    if (!selectedAccountId) return
    if (JSON.stringify(gridRef.current) !== JSON.stringify(after)) {
      notifyToast('ほかの変更が入ったため、元に戻せませんでした')
      return
    }
    setSaving(true)
    setSaveDone(false)
    setError(null)
    try {
      await putGrid(before)
      setGrid(before)
      setSavedGrid(before)
      flashDone()
      notifyToast('元に戻しました')
    } catch (e) {
      setError(
        `${describeSaveFailure(e)}（元に戻せませんでした。画面を再読み込みして最新の状態を確認してください）`,
      )
    } finally {
      setSaving(false)
    }
  }

  /* 「いま受付できる人数」（稼働中の担当だけ）と「割ってある人数」を分ける（v7 R308 と同じ）。 */
  const assignedCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of menus) {
      let n = 0
      for (const s of staff) if (grid[s.id]?.[m.id]?.is_offered) n += 1
      counts.set(m.id, n)
    }
    return counts
  }, [menus, staff, grid])
  const availableCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of menus) {
      let n = 0
      for (const s of staff) if (s.is_active && grid[s.id]?.[m.id]?.is_offered) n += 1
      counts.set(m.id, n)
    }
    return counts
  }, [menus, staff, grid])

  /** 受付できる担当がいないメニュー（誰も割っていない／止めている担当だけ）。 */
  const orphans = menus.filter((m) => (availableCounts.get(m.id) ?? 0) === 0)
  const unassigned = orphans.filter((m) => (assignedCounts.get(m.id) ?? 0) === 0)
  const inactiveOnly = orphans.filter((m) => (assignedCounts.get(m.id) ?? 0) > 0)

  const dirty = useMemo(
    () => savedGrid !== null && JSON.stringify(grid) !== JSON.stringify(savedGrid),
    [grid, savedGrid],
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const loadFailed = error !== null && savedGrid === null
  const loadFailure = loadError ? loadFailureCopy(loadError, '担当スタッフの割り当て') : null

  /* 升の中身を変える段が対象にしている升。 */
  const selectedStaff = selected ? staff.find((s) => s.id === selected.staffId) ?? null : null
  const selectedMenu = selected ? menus.find((m) => m.id === selected.menuId) ?? null : null
  const selectedRow = selected ? grid[selected.staffId]?.[selected.menuId] ?? null : null
  const selectedOverridden =
    Boolean(selectedRow) &&
    (selectedRow!.override_duration_minutes != null || selectedRow!.override_price != null)

  return (
    <div className={shell.shell} data-design-node="ooufy">
      <header className={shell.boardHead} data-design="Head">
        <Link href="/booking/bookings" className={shell.backLink}>← 予約へ</Link>
        <h1 className={shell.headTitle}>担当メニューをまとめて決める</h1>
        <p className={shell.headNote} role="status" aria-live="polite">
          {dirty ? '未保存の変更があります' : 'メニューごとに、予約を受けられるスタッフを決めます'}
        </p>
        <div data-design="Tabs">
          <Tabs
            label="予約設定のタブ"
            items={V8_TABS.map((item) => ({
              label: item.label,
              current: item.key === 'staff',
              href: item.key === 'staff'
                ? undefined
                : item.key === 'menus'
                  ? '/booking/menus'
                  : `/booking/menus?tab=${item.key}`,
            }))}
          />
        </div>
      </header>

      <div className={shell.body} data-design="Body">
        <div className={shell.main}>
          {!selectedAccountId ? (
            <div className={shell.stateCard}>
              <p className={shell.stateTitle}>LINEアカウントを選んでください</p>
              <p className={shell.stateDesc}>共通メニューで、予約設定を開くLINEアカウントを選んでください。</p>
            </div>
          ) : loading ? (
            <div aria-busy="true">
              <span className="sr-only" role="status">メニューと担当スタッフを読み込んでいます</span>
              <DelayedSkeleton loading skeleton={<MatrixSkeleton />} />
            </div>
          ) : loadFailed ? (
            <div className={shell.stateCard}>
              <p className={shell.stateTitle}>{loadFailure?.title ?? '読み込めませんでした'}</p>
              <p className={shell.stateDesc}>{loadFailure?.description ?? error}</p>
              {loadFailure?.retryable ? (
                <div className={shell.stateActions}>
                  <Button onClick={() => void load()}>読み直す</Button>
                </div>
              ) : null}
            </div>
          ) : staff.length === 0 ? (
            <div className={shell.stateCard}>
              <p className={shell.stateTitle}>スタッフはまだいません</p>
              <p className={shell.stateDesc}>先に担当スタッフを登録してください。</p>
              <div className={shell.stateActions}>
                <Button href="/booking/menus?tab=staff">担当スタッフを開く</Button>
              </div>
            </div>
          ) : (
            <>
              {error && !loadFailed ? (
                <p className={shell.warnBand} role="alert">{error}</p>
              ) : null}

              <section className={shell.section} data-design="Table">
                <div className={shell.sectionHead}>
                  <h2 className={shell.sectionTitle}>だれがどのメニューを受けるか</h2>
                  <p className={shell.sectionDesc}>担当が0人のメニューは、出していてもお客さまの画面に枠が出ません</p>
                </div>

                <div className={styles.matrixWrap}>

                  <table className={styles.matrix}>
                    <thead>
                      <tr>
                        <th className={styles.matrixMenuHead} scope="col">メニュー</th>
                        {staff.map((s) => (
                          <th key={s.id} className={styles.matrixStaffHead} scope="col">
                            <span className={styles.matrixStaffName} title={staffLabel(s)}>
                              {staffLabel(s)}
                            </span>
                            {!s.is_active ? <span className={styles.matrixStaffOff}>止めている</span> : null}
                            {s.is_designation_optional === 1 ? <span className={styles.matrixStaffOff}>指名なし</span> : null}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {menus.map((m) => (
                        <tr
                          key={m.id}
                          id={`menu-${m.id}`}
                          className={focusMenuId === m.id ? styles.matrixRowFocus : undefined}
                        >
                          <th scope="row" className={styles.matrixMenuCell}>
                            <span className={styles.matrixMenuName} title={m.name}>{m.name}</span>
                          </th>
                          {staff.map((s) => {
                            const row = grid[s.id]?.[m.id]
                            const offered = Boolean(row?.is_offered)
                            const overridden =
                              row?.override_duration_minutes != null || row?.override_price != null
                            const isSelected = selected?.staffId === s.id && selected?.menuId === m.id
                            return (
                              <td
                                key={s.id}
                                className={styles.matrixCell}
                                data-selected={isSelected || undefined}
                                onClick={() => setSelected({ staffId: s.id, menuId: m.id })}
                                onFocusCapture={() => setSelected({ staffId: s.id, menuId: m.id })}
                              >
                                <span className={styles.cellBox}>
                                  <Checkbox
                                    checked={offered}
                                    disabled={!canEditMenus}
                                    onCheckedChange={(checked) =>
                                      update(s.id, m.id, { is_offered: checked ? 1 : 0 })
                                    }
                                    aria-label={`${m.name} を ${staffLabel(s)} が受ける`}
                                  />
                                  {overridden ? (
                                    <span className={styles.ovrDot} title="時間・料金をこのスタッフ用に変えています" />
                                  ) : null}
                                </span>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedStaff && selectedMenu && selectedRow ? (
                  <div className={styles.overrideCard} data-design="Override">
                    <h3 className={styles.overrideTitle}>
                      升を押したとき（{staffLabel(selectedStaff)} × {selectedMenu.name}）
                    </h3>
                  <div className={styles.overrideFields}>
                    <label className={styles.field}>
                      <span className={styles.label}>このスタッフの所要時間</span>
                      <span className={styles.unitField}>
                        <input
                          type="number"
                          min={1}
                          disabled={!canEditMenus || !selectedRow.is_offered}
                          value={selectedRow.override_duration_minutes ?? ''}
                          onChange={(e) =>
                            update(selectedStaff.id, selectedMenu.id, {
                              override_duration_minutes:
                                e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          placeholder={String(selectedMenu.duration_minutes)}
                          aria-label={`${staffLabel(selectedStaff)} の ${selectedMenu.name} の所要時間`}
                        />
                        <span className={styles.unitSuffix}>分（メニューは {selectedMenu.duration_minutes} 分）</span>
                      </span>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>このスタッフの料金</span>
                      <span className={styles.unitField}>
                        <span className={styles.unitSuffix}>¥</span>
                        <input
                          type="number"
                          min={0}
                          disabled={!canEditMenus || !selectedRow.is_offered}
                          value={selectedRow.override_price ?? ''}
                          onChange={(e) =>
                            update(selectedStaff.id, selectedMenu.id, {
                              override_price:
                                e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          placeholder={formatNumber(selectedMenu.base_price)}
                          aria-label={`${staffLabel(selectedStaff)} の ${selectedMenu.name} の料金`}
                        />
                        <span className={styles.unitSuffix}>（メニューは {menuPriceLabel(selectedMenu)}）</span>
                      </span>
                    </label>
                    <span className={styles.overrideClear}>
                      <Button
                        disabled={!canEditMenus || !selectedOverridden}
                        onClick={() =>
                          update(selectedStaff.id, selectedMenu.id, {
                            override_duration_minutes: null,
                            override_price: null,
                          })
                        }
                      >
                        上書きを消す
                      </Button>
                    </span>
                  </div>
                  <div className={styles.legendRow}>
                    <span className={styles.legendCheck} aria-hidden="true">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4l2.5 2.5L9 1" /></svg>
                    </span>
                    <span className={styles.legendName}>{staffLabel(selectedStaff)}</span>
                    {selectedOverridden ? (
                      <span className={styles.ovrBadge}>
                        <span className={styles.ovrBadgeDot} aria-hidden="true" />
                        上書きあり
                      </span>
                    ) : null}
                    <span className={styles.legendCaption}>上書きがある升にはこの印が付きます</span>
                  </div>
                  </div>
                ) : null}

                {orphans.length > 0 ? (
                  <div className={shell.warnBand} data-design="Warn" role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>
                    {unassigned.length > 0
                      ? `「${unassigned.map((m) => m.name).join('」「')}」は担当が0人です。出しても予約は入りません。`
                      : null}
                    {inactiveOnly.length > 0
                      ? `${unassigned.length > 0 ? ' ' : ''}「${inactiveOnly.map((m) => m.name).join('」「')}」は受付を止めている担当しかいません。`
                      : null}
                  </span>
                  </div>
                ) : null}
              </section>
            </>
          )}
        </div>

        {/* 板では右の欄は空き（仕切り線だけ）。 */}
        <div className={shell.side} aria-hidden="true" />
      </div>

      {(dirty || saveDone) && canEditMenus ? (
        <div className={styles.saveBar} data-design="Savebar">
          <Button
            onClick={() => setGrid(savedGrid ?? grid)}
            disabled={saving}
          >
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={() => void saveAll()}
            disabled={saving || !selectedAccountId || loading || Boolean(error)}
            busy={saving}
            done={saveDone}
          >
            保存
          </Button>
        </div>
      ) : null}

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="担当割り当てへの変更"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}
