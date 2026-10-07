'use client'

/*
 * ★V8 メニュー管理（板 `MJoJR`・停止の確認 `MV5Os`・追加と変更 `NkmwU`）。
 *
 * 数5（全メニュー・コース・単品・要承認・アレルギー登録）→ メニュー一覧の枠
 * （頭に追加ボタン・「…」の決まりの帯・表）。行末は「…」、保管済みだけ「再開」。
 * 追加・変更は同じ窓、停止は確認の窓。データの口・送る形は今の画面
 * （app/restaurant-test/v8/menu.tsx）と同じ。動きは BEHAVIOR.md。
 */
import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { useAccount } from '@/contexts/account-context'
import { formatYen } from '@/lib/format'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { fetchApi } from '@/lib/api'
import { restaurantTestApi, type RestaurantMenuItem } from '@/lib/restaurant-test-api'
import RestaurantShell, { Panel, Stat, StatRow, Status, type RestaurantV8Context } from '../booking-kit/shell'
import { DialogField, DialogNote, RowMore, RsDialog } from '../booking-kit/parts'
import styles from './menu.module.css'

export function safeArray(value: string): string[] {
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

type Period = 'lunch' | 'dinner' | 'both'
type Draft = { kind: 'course' | 'a_la_carte'; name: string; price: string; period: Period; effectiveAt: string; allergens: string }

const emptyDraft: Draft = { kind: 'course', name: '', price: '', period: 'dinner', effectiveAt: '', allergens: '' }

function draftOf(item: RestaurantMenuItem): Draft {
  const periods = safeArray(item.service_periods_json)
  return {
    kind: item.kind,
    name: item.name,
    price: String(item.price),
    period: periods.length > 1 ? 'both' : periods[0] === 'lunch' ? 'lunch' : 'dinner',
    effectiveAt: '',
    allergens: safeArray(item.allergens_json).join(', '),
  }
}

function MenuBoard({ ctx }: { ctx: RestaurantV8Context }) {
  const { data, store, busy, mutate } = ctx
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  /* 閲覧のみの人には、追加・変更・停止・再開のボタンを置かない（2026-10-06 オーナー）。 */
  const canEdit = role === null || canManageRole(role)
  const rows = store ? data.menuItems.filter((row) => row.store_id === store.id) : data.menuItems
  const pendingApprovals = data.approvals.filter((item) => item.kind === 'menu_change' && item.status === 'pending')
  /* 窓：'new' は追加、品目の id は変更。 */
  const [editor, setEditor] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [stopId, setStopId] = useState('')
  const [deleteId, setDeleteId] = useState('')
  const editing = editor && editor !== 'new' ? rows.find((row) => row.id === editor) ?? null : null
  const stopping = rows.find((row) => row.id === stopId)
  const deleting = rows.find((row) => row.id === deleteId)
  const priceChanged = Boolean(editing && draft.price !== '' && Number(draft.price) !== editing.price)

  const openNew = () => { setDraft(emptyDraft); setEditor('new') }
  const openEdit = (item: RestaurantMenuItem) => { setDraft(draftOf(item)); setEditor(item.id) }

  const save = async () => {
    if (!selectedAccountId || !draft.name.trim() || draft.price === '') return
    const body = {
      kind: draft.kind,
      name: draft.name,
      price: Number(draft.price),
      effectiveAt: draft.effectiveAt ? new Date(draft.effectiveAt).toISOString() : null,
      allergens: draft.allergens.split(',').map((part) => part.trim()).filter(Boolean),
      servicePeriods: draft.period === 'both' ? ['lunch', 'dinner'] : [draft.period],
    }
    const ok = editing
      ? await mutate(
        () => restaurantTestApi.updateMenu(selectedAccountId, editing.id, body),
        priceChanged ? '価格変更を承認待ちとして申請しました。現在の価格は変わりません。' : 'メニューを更新しました。',
      )
      : store
        ? await mutate(() => restaurantTestApi.createMenu(selectedAccountId, { storeId: store.id, ...body }), 'メニューを追加しました。')
        : false
    if (ok) setEditor(null)
  }

  const stop = (item: RestaurantMenuItem) => {
    if (!selectedAccountId) return
    void mutate(
      () => restaurantTestApi.updateMenu(selectedAccountId, item.id, { status: 'archived' }),
      'メニューを保管しました。予約履歴の参照は残ります。',
    ).then(() => setStopId(''))
  }

  /* 一度も公開していない下書きだけ消せる（サーバが公開済み・申請中・予約で使用中を断る）。 */
  const remove = (item: RestaurantMenuItem) => {
    if (!selectedAccountId) return
    void mutate(
      () => fetchApi(`/api/restaurant-test/menus/${encodeURIComponent(item.id)}?account_id=${encodeURIComponent(selectedAccountId)}`, { method: 'DELETE' }),
      '下書きのメニューを削除しました。',
    ).then(() => setDeleteId(''))
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
      <StatRow>
        <Stat label="全メニュー" value={`${rows.length}`} note="公開・下書き・保管済み" />
        <Stat label="コース" value={`${rows.filter((item) => item.kind === 'course').length}`} note="予約時に選択" />
        <Stat label="単品" value={`${rows.filter((item) => item.kind !== 'course').length}`} note="アラカルト" />
        <Stat label="要承認" value={`${pendingApprovals.length}`} note="価格・内容改定" warning={pendingApprovals.length > 0} />
        <Stat label="アレルギー登録" value={`${rows.filter((item) => safeArray(item.allergens_json).length > 0).length}`} note="注意品目あり" />
      </StatRow>
      <Panel
        title="メニュー一覧"
        description="予約台帳・Google投稿・LINEカードで同じマスターを参照します。価格の改定は承認ワークフローを通り、決めた開始日時から新しい価格になります。"
        aside={canEdit ? (
          <Button variant="primary" onClick={openNew}><Plus size={15} aria-hidden="true" />メニューを追加する</Button>
        ) : null}
        flush
      >
        <p className={styles.legend}>「…」の中身：有効＝変更・停止／保管済み＝変更・再開／一度も公開していない下書き＝変更・削除</p>
        <DataTable className={styles.table}>
          <thead>
            <TableHeadRow className={styles.headRow}>
              <Th className={`${styles.th} ${styles.colName}`}>メニュー</Th>
              <Th className={`${styles.th} ${styles.colKind}`}>種類</Th>
              <Th className={`${styles.th} ${styles.colPrice}`} align="right">価格</Th>
              <Th className={`${styles.th} ${styles.colPeriod}`}>提供時間</Th>
              <Th className={`${styles.th} ${styles.colDuration}`}>所要時間</Th>
              <Th className={`${styles.th} ${styles.colAllergy}`}>アレルギー</Th>
              <Th className={`${styles.th} ${styles.colStatus}`}>状態</Th>
              <Th className={`${styles.th} ${styles.colOps}`} align="right"><span className={styles.srOnly}>操作</span></Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {rows.map((item) => {
              const archived = item.status === 'archived'
              const draftItem = item.status === 'draft'
              const pending = item.pendingPrice != null
              const allergens = safeArray(item.allergens_json)
              return (
                <Tr key={item.id} className={styles.row}>
                  <Td className={`${styles.td} ${styles.colName}`}>
                    {canEdit ? (
                      <button type="button" className={styles.name} title={item.name} onClick={() => openEdit(item)}>{item.name}</button>
                    ) : <span className={styles.name} title={item.name}>{item.name}</span>}
                  </Td>
                  <Td className={styles.td}>{item.kind === 'course' ? 'コース' : '単品'}</Td>
                  <Td className={`${styles.td} ${styles.colPrice}`} align="right">{formatYen(item.price)}</Td>
                  <Td className={styles.td}>{periodLabel(safeArray(item.service_periods_json))}</Td>
                  <Td className={styles.td}>{item.duration_minutes ? `${item.duration_minutes}分` : '—'}</Td>
                  <Td className={styles.td}><span className={styles.clip} title={allergens.join('・') || 'なし'}>{allergens.join('・') || 'なし'}</span></Td>
                  <Td className={styles.td}>
                    {pending ? (
                      <span title={`新価格 ${formatYen(item.pendingPrice ?? 0)}${item.pendingEffectiveAt ? `・${new Date(item.pendingEffectiveAt).toLocaleString('ja-JP')}から` : ''}`}>
                        <Status value="pending" label={item.priceChangeStatus === 'approved' ? '開始待ち' : '申請中'} />
                      </span>
                    ) : <Status value={archived ? 'archived' : draftItem ? 'draft' : item.status === 'paused' ? 'paused' : 'active'} />}
                  </Td>
                  <Td className={`${styles.td} ${styles.colOps}`} align="right">
                    {canEdit ? (
                      <span className={styles.rowActions}>
                        {archived ? <Button disabled={busy} onClick={() => resume(item)}>再開</Button> : null}
                        <RowMore
                          subject={`メニュー「${item.name}」`}
                          items={[
                            { id: 'edit', label: '変更', onSelect: () => openEdit(item) },
                            ...(archived
                              ? [{ id: 'resume', label: '再開', onSelect: () => resume(item) }]
                              : draftItem
                                ? [{ id: 'delete', label: '削除', tone: 'danger' as const, dividerBefore: true, onSelect: () => setDeleteId(item.id) }]
                                : [{ id: 'stop', label: '停止', onSelect: () => setStopId(item.id) }]),
                          ]}
                        />
                      </span>
                    ) : null}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </DataTable>
      </Panel>
      <RsDialog
        open={editor !== null}
        title={editing ? `「${editing.name}」を変更` : 'メニューを追加する'}
        width={560}
        top={180}
        busy={busy}
        designNode="NkmwU"
        onCancel={() => setEditor(null)}
        onSubmit={() => void save()}
        actions={(
          <>
            <Button type="button" onClick={() => setEditor(null)} disabled={busy}>キャンセル</Button>
            <Button type="submit" variant="primary" disabled={busy || !draft.name.trim() || draft.price === ''}>
              <Check size={15} aria-hidden="true" />{editing ? (priceChanged ? '保存して申請する' : '保存する') : '保存して追加する'}
            </Button>
          </>
        )}
      >
        <DialogField label="種類" kind="select">
          <Select aria-label="種類" size="full" value={draft.kind} onChange={(value) => setDraft({ ...draft, kind: value === 'a_la_carte' ? 'a_la_carte' : 'course' })} options={[{ value: 'course', label: 'コース' }, { value: 'a_la_carte', label: '単品' }]} />
        </DialogField>
        <DialogField label="メニュー名" htmlFor="rs-menu-name">
          <TextField id="rs-menu-name" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </DialogField>
        <div className={styles.pair}>
          <DialogField label="価格（税込）" htmlFor="rs-menu-price">
            <TextField id="rs-menu-price" type="number" min={0} required value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
          </DialogField>
          <DialogField label="提供時間" kind="select">
            <Select
              aria-label="提供時間"
              size="full"
              value={draft.period}
              onChange={(value) => setDraft({ ...draft, period: value === 'lunch' ? 'lunch' : value === 'both' ? 'both' : 'dinner' })}
              options={[{ value: 'lunch', label: 'ランチ' }, { value: 'dinner', label: 'ディナー' }, { value: 'both', label: 'ランチ・ディナー' }]}
            />
          </DialogField>
        </div>
        <DialogField label={editing ? '新しい価格の開始日時' : '価格の開始日時'} htmlFor="rs-menu-effective">
          <TextField id="rs-menu-effective" type="datetime-local" value={draft.effectiveAt} onChange={(event) => setDraft({ ...draft, effectiveAt: event.target.value })} />
        </DialogField>
        <DialogField label="アレルギー（カンマ区切り）" htmlFor="rs-menu-allergens">
          <TextField id="rs-menu-allergens" value={draft.allergens} onChange={(event) => setDraft({ ...draft, allergens: event.target.value })} />
        </DialogField>
        <DialogNote>
          {editing
            ? `価格を変えると承認ワークフローへ申請されます。承認されるまで、いまの価格（${formatYen(editing.price)}）のまま出ます。空欄の開始日時は承認後すぐに反映します。`
            : '追加したメニューは、予約台帳・Google投稿・LINEカードで同じマスターとして使われます。あとから価格を変えるときは承認ワークフローへ申請されます。'}
        </DialogNote>
      </RsDialog>
      <RsDialog
        open={Boolean(stopping)}
        title="このメニューを停止しますか？"
        width={480}
        top={300}
        busy={busy}
        designNode="MV5Os"
        onCancel={() => setStopId('')}
        actions={(
          <>
            <Button onClick={() => setStopId('')} disabled={busy}>キャンセル</Button>
            <Button variant="danger" disabled={busy} onClick={() => { if (stopping) stop(stopping) }}>停止する</Button>
          </>
        )}
      >
        <p className={styles.stopName}>{stopping?.name}</p>
        <DialogNote>メニューは保管され、予約履歴の参照は残ります。後で再開できます。</DialogNote>
      </RsDialog>
      <RsDialog
        open={Boolean(deleting)}
        title="この下書きを削除しますか？"
        width={480}
        top={300}
        busy={busy}
        onCancel={() => setDeleteId('')}
        actions={(
          <>
            <Button onClick={() => setDeleteId('')} disabled={busy}>キャンセル</Button>
            <Button variant="danger" disabled={busy} onClick={() => { if (deleting) remove(deleting) }}>削除する</Button>
          </>
        )}
      >
        <p className={styles.stopName}>{deleting?.name}</p>
        <DialogNote>一度も公開していない下書きだけ削除できます。元に戻せません。</DialogNote>
      </RsDialog>
    </>
  )
}

export default function MenuPage() {
  return (
    <RestaurantShell boardId="MJoJR" title="メニュー管理" description="コースと単品、価格、アレルギー、提供時間帯を管理します。">
      {(ctx) => <MenuBoard ctx={ctx} />}
    </RestaurantShell>
  )
}
