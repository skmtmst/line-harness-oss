'use client'

/*
 * ★V8 統合ユーザー（Pencil `ADjK8`、採用版の流れは `sdbsQ` 板3、状態 `SXCb3`）。
 *
 * データの口は v7 と同じ `useMergedUsers`。違いは見せ方——タブの段は
 * 「← 友だち一覧 › データ管理 › 統合ユーザー」＋「データ管理 ▾」に替える。
 * 詳細は v7 と同じく一覧の面を差し替える（merged-person-detail-v8.tsx）。
 *
 * 板にある「配信に使うアカウント」の列は /api/users-grouped の行に無いので
 * 出さない（DEVIN-QUESTIONS に未接続として記録）。
 */
import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, RotateCw, SearchX, UserPlus } from 'lucide-react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import HelpTip from '@/components/shared/help-tip'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import MergedPersonDetailViewV8 from '@/components/merged-person/merged-person-detail-v8'
import { mergedPersonIdOf } from '@/components/merged-person/merged-person-view'
import { FriendsManageNavV8 } from '@/app/friends/friends-nav-v8'
import { api } from '@/lib/api'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { formatDateTime, formatDay, formatNumber } from '@/lib/format'
import { useMergedUsers, USERS_PAGE_SIZE } from './use-merged-users'
import styles from '@/app/friends/friends-v8.module.css'

const UID_STATUS = {
  url_token: '要確認',
  uid: 'UIDで連携',
  solo: '未連携',
} as const

