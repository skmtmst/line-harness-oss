'use client'

/*
 * ★V8 統合ユーザー（Pencil `ADjK8`）。/friends?tab=merged。
 *
 * データの口は今と同じ（/api/users-grouped・/api/duplicates/stats・CSV の全件書き出し）。
 * 詳細（`Hn9eE`）は今と同じく一覧の面を差し替える。URL の `?person=<id>` でも開ける。
 *
 * 絵の列「配信に使うアカウント」「結び付けた日」は一覧の API に無い。
 * 今の列（状態・最終接触）をその位置に出す（情報を落とさない）。
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronUp, Download, MoreHorizontal, RotateCw } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, formatDay, formatNumber } from '@/lib/format'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Checkbox from '@/components/shared/checkbox'
import KpiCard from '@/components/shared/kpi-card'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import ListState from '@/components/shared/list-state'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { mergedPersonIdOf } from '@/components/merged-person/merged-person-view'
import type { UserRowData } from '@/components/users/user-row'
import { FriendsSectionHead } from '../shared/head'
import MergedPersonV8 from './person'
import { useMergedUsers, USERS_PAGE_SIZES } from './use-merged-users'
import styles from './merged.module.css'

const UID_STATUS = {
  url_token: '要確認',
  uid: 'UIDで連携',
  solo: '未連携',
} as const

export default function MergedUsersV8() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const personFromUrl = searchParams.get('person')
  const [openedPersonId, setOpenedPersonId] = useState<string | null>(personFromUrl)
  useEffect(() => { setOpenedPersonId(personFromUrl) }, [personFromUrl])

  if (openedPersonId) {
    return (
      <MergedPersonV8
        personId={openedPersonId}
        onClose={() => {
          setOpenedPersonId(null)
          if (personFromUrl) router.replace('/friends?tab=merged')
        }}
      />
    )
  }
  return <MergedUsersList onOpen={setOpenedPersonId} />
}

function MergedUsersList({ onOpen }: { onOpen: (personId: string) => void }) {
  usePageTitle('統合ユーザー')
  const u = useMergedUsers()
  const staffRole = useStaffRole()
  const canManage = staffRole === null || canManageRole(staffRole)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  // 「統合ユーザー」の数は重複検出の集計（uniquePeople）。今と同じ口。
  const [uniquePeople, setUniquePeople] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    api.duplicates.stats().then((res) => {
      if (alive && res.success) setUniquePeople(res.data.uniquePeople)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const pageCount = Math.max(1, Math.ceil(u.total / u.pageSize))
  const linkedUidCount = u.rows.filter((row) => row.identityKeyKind === 'uid').length
  const multiAccountCount = u.rows.filter((row) => row.accounts.length > 1).length

  const kpis = [
    { key: 'people', title: '統合ユーザー', value: uniquePeople, help: '重複を1人にまとめた数です。' },
    { key: 'uid', title: 'UID連携済み', value: u.loading ? null : linkedUidCount, help: 'このページに出ている人のうち、LINE UIDを根拠にまとめている数です（このページでUID確認済み）。' },
    { key: 'multi', title: '複数アカウントにいる', value: u.loading ? null : multiAccountCount, help: 'このページに出ている人のうち、2つ以上のLINEアカウントに登録がある数です。送信前に配信先の確認が必要です。' },
  ]

  return (
    <PageFrame kind="list" boardId="ADjK8">
      <FriendsSectionHead current="merged" description="結び付けて、同じ人として扱っている人の一覧です" />
      <div className={styles.body}>
        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => u.setPendingForceRefresh(true)}
            disabled={u.refreshing}
            busy={u.refreshing}
            busyLabel="再計算中…"
            title="最新の状態を取得して一覧を更新"
          >
            <RotateCw size={14} aria-hidden="true" />
            再計算
          </Button>
          {canManage ? (
            <Button type="button" variant="secondary" onClick={() => void u.exportCsv()} disabled={u.exporting} busy={u.exporting} busyLabel="書き出し中…">
              <Download size={14} aria-hidden="true" />
              CSVで書き出す
            </Button>
          ) : null}
          {canManage ? (
            <Button variant="primary" href="/friends/identity-candidates">
              統合ユーザーを作る
            </Button>
          ) : null}
        </div>
        {u.exportError ? <p className={styles.error} role="alert">{u.exportError}</p> : null}

        <div className={styles.cards}>
          {kpis.map((kpi) => (
            <KpiCard
              key={kpi.key}
              presentation="card"
              icon={null}
              title={kpi.title}
              value={kpi.value}
              valueText={kpi.value == null ? '—' : `${formatNumber(kpi.value)} 人`}
              unit="人"
              detail={null}
              help={kpi.help}
              className={styles.card}
            />
          ))}
        </div>

        <div className={styles.filters}>
          <Select
            aria-label="UID連携で絞り込む"
            width={180}
            value={u.uid}
            onChange={u.setUid}
            options={[
              { value: '', label: 'UID連携：すべて' },
              { value: 'linked', label: 'UID連携：連携済み' },
              { value: 'unlinked', label: 'UID連携：未連携・要確認' },
            ]}
          />
          <Select
            aria-label="所属アカウントで絞り込む"
            width={200}
            value={u.account}
            onChange={u.setAccount}
            options={[
              { value: '', label: '所属アカウント：すべて' },
              ...u.accountOptions.map((a) => ({ value: a.id, label: `所属アカウント：${a.name}` })),
            ]}
          />
          <Checkbox checked={u.onlyDups} onCheckedChange={u.setOnlyDups}>複数アカウントのみ</Checkbox>
        </div>

        <div className={styles.listArea}>
          <div className={styles.searchRow}>
            <div className={styles.search}>
              <SearchField aria-label="統合ユーザーを探す" value={u.q} onChange={u.setQ} onClear={() => u.setQ('')} placeholder="名前・メール・電話で探す" />
            </div>
            <Select
              aria-label="表示件数"
              width={96}
              value={String(u.pageSize)}
              onChange={(value) => u.setPageSize(Number(value))}
              options={USERS_PAGE_SIZES.map((size) => ({ value: String(size), label: `${size}件表示` }))}
            />
          </div>

          <section className={styles.panel} aria-labelledby="merged-users-title">
            <div className={styles.panelHead}>
              <h3 id="merged-users-title" className={styles.panelTitle}>統合ユーザー</h3>
              <p className={styles.panelSub}>{u.loading && u.total === 0 ? '更新中…' : `${formatNumber(u.total)}人`}</p>
            </div>
            <DataTable className={styles.table}>
              <colgroup>
                <col />
                <col className={styles.colFriends} />
                <col className={styles.colState} />
                <col className={styles.colDate} />
                <col className={styles.colMenu} />
              </colgroup>
              <thead>
                <TableHeadRow>
                  <Th className={styles.th}>人</Th>
                  <Th className={styles.th}>結び付いた友だち</Th>
                  <Th className={styles.th}>状態</Th>
                  <Th className={styles.th}>最終接触</Th>
                  <Th className={styles.th}><span className="sr-only">操作</span></Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {u.error ? (
                  <tr><td colSpan={5} className={styles.stateCell}>
                    <ListState kind="error" title="統合ユーザーを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。" onRetry={() => void u.load()} />
                  </td></tr>
                ) : u.loading && u.rows.length === 0 ? (
                  <tr><td colSpan={5} className={styles.stateCell}><ListState kind="loading" title="読み込んでいます" /></td></tr>
                ) : u.rows.length === 0 ? (
                  <tr><td colSpan={5} className={styles.stateCell}>
                    <ListState kind="empty" title="条件に合う人はいません" description="検索や絞り込みを外すと、すべて出ます。" />
                  </td></tr>
                ) : u.rows.flatMap((row) => {
                  const personId = mergedPersonIdOf(row)
                  const open = expanded === row.identityKey
                  const items: ActionMenuItem[] = [
                    ...(personId ? [{ id: 'open', label: '詳細を見る', onSelect: () => onOpen(personId) }] : []),
                    { id: 'accounts', label: open ? '登録アカウントを閉じる' : '登録アカウントを見る', onSelect: () => setExpanded(open ? null : row.identityKey) },
                  ]
                  const main = (
                    <Tr key={row.identityKey} className={styles.row}>
                      <Td className={styles.td}>
                        <div className={styles.person}>
                          {personId ? (
                            <button type="button" className={styles.name} onClick={() => onOpen(personId)} data-qa-open="Hn9eE">{row.displayName || '名前なし'}</button>
                          ) : (
                            <span className={`${styles.name} ${styles.nameStatic}`}>{row.displayName || '—'}</span>
                          )}
                          <span className={styles.contact}>{row.emails[0] ?? row.phones[0] ?? '—'}</span>
                        </div>
                      </Td>
                      <Td className={styles.td}>
                        <span className={styles.cellText} title={row.accounts.map((a) => a.accountName).join('・')}>
                          {`${row.accounts.length}（${row.accounts.map((a) => a.accountName).join('・')}）`}
                        </span>
                      </Td>
                      <Td className={styles.td}>
                        <span className={styles.badges}>
                          <StatusBadge tone={row.identityKeyKind === 'url_token' ? 'warning' : row.identityKeyKind === 'uid' ? 'success' : 'neutral'} size="compact">
                            {UID_STATUS[row.identityKeyKind]}
                          </StatusBadge>
                          {row.isDuplicate ? <StatusBadge tone="warning" size="compact">要確認</StatusBadge> : null}
                        </span>
                      </Td>
                      <Td className={styles.td}><span className={styles.cellText}>{formatDateTime(row.lastActivityAt)}</span></Td>
                      <Td className={styles.tdMenu}>
                        <RowMenu label={`${row.displayName || '名前なし'}の操作`} items={items} open={menuFor === row.identityKey} onOpenChange={(next) => setMenuFor(next ? row.identityKey : null)} />
                      </Td>
                    </Tr>
                  )
                  if (!open) return [main]
                  return [main, <AccountsRow key={`${row.identityKey}-accounts`} row={row} onClose={() => setExpanded(null)} />]
                })}
              </tbody>
            </DataTable>
            {u.total > 0 && !u.error ? (
              <div className={styles.pager}>
                <span className={styles.pagerCount}>
                  {`${formatNumber(u.total)}人中 ${formatNumber((u.page - 1) * u.pageSize + 1)}〜${formatNumber(Math.min(u.page * u.pageSize, u.total))}人`}
                </span>
                {pageCount > 1 ? <Pagination page={u.page} pageCount={pageCount} onPageChange={u.setPage} disabled={u.loading} ariaLabel="統合ユーザーのページ" /> : null}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </PageFrame>
  )
}

function RowMenu({ label, items, open, onOpenChange }: { label: string; items: ActionMenuItem[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  return (
    <span className={styles.menuBox} ref={anchorRef}>
      <IconButton title={label} aria-label={label} aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </IconButton>
      <ActionMenu open={open} onClose={() => onOpenChange(false)} ariaLabel={label} items={items} anchorRef={anchorRef} />
    </span>
  )
}

function AccountsRow({ row, onClose }: { row: UserRowData; onClose: () => void }) {
  return (
    <tr className={styles.accountsRow}>
      <td colSpan={5}>
        <div className={styles.accounts}>
          <div>
            <p className={styles.accountsTitle}>登録アカウント</p>
            <ul className={styles.accountList}>
              {row.accounts.map((a) => (
                <li key={a.friendId}>
                  <StatusBadge tone={a.isFollowing ? 'success' : 'neutral'} size="compact">{a.isFollowing ? '友だち' : 'ブロック・削除'}</StatusBadge>
                  <span className={styles.accountName}>{a.accountName}</span>
                  <span>{`登録: ${formatDay(new Date(a.joinedAt))}`}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.contacts}>
            {row.emails.length > 0 ? <p>{`メール（フォーム回答）：${row.emails.join(', ')}`}</p> : null}
            {row.phones.length > 0 ? <p>{`電話（フォーム回答）：${row.phones.join(', ')}`}</p> : null}
            {row.xUsername ? <p>{`X：@${row.xUsername}`}</p> : null}
          </div>
          <button type="button" className={styles.closeLink} onClick={onClose}>
            閉じる <ChevronUp size={14} aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  )
}
