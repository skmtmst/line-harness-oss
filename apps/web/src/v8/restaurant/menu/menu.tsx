'use client'

import { datetimeLocalJstToUtcIso } from '@/lib/jst-datetime'

import { useState } from 'react'
import KpiCard from '@/components/shared/kpi-card'
import { Check, Plus } from 'lucide-react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr, ActionCell, NameCell, RowNameButton } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import DateTimeField from '@/components/shared/date-time-field'
import { useAccount } from '@/contexts/account-context'
import { formatYen } from '@/lib/format'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { fetchApi } from '@/lib/api'
import { restaurantTestApi, type RestaurantMenuItem } from '@/lib/restaurant-test-api'
import RestaurantShell, { Panel, StatRow, Status, type RestaurantV8Context } from '../booking-kit/shell'
import { DialogField, DialogNote, RowMore, RsDialog } from '../booking-kit/parts'
import styles from './menu.module.css'
import { formatDateTime as polishFormatDateTime } from '@/lib/format'
import TruncatedText from '@/components/shared/truncated-text'
import { emptyValue } from '@/components/shared/empty-value'
import NumberInput from '@/components/shared/number-field'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { CreateSummaryCard } from '@/components/templates/create-parts'

/*
 * ★V8 メニュー管理（板 `MJoJR`・停止の確認 `MV5Os`・追加と変更 `NkmwU`）。
 *
 * 数5（全メニュー・コース・単品・要承認・アレルギー登録）→ メニュー一覧の枠
 * （頭に追加ボタン・「…」の決まりの帯・表）。行末は「…」、アーカイブだけ「再開」。
 * 追加・変更は同じ窓、停止は確認の窓。データの口・送る形は今の画面
 * （app/restaurant-test/v8/menu.tsx）と同じ。動きは BEHAVIOR.md。
 */

