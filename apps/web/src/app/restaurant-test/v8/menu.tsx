'use client'

/*
 * ★V8-B メニュー管理（板 `MJoJR`）。
 *
 * v7（restaurant-console.tsx の Menu）と同じ口・同じ集計で、板の形に置く：
 * 数5（全メニュー・コース・単品・要承認・アレルギー登録）→「…」の決まりの帯
 * → メニュー一覧の表（行末は「…」・保管済みだけ再開ボタン）。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま。
 * M10 宛て：追加・変更の窓（板 `NkmwU`）は共通の窓部品への置き換えが要る）：
 * - 行の「申請中」の札：承認と品目を結ぶ口が無いので出さない。要承認の数は
 *   帯に出す。承認側に結びができたら札を付ける。
 * - 下書きの「削除」：「…」の決まりに書いてあるが、削除の口が無いので出さない。
 * - 価格の開始日・承認への申請文言は今の口の範囲で出さない。
 */
import { FormEvent, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { useAccount } from '@/contexts/account-context'
import { formatYen } from '@/lib/format'
import { restaurantTestApi, type RestaurantMenuItem } from '@/lib/restaurant-test-api'
import RestaurantShell, { Panel, Stat, Status, type RestaurantV8Context } from './shell'
import shellStyles from './shell.module.css'
import styles from './menu.module.css'

function safeArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function periodLabel(periods: string[]): string {
  return periods.map((period) => (period === 'lunch' ? 'ランチ' : 'ディナー')).join('・') || '—'
}

function MenuBoard({ ctx }: { ctx: RestaurantV8Context }) {
  const { data, store, busy, mutate } = ctx
  const { selectedAccountId } = useAccount()
  const rows = store ? data.menuItems.filter((row) => row.store_id === store.id) : data.menuItems
  const pendingApprovals = data.approvals.filter((item) => item.kind === 'menu_change' && item.status === 'pending')
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
      () => restaurantTestApi.createMenu(selectedAccountId, {
        storeId: store.id,
        kind: fd.get('kind'),
        name: fd.get('name'),
        price: Number(fd.get('price')),
        allergens: String(fd.get('allergens') || '').split(',').map((part) => part.trim()).filter(Boolean),
        servicePeriods: [fd.get('period')],
      }),
      'メニューを追加しました。',
    )
  }

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing || !selectedAccountId) return
    const fd = new FormData(event.currentTarget)
    const period = fd.get('period')
    const ok = await mutate(
      () => restaurantTestApi.updateMenu(selectedAccountId, editing.id, {
        kind: fd.get('kind'),
        name: fd.get('name'),
        price: Number(fd.get('price')),
        allergens: String(fd.get('allergens') || '').split(',').map((part) => part.trim()).filter(Boolean),
        servicePeriods: period === 'both' ? ['lunch', 'dinner'] : [period],
      }),
      'メニューを更新しました。',
    )
    if (ok) setEditingId('')
  }

  const stop = (item: RestaurantMenuItem) => {
    if (!selectedAccountId) return
    void mutate(
      () => restaurantTestApi.updateMenu(selectedAccountId, item.id, { status: 'archived' }),
      'メニューを保管しました。予約履歴の参照は残ります。',
    ).then(() => setStopId(''))
  }

  const resume = (item: RestaurantMenuItem) => {
    if (!selectedAccountId) return
    void mutate(
      () => restaurantTestApi.updateMenu(selectedAccountId, item.id, { status: 'active' }),
      'メニューを再開しました。',
    )
  }

  return (
    <>
      <div className={shellStyles.stats}>
        <Stat label="全メニュー" value={`${rows.length}`} note="公開・下書き・保管済み" />
        <Stat label="コース" value={`${rows.filter((item) => item.kind === 'course').length}`} note="予約時に選択" />
        <Stat label="単品" value={`${rows.filter((item) => item.kind !== 'course').length}`} note="アラカルト" />
        <Stat label="要承認" value={`${pendingApprovals.length}`} note="価格・内容改定" warning={pendingApprovals.length > 0} />
        <Stat label="アレルギー登録" value={`${rows.filter((item) => safeArray(item.allergens_json).length > 0).length}`} note="注意品目あり" />
      </div>
      <p className={styles.legend}>「…」の中身：有効＝変更・停止／保管済み＝変更・再開／一度も公開していない下書き＝変更・削除</p>
      {showForm ? (
        <div data-design-node="NkmwU">
        <Panel title="新しいメニュー">
          <form onSubmit={submit} className={styles.formGrid}>
            <label className={styles.field}>種類
              <select name="kind" aria-label="種類" defaultValue="course" className={styles.select}>
                <option value="course">コース</option>
                <option value="a_la_carte">単品</option>
              </select>
            </label>
            <label className={styles.field}>メニュー名<TextField name="name" required aria-label="メニュー名" /></label>
            <label className={styles.field}>価格（税込）<input name="price" type="number" required aria-label="価格（税込）" className={styles.numberInput} /></label>
            <label className={styles.field}>アレルギー（カンマ区切り）<TextField name="allergens" aria-label="アレルギー（カンマ区切り）" /></label>
            <label className={styles.field}>提供時間
              <select name="period" aria-label="提供時間" defaultValue="lunch" className={styles.select}>
                <option value="lunch">ランチ</option>
                <option value="dinner">ディナー</option>
              </select>
            </label>
            <div className={styles.formActions}>
              <Button type="submit" variant="primary" disabled={busy}>追加する</Button>
            </div>
          </form>
        </Panel>
        </div>
      ) : null}
      {editing ? (
        <div data-design-node="NkmwU">
        <Panel title={`${editing.name}を変更`}>
          <form key={editing.id} onSubmit={(event) => void submitEdit(event)} className={styles.formGrid}>
            <label className={styles.field}>種類
              <select name="kind" aria-label="種類" defaultValue={editing.kind} className={styles.select}>
                <option value="course">コース</option>
                <option value="a_la_carte">単品</option>
              </select>
            </label>
            <label className={styles.field}>メニュー名<TextField name="name" defaultValue={editing.name} required aria-label="メニュー名" /></label>
            <label className={styles.field}>価格（税込）<input name="price" type="number" defaultValue={String(editing.price)} required aria-label="価格（税込）" className={styles.numberInput} /></label>
            <label className={styles.field}>アレルギー（カンマ区切り）<TextField name="allergens" defaultValue={safeArray(editing.allergens_json).join(', ')} aria-label="アレルギー（カンマ区切り）" /></label>
            <label className={styles.field}>提供時間
              <select
                name="period"
                aria-label="提供時間"
                defaultValue={safeArray(editing.service_periods_json).length > 1 ? 'both' : safeArray(editing.service_periods_json)[0] || 'dinner'}
                className={styles.select}
              >
                <option value="lunch">ランチ</option>
                <option value="dinner">ディナー</option>
                <option value="both">ランチ・ディナー</option>
              </select>
            </label>
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
        title="このメニューを停止しますか？"
        description="メニューは保管され、予約履歴の参照は残ります。後で再開できます。"
        confirmLabel="停止する"
        designNode="MV5Os"
        busy={busy}
        onCancel={() => setStopId('')}
        onConfirm={() => { if (stopping) stop(stopping) }}
      />
      <Panel
        title="メニュー一覧"
        description="予約台帳・Google投稿・LINEカードで同じマスターを参照します。価格の改定は承認ワークフローを通り、決めた開始日から新しい価格になります。"
        aside={<Button variant="primary" onClick={() => setShowForm((open) => !open)}>＋ メニューを追加する</Button>}
        flush
      >
        <DataTable>
          <TableHeadRow>
            <Th>メニュー</Th>
            <Th>種類</Th>
            <Th align="right">価格</Th>
            <Th>提供時間</Th>
            <Th>所要時間</Th>
            <Th>アレルギー</Th>
            <Th>状態</Th>
            <Th align="right">操作</Th>
          </TableHeadRow>
          {rows.map((item) => {
            const archived = item.status === 'archived'
            return (
              <Tr key={item.id}>
                <Td><span className={styles.nameCell}>{item.name}</span></Td>
                <Td>{item.kind === 'course' ? 'コース' : '単品'}</Td>
                <Td align="right">{formatYen(item.price)}</Td>
                <Td>{periodLabel(safeArray(item.service_periods_json))}</Td>
                <Td>{item.duration_minutes ? `${item.duration_minutes}分` : '—'}</Td>
                <Td>{safeArray(item.allergens_json).join('・') || 'なし'}</Td>
                <Td><Status value={archived ? 'archived' : 'active'} /></Td>
                <Td align="right">
                  <span className={styles.rowActions}>
                    {archived ? <Button size="compact" disabled={busy} onClick={() => resume(item)}>再開</Button> : null}
                    <RowActions
                      subjectName={item.name}
                      menuItems={[
                        { id: 'edit', label: '変更', onSelect: () => { setEditingId(item.id); setShowForm(false) } },
                        ...(archived
                          ? [{ id: 'resume', label: '再開', onSelect: () => resume(item) }]
                          : [{ id: 'stop', label: '停止', onSelect: () => setStopId(item.id) }]),
                      ]}
                    />
                  </span>
                </Td>
              </Tr>
            )
          })}
        </DataTable>
      </Panel>
    </>
  )
}

export default function MenuV8() {
  return (
    <RestaurantShell boardId="MJoJR" title="メニュー管理" description="コースと単品、価格、アレルギー、提供時間帯を管理します。">
      {(ctx) => <MenuBoard ctx={ctx} />}
    </RestaurantShell>
  )
}