export default function UsersV8() {
  usePageTitle('統合ユーザー')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '友だち', href: '/friends' }])
  const u = useMergedUsers()
  const staffRole = useStaffRole()
  const canManage = staffRole === null || canManageRole(staffRole)
  const [openedPersonId, setOpenedPersonId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // 数の帯の「統合ユーザー」は重複検出の集計（uniquePeople）を使う（v7 と同じ API）。
  const [uniquePeople, setUniquePeople] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    api.duplicates.stats().then((res) => {
      if (alive && res.success) setUniquePeople(res.data.uniquePeople)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const pageCount = Math.max(1, Math.ceil(u.total / USERS_PAGE_SIZE))
  const linkedUidCount = u.rows.filter((row) => row.identityKeyKind === 'uid').length
  const multiAccountCount = u.rows.filter((row) => row.accounts.length > 1).length

  const openPerson = useCallback((id: string) => setOpenedPersonId(id), [])

  if (openedPersonId) {
    return (
      <MergedPersonDetailViewV8
        personId={openedPersonId}
        onClose={() => setOpenedPersonId(null)}
      />
    )
  }

  return (
    <div className={styles.board} data-design-node="ADjK8">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.headTitle}>統合ユーザー</h2>
          <p className={styles.headDescription}>
            結び付けて、同じ人として扱っている人の一覧です。間違えて結び付けたときは、ここで分けます。
          </p>
        </div>
        <div className={styles.headAction}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => u.setPendingForceRefresh(true)}
            disabled={u.refreshing}
            busy={u.refreshing}
            busyLabel="再計算中…"
            title="最新の状態を取得して一覧を更新"
          >
            <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
            再計算
          </Button>
          <Button variant="primary" href="/friends/identity-candidates">
            <UserPlus aria-hidden="true" className="h-3.5 w-3.5" />
            統合ユーザーを作る
          </Button>
        </div>
      </div>

      <FriendsManageNavV8 current="統合ユーザー" />

      {/* 数の帯：3つのマス（ADjK8）。ページ内の数はその旨を添える。 */}
      <div className={styles.kpis} style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>統合ユーザー</span>
          <p className={styles.kpiValue}>
            {uniquePeople !== null ? formatNumber(uniquePeople) : '—'}
            <span className={styles.kpiUnit}>人</span>
          </p>
          <p className={styles.kpiDetail}>重複を1人にまとめた数</p>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>
            UID連携済み
            <HelpTip label="UID連携済みの説明">このページに出ている人のうち、LINE UIDを根拠にまとめている数です。</HelpTip>
          </span>
          <p className={styles.kpiValue}>
            {u.loading ? '—' : formatNumber(linkedUidCount)}
            <span className={styles.kpiUnit}>人</span>
          </p>
          <p className={styles.kpiDetail}>このページでUID確認済み</p>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>
            複数アカウントにいる
            <HelpTip label="複数アカウントの説明">このページに出ている人のうち、2つ以上のLINEアカウントに登録がある数です。</HelpTip>
          </span>
          <p className={styles.kpiValue}>
            {u.loading ? '—' : formatNumber(multiAccountCount)}
            <span className={styles.kpiUnit}>人</span>
          </p>
          <p className={styles.kpiDetail}>送信前に配信先の確認が必要です</p>
        </div>
      </div>

      {/* 道具の段：検索・UID・所属・複数アカウントのみ、右に件数とCSV。 */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <SearchField
            className="w-full"
            aria-label="統合ユーザーを検索"
            value={u.q}
            onChange={u.setQ}
            onClear={() => u.setQ('')}
            placeholder="名前・メール・電話で探す"
          />
        </div>
        <div className={styles.selectWrap}>
          <Select
            aria-label="UID連携で絞り込む"
            label="UID連携"
            size="full"
            value={u.uid}
            onChange={u.setUid}
            options={[
              { value: '', label: 'UID：すべて' },
              { value: 'linked', label: 'UID：連携済み' },
              { value: 'unlinked', label: 'UID：未連携・要確認' },
            ]}
          />
        </div>
        <div className={styles.selectWrap}>
          <Select
            aria-label="所属アカウントで絞り込む"
            label="所属アカウント"
            size="full"
            value={u.account}
            onChange={u.setAccount}
            options={[
              { value: '', label: '所属：すべて' },
              ...u.accountOptions.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
        </div>
        <Checkbox
          checked={u.onlyDups}
          onCheckedChange={u.setOnlyDups}
          className="whitespace-nowrap"
        >
          複数アカウントのみ
        </Checkbox>
        <span className={styles.toolbarSpacer} />
        <span className={styles.toolbarCount}>
          {u.loading && u.total === 0 ? '更新中…' : `${formatNumber(u.total)}人`}
        </span>
        {canManage ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void u.exportCsv()}
            disabled={u.exporting}
            busy={u.exporting}
            busyLabel="書き出し中…"
          >
            CSVで書き出す
          </Button>
        ) : null}
      </div>

      {u.exportError ? (
        <p className={styles.errorBand} role="alert">{u.exportError}</p>
      ) : null}

      {/* 一覧。状態は SXCb3：骨格・0件・失敗をこの場所で出す。 */}
      <div className={styles.tableWrap} aria-busy={u.loading}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>統合ユーザー</th>
              <th>結び付いた友だち</th>
              <th>状態</th>
              <th>最終接触</th>
              <th>{/* 操作 */}</th>
            </tr>
          </thead>
          <tbody>
            {u.error ? (
              <tr>
                <td colSpan={5}>
                  <div className={styles.stateCard} style={{ border: 0 }}>
                    <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
                      <CircleAlert size={20} aria-hidden="true" />
                    </span>
                    <p className={styles.stateTitle}>統合ユーザーを読み込めませんでした</p>
                    <Button type="button" variant="primary" onClick={() => void u.load()}>
                      もう一度試す
                    </Button>
                  </div>
                </td>
              </tr>
            ) : u.loading && u.rows.length === 0 ? (
              Array.from({ length: 5 }, (_, index) => (
                <tr key={index} aria-hidden="true">
                  <td><span className={styles.skeletonDot} style={{ display: 'inline-block' }} /></td>
                  <td colSpan={4}><span className={styles.skeletonBar} style={{ display: 'block' }} /></td>
                </tr>
              ))
            ) : u.rows.length ? u.rows.flatMap((row) => {
              const personId = mergedPersonIdOf(row)
              const main = (
                <tr key={row.identityKey}>
                  <td>
                    <div className={styles.personCell}>
                      <span className={styles.avatarDot} aria-hidden="true">
                        {(row.displayName ?? '？').slice(0, 1)}
                      </span>
                      <div className={styles.personCellText}>
                        {personId ? (
                          <button
                            type="button"
                            className={styles.personName}
                            onClick={() => openPerson(personId)}
                            data-qa-open="Hn9eE"
                          >
                            {row.displayName || '名前なし'}
                          </button>
                        ) : (
                          <span className={styles.personName} style={{ cursor: 'default' }}>
                            {row.displayName || '—'}
                          </span>
                        )}
                        <span className={styles.personSub}>
                          {row.emails[0] ?? row.phones[0] ?? '—'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={styles.pairCell}>
                      {row.accounts.length}（{row.accounts.map((a) => a.accountName).join('・')}）
                    </span>
                  </td>
                  <td>
                    <span className={styles.evidenceChips}>
                      <StatusBadge
                        tone={row.identityKeyKind === 'url_token' ? 'warning' : row.identityKeyKind === 'uid' ? 'success' : 'neutral'}
                        size="compact"
                      >
                        {UID_STATUS[row.identityKeyKind]}
                      </StatusBadge>
                      {row.isDuplicate ? (
                        <StatusBadge tone="warning" size="compact">要確認</StatusBadge>
                      ) : null}
                    </span>
                  </td>
                  <td>{formatDateTime(row.lastActivityAt)}</td>
                  <td>
                    {personId ? (
                      <button type="button" className={styles.linkAction} onClick={() => openPerson(personId)}>
                        詳細を見る →
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.linkAction}
                        onClick={() => setExpanded((current) => (current === row.identityKey ? null : row.identityKey))}
                      >
                        {expanded === row.identityKey ? '閉じる' : '詳細を見る'}
                      </button>
                    )}
                  </td>
                </tr>
              )
              if (expanded !== row.identityKey || personId) return [main]
              return [
                main,
                <tr key={`${row.identityKey}-detail`}>
                  <td colSpan={5} style={{ background: 'var(--color-canvas-sunken, #f6f8f7)' }}>
                    <div className={styles.duoCards} style={{ padding: '12px 16px' }}>
                      <div>
                        <p className={styles.sectionDesc} style={{ marginBottom: 6 }}>登録アカウント</p>
                        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13 }}>
                          {row.accounts.map((a) => (
                            <li key={a.friendId} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '3px 0', color: 'var(--color-ink-secondary)' }}>
                              <span className={`${styles.pill} ${a.isFollowing ? styles.pillStrong : styles.pillWeak}`}>
                                {a.isFollowing ? '友だち' : 'ブロック・削除'}
                              </span>
                              <span style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{a.accountName}</span>
                              <span>登録: {formatDay(new Date(a.joinedAt))}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--color-ink-secondary)' }}>
                        {row.emails.length > 0 ? <p>メール（フォーム回答）：{row.emails.join(', ')}</p> : null}
                        {row.phones.length > 0 ? <p>電話（フォーム回答）：{row.phones.join(', ')}</p> : null}
                        {row.xUsername ? <p>X：@{row.xUsername}</p> : null}
                      </div>
                    </div>
                  </td>
                </tr>,
              ]
            }) : (
              <tr>
                <td colSpan={5}>
                  <div className={styles.stateCard} style={{ border: 0 }}>
                    <span className={styles.stateIcon}>
                      <SearchX size={20} aria-hidden="true" />
                    </span>
                    <p className={styles.stateTitle}>条件に合う人はいません</p>
                    <p className={styles.sectionDesc}>
                      検索や絞り込みを外すと、すべて出ます。
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {u.total > 0 && !u.error ? (
        <div className={styles.pagerRow}>
          <span className={styles.toolbarCount}>
            {formatNumber(u.total)}人中 {formatNumber((u.page - 1) * USERS_PAGE_SIZE + 1)}〜{formatNumber(Math.min(u.page * USERS_PAGE_SIZE, u.total))}人
          </span>
          <Pagination
            page={u.page}
            pageCount={pageCount}
            onPageChange={u.setPage}
            disabled={u.loading}
            ariaLabel="統合ユーザーのページ"
          />
        </div>
      ) : null}
    </div>
  )
}
