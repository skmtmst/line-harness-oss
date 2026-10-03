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
 * - タブ（予約経路の連携・自動で合わせるルール）：中身の板が無いので出さない。
 * - 開ける時間の曜日ごとの編集：週単位で保存する口が無いので出さない。
 *   時間帯ごとの席数は表と箱で直せる。
 * - 下の固定帯の文言：開ける時間が出せないので「配分を保存」にする。
 * v7 を直す必要が出たら向こうも同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
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
  const rows = useMemo(
    () => (store ? data.inventory.filter((row) => row.store_id === store.id) : data.inventory)
      .slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [data.inventory, store],
  )
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
    const labels = [...new Set(overlapping.map((item) => item.table_label || tableById.get(item.table_id ?? '')?.code || '').filter(Boolean))]
    const seats = overlapping.reduce((sum, item) => sum + item.guest_count, 0)
    const free = Math.max(0, totalSeats - seats)
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
  const [allocOverride, setAllocOverride] = useState<Alloc | null>(null)
  const alloc: Alloc = allocOverride ?? (firstRow ? { ota: firstRow.ota_capacity, line: firstRow.line_capacity, walkin: firstRow.walk_in_capacity } : { ota: 0, line: 0, walkin: 0 })
  const [slotAlloc, setSlotAlloc] = useState<Alloc | null>(null)
  const [conflict, setConflict] = useState<{ rowId: string | null; attempted: Alloc; scope: string } | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
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

  const saveAll = () => {
    if (!selectedAccountId || allocInvalid || rows.length === 0) return
    const attempt = { ...alloc }
    void mutate(async () => {
      try {
        for (const row of rows) {
          await restaurantTestApi.updateInventory(selectedAccountId, row.id, { otaCapacity: attempt.ota, lineCapacity: attempt.line, walkInCapacity: attempt.walkin })
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          await reload()
          setConflict({ rowId: null, attempted: attempt, scope: '全部の時間帯' })
          throw new Error('ほかの担当者が先に保存しました。最新の内容を確認してください。')
        }
        throw err
      }
    }, '全部の時間帯に配分を保存しました。外部媒体へは反映していません。')
  }

  const saveSlot = () => {
    if (!selectedAccountId || !selected || slotInvalid) return
    const attempt = { ...currentSlotAlloc }
    void mutate(async () => {
      try {
        await restaurantTestApi.updateInventory(selectedAccountId, selected.row.id, { otaCapacity: attempt.ota, lineCapacity: attempt.line, walkInCapacity: attempt.walkin })
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          await reload()
          setConflict({ rowId: selected.row.id, attempted: attempt, scope: `${selected.time}の時間帯` })
          throw new Error('ほかの担当者が先に保存しました。最新の内容を確認してください。')
        }
        throw err
      }
    }, `${selected.time}の配分だけ保存しました。外部媒体へは反映していません。`).then((ok) => {
      if (ok) setSlotAlloc(null)
    })
  }

  const resetAll = () => {
    setAllocOverride(null)
    setSlotAlloc(null)
  }

  const occupiedAt = (slot: SlotInfo | null) => {
    if (!slot) return new Set<string>()
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
      <p className={styles.infoBand}>ここは「席（卓）」に対して受ける予約の枠です。担当スタッフなど「人」に対して受ける予約は、予約設定（メニュー・受付枠・担当スタッフ）で決めます。</p>
      {conflict ? (
        <div className={styles.conflict} role="alert">
          <p className={styles.conflictTitle}>ほかの担当者が先に保存しました</p>
          <p className={styles.conflictText}>このまま保存すると、その変更（{conflict.scope}）が消えます</p>
          <div className={styles.conflictActions}>
            <Button onClick={() => setDiffOpen(true)}>違いを比べる</Button>
            <Button
              variant="primary"
              onClick={() => { setConflict(null); void reload() }}
            >
              最新を読み込んで続ける
            </Button>
          </div>
        </div>
      ) : null}
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
                <input type="number" min={0} aria-label="OTA（予約媒体）" value={alloc.ota} onChange={(event) => setAllocOverride({ ...alloc, ota: Number(event.target.value) })} className={styles.numberInput} />
              </label>
              <label className={styles.field}>LINE専用
                <input type="number" min={0} aria-label="LINE専用" value={alloc.line} onChange={(event) => setAllocOverride({ ...alloc, line: Number(event.target.value) })} className={styles.numberInput} />
              </label>
              <label className={styles.field}>当日（ウォークイン）
                <input type="number" min={0} aria-label="当日（ウォークイン）" value={alloc.walkin} onChange={(event) => setAllocOverride({ ...alloc, walkin: Number(event.target.value) })} className={styles.numberInput} />
              </label>
              <span className={styles.field}>店頭・電話
                <span className={styles.remainder}>{remainder}（残り）</span>
              </span>
            </div>
            <p className={`${styles.allocNote} ${allocInvalid ? styles.allocNoteInvalid : ''}`}>OTA・LINE・当日の合計が総数を超えると保存できません。予約媒体へは書き戻しません（検証中）</p>
          </Panel>
          <Panel title={`時間帯ごとの在庫${rows[0] ? `（${slotDateLabel(rows[0].starts_at)}）` : ''}`} description="予約台帳の平均から、埋まっている卓と空きを出します。行を押すと右に卓の埋まりぐあいが出ます" flush>
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
                    <Td><button type="button" className={styles.timeButton} onClick={() => { setSelectedId(slot.row.id); setSlotAlloc(null) }}>{slot.time}</button></Td>
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
                  <input type="number" min={0} aria-label={`${selected.time}のOTA`} value={currentSlotAlloc.ota} onChange={(event) => setSlotAlloc({ ...currentSlotAlloc, ota: Number(event.target.value) })} className={styles.numberInput} />
                </label>
                <label className={styles.field}>LINE専用
                  <input type="number" min={0} aria-label={`${selected.time}のLINE`} value={currentSlotAlloc.line} onChange={(event) => setSlotAlloc({ ...currentSlotAlloc, line: Number(event.target.value) })} className={styles.numberInput} />
                </label>
                <label className={styles.field}>当日（ウォークイン）
                  <input type="number" min={0} aria-label={`${selected.time}の当日`} value={currentSlotAlloc.walkin} onChange={(event) => setSlotAlloc({ ...currentSlotAlloc, walkin: Number(event.target.value) })} className={styles.numberInput} />
                </label>
              </div>
              <div className={styles.slotActions}>
                <span className={styles.slotBase}>全部の時間帯の配分：OTA {alloc.ota}・LINE {alloc.line}・当日 {alloc.walkin}（上で入れた数）</span>
                <span className={styles.slotButtons}>
                  <Button onClick={() => setSlotAlloc({ ...alloc })}>全体の配分に戻す</Button>
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

export default function InventoryV8() {
  return (
    <RestaurantShell boardId="Y8SjT2" title="予約枠・在庫" description="時間帯ごとの総枠と、媒体・LINE・当日枠の配分を確認します。">
      {(ctx) => <InventoryBoard ctx={ctx} />}
    </RestaurantShell>
  )
}
