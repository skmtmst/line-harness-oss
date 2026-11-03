'use client'
import { DetailPreview } from '@/components/shared/detail-content'

import { tableRequirements as b244Requirements } from './requirements'

import {reservationBoardApi} from '@/lib/api/helpers/reservation-board'
import {seatBoardEntry,type RestaurantFloor} from '@line-crm/shared'
import RestaurantFloorEditor from '@/components/shared/restaurant-floor-editor'

/*
 * ★V8 座席・卓管理（板 `BERxg`・卓を止める ・卓を追加・変更 ）。
 *
 * 数4（卓数・総席数・結合可能・個室）→ 右上に「卓を作る」→
 * 左にフロアマップ（結合グループは緑の地と札・停止中は薄く）、右に卓の詳細
 * （有効／停止中の札・変更・停止／再開）→ 自動配席ルール。
 * 止めるときは、この卓に入っている先の予約を見せ、別の卓へ移すか未配席に戻してから止める。
 * データの口・送る形は今の画面（app/restaurant-test/v8/tables.tsx）と同じ。動きは BEHAVIOR.md。
 */
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import KpiCard from '@/components/shared/kpi-card'
import { useEffect,useMemo, useRef, useState } from 'react'
import { Check, Inbox, Plus } from 'lucide-react'
import SeatTile from '@/components/shared/seat-tile'
import { DetailColumns } from '@/components/templates/detail-columns'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { Field } from '@/components/shared/form-controls'
import Select from '@/components/shared/select'
import EntitySelect from '@/components/shared/entity-select'
import { TextField } from '@/components/shared/text-field'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { restaurantTestApi, type RestaurantReservation, type RestaurantTable } from '@/lib/restaurant-test-api'
import { RestaurantShell, Panel, QuietError, StatRow, Status, type RestaurantV8Context } from '@/v8/restaurant/booking-kit/public/shell/index'
import { DialogField, DialogNote, RsDialog } from '@/v8/restaurant/booking-kit/public/parts/index'
import { pickMoveTarget, reservationLine } from './move'
import styles from './tables.module.css'
import TableRowActions from './table-row-actions'
import TablesAssignBoard from './assign'
import { useSearchParams } from 'next/navigation'
import { Scale, Map as MapIcon } from 'lucide-react'
import NumberInput from '@/components/shared/number-field'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import OperationTargetSummary from '@/components/shared/operation-target-summary'


/*
 * ★V8 座席・卓管理（板 `BERxg`・卓を止める ・卓を追加・変更 ）。
 *
 * 数4（卓数・総席数・結合可能・個室）→ 右上に「卓を作る」→
 * 左にフロアマップ（結合グループは緑の地と札・停止中は薄く）、右に卓の詳細
 * （有効／停止中の札・変更・停止／再開）→ 自動配席ルール。
 * 止めるときは、この卓に入っている先の予約を見せ、別の卓へ移すか未配席に戻してから止める。
 * データの口・送る形は今の画面（app/restaurant-test/v8/tables.tsx）と同じ。動きは BEHAVIOR.md。
 */

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
  floorX: string; floorY: string; joinGroup: string;floorId:string
}

type MoveMode = 'move' | 'unassign'