export function safeArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function periodLabel(periods: string[]): string {
  return periods.map((period) => (period === 'lunch' ? 'ランチ' : 'ディナー')).join('・') || emptyValue('unknown')
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
  const canEdit = canManageRole(role)
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
    if (!canEdit || !selectedAccountId || !draft.name.trim() || draft.price === '') return
    const body = {
      kind: draft.kind,
      name: draft.name,
      price: Number(draft.price),
      effectiveAt: draft.effectiveAt ? datetimeLocalJstToUtcIso(draft.effectiveAt) : null,
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
      {!canEdit ? <ReadOnlyNotice /> : null}
      <StatRow>
        <KpiCard title="全メニュー" valueText={`${rows.length}`} detail="公開・下書き・アーカイブ" presentation="band" value={null} unit="" />
        <KpiCard title="コース" valueText={`${rows.filter((item) => item.kind === 'course').length}`} detail="予約時に選択" presentation="band" value={null} unit="" />
        <KpiCard title="単品" valueText={`${rows.filter((item) => item.kind !== 'course').length}`} detail="アラカルト" presentation="band" value={null} unit="" />
        <KpiCard title="要承認" valueText={`${pendingApprovals.length}`} detail="価格・内容改定" valueTone={pendingApprovals.length > 0 ? 'warning' : 'default'} presentation="band" value={null} unit="" />
        <KpiCard title="アレルギー登録" valueText={`${rows.filter((item) => safeArray(item.allergens_json).length > 0).length}`} detail="注意品目あり" presentation="band" value={null} unit="" />
      </StatRow>
      <Panel
        title="メニュー一覧"
        description="予約台帳・Google投稿・LINEカードで同じマスターを参照します。価格の改定は承認ワークフローを通り、決めた開始日時から新しい価格になります。"
        aside={canEdit ? (
          <Button variant="primary" onClick={openNew}><Plus size={15} aria-hidden="true" />メニューを追加する</Button>
        ) : null}
        flush
      >
        <Notice tone="info">「…」の中身：有効＝変更・停止／アーカイブ＝変更・再開／一度も公開していない下書き＝変更・削除</Notice>
        <DataTable columnLayout={{ headHeight: 'var(--tpl-thead-h)', rowHeight: 'var(--tpl-list-row-h)', gap: 'var(--space-16)', padding: '0 var(--tpl-list-inset)', bodyTextSize: 'var(--text-caption)' }}>
          <thead>
            <TableHeadRow data-table-layout="columns">
              <Th grow>メニュー</Th>
              <Th className={styles.colKind}>種類</Th>
              <Th className={styles.colPrice} align="right">価格</Th>
              <Th collapseAt="narrow" className={styles.colPeriod}>提供時間</Th>
              <Th collapseAt="narrow" className={styles.colDuration}>所要時間</Th>
              <Th className={styles.colAllergy}>アレルギー</Th>
              <Th className={styles.colStatus}>状態</Th>
              <Th className={styles.colOps} align="right">操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {rows.map((item) => {
              const archived = item.status === 'archived'
              const draftItem = item.status === 'draft'
              const pending = item.pendingPrice != null
              const allergens = safeArray(item.allergens_json)
              return (
                <Tr data-row-id={item.id} key={item.id} data-table-layout="columns" onOpen={() => openEdit(item)}>
                  <NameCell grow name={<RowNameButton title={item.name} onClick={() => openEdit(item)}>{item.name}</RowNameButton>} />
                  <Td className={styles.colKind}>{item.kind === 'course' ? 'コース' : '単品'}</Td>
                  <Td className={styles.colPrice} align="right">{formatYen(item.price)}</Td>
                  <Td collapseAt="narrow" className={styles.colPeriod}>{periodLabel(safeArray(item.service_periods_json))}</Td>
                  <Td collapseAt="narrow" className={styles.colDuration}>{item.duration_minutes ? `${item.duration_minutes}分` : emptyValue('unknown')}</Td>
                  <Td className={styles.colAllergy}><TruncatedText value={allergens.join('・') || emptyValue('none')} /></Td>
                  <Td className={styles.colStatus}>
                    {pending ? (
                      <span title={`新価格 ${formatYen(item.pendingPrice ?? 0)}${item.pendingEffectiveAt ? `・${polishFormatDateTime(new Date(item.pendingEffectiveAt))}から` : ''}`}>
                        <Status value="pending" label={item.priceChangeStatus === 'approved' ? '開始待ち' : '申請中'} />
                      </span>
                    ) : <Status value={archived ? 'archived' : draftItem ? 'draft' : item.status === 'paused' ? 'paused' : 'active'} />}
                  </Td>
                  <ActionCell className={styles.colOps}>
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
                  </ActionCell>
                </Tr>
              )
            })}
          </tbody>
        </DataTable>
      </Panel>
      <RsDialog
        open={editor !== null}
        title={editing ? `「${editing.name}」を${canEdit ? '変更' : '見る'}` : 'メニューを追加する'}
        width={560}
        top={180}
        busy={busy}
        designNode="NkmwU"
        onCancel={() => setEditor(null)}
        onSubmit={canEdit ? () => void save() : undefined}
        actions={(
          <>
            <Button type="button" onClick={() => setEditor(null)} disabled={busy}>キャンセル</Button>
            {canEdit ? <Button type="submit" variant="primary" disabled={busy || !draft.name.trim() || draft.price === ''}>
              <Check size={15} aria-hidden="true" />{editing ? (priceChanged ? '保存して申請する' : '保存する') : '保存して追加する'}
            </Button> : null}
          </>
        )}
      >
        {!canEdit ? <ReadOnlyNotice /> : null}
        {editing ? <Notice tone="info">{`提供時間：${periodLabel(safeArray(editing.service_periods_json))} ／ 所要時間：${editing.duration_minutes ? `${editing.duration_minutes}分` : emptyValue('unknown')}`}</Notice> : null}
        {canEdit ? <fieldset className={styles.fields} disabled={busy}>
        <DialogField label="種類" kind="select">
          <SaveErrorField names={["kind","draft.kind"]}><Select aria-label="種類" size="full" value={draft.kind} onChange={(value) => setDraft({ ...draft, kind: value === 'a_la_carte' ? 'a_la_carte' : 'course' })} options={[{ value: 'course', label: 'コース' }, { value: 'a_la_carte', label: '単品' }]} /></SaveErrorField>
        </DialogField>
        <DialogField label="メニュー名" htmlFor="rs-menu-name">
          <SaveErrorField names={["name","draft.name"]}><TextField id="rs-menu-name" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></SaveErrorField>
        </DialogField>
        <div className={styles.pair}>
          <DialogField label="価格（税込）" htmlFor="rs-menu-price">
            <SaveErrorField names={["price","draft.price"]}><NumberInput id="rs-menu-price" type="number" min={0} required value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></SaveErrorField>
          </DialogField>
          <DialogField label="提供時間" kind="select">
            <SaveErrorField names={["period","draft.period"]}><Select
              aria-label="提供時間"
              size="full"
              value={draft.period}
              onChange={(value) => setDraft({ ...draft, period: value === 'lunch' ? 'lunch' : value === 'both' ? 'both' : 'dinner' })}
              options={[{ value: 'lunch', label: 'ランチ' }, { value: 'dinner', label: 'ディナー' }, { value: 'both', label: 'ランチ・ディナー' }]}
            /></SaveErrorField>
          </DialogField>
        </div>
        <DialogField label={editing ? '新しい価格の開始日時' : '価格の開始日時'} htmlFor="rs-menu-effective">
          <SaveErrorField names={["effectiveAt","draft.effectiveAt","effective_at","draft.effective_at"]}><DateTimeField id="rs-menu-effective" value={draft.effectiveAt} onChange={(next) => setDraft({ ...draft, effectiveAt: next })} /></SaveErrorField>
        </DialogField>
        <DialogField label="アレルギー（カンマ区切り）" htmlFor="rs-menu-allergens">
          <SaveErrorField names={["allergens","draft.allergens"]}><TextField id="rs-menu-allergens" value={draft.allergens} onChange={(event) => setDraft({ ...draft, allergens: event.target.value })} /></SaveErrorField>
        </DialogField>
        <DialogNote>
          {editing
            ? `価格を変えると承認ワークフローへ申請されます。承認されるまで、いまの価格（${formatYen(editing.price)}）のまま出ます。空欄の開始日時は承認後すぐに反映します。`
            : '追加したメニューは、予約台帳・Google投稿・LINEカードで同じマスターとして使われます。あとから価格を変えるときは承認ワークフローへ申請されます。'}
        </DialogNote>
        </fieldset> : <CreateSummaryCard title="メニューの内容" description={editing?.pendingPrice != null ? '変更予定の価格は承認後に反映します。開始日時が未設定のときは、承認後すぐに反映します。' : undefined} rows={[
          { label: '種類', value: draft.kind === 'course' ? 'コース' : '単品' },
          { label: 'メニュー名', value: draft.name || emptyValue('unconfigured') },
          { label: '価格（税込）', value: editing ? formatYen(editing.price) : draft.price.trim() ? formatYen(Number(draft.price)) : emptyValue('unconfigured') },
          ...(editing?.pendingPrice != null ? [{ label: '変更予定の価格', value: formatYen(editing.pendingPrice) }] : []),
          { label: '提供時間', value: editing ? periodLabel(safeArray(editing.service_periods_json)) : periodLabel([draft.period]) },
          { label: '所要時間', value: editing?.duration_minutes ? `${editing.duration_minutes}分` : emptyValue('unknown') },
          { label: 'アレルギー', value: draft.allergens || emptyValue('none') },
          { label: '変更後の価格の開始日時', value: editing?.pendingEffectiveAt ? polishFormatDateTime(new Date(editing.pendingEffectiveAt)) : emptyValue('unconfigured') },
        ]} />}
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
    <RestaurantShell headingInset="none" boardId="MJoJR" title="メニュー管理" description="コースと単品、価格、アレルギー、提供時間帯を管理します。">
      {(ctx) => <MenuBoard ctx={ctx} />}
    </RestaurantShell>
  )
}
