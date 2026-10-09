'use client'

/*
 * ★V8 座席・卓管理（板 `BERxg`・卓を止める `eY9F3`・卓を追加・変更 `gBrCz`）。
 *
 * 数4（卓数・総席数・結合可能・個室）→ 右上に「卓を追加する」→
 * 左にフロアマップ（結合グループは緑の地と札・停止中は薄く）、右に卓の詳細
 * （有効／停止中の札・変更・停止／再開）→ 自動配席ルール。
 * 止めるときは、この卓に入っている先の予約を見せ、別の卓へ移すか未配席に戻してから止める。
 * データの口・送る形は今の画面（app/restaurant-test/v8/tables.tsx）と同じ。動きは BEHAVIOR.md。
 */
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import KpiCard from '@/components/shared/kpi-card'
import { useMemo, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import SeatTile from '@/components/shared/seat-tile'
import { DetailColumns } from '@/components/templates/detail-columns'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { Field } from '@/components/shared/form-controls'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { restaurantTestApi, type RestaurantReservation, type RestaurantTable } from '@/lib/restaurant-test-api'
import RestaurantShell, { Panel, QuietError, StatRow, Status, type RestaurantV8Context } from '../booking-kit/shell'
import { DialogField, DialogNote, RsDialog } from '../booking-kit/parts'
import { pickMoveTarget, reservationLine } from './move'
import styles from './tables.module.css'

const SEAT_TYPE_LABEL: Record<string, string> = {
  table: 'テーブル',
  counter: 'カウンター',
  private_room: '個室',
  terrace: 'テラス',
}

const SEAT_TYPE_OPTIONS = [
  { value: 'table', label: 'テーブル' },
  { value: 'counter', label: 'カウンター' },
  { value: 'private_room', label: '個室' },
  { value: 'terrace', label: 'テラス' },
]

function seatTypeLabel(value: string): string {
  return SEAT_TYPE_LABEL[value] ?? value
}

type Draft = {
  code: string; label: string; seatType: string; minCapacity: string; maxCapacity: string
  floorX: string; floorY: string; joinGroup: string
}

type MoveMode = 'move' | 'unassign'

function TablesBoard({ ctx }: { ctx: RestaurantV8Context }) {
  const { data, store, busy, mutate } = ctx
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  /* 閲覧のみの人には、追加・変更・停止・再開・並べ替えを置かない（2026-10-06 オーナー）。 */
  const canEdit = role === null || canManageRole(role)
  const rows = useMemo(() => (store ? data.tables.filter((row) => row.store_id === store.id) : data.tables), [data.tables, store])
  const placed = useMemo(
    () => [...rows].sort((a, b) => a.floor_y - b.floor_y || a.floor_x - b.floor_x || a.code.localeCompare(b.code)),
    [rows],
  )
  const [asideExpanded, setAsideExpanded] = useState(false)
  const [dragId, setDragId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  /* 窓：'new' は追加、卓の id は変更。 */
  const [editor, setEditor] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Draft, string>>>({})
  const editorRef = useRef<HTMLDivElement>(null)
  const [showPlacement, setShowPlacement] = useState(false)
  const [stopId, setStopId] = useState('')
  const [stopError, setStopError] = useState('')
  const [moveMode, setMoveMode] = useState<MoveMode>('move')
  const editing = editor && editor !== 'new' ? rows.find((row) => row.id === editor) ?? null : null
  const stopping = rows.find((row) => row.id === stopId)
  const now = Date.now()
  /* この卓に入っている、これから先の予約（取消・無断キャンセル・来店済みは除く）。 */
  const upcoming = useMemo(() => (stopping
    ? data.reservations
      .filter((item) => item.table_id === stopping.id && !['cancelled', 'no_show', 'completed', 'visited'].includes(item.status))
      .filter((item) => new Date(item.ends_at).getTime() > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    : []), [data.reservations, stopping, now])

  const openNew = () => {
    setDraft({ code: '', label: '', seatType: 'table', minCapacity: '1', maxCapacity: '2', floorX: String(rows.length % 3), floorY: String(Math.floor(rows.length / 3)), joinGroup: '' })
    setFieldErrors({})
    setShowPlacement(false)
    setEditor('new')
  }
  const openEdit = (table: RestaurantTable) => {
    setDraft({
      code: table.code, label: table.label, seatType: table.seat_type,
      minCapacity: String(table.min_capacity), maxCapacity: String(table.max_capacity),
      floorX: String(table.floor_x), floorY: String(table.floor_y), joinGroup: table.join_group || '',
    })
    setFieldErrors({})
    setShowPlacement(false)
    setEditor(table.id)
  }

  const save = async () => {
    if (!draft || !selectedAccountId) return
    const errors: Partial<Record<keyof Draft, string>> = {}
    if (!draft.code.trim()) errors.code = '卓番を入れてください。'
    if (!draft.label.trim()) errors.label = '表示名を入れてください。'
    const min = Number(draft.minCapacity), max = Number(draft.maxCapacity)
    if (!Number.isInteger(min) || min < 1) errors.minCapacity = '最小人数は1以上の整数にしてください。'
    if (!Number.isInteger(max) || max < min || max < 1) errors.maxCapacity = '最大人数は最小人数以上の整数にしてください。'
    for (const key of ['floorX', 'floorY'] as const) {
      if (!Number.isInteger(Number(draft[key])) || Number(draft[key]) < 0 || Number(draft[key]) > 10000) errors[key] = '配置は0〜10000の整数にしてください。'
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length) {
      if (errors.floorX || errors.floorY) setShowPlacement(true)
      requestAnimationFrame(() => { const field = editorRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]'); field?.focus(); field?.scrollIntoView?.({ block: 'center' }) })
      return
    }
    const body = {
      code: draft.code,
      label: draft.label,
      seatType: draft.seatType,
      minCapacity: Number(draft.minCapacity),
      maxCapacity: Number(draft.maxCapacity),
      floorX: Number(draft.floorX),
      floorY: Number(draft.floorY),
      joinGroup: draft.joinGroup.trim() || null,
    }
    const ok = editing
      ? await mutate(() => restaurantTestApi.updateTable(selectedAccountId, editing.id, body), '卓を更新しました。')
      : store
        ? await mutate(() => restaurantTestApi.createTable(selectedAccountId, { storeId: store.id, ...body }), '卓を追加しました。')
        : false
    if (ok) setEditor(null)
  }

  const moveTable = (targetId: string) => {
    if (!store || !selectedAccountId || !dragId || dragId === targetId || busy) return
    const from = placed.findIndex((t) => t.id === dragId)
    const to = placed.findIndex((t) => t.id === targetId)
    setDragId('')
    if (from < 0 || to < 0) return
    const reordered = [...placed]
    reordered.splice(to, 0, reordered.splice(from, 1)[0])
    void mutate(() => restaurantTestApi.saveTableLayout(selectedAccountId, {
      storeId: store.id,
      tables: reordered.map((t, index) => ({ id: t.id, floorX: index % 3, floorY: Math.floor(index / 3), joinGroup: t.join_group })),
    }), '卓の配置を保存しました。')
  }

  /* 先の予約を移して（または未配席に戻して）から卓を止める。1件ずつ送り、失敗したらそこで止める。 */
  const stop = (table: RestaurantTable, reservations: RestaurantReservation[]) => {
    if (!selectedAccountId) return
    setStopError('')
    void mutate(async () => {
      try {
        const taken: RestaurantReservation[] = data.reservations.filter((item) => item.table_id !== table.id)
        let moved = 0
        let unassigned = 0
        for (const item of reservations) {
          const target = moveMode === 'move' ? pickMoveTarget(item, rows.filter((row) => row.id !== table.id), taken) : null
          await restaurantTestApi.updateReservation(selectedAccountId, item.id, { tableId: target?.id ?? null })
          if (target) { moved += 1; taken.push({ ...item, table_id: target.id }) } else { unassigned += 1 }
        }
        await restaurantTestApi.updateTable(selectedAccountId, table.id, { isActive: false })
        return { moved, unassigned }
      } catch (error) {
        setStopError(japaneseDetailOf(error) || '予約の移動・卓の停止に失敗しました。')
        throw new QuietError()
      }
    }, reservations.length === 0
      ? '卓を停止しました。予約履歴と卓の情報は残ります。'
      : moveMode === 'move'
        ? '先の予約を別の卓へ移して、卓を停止しました。入る卓が無かった予約は未配席にしました。'
        : '先の予約を未配席に戻して、卓を停止しました。予約台帳で卓を割り当ててください。').then((ok) => { if (ok) setStopId('') })
  }

  const resume = (table: RestaurantTable) => {
    if (!selectedAccountId) return
    void mutate(
      () => restaurantTestApi.updateTable(selectedAccountId, table.id, { isActive: true }),
      '卓を再開しました。',
    )
  }

  const groups = new Set(rows.filter((item) => item.join_group).map((item) => item.join_group))
  const placementFields = draft ? (
    <>
      <div className={styles.pair}>
        <Field label="配置の列（0から）" htmlFor="rs-table-x" error={fieldErrors.floorX}>
          <TextField id="rs-table-x" type="number" min={0} max={10000} value={draft.floorX} onChange={(event) => setDraft({ ...draft, floorX: event.target.value })} />
        </Field>
        <Field label="配置の行（0から）" htmlFor="rs-table-y" error={fieldErrors.floorY}>
          <TextField id="rs-table-y" type="number" min={0} max={10000} value={draft.floorY} onChange={(event) => setDraft({ ...draft, floorY: event.target.value })} />
        </Field>
      </div>
      <DialogField label="結合グループ" htmlFor="rs-table-group">
        <TextField id="rs-table-group" maxLength={100} value={draft.joinGroup} onChange={(event) => setDraft({ ...draft, joinGroup: event.target.value })} />
      </DialogField>
    </>
  ) : null

  return (
    <>
      <StatRow>
        <KpiCard title="卓数" valueText={`${rows.length}`} detail="稼働・停止を含む" icon={null} presentation="band" value={null} unit="" />
        <KpiCard title="総席数" valueText={`${rows.reduce((sum, item) => sum + item.max_capacity, 0)}`} detail="最大収容人数" icon={null} presentation="band" value={null} unit="" />
        <KpiCard title="結合可能" valueText={`${groups.size}`} detail="結合グループ" icon={null} presentation="band" value={null} unit="" />
        <KpiCard title="個室" valueText={`${rows.filter((item) => item.seat_type === 'private_room').length}`} detail="個室卓" icon={null} presentation="band" value={null} unit="" />
      </StatRow>
      {canEdit ? (
        <div className={styles.addRow}>
          <Button variant="primary" onClick={openNew}><Plus size={15} aria-hidden="true" />卓を追加する</Button>
        </div>
      ) : <div className={styles.addRow} aria-hidden="true" />}
      <DetailColumns variant="restaurant-tables" asideLabel="卓の詳細を見る" expanded={asideExpanded} onExpandedChange={setAsideExpanded} aside={(
        <div className={styles.detailPanel}>
        <Panel title="卓の詳細" flush>
          <ul className={styles.detailList}>
            {rows.map((item) => (
              <li key={item.id} className={`${styles.detailRow} ${item.id === selectedId ? styles.detailRowSelected : ''}`}>
                <div className={styles.detailMain}>
                  <p className={styles.detailName} title={`${item.code} · ${item.label}`}>{`${item.code} · ${item.label}`}</p>
                  <p className={styles.detailSub}>{`${seatTypeLabel(item.seat_type)} / ${item.min_capacity}〜${item.max_capacity}名`}</p>
                </div>
                <span className={styles.detailStatus}><Status value={item.is_active ? 'active' : 'suspended'} /></span>
                {canEdit ? (
                  <>
                    <Button disabled={busy} aria-label={`${item.code}・${item.label}を変更`} onClick={() => openEdit(item)}>変更</Button>
                    {item.is_active
                      ? <Button disabled={busy} aria-label={`${item.code}・${item.label}を停止`} onClick={() => { setStopError(''); setMoveMode('move'); setStopId(item.id) }}>停止</Button>
                      : <Button disabled={busy} aria-label={`${item.code}・${item.label}を再開`} onClick={() => resume(item)}>再開</Button>}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
        </div>
      )}>
        <div className={styles.floorPanel}>
        <Panel
          title="フロアマップ"
          description={canEdit ? '卓を別の卓へドラッグして並べ替えると保存されます。「変更」から列・行・結合グループも指定できます。' : '卓の並びと結合グループを確かめられます。'}
          flush
        >
          <ul className={styles.mapGrid}>
            {placed.map((item) => {
              const selected = item.id === selectedId
              return (
                <li key={item.id} onDragOver={(event) => { if (dragId && !busy) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); moveTable(item.id) }}>
                  <SeatTile
                    code={item.code}
                    label={item.label}
                    capacity={`${item.min_capacity}〜${item.max_capacity}名`}
                    joinGroup={item.join_group}
                    stopped={!item.is_active}
                    selected={selected}
                    disabled={busy}
                    draggable={canEdit && !busy}
                    onDragStart={(event) => { setDragId(item.id); event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => setDragId('')}
                    data-floor-x={item.floor_x}
                    data-floor-y={item.floor_y}
                    aria-label={`${item.code} ${item.label} ${item.min_capacity}〜${item.max_capacity}名${item.join_group ? ` 結合${item.join_group}` : ''}${item.is_active ? '' : '（停止中）'}`}
                    onClick={() => setSelectedId((current) => (current === item.id ? '' : item.id))}
                  />
                </li>
              )
            })}
          </ul>
        </Panel>
        </div>
      </DetailColumns>
      <Panel title="自動配席ルール" flush>
        <div className={styles.ruleBody}>
          <p className={styles.ruleTitle}>収容差が最小の卓を優先</p>
          <p className={styles.ruleText}>少人数予約で大型卓を占有しないよう、人数を収容できる卓のうち余剰席が最も少ない卓を候補にします。結合卓は同一グループとして次段階で評価します。</p>
        </div>
      </Panel>
      <RsDialog
        open={editor !== null && draft !== null}
        title={editing ? `卓「${editing.code}・${editing.label}」を変更` : '新しい卓'}
        width={520}
        top={200}
        busy={busy}
        designNode="gBrCz"
        onCancel={() => setEditor(null)}
        noValidate
        onSubmit={() => void save()}
        actions={(
          <>
            <Button type="button" variant="text" size="inline" aria-expanded={showPlacement} onClick={() => setShowPlacement((open) => !open)}>
              {showPlacement ? '配置・結合グループを閉じる' : '配置・結合グループ'}
            </Button>
            <Button type="button" onClick={() => setEditor(null)} disabled={busy}>キャンセル</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {editing ? <Check size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}{editing ? '保存する' : '追加する'}
            </Button>
          </>
        )}
      >
        {draft ? (
          <div ref={editorRef} className={styles.editorFields}>
            <div className={styles.pair}>
              <Field label="卓番" htmlFor="rs-table-code" error={fieldErrors.code}>
                <TextField id="rs-table-code" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} />
              </Field>
              <Field label="表示名" htmlFor="rs-table-label" error={fieldErrors.label}>
                <TextField id="rs-table-label" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
              </Field>
            </div>
            <DialogField label="席種" kind="select">
              <Select aria-label="席種" size="full" value={draft.seatType} onChange={(value) => setDraft({ ...draft, seatType: value })} options={SEAT_TYPE_OPTIONS} />
            </DialogField>
            <div className={styles.pair}>
              <Field label="最小人数" htmlFor="rs-table-min" error={fieldErrors.minCapacity}>
                <TextField id="rs-table-min" type="number" min={1} value={draft.minCapacity} onChange={(event) => setDraft({ ...draft, minCapacity: event.target.value })} />
              </Field>
              <Field label="最大人数" htmlFor="rs-table-max" error={fieldErrors.maxCapacity}>
                <TextField id="rs-table-max" type="number" min={1} value={draft.maxCapacity} onChange={(event) => setDraft({ ...draft, maxCapacity: event.target.value })} />
              </Field>
            </div>
            {showPlacement ? placementFields : null}
            <DialogNote>{editing ? '人数を変えると、予約枠・在庫の総数も変わります。' : '卓を足すと、予約枠・在庫の総数も増えます。'}</DialogNote>
          </div>
        ) : null}
      </RsDialog>
      <RsDialog
        open={Boolean(stopping)}
        title={stopping ? `卓「${stopping.code}・${stopping.label}」を止めますか？` : ''}
        width={560}
        top={260}
        busy={busy}
        designNode="eY9F3"
        onCancel={() => setStopId('')}
        actions={(
          <>
            <Button onClick={() => setStopId('')} disabled={busy}>キャンセル</Button>
            <Button variant="danger" disabled={busy} onClick={() => { if (stopping) stop(stopping, upcoming) }}>
              {upcoming.length === 0 ? '止める' : moveMode === 'move' ? '予約を移して止める' : '未配席に戻して止める'}
            </Button>
          </>
        )}
      >
        {stopError ? <Notice tone="danger" role="alert" message={stopError} /> : null}
        {upcoming.length === 0 ? (
          <>
            <p className={styles.stopLead}>この卓には、これから先の予約はありません。</p>
            <DialogNote>予約履歴と卓の情報は残ります。停止中の卓は自動配席の候補から外れ、後で再開できます。</DialogNote>
          </>
        ) : (
          <>
            <p className={styles.stopLead}>{`この卓には、これから先の予約が ${upcoming.length} 件あります。`}</p>
            <ul className={styles.stopList}>
              {upcoming.map((item) => <li key={item.id}>{reservationLine(item, store?.timezone)}</li>)}
            </ul>
            <DialogField label="この予約をどうしますか" kind="select">
              <Select
                aria-label="この予約をどうしますか"
                size="full"
                value={moveMode}
                onChange={(value) => setMoveMode(value === 'unassign' ? 'unassign' : 'move')}
                options={[
                  { value: 'move', label: '同じ人数が入る別の卓へ自動で移す' },
                  { value: 'unassign', label: '未配席に戻す（予約台帳で割り当てる）' },
                ]}
              />
            </DialogField>
            <p className={styles.stopNotice}>お客さまへの LINE のお知らせは、この画面からは送りません。</p>
          </>
        )}
      </RsDialog>
    </>
  )
}

export default function TablesPage() {
  return (
    <RestaurantShell templateHeading storeTab="tables" boardId="BERxg" title="座席・卓管理" description="フロア配置、席種、収容人数、結合ルールを管理します。">
      {(ctx) => <TablesBoard ctx={ctx} />}
    </RestaurantShell>
  )
}