function TablesBoard({ ctx, addRequest }: { ctx: RestaurantV8Context;addRequest:number }) {
  const saveErrors = useSaveFormErrors()
  const { data, store, busy, mutate, tableDefinition } = ctx
  const { selectedAccountId, accounts } = useAccount()
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const snapshotAccountCurrent = Boolean(tableDefinition && tableDefinition.accountId === selectedAccountId && tableDefinition.snapshot === data)
  const snapshotCurrentRef = useRef(snapshotAccountCurrent); snapshotCurrentRef.current = snapshotAccountCurrent
  const scope = useRef({ accountId: selectedAccountId, storeId: store?.id, generation: 0 })
  if (scope.current.accountId !== selectedAccountId || scope.current.storeId !== store?.id) scope.current = { accountId: selectedAccountId, storeId: store?.id, generation: scope.current.generation + 1 }
  const renderedScope = scope.current
  const [floors,setFloors]=useState<RestaurantFloor[]>([])
  useEffect(()=>{let active=true;if(selectedAccountId&&store)void reservationBoardApi.floors(selectedAccountId,store.id).then(r=>{if(active)setFloors(r.data)}).catch(()=>{});return ()=>{active=false}},[selectedAccountId,store?.id,data.tables])
  const role = useStaffRole()
  /* 閲覧のみの人には、追加・変更・停止・再開・並べ替えを置かない（2026-10-06 オーナー）。 */
  const canEdit = canManageRole(role)
  const canEditRef = useRef(canEdit); canEditRef.current = canEdit
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
  const [editorError, setEditorError] = useState('')
  const editorRef = useRef<HTMLFormElement>(null)
  const [showPlacement, setShowPlacement] = useState(false)
  const [deleteId, setDeleteId] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [stopId, setStopId] = useState('')
  const [deleteScope, setDeleteScope] = useState<{ scope: typeof renderedScope; ticket: object } | null>(null)
  const [stopScope, setStopScope] = useState<{ scope: typeof renderedScope; ticket: object } | null>(null)
  const deleteTicket = useRef<object | null>(null)
  const stopTicket = useRef<object | null>(null)
  const [stopError, setStopError] = useState('')
  const [moveMode, setMoveMode] = useState<MoveMode>('move')
  useEffect(()=>{if(addRequest>0)openNew()},[addRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  const editing = editor && editor !== 'new' ? rows.find((row) => row.id === editor) ?? null : null
  const deleting = deleteScope?.scope === scope.current && deleteScope.ticket === deleteTicket.current ? rows.find((row) => row.id === deleteId) : undefined
  const stopping = stopScope?.scope === scope.current && stopScope.ticket === stopTicket.current ? rows.find((row) => row.id === stopId) : undefined
  const now = Date.now()
  /* この卓に入っている、これから先の予約（取消・無断キャンセル・来店済みは除く）。 */
  const upcoming = useMemo(() => (stopping
    ? data.reservations
      .filter((item) => seatBoardEntry(item as unknown as Record<string,unknown>).resourceIds.includes(stopping.id) && !['cancelled', 'no_show', 'completed', 'visited', 'seated'].includes(item.status) && !item.departed_at)
      .filter((item) => new Date(item.ends_at).getTime() > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    : []), [data.reservations, stopping, now])

  const openNew = () => {
    setEditorError('')
    setDraft({ code: '', label: '', seatType: 'table', minCapacity: '1', maxCapacity: '2', floorX: '', floorY: '', joinGroup: '',floorId:floors[0]?.id??'floor-'+store?.id })
    setFieldErrors({})
    setShowPlacement(false)
    setEditor('new')
  }
  const openEdit = (table: RestaurantTable) => {
    setEditorError('')
    setDraft({
      code: table.code, label: table.label, seatType: table.seat_type,
      minCapacity: String(table.min_capacity), maxCapacity: String(table.max_capacity),
      floorX: String(table.floor_x), floorY: String(table.floor_y), joinGroup: table.join_group || '',floorId:table.floor_id??'floor-'+table.store_id,
    })
    setFieldErrors({})
    setShowPlacement(false)
    setEditor(table.id)
  }

  const changeCapacity = (field: 'minCapacity' | 'maxCapacity', value: string) => {
    if (!draft) return
    const next = { ...draft, [field]: value }
    setDraft(next)
    setFieldErrors((current) => {
      const errors = { ...current }
      const min = Number(next.minCapacity), max = Number(next.maxCapacity)
      // 保存時に表示済みの人数の理由だけを現在値で見直す。
      if (current.minCapacity && Number.isInteger(min) && min >= 1) delete errors.minCapacity
      if (current.maxCapacity && Number.isInteger(max) && max >= min && max >= 1) delete errors.maxCapacity
      return errors
    })
  }

  const save = async () => {
    if (!draft) return
    setEditorError('')
    if (!selectedAccountId) { setEditorError('LINEアカウントを選んでから、もう一度お試しください。'); return }
    if (!editing && !store) { setEditorError('店舗を選んでから、もう一度お試しください。'); return }
    const errors: Partial<Record<keyof Draft, string>> = {}
    if ((b244Requirements.draft_code.check(draft.code) !== null)) errors.code = '卓番を入れてください。'
    if ((b244Requirements.draft_label.check(draft.label) !== null)) errors.label = '表示名を入れてください。'
    const min = Number(draft.minCapacity), max = Number(draft.maxCapacity)
    if (!Number.isInteger(min) || min < 1) errors.minCapacity = '最小人数は1以上の整数にしてください。'
    if (!Number.isInteger(max) || max < min || max < 1) errors.maxCapacity = '最大人数は最小人数以上の整数にしてください。'
    for (const key of ['floorX', 'floorY'] as const) {
      if (!draft[key].trim()) { if (editing) errors[key] = '位置を入れてください。'; continue }
      if (!Number.isInteger(Number(draft[key])) || Number(draft[key]) < 0 || Number(draft[key]) > 10000) errors[key] = '配置は0〜10000の整数にしてください。'
    }
    if (!editing && Boolean(draft.floorX.trim()) !== Boolean(draft.floorY.trim())) errors[draft.floorX.trim() ? 'floorY' : 'floorX'] = '横と縦の位置を一緒に指定してください。'
    setFieldErrors(errors)
    if (Object.keys(errors).length) {
      if (errors.floorX || errors.floorY) setShowPlacement(true)
      requestAnimationFrame(() => { const field = editorRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]'); field?.focus(); field?.scrollIntoView?.({ block: 'center' }) })
      return
    }
    const body = {
      floorId:draft.floorId,expectedTargetVersion:floors.find(f=>f.id===draft.floorId)?.version,
      expectedVersion:editing?.floor_version??1,
      code: draft.code,
      label: draft.label,
      seatType: draft.seatType,
      minCapacity: Number(draft.minCapacity),
      maxCapacity: Number(draft.maxCapacity),
      floorX: draft.floorX.trim()?Number(draft.floorX):undefined,
      floorY: draft.floorY.trim()?Number(draft.floorY):undefined,
      joinGroup: draft.joinGroup.trim() || null,
    }
    const ok = editing
      ? await mutate(() => restaurantTestApi.updateTable(selectedAccountId, editing.id, body), '卓を更新しました。', setEditorError)
      : store
        ? await mutate(() => restaurantTestApi.createTable(selectedAccountId, { storeId: store.id, ...body }), '卓を追加しました。', setEditorError)
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
      storeId: store.id, expectedVersion:reordered[0]?.floor_version??1,
      tables: reordered.map((t, index) => ({ id: t.id, floorX: index % 3, floorY: Math.floor(index / 3), joinGroup: t.join_group })),
    }), '卓の配置を保存しました。')
  }

  /* 先の予約を移して（または未配席に戻して）から卓を止める。1件ずつ送り、失敗したらそこで止める。 */
  const stop = (table: RestaurantTable, reservations: RestaurantReservation[]) => {
    if (!alive.current || !selectedAccountId || !snapshotCurrentRef.current || !canEditRef.current || !stopScope || stopScope.scope !== scope.current || stopScope.ticket !== stopTicket.current) return
    const belongs = () => alive.current && canEditRef.current && stopScope.scope === scope.current && stopScope.ticket === stopTicket.current
    const current = () => snapshotCurrentRef.current && belongs()
    setStopError('')
    void mutate(async () => {
      try {
        const taken: RestaurantReservation[] = data.reservations.filter((item) => item.table_id !== table.id)
        let moved = 0
        let unassigned = 0
        for (const item of reservations) {
          if (!current()) throw new QuietError()
          const target = moveMode === 'move' ? pickMoveTarget(item, rows.filter((row) => row.id !== table.id), taken) : null
          await restaurantTestApi.updateReservation(selectedAccountId, item.id, { tableId: target?.id ?? null, expectedVersion: item.customer_version ?? 1 })
          if (target) { moved += 1; taken.push({ ...item, table_id: target.id }) } else { unassigned += 1 }
        }
        if (!current()) throw new QuietError()
        await restaurantTestApi.updateTable(selectedAccountId, table.id, { isActive: false })
        return { moved, unassigned }
      } catch (error) {
        if (!current()) throw new QuietError()
        const fieldFailure = saveErrors.capture(error)

        { if (!fieldFailure && current())
        setStopError(japaneseDetailOf(error) || '予約の移動・卓の停止に失敗しました。時間をおいて、もう一度お試しください。') }
        throw new QuietError()
      }
    }, reservations.length === 0
      ? '卓を停止しました。予約履歴と卓の情報は残ります。'
      : moveMode === 'move'
        ? '先の予約を別の卓へ移して、卓を停止しました。入る卓が無かった予約は未配席にしました。'
        : '先の予約を未配席に戻して、卓を停止しました。予約台帳で卓を割り当ててください。').then((ok) => { if (ok && belongs()) { stopTicket.current = null; setStopId('') } })
  }

  const resume = (table: RestaurantTable) => {
    if (!selectedAccountId) return
    void mutate(
      () => restaurantTestApi.updateTable(selectedAccountId, table.id, { isActive: true }),
      '卓を再開しました。',
    )
  }

  const activeRows = rows.filter((item) => item.is_active)
  const groups = new Set(activeRows.filter((item) => item.join_group).map((item) => item.join_group))
  const placementFields = draft ? (
    <>
      <div className={styles.pair}>
        <Field label="階・エリア"><SaveErrorField names={["floorId","draft.floorId","floor_id","draft.floor_id"]}><EntitySelect size="full" aria-label="階・エリア" noun="階・エリア" value={draft.floorId} onChange={v=>setDraft({...draft,floorId:v})} options={floors.map(f=>({value:f.id,label:f.name}))}/></SaveErrorField></Field>
        <Field label="横の位置" htmlFor="rs-table-x" error={fieldErrors.floorX}>
          <SaveErrorField names={["floorX","draft.floorX","floor_x","draft.floor_x"]}><NumberInput placeholder={editing?undefined:"自動配置"} id="rs-table-x" type="number" min={0} max={10000} value={draft.floorX} onChange={(event) => setDraft({ ...draft, floorX: event.target.value })} /></SaveErrorField>
        </Field>
        <Field label="縦の位置" htmlFor="rs-table-y" error={fieldErrors.floorY}>
          <SaveErrorField names={["floorY","draft.floorY","floor_y","draft.floor_y"]}><NumberInput placeholder={editing?undefined:"自動配置"} id="rs-table-y" type="number" min={0} max={10000} value={draft.floorY} onChange={(event) => setDraft({ ...draft, floorY: event.target.value })} /></SaveErrorField>
        </Field>
      </div>
      {!editing?<DialogNote>位置を空欄にすると、重ならない空き位置へ自動で配置します。追加後は座席図上で移動できます。</DialogNote>:null}
      <DialogField label="結合グループ" htmlFor="rs-table-group">
        <SaveErrorField names={["joinGroup","draft.joinGroup","join_group","draft.join_group"]}><TextField id="rs-table-group" maxLength={100} value={draft.joinGroup} onChange={(event) => setDraft({ ...draft, joinGroup: event.target.value })} /></SaveErrorField>
      </DialogField>
    </>
  ) : null

  return (
    <SaveErrorScope errors={saveErrors}><>
      <StatRow fusion>
        <KpiCard title="卓数" value={rows.length} unit="卓" detail="稼働・停止を含む" icon={<Inbox size={16} aria-hidden />} presentation="band" />
        <KpiCard title="総席数" value={activeRows.reduce((sum, item) => sum + item.max_capacity, 0)} unit="席" detail="稼働中の最大収容人数" icon={<Inbox size={16} aria-hidden />} presentation="band" />
        <KpiCard title="結合可能" value={groups.size} unit="組" detail="結合グループ" icon={<Inbox size={16} aria-hidden />} presentation="band" />
        <KpiCard title="個室" value={rows.filter((item) => item.seat_type === 'private_room').length} unit="室" detail="個室卓" icon={<Inbox size={16} aria-hidden />} presentation="band" />
      </StatRow>
      <DetailColumns variant="restaurant-tables" asideLabel="卓の詳細を見る" expanded={asideExpanded} onExpandedChange={setAsideExpanded} aside={<DetailPreview title={'卓の詳細'}>
          <ul className={styles.detailList}>
            {rows.map((item) => (
              <li key={item.id} className={`${styles.detailRow} ${item.id === selectedId ? styles.detailRowSelected : ''}`}>
                <div className={styles.detailMain}>
                  <p className={styles.detailName} title={`${item.code} · ${item.label}`}>{`${item.code} · ${item.label}`}</p>
                  <p className={styles.detailSub}>{`${seatTypeLabel(item.seat_type)} / ${item.min_capacity}〜${item.max_capacity}名`}</p>
                </div>
                <span className={styles.detailStatus}><Status value={item.is_active ? 'active' : 'suspended'} /></span>
                <TableRowActions table={item} canEdit={canEdit} busy={busy} pendingAccount={!snapshotAccountCurrent} onEdit={openEdit} onResume={resume}
                  onDelete={(table) => { if (!selectedAccountId || !store || !snapshotAccountCurrent || !canEditRef.current || renderedScope !== scope.current) return; const ticket = {}; deleteTicket.current = ticket; setDeleteScope({ scope: renderedScope, ticket }); setDeleteError(''); setDeleteId(table.id) }}
                  onStop={(table) => { if (!selectedAccountId || !store || !snapshotAccountCurrent || !canEditRef.current || renderedScope !== scope.current) return; const ticket = {}; stopTicket.current = ticket; setStopScope({ scope: renderedScope, ticket }); setStopError(''); setMoveMode('move'); setStopId(table.id) }} />
              </li>
            ))}
          </ul>
        </DetailPreview>} asideLayout="detail">
        <div className={styles.floorPanel}>
          {store&&selectedAccountId?<RestaurantFloorEditor accountId={selectedAccountId} storeId={store.id} refreshKey={JSON.stringify(rows.map(t=>[t.id,t.floor_id,t.floor_version]))} resources={rows.map(t=>({id:t.id,label:t.code,capacity:t.max_capacity,active:!!t.is_active}))} canEdit={canEdit} onSelect={setSelectedId}/>:null}
        </div>
      </DetailColumns>
      <div className={styles.rules}>
        <Panel fusion title="自動配席ルール" description="収容差が最小の卓を優先"><p className={styles.ruleText}>人数を収容できる卓のうち、余裕が最も少ない卓を候補にします。電話・直接来店も同じ候補を使います。</p></Panel>
        <Panel fusion title="結合のルール" description="結合グループ"><p className={styles.ruleText}>同じ結合グループの卓は全卓を一緒に確保します。配置と結合グループは卓の変更から設定できます。</p></Panel>
        <Panel fusion title="卓を止めるとき"><p className={styles.ruleText}>先の予約を同じ人数が入る別の卓へ自動で移すか、未配席に戻します。お客さまへの通知はこの画面からは送りません。</p></Panel>
      </div>
      <RsDialog open={Boolean(deleting)} title="この卓を削除しますか？" width={480} top={300} busy={busy}
        onCancel={() => { if (deleteScope?.ticket === deleteTicket.current) { deleteTicket.current = null; setDeleteId('') } }} actions={<>
          <Button disabled={busy} onClick={() => { if (deleteScope?.ticket === deleteTicket.current) { deleteTicket.current = null; setDeleteId('') } }}>キャンセル</Button>
          <Button variant="danger" disabled={busy} onClick={() => {
            if (!alive.current || !selectedAccountId || !deleting || !snapshotCurrentRef.current || !canEditRef.current || !deleteScope || deleteScope.scope !== scope.current || deleteScope.ticket !== deleteTicket.current) return
            const belongs = () => alive.current && canEditRef.current && deleteScope.scope === scope.current && deleteScope.ticket === deleteTicket.current
            const current = () => snapshotCurrentRef.current && belongs()
            setDeleteError('')
            void mutate(async () => {
              try { await restaurantTestApi.deleteTable(selectedAccountId, deleting.id) }
              catch (error) { if (current()) setDeleteError(japaneseDetailOf(error) || '削除できませんでした。'); throw new QuietError() }
            }, '卓を削除しました。').then((ok) => { if (ok && belongs()) { deleteTicket.current = null; setDeleteId('') } })
          }}>削除する</Button>
        </>}>
        {deleteScope?.scope.accountId && store && <OperationTargetSummary accounts={[{ id: deleteScope.scope.accountId, name: accounts.find(account => account.id === deleteScope.scope.accountId)?.name }]} store={{ id: store.id, name: store.name }} />}
        <p>{deleting?.code}・{deleting?.label}</p>
        <DialogNote>予約や設定で使われていない卓だけ削除できます。元に戻せません。</DialogNote>
        {deleteError ? <Notice tone="danger">{deleteError}</Notice> : null}
      </RsDialog>
      <RsDialog
        open={editor !== null && draft !== null}
        title={editing ? `卓「${editing.code}・${editing.label}」を変更` : '新しい卓'}
        actionsPlacement="footer"
        width={520}
        top={200}
        busy={busy}
        designNode="gBrCz"
        onCancel={() => setEditor(null)}
        actions={(
          <>
            <Button presentation="restaurant" type="button" onClick={() => setEditor(null)} disabled={busy}>キャンセル</Button>
            <Button presentation="restaurant" type="submit" form="rs-table-editor" variant="primary" disabled={busy}>
              {editing ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{editing ? '保存する' : '追加する'}
            </Button>
          </>
        )}
      >
        {draft ? (
          <form id="rs-table-editor" ref={editorRef} className={styles.editorFields} noValidate onSubmit={(event) => { event.preventDefault(); void save() }}>
            {editorError ? <Notice tone="danger" role="alert">{editorError}</Notice> : null}
            <div className={styles.pair}>
              <Field label="卓番" htmlFor="rs-table-code" error={fieldErrors.code} requirement={b244Requirements.draft_code}>
                <SaveErrorField names={["code","draft.code"]}><TextField id="rs-table-code" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></SaveErrorField>
              </Field>
              <Field label="表示名" htmlFor="rs-table-label" error={fieldErrors.label} requirement={b244Requirements.draft_label}>
                <SaveErrorField names={["label","draft.label"]}><TextField id="rs-table-label" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></SaveErrorField>
              </Field>
            </div>
            <DialogField label="席種" kind="select">
              <SaveErrorField names={["seatType","draft.seatType","seat_type","draft.seat_type"]}><Select aria-label="席種" size="full" value={draft.seatType} onChange={(value) => setDraft({ ...draft, seatType: value })} options={SEAT_TYPE_OPTIONS} /></SaveErrorField>
            </DialogField>
            <div className={styles.pair}>
              <Field label="最小人数" htmlFor="rs-table-min" error={fieldErrors.minCapacity} requirement={b244Requirements.draft_min_capacity}>
                <SaveErrorField names={["minCapacity","draft.minCapacity","min_capacity","draft.min_capacity"]}><NumberInput id="rs-table-min" type="number" min={1} value={draft.minCapacity} onChange={(event) => changeCapacity('minCapacity', event.target.value)} /></SaveErrorField>
              </Field>
              <Field label="最大人数" htmlFor="rs-table-max" error={fieldErrors.maxCapacity} requirement={b244Requirements.draft_max_capacity}>
                <SaveErrorField names={["maxCapacity","draft.maxCapacity","max_capacity","draft.max_capacity"]}><NumberInput id="rs-table-max" type="number" min={1} value={draft.maxCapacity} onChange={(event) => changeCapacity('maxCapacity', event.target.value)} /></SaveErrorField>
              </Field>
            </div>
            <Button presentation="restaurant" type="button" aria-expanded={showPlacement} onClick={() => setShowPlacement((open) => !open)}>
              {showPlacement ? '配置・結合グループを閉じる' : '配置・結合グループ'}
            </Button>
            {showPlacement ? placementFields : null}
            <DialogNote>{editing ? '人数を変えると、予約枠・在庫の総数も変わります。' : '卓を足すと、予約枠・在庫の総数も増えます。'}</DialogNote>
          </form>
        ) : null}
      </RsDialog>
      <RsDialog
        open={Boolean(stopping)}
        title={stopping ? `卓「${stopping.code}・${stopping.label}」を止めますか？` : ''}
        width={560}
        top={260}
        busy={busy}
        designNode="eY9F3"
        onCancel={() => { if (stopScope?.ticket === stopTicket.current) { stopTicket.current = null; setStopId('') } }}
        actions={(
          <>
            <Button presentation="restaurant" onClick={() => { if (stopScope?.ticket === stopTicket.current) { stopTicket.current = null; setStopId('') } }} disabled={busy}>キャンセル</Button>
            <Button presentation="restaurant" variant="danger" disabled={busy} onClick={() => { if (stopping) stop(stopping, upcoming) }}>
              {upcoming.length === 0 ? '止める' : moveMode === 'move' ? '予約を移して止める' : '未配席に戻して止める'}
            </Button>
          </>
        )}
      >
        {stopScope?.scope.accountId && store && <OperationTargetSummary accounts={[{ id: stopScope.scope.accountId, name: accounts.find(account => account.id === stopScope.scope.accountId)?.name }]} store={{ id: store.id, name: store.name }} />}
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
              <SaveErrorField names={["moveMode","move_mode"]}><Select
                aria-label="この予約をどうしますか"
                size="full"
                value={moveMode}
                onChange={(value) => setMoveMode(value === 'unassign' ? 'unassign' : 'move')}
                options={[
                  { value: 'move', label: '同じ人数が入る別の卓へ自動で移す' },
                  { value: 'unassign', label: '未配席に戻す（予約台帳で割り当てる）' },
                ]}
              /></SaveErrorField>
            </DialogField>
            <p className={styles.stopNotice}>お客さまへの LINE のお知らせは、この画面からは送りません。</p>
          </>
        )}
      </RsDialog>
    </></SaveErrorScope>
  )
}

