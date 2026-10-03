'use client'

/*
 * ★V8-B 座席・卓管理（板 `BERxg`）。
 *
 * v7（restaurant-console.tsx の Tables）と同じ口・同じ集計で、板の形に置く：
 * 数4（卓数・総席数・結合可能・個室）→ ＋卓を追加する → フロアマップ
 * （選ぶと結合札・停止中は灰色）→ 卓の詳細（変更・停止／再開）→ 自動配席ルール。
 * 配置図のドラッグ移動は今の作りのまま扱わない（申送り BERxg の指摘どおり、
 * 閲覧だけ。座標の保存口が無いため動かせない）。
 * - 板 `gBrCz`（追加・変更）：見本は窓だが、共通の窓部品への置き換えは
 *   仕上げ係 M10 の範囲なので、今の作りの枠のまま外枠に印だけ付ける。
 * - 板 `eY9F3`（止める確認）：見本の先の予約の一覧・移し先の選択・LINE通知は、
 *   予約と卓を結ぶ口と通知の口が無いので出さない。今の確認文のまま印だけ付ける。
 * v7 を直す必要が出たら向こうも同じ判断を入れる（V8 完成までの二重管理）。
 */
import { FormEvent, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { TextField } from '@/components/shared/text-field'
import { useAccount } from '@/contexts/account-context'
import { restaurantTestApi, type RestaurantTable } from '@/lib/restaurant-test-api'
import RestaurantShell, { Panel, Stat, Status, type RestaurantV8Context } from './shell'
import shellStyles from './shell.module.css'
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

function TablesBoard({ ctx }: { ctx: RestaurantV8Context }) {
  const { data, store, busy, mutate } = ctx
  const { selectedAccountId } = useAccount()
  const rows = store ? data.tables.filter((row) => row.store_id === store.id) : data.tables
  const [selectedId, setSelectedId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [stopId, setStopId] = useState('')
  const editing = rows.find((row) => row.id === editingId)
  const stopping = rows.find((row) => row.id === stopId)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!store || !selectedAccountId) return
    const fd = new FormData(event.currentTarget)
    void mutate(
      () => restaurantTestApi.createTable(selectedAccountId, {
        storeId: store.id,
        code: fd.get('code'),
        label: fd.get('label'),
        seatType: fd.get('seatType'),
        minCapacity: Number(fd.get('minCapacity')),
        maxCapacity: Number(fd.get('maxCapacity')),
      }),
      '卓を追加しました。',
    )
  }

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing || !selectedAccountId) return
    const fd = new FormData(event.currentTarget)
    const ok = await mutate(
      () => restaurantTestApi.updateTable(selectedAccountId, editing.id, {
        code: fd.get('code'),
        label: fd.get('label'),
        seatType: fd.get('seatType'),
        minCapacity: Number(fd.get('minCapacity')),
        maxCapacity: Number(fd.get('maxCapacity')),
      }),
      '卓を更新しました。',
    )
    if (ok) setEditingId('')
  }

  const stop = (table: RestaurantTable) => {
    if (!selectedAccountId) return
    void mutate(
      () => restaurantTestApi.updateTable(selectedAccountId, table.id, { isActive: false }),
      '卓を停止しました。予約履歴と卓の情報は残ります。',
    ).then(() => setStopId(''))
  }

  const resume = (table: RestaurantTable) => {
    if (!selectedAccountId) return
    void mutate(
      () => restaurantTestApi.updateTable(selectedAccountId, table.id, { isActive: true }),
      '卓を再開しました。',
    )
  }

  return (
    <>
      <div className={shellStyles.stats}>
        <Stat label="卓数" value={`${rows.length}`} note="稼働・停止を含む" />
        <Stat label="総席数" value={`${rows.reduce((sum, item) => sum + item.max_capacity, 0)}`} note="最大収容人数" />
        <Stat label="結合可能" value={`${new Set(rows.filter((item) => item.join_group).map((item) => item.join_group)).size}`} note="結合グループ" />
        <Stat label="個室" value={`${rows.filter((item) => item.seat_type === 'private_room').length}`} note="個室卓" />
      </div>
      <div className={styles.addRow}>
        <Button variant="primary" onClick={() => setShowForm((open) => !open)}>＋ 卓を追加する</Button>
      </div>
      {showForm ? (
        <div data-design-node="gBrCz">
        <Panel title="新しい卓">
          <form onSubmit={submit} className={styles.formGrid}>
            <label className={styles.field}>卓番<TextField name="code" required aria-label="卓番" /></label>
            <label className={styles.field}>表示名<TextField name="label" required aria-label="表示名" /></label>
            <label className={styles.field}>席種
              <select name="seatType" aria-label="席種" defaultValue="table" className={styles.select}>
                {SEAT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className={styles.field}>最小人数<input name="minCapacity" type="number" defaultValue="1" required aria-label="最小人数" className={styles.numberInput} /></label>
            <label className={styles.field}>最大人数<input name="maxCapacity" type="number" defaultValue="4" required aria-label="最大人数" className={styles.numberInput} /></label>
            <div className={styles.formActions}>
              <Button type="submit" variant="primary" disabled={busy}>追加する</Button>
            </div>
          </form>
        </Panel>
        </div>
      ) : null}
      {editing ? (
        <div data-design-node="gBrCz">
        <Panel title={`${editing.code}・${editing.label}を変更`}>
          <form key={editing.id} onSubmit={(event) => void submitEdit(event)} className={styles.formGrid}>
            <label className={styles.field}>卓番<TextField name="code" defaultValue={editing.code} required aria-label="卓番" /></label>
            <label className={styles.field}>表示名<TextField name="label" defaultValue={editing.label} required aria-label="表示名" /></label>
            <label className={styles.field}>席種
              <select name="seatType" aria-label="席種" defaultValue={editing.seat_type} className={styles.select}>
                {SEAT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className={styles.field}>最小人数<input name="minCapacity" type="number" defaultValue={String(editing.min_capacity)} required aria-label="最小人数" className={styles.numberInput} /></label>
            <label className={styles.field}>最大人数<input name="maxCapacity" type="number" defaultValue={String(editing.max_capacity)} required aria-label="最大人数" className={styles.numberInput} /></label>
            <div className={styles.formActions}>
              <Button type="button" onClick={() => setEditingId('')}>キャンセル</Button>
              <Button type="submit" variant="primary" disabled={busy}>保存する</Button>
            </div>
          </form>
        </Panel>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(stopping)}
        title="この卓を停止しますか？"
        description="予約履歴と卓の情報は残ります。停止中の卓は自動配席の候補から外れ、後で再開できます。"
        confirmLabel="停止する"
        designNode="eY9F3"
        busy={busy}
        onCancel={() => setStopId('')}
        onConfirm={() => { if (stopping) stop(stopping) }}
      />
      <Panel title="フロアマップ" description="ドラッグ配置は切り離し後の専用サーバーで永続化します。" flush>
        <ul className={styles.mapGrid}>
          {rows.map((item) => {
            const selected = item.id === selectedId
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`${styles.mapCard} ${item.is_active ? '' : styles.mapCardStopped}`}
                  aria-pressed={selected}
                  aria-label={`${item.code} ${item.label} ${item.min_capacity}〜${item.max_capacity}名${item.is_active ? '' : '（停止中）'}`}
                  onClick={() => setSelectedId((current) => (current === item.id ? '' : item.id))}
                >
                  <span className={styles.mapCode}>{item.code}</span>
                  <span className={styles.mapLabel}>{item.label}</span>
                  <span className={styles.mapCapacity}>{item.min_capacity}〜{item.max_capacity}名</span>
                  {selected && item.join_group ? <span className={styles.mapJoin}>結合 {item.join_group}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </Panel>
      <Panel title="卓の詳細" flush>
        <ul className={styles.detailList}>
          {rows.map((item) => (
            <li key={item.id} className={styles.detailRow}>
              <div className={styles.detailMain}>
                <p className={styles.detailName}>{item.code}・{item.label}</p>
                <p className={styles.detailSub}>{seatTypeLabel(item.seat_type)}／{item.min_capacity}〜{item.max_capacity}名</p>
              </div>
              <Status value={item.is_active ? 'active' : 'suspended'} />
              <div className={styles.detailActions}>
                <Button size="compact" disabled={busy} onClick={() => { setEditingId(item.id); setShowForm(false) }}>変更</Button>
                {item.is_active
                  ? <Button size="compact" disabled={busy} onClick={() => setStopId(item.id)}>停止</Button>
                  : <Button size="compact" disabled={busy} onClick={() => resume(item)}>再開</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="自動配席ルール">
        <div className={shellStyles.panelBody}>
          <p className={styles.ruleTitle}>収容差が最小の卓を優先</p>
          <p className={styles.ruleText}>少人数予約で大型卓を占有しないよう、人数を収容できる卓のうち余剰席が最も少ない卓を候補にします。結合卓は同一グループとして次段階で評価します。</p>
        </div>
      </Panel>
    </>
  )
}

export default function TablesV8() {
  return (
    <RestaurantShell boardId="BERxg" title="座席・卓管理" description="フロア配置、席種、収容人数、結合ルールを管理します。">
      {(ctx) => <TablesBoard ctx={ctx} />}
    </RestaurantShell>
  )
}
