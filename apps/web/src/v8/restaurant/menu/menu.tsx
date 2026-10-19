'use client'


import { useState } from 'react'
import KpiCard from '@/components/shared/kpi-card'
import { Plus } from 'lucide-react'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { DataTable, TableHeadRow, Td, Th, Tr, ActionCell, NameCell, RowNameButton } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import { formatYen } from '@/lib/format'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { fetchApi } from '@/lib/api'
import { restaurantTestApi, type RestaurantMenuItem } from '@/lib/restaurant-test-api'
import { RestaurantShell, Panel, StatRow, Status, type RestaurantV8Context } from '@/v8/restaurant/booking-kit/public/shell/index'
import { DialogNote, RowMore, RsDialog } from '@/v8/restaurant/booking-kit/public/parts/index'
import styles from './menu.module.css'
import { formatDateTime as polishFormatDateTime } from '@/lib/format'
import TruncatedText from '@/components/shared/truncated-text'
import { emptyValue } from '@/components/shared/empty-value'

/*
 * ★V8 メニュー管理（板 ・停止の確認 ・追加と変更 ）。
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

export function periodLabel(periods: string[]): string {
  return periods.map((period) => (period === 'lunch' ? 'ランチ' : 'ディナー')).join('・') || emptyValue('unknown')
}

function MenuBoard({ ctx }: { ctx: RestaurantV8Context }) {
  const { data, store, busy, mutate } = ctx
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  /* 閲覧のみの人には、追加・変更・停止・再開のボタンを置かない（2026-10-06 オーナー）。 */
  const canEdit = canManageRole(role)
  const rows = store ? data.menuItems.filter((row) => row.store_id === store.id) : data.menuItems
  const pendingApprovals = data.approvals.filter((item) => item.kind === 'menu_change' && item.status === 'pending')
  const [stopId, setStopId] = useState('')
  const [deleteId, setDeleteId] = useState('')
  const stopping = rows.find((row) => row.id === stopId)
  const deleting = rows.find((row) => row.id === deleteId)
  /* 追加・変更は 1 枚の編集ページ（mauOC）。前の窓は消した。 */
  const router = useRouter()
  const openNew = () => router.push(`/restaurant-test/menu/edit${store ? `?store=${encodeURIComponent(store.id)}` : ''}`)
  const openEdit = (item: RestaurantMenuItem) => router.push(`/restaurant-test/menu/edit?id=${encodeURIComponent(item.id)}`)

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
        <KpiCard title="全メニュー" value={rows.length} unit="公開・下書き・アーカイブ" detail={null} presentation="band" />
        <KpiCard title="コース" value={rows.filter((item) => item.kind === 'course').length} unit="予約時に選択" detail={null} presentation="band" />
        <KpiCard title="単品" value={rows.filter((item) => item.kind !== 'course').length} unit="アラカルト" detail={null} presentation="band" />
        <KpiCard title="要承認" value={pendingApprovals.length} unit="価格・内容改定" detail={null} valueTone={pendingApprovals.length > 0 ? 'warning' : 'default'} presentation="band" />
        <KpiCard title="アレルギー登録" value={rows.filter((item) => safeArray(item.allergens_json).length > 0).length} unit="注意品目あり" detail={null} presentation="band" />
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