export default function TablesPage() {
  const [addRequest,setAddRequest]=useState(0)
  const canEdit=canManageRole(useStaffRole())
  /* ?view=assign：卓の割り当て方（jmVYJ・）。座席表へは［座席表を直す］で戻る。 */
  const assignView=useSearchParams().get('view')==='assign'
  if(assignView) return (
    <RestaurantShell templateHeading boundary={false} boardId="jmVYJ" title="座席・卓管理" description={ctx=>ctx?.store?.name??''} headAfter={(_ctx,picker)=><>{picker}<Button presentation="restaurant" href="/restaurant-test/tables"><MapIcon size={16} aria-hidden="true"/>座席表を直す</Button></>} renderPage={(ctx, heading, notice) => <TablesAssignBoard ctx={ctx} canEdit={canEdit} heading={heading} notice={notice} />} />
  )
  return (
    <RestaurantShell templateHeading boundary={false} boardId="BERxg" title="座席・卓管理" description={ctx=>ctx?.store?.name??''} headAfter={(_ctx,picker)=><>{picker}<Button presentation="restaurant" href="/restaurant-test/tables?view=assign"><Scale size={16} aria-hidden="true"/>卓の割り当て方</Button>{canEdit?<Button presentation="restaurant" variant="primary" onClick={()=>setAddRequest(n=>n+1)}><Plus size={16}/>卓を作る</Button>:null}</>}>
      {(ctx) => <TablesBoard ctx={ctx} addRequest={addRequest} />}
    </RestaurantShell>
  )
}
