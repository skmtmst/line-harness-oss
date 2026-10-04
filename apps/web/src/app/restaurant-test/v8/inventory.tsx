'use client'

/*
 * ★V8-B 予約枠・在庫（板 `Y8SjT2`・競合 `qf3ky`）。
 *
 * v7（restaurant-console.tsx の Inventory）と同じ口で、板の形に置く：
 * 席と枠の配分（卓とつながる）→ 卓の埋まりぐあい → 時間帯ごとの在庫の表 →
 * 行を押したときの箱 → 下の固定帯（配分を保存）。
 * 競合（ほかの担当者が先に保存・409）は黄色の帯と比べる窓で受ける。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま）：
 * - タブ（自動で合わせるルール）：ルールの口（F-24）が無いので出さない。
 * - 開ける時間の曜日ごとの編集と日付別在庫は予約APIへ接続する。
 * - 下の固定帯の文言：開ける時間が出せないので「配分を保存」にする。
 * - 板 `Yyw6i`（媒体を閉じる知らせ）：残りが少ない時間帯の検知と閉じた記録は
 *   この画面だけで持ち、外部媒体への書き戻しはしない（検証環境は受信専用）。
 *   媒体ごとの受信状態の口が無いので、閉じる対象の媒体は利用者が選ぶ。
 * v7 を直す必要が出たら向こうも同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { RestaurantOpeningHours } from '@line-crm/shared'
import Link from 'next/link'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import InventoryChannels from './inventory-channels'
import { useAccount } from '@/contexts/account-context'
import { ApiError } from '@/lib/api'
import { restaurantTestApi, type RestaurantInventory } from '@/lib/restaurant-test-api'
import { formatYmdShort } from '../google/google-format'
import RestaurantShell, { Panel, type RestaurantV8Context } from './shell'
import styles from './inventory.module.css'

type Alloc = { ota: number; line: number; walkin: number }

type SlotInfo = {
  row: RestaurantInventory
  time: string
  seats: number
  tables: string[]
  free: number
  ratio: number
}

function slotTimeLabel(startsAt: string): string {
  const date = new Date(startsAt)
  if (Number.isNaN(date.getTime())) return '—'
  const hours = date.getHours()
  const minutes = date.getMinutes()
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

function slotDateLabel(startsAt: string): string {
  const date = new Date(startsAt)
  if (Number.isNaN(date.getTime())) return ''
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return formatYmdShort(ymd)
}

function InventoryBoard({ ctx }: { ctx: RestaurantV8Context }) {
  const { data, store, busy, mutate, reload } = ctx
  const { selectedAccountId } = useAccount()
  const tables = useMemo(
    () => (store ? data.tables.filter((item) => item.store_id === store.id) : data.tables),
    [data.tables, store],
  )
  const storeId = store?.id
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: store?.timezone || 'Asia/Tokyo' }).format(new Date()))
  const [dayRows, setDayRows] = useState<RestaurantInventory[]>([])
  const [loadError, setLoadError] = useState('')
  const [opening, setOpening] = useState<RestaurantOpeningHours | null>(null)
  const [hoursDraft, setHoursDraft] = useState<NonNullable<RestaurantOpeningHours['hours']> | null>(null)
  const [hoursVersion, setHoursVersion] = useState(0)
  const [hoursError, setHoursError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    setDayRows([]); setLoadError('')
    if (!selectedAccountId || !storeId) return
    void restaurantTestApi.inventoryDay(selectedAccountId, storeId, date).then(res => {
      if (current) setDayRows(res.data)
    }).catch(() => { if (current) setLoadError('在庫を取得できませんでした。再読込してください。') })
    return () => { current = false }
  }, [selectedAccountId, storeId, date, data.inventory, refresh])
  useEffect(() => {
    let current = true
    setOpening(null); setHoursDraft(null); setHoursError('')
    if (!selectedAccountId || !storeId) return
    void restaurantTestApi.openingHours(selectedAccountId, storeId).then(res => {
      if (current) { setOpening(res.data); setHoursVersion(res.data.version); setHoursDraft(res.data.hours || Array.from({ length: 7 }, (_, weekday) => ({ weekday, periods: [] }))) }
    }).catch(() => { if (current) setHoursError('営業時間を取得できませんでした。再読込してください。') })
    return () => { current = false }
  }, [selectedAccountId, storeId])
  const rows = useMemo(() => dayRows.slice().sort((a,b) => a.starts_at.localeCompare(b.starts_at)), [dayRows])
  const reservations = useMemo(
    () => (store ? data.reservations.filter((item) => item.store_id === store.id) : data.reservations)
      .filter((item) => !['cancelled', 'no_show'].includes(item.status)),
    [data.reservations, store],
  )
  const tableById = useMemo(() => new Map(tables.map((item) => [item.id, item])), [tables])
  const activeTables = useMemo(() => tables.filter((item) => item.is_active), [tables])
  const stoppedTables = useMemo(() => tables.filter((item) => !item.is_active), [tables])
  const totalSeats = useMemo(() => activeTables.reduce((sum, item) => sum + item.max_capacity, 0), [activeTables])

  const slots: SlotInfo[] = useMemo(() => rows.map((row) => {
    const start = new Date(row.starts_at).getTime()
    const end = start + row.slot_minutes * 60_000
    const overlapping = Number.isNaN(start)
      ? []
      : reservations.filter((item) => {
        const from = new Date(item.starts_at).getTime()
        const to = new Date(item.ends_at).getTime()
        return !Number.isNaN(from) && !Number.isNaN(to) && from < end && to > start
      })
    const labels = row.occupiedTableIds ? row.occupiedTableIds.map(id => tableById.get(id)?.code || '').filter(Boolean) : [...new Set(overlapping.map((item) => item.table_label || tableById.get(item.table_id ?? '')?.code || '').filter(Boolean))]
    const seats = row.occupied_seats ?? overlapping.reduce((sum, item) => sum + item.guest_count, 0)
    const free = row.freeSeats ?? Math.max(0, totalSeats - seats)
    return {
      row, time: slotTimeLabel(row.starts_at), seats, tables: labels, free,
      ratio: totalSeats > 0 ? seats / totalSeats : 0,
    }
  }), [rows, reservations, tableById, totalSeats])

  const [selectedId, setSelectedId] = useState('')
  const selected = slots.find((slot) => slot.row.id === selectedId)
    ?? slots.slice().sort((a, b) => b.ratio - a.ratio)[0] ?? null

  const firstRow = rows[0]
  // 上の配分は、利用者が触るまで先頭の時間帯の値を写す（読み込み前に0で固めない）。
  const [allocVersions, setAllocVersions] = useState<Array<{ id: string; expectedVersion: number }> | null>(null)
  const [slotVersion, setSlotVersion] = useState<number | undefined>(undefined)
  const [allocOverride, setAllocOverride] = useState<Alloc | null>(null)
  const alloc: Alloc = allocOverride ?? (firstRow ? { ota: firstRow.ota_capacity, line: firstRow.line_capacity, walkin: firstRow.walk_in_capacity } : { ota: 0, line: 0, walkin: 0 })
  const [slotAlloc, setSlotAlloc] = useState<Alloc | null>(null)
  const [conflict, setConflict] = useState<{ rowId: string | null; attempted: Alloc; scope: string } | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  // 板 `Yyw6i`（媒体を閉じる知らせ）：残りが少ない時間帯への知らせと、閉じた記録。
  // 記録はこの画面だけで持ち、外部媒体への書き戻しはしない。
  const [closeNoteOpen, setCloseNoteOpen] = useState(false)
  const [closedSlots, setClosedSlots] = useState<string[]>([])
  const [closedChannels, setClosedChannels] = useState<string[]>([])
  const lowSlots = useMemo(
    () => slots.filter((slot) => slot.free >= 0 && slot.free / Math.max(totalSeats, 1) < 0.2 && !closedSlots.includes(slot.row.id)),
    [closedSlots, slots, totalSeats],
  )
  const closeTarget = lowSlots.slice().sort((a, b) => a.free - b.free)[0] ?? null
  // 競合後の最新値は、読み直した今の行から出す（閉じ込めた古い写しは使わない）。
  const conflictLatest: Alloc | null = conflict
    ? conflict.rowId === null
      ? rows[0] ? { ota: rows[0].ota_capacity, line: rows[0].line_capacity, walkin: rows[0].walk_in_capacity } : null
      : (() => {
        const row = rows.find((item) => item.id === conflict.rowId)
        return row ? { ota: row.ota_capacity, line: row.line_capacity, walkin: row.walk_in_capacity } : null
      })()
    : null

  const currentSlotAlloc: Alloc = slotAlloc ?? (selected ? { ota: selected.row.ota_capacity, line: selected.row.line_capacity, walkin: selected.row.walk_in_capacity } : { ota: 0, line: 0, walkin: 0 })
  const allocInvalid = alloc.ota + alloc.line + alloc.walkin > totalSeats
  const slotInvalid = selected ? currentSlotAlloc.ota + currentSlotAlloc.line + currentSlotAlloc.walkin > selected.row.total_capacity : true
  const remainder = totalSeats - alloc.ota - alloc.line - alloc.walkin

  const updateAlloc = (next: Alloc) => {
    if (!allocVersions) setAllocVersions(rows.map(r => ({ id: r.id, expectedVersion: r.version! })))
    setAllocOverride(next)
  }
  const updateSlot = (next: Alloc) => {
    if (slotVersion === undefined) setSlotVersion(selected?.row.version)
    setSlotAlloc(next)
  }
  const saveAll = () => {
    if (!selectedAccountId || allocInvalid || rows.length === 0) return
    const attempt = { ...alloc }
    void mutate(async () => {
      try {
        await restaurantTestApi.saveInventoryAllocation(selectedAccountId, { storeId: store!.id, slots: allocVersions || rows.map(r => ({ id: r.id, expectedVersion: r.version! })), otaCapacity: attempt.ota, lineCapacity: attempt.line, walkInCapacity: attempt.walkin })
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          await reload()
          setConflict({ rowId: null, attempted: attempt, scope: '全部の時間帯' })
          throw new Error('ほかの担当者が先に保存しました。最新の内容を確認してください。')
        }
        throw err
      }
    }, '全部の時間帯に配分を保存しました。').then(ok => { if (ok) { setAllocOverride(null); setAllocVersions(null); setRefresh(n => n + 1) } })
  }

  const saveSlot = () => {
    if (!selectedAccountId || !selected || slotInvalid) return
    const attempt = { ...currentSlotAlloc }
    void mutate(async () => {
      try {
        await restaurantTestApi.updateInventory(selectedAccountId, selected.row.id, { otaCapacity: attempt.ota, lineCapacity: attempt.line, walkInCapacity: attempt.walkin, expectedVersion: slotVersion ?? selected.row.version })
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          await reload()
          setConflict({ rowId: selected.row.id, attempted: attempt, scope: `${selected.time}の時間帯` })
          throw new Error('ほかの担当者が先に保存しました。最新の内容を確認してください。')
        }
        throw err
      }
    }, `${selected.time}の配分だけ保存しました。外部媒体へは反映していません。`).then((ok) => {
      if (ok) { setSlotAlloc(null); setSlotVersion(undefined); setRefresh(n => n + 1) }
    })
  }

  const resetAll = () => {
    setAllocOverride(null); setAllocVersions(null); setSlotVersion(undefined)
    setSlotAlloc(null)
  }

  const occupiedAt = (slot: SlotInfo | null) => {
    if (!slot) return new Set<string>()
    if (slot.row.occupiedTableIds) return new Set(slot.row.occupiedTableIds)
    const start = new Date(slot.row.starts_at).getTime()
    const end = start + slot.row.slot_minutes * 60_000
    const ids = new Set<string>()
    for (const item of reservations) {
      if (!item.table_id) continue
      const from = new Date(item.starts_at).getTime()
      const to = new Date(item.ends_at).getTime()
      if (!Number.isNaN(from) && !Number.isNaN(to) && from < end && to > start) ids.add(item.table_id)
    }
    return ids
  }
  const occupiedIds = occupiedAt(selected)
  const freeTables = activeTables.filter((item) => !occupiedIds.has(item.id))
  const bestTable = freeTables.slice().sort((a, b) => b.max_capacity - a.max_capacity)[0] ?? null

  return (
    <>
      <label className={styles.field}>在庫の日付<input type="date" aria-label="在庫の日付" value={date} disabled={busy} onChange={e => { setDate(e.target.value); setAllocOverride(null); setAllocVersions(null); setSlotAlloc(null); setSlotVersion(undefined) }} /></label>
      {loadError ? <Notice tone="warn">{loadError}<Button onClick={() => setRefresh(n=>n+1)}>再読込</Button></Notice> : null}
      <p className={styles.infoBand}>ここは「席（卓）」に対して受ける予約の枠です。担当スタッフなど「人」に対して受ける予約は、予約設定（メニュー・受付枠・担当スタッフ）で決めます。</p>
      {conflict ? (
        <div className={styles.conflict} role="alert">
          <p className={styles.conflictTitle}>ほかの担当者が先に保存しました</p>
          <p className={styles.conflictText}>このまま保存すると、その変更（{conflict.scope}）が消えます</p>
          <div className={styles.conflictActions}>
            <Button onClick={() => setDiffOpen(true)}>違いを比べる</Button>
            <Button
              variant="primary"
              onClick={() => { setConflict(null); resetAll(); setRefresh(n => n + 1); void reload() }}
            >
              最新を読み込んで続ける
            </Button>
          </div>
        </div>
      ) : null}
      {closeTarget && !conflict ? (
        <Notice tone="warn">
          {closeTarget.time}が残り{closeTarget.free}席になりました。媒体の受付を閉じたら記録してください。
          <Button size="compact" onClick={() => { setClosedChannels([]); setCloseNoteOpen(true) }}>閉じる知らせを確認する</Button>
        </Notice>
      ) : null}
      <Dialog
        open={closeNoteOpen}
        onCancel={() => setCloseNoteOpen(false)}
        title={closeTarget ? `${closeTarget.time}が残り${closeTarget.free}席になりました` : '残りが少ない時間帯があります'}
        designNode="Yyw6i"
        footer={(
          <>
            <Button onClick={() => setCloseNoteOpen(false)}>あとで</Button>
            <Button
              variant="primary"
              disabled={closedChannels.length === 0}
              onClick={() => {
                if (closeTarget) setClosedSlots((current) => [...current, closeTarget.row.id])
                setCloseNoteOpen(false)
              }}
            >
              閉じたものを記録する
            </Button>
          </>
        )}
      >
        <p>閉じた媒体に印を付けてください。媒体への書き戻しはしていません（検証環境は受信専用）。閉じた記録はこの画面だけで残します。</p>
        {['Hot Pepper', '食べログ', 'ぐるなび'].map((channel) => (
          <Checkbox
            key={channel}
            checked={closedChannels.includes(channel)}
            onCheckedChange={(checked) => setClosedChannels((current) => (checked ? [...current, channel] : current.filter((item) => item !== channel)))}
          >
            {channel}を閉じた
          </Checkbox>
        ))}
      </Dialog>
      <Dialog
        open={diffOpen}
        onCancel={() => setDiffOpen(false)}
        title="保存しようとした配分と最新の配分"
        footer={<Button variant="primary" onClick={() => setDiffOpen(false)}>閉じる</Button>}
      >
        {conflict && conflictLatest ? (
          <DataTable>
            <TableHeadRow>
              <Th>項目</Th>
              <Th align="right">保存しようとした数</Th>
              <Th align="right">最新の数</Th>
            </TableHeadRow>
            <Tr><Td>OTA（予約媒体）</Td><Td align="right">{conflict.attempted.ota}</Td><Td align="right">{conflictLatest.ota}</Td></Tr>
            <Tr><Td>LINE専用</Td><Td align="right">{conflict.attempted.line}</Td><Td align="right">{conflictLatest.line}</Td></Tr>
            <Tr><Td>当日（ウォークイン）</Td><Td align="right">{conflict.attempted.walkin}</Td><Td align="right">{conflictLatest.walkin}</Td></Tr>
          </DataTable>
        ) : null}
      </Dialog>
      <div className={styles.columns}>
        <div className={styles.mainColumn}>
          <Panel title="席と枠の配分（卓とつながる）" description="総数は「座席・卓管理」の稼働中の卓から自動で決まります。卓を止めると、この総数も減ります。">
            <div className={styles.totalLine}>
              <span className={styles.totalValue}>
                1つの時間帯の総数 {totalSeats}席
                <span className={styles.totalSub}>稼働中の卓 {activeTables.length}つ{stoppedTables.length > 0 ? `（${stoppedTables.map((item) => item.code).join('・')}は停止中のため除く）` : ''}</span>
              </span>
              <Link href="/restaurant-test/tables" className={styles.tablesLink}>座席・卓管理で変える →</Link>
            </div>
            <div className={styles.allocGrid}>
              <label className={styles.field}>OTA（予約媒体）
                <input type="number" min={0} aria-label="OTA（予約媒体）" value={alloc.ota} onChange={(event) => updateAlloc({ ...alloc, ota: Number(event.target.value) })} className={styles.numberInput} />
              </label>
              <label className={styles.field}>LINE専用
                <input type="number" min={0} aria-label="LINE専用" value={alloc.line} onChange={(event) => updateAlloc({ ...alloc, line: Number(event.target.value) })} className={styles.numberInput} />
              </label>
              <label className={styles.field}>当日（ウォークイン）
                <input type="number" min={0} aria-label="当日（ウォークイン）" value={alloc.walkin} onChange={(event) => updateAlloc({ ...alloc, walkin: Number(event.target.value) })} className={styles.numberInput} />
              </label>
              <span className={styles.field}>店頭・電話
                <span className={styles.remainder}>{remainder}（残り）</span>
              </span>
            </div>
            <p className={`${styles.allocNote} ${allocInvalid ? styles.allocNoteInvalid : ''}`}>OTA・LINE・当日の合計が総数を超えると保存できません。予約媒体へは書き戻しません（検証中）</p>
          </Panel>
          <Panel title="開ける時間" description="曜日ごとの営業時間から、選んだ日の枠を30分刻みで作ります。既存の枠は残します。">
            {hoursDraft ? hoursDraft.map(day => <div key={day.weekday} className={styles.slotGrid}>
              <strong>{['日','月','火','水','木','金','土'][day.weekday]}</strong>
              {day.periods.map((period, index) => <div key={index}>
                <input type="time" aria-label={`${day.weekday}曜日 ${index+1}開始`} value={period.opensAt} onChange={e => setHoursDraft(hoursDraft.map(d => d.weekday===day.weekday ? { ...d, periods:d.periods.map((p,i)=>i===index?{...p,opensAt:e.target.value}:p) }:d))} />
                〜<input type="time" aria-label={`${day.weekday}曜日 ${index+1}終了`} value={period.closesAt} onChange={e => setHoursDraft(hoursDraft.map(d => d.weekday===day.weekday ? { ...d, periods:d.periods.map((p,i)=>i===index?{...p,closesAt:e.target.value}:p) }:d))} />
                <Button size="compact" onClick={() => setHoursDraft(hoursDraft.map(d=>d.weekday===day.weekday?{...d,periods:d.periods.filter((_,i)=>i!==index)}:d))}>時間帯を外す</Button>
              </div>)}
              <Button size="compact" onClick={() => setHoursDraft(hoursDraft.map(d=>d.weekday===day.weekday?{...d,periods:[...d.periods,{opensAt:'17:00',closesAt:'22:00'}]}:d))}>時間帯を足す</Button>
            </div>) : <p>営業時間を読み込んでいます。</p>}
            {hoursError ? <p role="alert">{hoursError}</p> : null}
            <div className={styles.slotActions}>
              <Button disabled={busy || !hoursDraft || !opening} onClick={() => {
                if (!selectedAccountId || !store || !hoursDraft) return
                void mutate(async () => {
                  try { const res=await restaurantTestApi.saveOpeningHours(selectedAccountId,{storeId:store.id,hours:hoursDraft,expectedVersion:hoursVersion}); setHoursVersion(res.data.version); setOpening({...opening!,hours:hoursDraft,version:res.data.version}); setHoursError('') }
                  catch(err) { if(err instanceof ApiError && err.status===409) setHoursError('ほかの担当者が先に営業時間を保存しました。最新と比べてから保存してください。'); throw err }
                },'週の営業時間を保存しました。')
              }}>営業時間を保存</Button>
              <Button disabled={busy || !opening} onClick={() => {
                if(!selectedAccountId || !store) return
                void restaurantTestApi.openingHours(selectedAccountId,store.id).then(res=>{setOpening(res.data);setHoursVersion(res.data.version);setHoursDraft(res.data.hours || Array.from({length:7},(_,weekday)=>({weekday,periods:[]})));setHoursError('')}).catch(()=>setHoursError('営業時間を取得できませんでした。'))
              }}>最新の営業時間を読み込む</Button>
              <Button variant="primary" disabled={busy || !opening?.version || allocInvalid} onClick={() => {
                if(!selectedAccountId || !store || !opening) return
                void mutate(()=>restaurantTestApi.generateInventory(selectedAccountId,{storeId:store.id,date,expectedHoursVersion:opening.version,otaCapacity:alloc.ota,lineCapacity:alloc.line,walkInCapacity:alloc.walkin}),'30分刻みの枠を作りました。').then(ok=>{if(ok)setRefresh(n=>n+1)})
              }}>この日の枠を自動作成</Button>
            </div>
          </Panel>
          <Panel title={`時間帯ごとの在庫${rows[0] ? `（${slotDateLabel(rows[0].starts_at)}）` : ''}`} description="予約台帳の予約から、埋まっている卓と空きを出します。行を押すと右に卓の埋まりぐあいが出ます" flush>
            {slots.length === 0 ? (
              <div className={styles.stateBox}><ListState kind="empty" title="在庫の時間帯がありません" description="時間帯の在庫が登録されるとここに出ます。" emptyPreset="readonly" /></div>
            ) : (
              <DataTable>
                <TableHeadRow>
                  <Th>時間</Th>
                  <Th>利用状況</Th>
                  <Th align="right">席数</Th>
                  <Th>埋まっている卓</Th>
                  <Th align="right">空き</Th>
                </TableHeadRow>
                {slots.map((slot) => (
                  <Tr key={slot.row.id} selected={selected?.row.id === slot.row.id}>
                    <Td><button type="button" className={styles.timeButton} onClick={() => { setSelectedId(slot.row.id); setSlotAlloc(null); setSlotVersion(undefined) }}>{slot.time}</button></Td>
                    <Td>
                      <span className={styles.useBar} role="img" aria-label={`利用率 ${Math.round(slot.ratio * 100)}％`}>
                        <span className={`${styles.useFill} ${slot.ratio >= 0.7 ? styles.useFillBusy : ''}`} style={{ width: `${Math.max(4, Math.min(100, Math.round(slot.ratio * 100)))}%` }} />
                      </span>
                    </Td>
                    <Td align="right">{slot.seats}席</Td>
                    <Td>{slot.tables.join('・') || '—'}</Td>
                    <Td align="right"><span className={slot.free / Math.max(totalSeats, 1) < 0.2 ? styles.freeLow : undefined}>{slot.free}席</span></Td>
                  </Tr>
                ))}
              </DataTable>
            )}
          </Panel>
          {selected ? (
            <section className={styles.slotBox} aria-label={`${selected.time}の配分だけ直す`}>
              <h2 className={styles.slotBoxTitle}>行を押したときと：{selected.time}の配分だけ直す</h2>
              <div className={styles.slotGrid}>
                <label className={styles.field}>OTA（予約媒体）
                  <input type="number" min={0} aria-label={`${selected.time}のOTA`} value={currentSlotAlloc.ota} onChange={(event) => updateSlot({ ...currentSlotAlloc, ota: Number(event.target.value) })} className={styles.numberInput} />
                </label>
                <label className={styles.field}>LINE専用
                  <input type="number" min={0} aria-label={`${selected.time}のLINE`} value={currentSlotAlloc.line} onChange={(event) => updateSlot({ ...currentSlotAlloc, line: Number(event.target.value) })} className={styles.numberInput} />
                </label>
                <label className={styles.field}>当日（ウォークイン）
                  <input type="number" min={0} aria-label={`${selected.time}の当日`} value={currentSlotAlloc.walkin} onChange={(event) => updateSlot({ ...currentSlotAlloc, walkin: Number(event.target.value) })} className={styles.numberInput} />
                </label>
              </div>
              <div className={styles.slotActions}>
                <span className={styles.slotBase}>全部の時間帯の配分：OTA {alloc.ota}・LINE {alloc.line}・当日 {alloc.walkin}（上で入れた数）</span>
                <span className={styles.slotButtons}>
                  <Button onClick={() => updateSlot({ ...alloc })}>全体の配分に戻す</Button>
                  <Button variant="primary" disabled={busy || slotInvalid} onClick={saveSlot}>この時間帯だけ保存</Button>
                </span>
              </div>
            </section>
          ) : null}
        </div>
        <Panel title={selected ? `${selected.time}の卓` : '卓の埋まりぐあい'} flush>
          <div style={{ padding: '12px 16px 16px' }}>
            <p className={styles.tablesLegend}>赤＝埋まっている・白＝空き・灰＝停止中</p>
            <ul className={styles.tablesGrid}>
              {tables.map((item) => {
                const occupied = occupiedIds.has(item.id)
                return (
                  <li
                    key={item.id}
                    className={`${styles.tableCell} ${!item.is_active ? styles.tableCellStopped : occupied ? styles.tableCellOccupied : ''}`}
                    aria-label={`${item.code} ${item.max_capacity}名${!item.is_active ? '（停止中）' : occupied ? '（埋まっている）' : '（空き）'}`}
                  >
                    <span className={styles.tableCellName}>{item.code}</span>
                    <span className={styles.tableCellSeats}>{item.max_capacity}名</span>
                  </li>
                )
              })}
            </ul>
            {selected ? (
              <p className={styles.freeInfo}>
                {bestTable ? (
                  <><strong>空き：{bestTable.code}（{bestTable.label} {bestTable.max_capacity}名）</strong><br />{selected.time}に{bestTable.max_capacity}名までなら受けられます</>
                ) : '空きの卓がありません'}
              </p>
            ) : null}
            {selected ? (
              <div className={styles.ledgerButton}>
                <Button href="/restaurant-test/reservations">予約台帳で{selected.time}を見る</Button>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
      <StickyBar
        actions={<><Button onClick={resetAll}>キャンセル</Button><Button variant="primary" disabled={busy || allocInvalid || rows.length === 0} onClick={saveAll}>配分を保存</Button></>}
      />
    </>
  )
}

function InventoryTabs({ ctx }: { ctx: RestaurantV8Context }) {
  const [tab, setTab] = useState<'stock' | 'channels'>('stock')
  const { selectedAccountId } = useAccount()
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Tabs
        label="予約枠・在庫の切り替え"
        items={[
          { label: '時間帯ごとの在庫', current: tab === 'stock', onClick: () => setTab('stock') },
          { label: '予約経路の連携', current: tab === 'channels', onClick: () => setTab('channels') },
        ]}
      />
      {tab === 'stock' ? (
        <InventoryBoard ctx={ctx} />
      ) : selectedAccountId && ctx.selectedStoreId ? (
        <InventoryChannels accountId={selectedAccountId} storeId={ctx.selectedStoreId} connectors={ctx.data.connectors} />
      ) : (
        <ListState kind="empty" title="店舗を選んでください" description="予約経路を見たい店舗を選んでください。" />
      )}
    </div>
  )
}

export default function InventoryV8() {
  return (
    <RestaurantShell boardId="Y8SjT2" title="予約枠・在庫" description="時間帯ごとの総枠と、媒体・LINE・当日枠の配分を確認します。">
      {(ctx) => <InventoryTabs ctx={ctx} />}
    </RestaurantShell>
  )
}
