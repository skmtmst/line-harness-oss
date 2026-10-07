'use client'

/*
 * ★V8 他のサイトの枠を閉じる知らせ（提案 E-5 `YMVFD`。ダッシュボードの「すべて見る」から）。
 *
 * 未対応／閉じた で切り替え。1行＝1つの枠（時刻）。閉じる媒体は札で並べ、閉じた媒体には ✓。
 * ［閉じた］は媒体ごと（まだ閉じていない先頭の媒体。ほかの媒体は「…」から）。
 * 席が空いた枠は「もう開けてよい」。読む口・書く口は channel-close-tasks（今ある口）だけ。動きは BEHAVIOR.md。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { RestaurantChannelCloseTask } from '@line-crm/shared'
import { ListPage } from '@/components/templates/list-page'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { notifyToast } from '@/components/shared/toast'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { fetchApi } from '@/lib/api'
import { useStaffRole } from '@/lib/staff-role'
import { restaurantTestApi } from '@/lib/restaurant-test-api'
import { type CloseGroup, canWriteRole, groupCloseTasks, openItems, reasonText, slotTitle } from '../dashboard/summarize'
import { type StoreMedium, toMedia } from '../dashboard/use-store-today'
import styles from './close-tasks.module.css'

type Tab = 'open' | 'done'

const STATE_BADGE: Record<CloseGroup['state'], { label: string; tone: 'danger' | 'warning' | 'info' | 'success' }> = {
  open: { label: '未対応', tone: 'danger' },
  partly: { label: '残りあり', tone: 'warning' },
  reopen: { label: 'もう開けてよい', tone: 'info' },
  done: { label: '閉じた', tone: 'success' },
}

export default function CloseTasksPage() {
  usePageTitle('枠を閉じる知らせ')
  usePageCrumbs([{ label: '店舗ダッシュボード', href: '/restaurant-test/dashboard' }])
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const canWrite = canWriteRole(role)
  const [storeId, setStoreId] = useState('')
  const [tasks, setTasks] = useState<RestaurantChannelCloseTask[] | null>(null)
  const [media, setMedia] = useState<StoreMedium[]>([])
  const [error, setError] = useState<unknown>(null)
  const [tab, setTab] = useState<Tab>('open')
  const [query, setQuery] = useState('')
  const [medium, setMedium] = useState('all')
  const [busyId, setBusyId] = useState('')

  /* 店舗：選んでいる店舗（store-context）→ 無ければ先頭（ダッシュボードと同じ）。 */
  useEffect(() => {
    let current = true
    if (!selectedAccountId) return
    void Promise.all([
      restaurantTestApi.listStores(selectedAccountId),
      restaurantTestApi.storeContext(selectedAccountId).catch(() => null),
    ]).then(([stores, context]) => {
      if (!current) return
      const selected = context?.data.selectedStore?.id
      setStoreId(stores.data.stores.some((s) => s.id === selected) ? selected! : stores.data.stores[0]?.id ?? '')
      if (stores.data.stores.length === 0) setTasks([])
    }).catch((caught) => { if (current) setError(caught) })
    return () => { current = false }
  }, [selectedAccountId])

  const load = useCallback(async () => {
    if (!selectedAccountId || !storeId) return
    try {
      const [list, channels] = await Promise.all([
        restaurantTestApi.channelCloseTasks(selectedAccountId, storeId),
        fetchApi<{ success: true; data: Array<{ code: string; name: string; receiveMethod?: string }> }>(`/api/restaurant-test/channels?account_id=${encodeURIComponent(selectedAccountId)}&storeId=${encodeURIComponent(storeId)}`)
          .then((res) => toMedia(res.data)).catch(() => [] as StoreMedium[]),
      ])
      setTasks(list.data); setMedia(channels); setError(null)
    } catch (caught) {
      setError(caught)
    }
  }, [selectedAccountId, storeId])
  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => groupCloseTasks(tasks ?? [], media), [tasks, media])
  const openCount = groups.filter((g) => g.state !== 'done').length
  const doneCount = groups.length - openCount
  const shown = groups
    .filter((g) => (tab === 'open' ? g.state !== 'done' : g.state === 'done'))
    .filter((g) => medium === 'all' || g.items.some((item) => item.channel === medium))
    .filter((g) => !query.trim() || slotTitle(g.startsAt).includes(query.trim()) || g.items.some((item) => item.name.includes(query.trim())))
  const mediaOptions = [...new Map(groups.flatMap((g) => g.items).map((item) => [item.channel, item.name])).entries()]

  const close = async (taskId: string, name: string) => {
    if (!selectedAccountId) return
    setBusyId(taskId)
    try {
      await restaurantTestApi.completeChannelCloseTask(selectedAccountId, taskId)
      notifyToast(`${name}の枠を閉じた印を付けました。`)
    } catch (caught) {
      notifyToast(caught instanceof Error && caught.message ? caught.message : '印を付けられませんでした。', { tone: 'error' })
    } finally {
      await load()
      setBusyId('')
    }
  }

  let content
  if (error && tasks === null) content = <ListState kind="error" error={error} onRetry={() => void load()} />
  else if (tasks === null) content = <ListState kind="loading" />
  else if (shown.length === 0) {
    content = <ListState kind="empty" title={tab === 'open' ? '未対応の知らせはありません' : '閉じた知らせはありません'} description={tab === 'open' ? '他の予約サイトの枠を閉じる必要があると、ここに出ます。' : undefined} />
  } else {
    content = (
      <DataTable data-design="restaurant-close-tasks">
        <thead>
          <TableHeadRow>
            <Th className={styles.colSlot}>枠の日時</Th>
            <Th>閉じる媒体</Th>
            <Th className={styles.colState}>状態</Th>
            <Th className={styles.colActions}>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {shown.map((group) => {
            const remaining = openItems(group)
            const target = remaining[0] ?? null
            const badge = STATE_BADGE[group.state]
            return (
              <Tr key={group.slotId}>
                <Td className={styles.colSlot}>
                  <span className={styles.slot}>{slotTitle(group.startsAt)}</span>
                  <span className={styles.reason}>{reasonText(group)}</span>
                </Td>
                <Td>
                  <span className={styles.chips}>
                    {group.items.map((item) => (
                      <span key={item.id} className={`${styles.chip} ${item.status === 'done' ? styles.chipDone : ''}`}>
                        {item.name}{item.status === 'done' ? <Check size={12} aria-label="閉じた" /> : null}
                      </span>
                    ))}
                  </span>
                </Td>
                <Td className={styles.colState}>
                  <StatusBadge tone={badge.tone}>{group.state === 'partly' ? `残り ${remaining.length}つ` : badge.label}</StatusBadge>
                </Td>
                <Td className={styles.colActions}>
                  <span className={styles.actions}>
                    {canWrite && target ? (
                      <Button size="compact" onClick={() => void close(target.id, target.name)} disabled={busyId === target.id} aria-label={`${target.name}の枠を閉じた`} title={`${target.name}の枠を閉じた`}>
                        <Check size={15} aria-hidden="true" />閉じた
                      </Button>
                    ) : null}
                    {canWrite && remaining.length > 1 ? (
                      <RowActions
                        subjectName={slotTitle(group.startsAt)}
                        menuItems={remaining.slice(1).map((item) => ({ id: item.id, label: `${item.name}を閉じた`, onSelect: () => void close(item.id, item.name) }))}
                      />
                    ) : null}
                  </span>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    )
  }

  return (
    <ListPage
      boardId="YMVFD"
      title="他のサイトの枠を閉じる知らせ"
      help="LINE や電話で予約が入って席が少なくなった枠を、ほかの予約サイトでも閉じるための知らせです。閉じたら［閉じた］を押します。キャンセルで席が戻った枠は「もう開けてよい」になります。"
      tabs={(
        <Tabs
          label="知らせの状態"
          items={[
            { label: '未対応', count: openCount, current: tab === 'open', onClick: () => setTab('open') },
            { label: '閉じた', count: doneCount, current: tab === 'done', onClick: () => setTab('done') },
          ]}
        />
      )}
      toolbar={(
        <>
          <span className={styles.search}>
            <SearchField aria-label="日時・媒体で探す" placeholder="日時・媒体で探す" value={query} onChange={setQuery} onClear={() => setQuery('')} />
          </span>
          <Select
            aria-label="媒体で絞る"
            value={medium}
            onChange={setMedium}
            options={[{ value: 'all', label: '媒体：すべて' }, ...mediaOptions.map(([code, name]) => ({ value: code, label: `媒体：${name}` }))]}
          />
        </>
      )}
    >
      {content}
    </ListPage>
  )
}
