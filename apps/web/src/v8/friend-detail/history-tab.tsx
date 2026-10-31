'use client'

import SegmentedControl from '@/components/shared/segmented'
import { useListUrlValue } from '@/components/shared/list-url-state';
import { Fragment } from 'react';
import Link from '@/components/shared/list-navigation'
import { CalendarDays, ClipboardList, MailOpen, MessageCircle, Send, ShoppingBag, Tag as TagIcon, Workflow } from 'lucide-react';
import Button from '@/components/shared/button'
import { formatTime } from '@/lib/format';
import type { FriendDetail } from '@/lib/api';
import type { FriendDetailState } from './use-friend-detail';
import { dayHeading, dayKey, matchesTimelineFilter, timelineKey, timelineSourceHref, timelineStatusLabel, timelineTone, timelineTypeLabel, type TimelineFilter } from './timeline';
import styles from './detail.module.css'
import TextLink from '@/components/shared/text-link'
import { emptyValue } from '@/components/shared/empty-value';
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import { formatNumber } from '@/lib/format'


/*
 * 履歴タブ（ の 3.）。全部の出来事を時系列で、日ごとに区切って並べる。
 * 受信・送信・システム通知の切り替えは、読んだ行の中で絞る（口は今と同じ1本）。
 */

const FILTERS: Array<{ value: TimelineFilter; label: string }> = [
  { value: 'all', label: '全件' },
  { value: 'received', label: '受信' },
  { value: 'sent', label: '送信' },
  { value: 'system', label: 'システム通知' },
]

function typeIcon(type: string) {
  if (type === 'message_received') return <MessageCircle size={16} aria-hidden />
  if (type === 'message_sent') return <Send size={16} aria-hidden />
  if (type === 'form_submitted') return <ClipboardList size={16} aria-hidden />
  if (type.startsWith('scenario')) return <Workflow size={16} aria-hidden />
  if (type === 'tag_change') return <TagIcon size={16} aria-hidden />
  if (type === 'ec_order') return <ShoppingBag size={16} aria-hidden />
  if (type.includes('booking')) return <CalendarDays size={16} aria-hidden />
  return <MailOpen size={16} aria-hidden />
}

export default function HistoryTab({ friend, friendId, data }: { friend: FriendDetail; friendId: string; data: FriendDetailState }) {
  const [filter, setFilter] = useListUrlValue<TimelineFilter>('filter', 'all')
  const { historyItems, historyStatus, historyNextCursor, historyLoadingMore, historyMoreError } = data
  const filteredRows = historyItems.filter((item) => matchesTimelineFilter(item, filter))
  const complete = !historyNextCursor
  // 最後まで読めた時だけ追加記録も合流する。日付の形式やページの境目で同じ日を分断しない。
  const rows = [...filteredRows]
  if (complete && filter !== 'received' && filter !== 'sent') {
    rows.push({
      id: `friend-add:${friendId}`, type: 'friend_add', occurredAt: friend.createdAt || '',
      summary: friend.firstTrackedLinkName ? `${friend.firstTrackedLinkName}から追加されました` : '友だちに追加されました',
      status: null, source: null, lineAccount: { id: '', name: 'システム' },
    })
  }
  rows.sort((a, b) => {
    const aTime = Date.parse(a.occurredAt), bTime = Date.parse(b.occurredAt)
    if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : 0
    if (!Number.isFinite(bTime)) return -1
    return bTime - aTime
  })

  return (
    <div className={styles.pane}>
      <div className={styles.tools}>
        <SegmentedControl aria-label="履歴の種類" value={filter} onChange={setFilter} options={FILTERS} />
        {historyStatus === 'ready' ? (
          <span className={styles.count}>{complete ? `${formatNumber(rows.length)} 件` : `${formatNumber(rows.length)} 件を表示中`}</span>
        ) : null}
      </div>

      <div className={styles.table} role="table" aria-label="この友だちの履歴">
        <div className={`${styles.tr} ${styles.th}`} role="row">
          <span role="columnheader">日時</span><span role="columnheader">種別</span><span role="columnheader">内容</span><span role="columnheader">アカウント</span><span role="columnheader">元</span>
        </div>
        {historyStatus === 'loading' || historyStatus === 'idle' ? (
          // 読み込み中は骨格の行（絵の注記）。
          <div aria-busy="true" aria-label="履歴を読み込んでいます">
            {[0, 1, 2, 3].map((i) => <div key={i} className={styles.skeletonRow} />)}
          </div>
        ) : historyStatus === 'error' ? (
          <ListState kind="error" title="履歴を読み込めませんでした。" description="" action={<><Button onClick={() => data.loadHistory()} busyLabel="処理中…">もう一度読み込む</Button></>} />
        ) : (
          <>
            {rows.map((item, index) => {
              const source = timelineSourceHref(item, friendId)
              const status = timelineStatusLabel(item.type, item.status)
              const newDay = index === 0 || dayKey(rows[index - 1].occurredAt) !== dayKey(item.occurredAt)
              return (
                <Fragment key={timelineKey(item)}>
                  {newDay ? <div className={styles.day} role="row" data-table-date-group={dayKey(item.occurredAt) || 'unknown'}><span role="cell">{dayHeading(item.occurredAt)}</span></div> : null}
                  <div className={styles.tr} role="row">
                    <span role="cell">{formatTime(item.occurredAt)}</span>
                    <span role="cell" className={styles.cellType}>
                      <span className={styles.typeDot} data-tone={timelineTone(item.type)}>{typeIcon(item.type)}</span>
                      {timelineTypeLabel(item.type)}
                    </span>
                    <span role="cell" className={styles.cellMain} title={item.summary}>
                      {status ? <span className={styles.statusChip}>{status}</span> : null}
                      {item.summary}
                    </span>
                    <span role="cell" className={styles.cellClip} title={item.lineAccount?.name ?? undefined}>{item.lineAccount?.name ?? emptyValue('unknown')}</span>
                    <span role="cell">
                      {source ? (
                        source.external
                          ? <TextLink external className={styles.srcLink} href={source.href}  >{source.label}</TextLink>
                          : <Link className={styles.srcLink} href={source.href}>{source.label} ↗</Link>
                      ) : null}
                    </span>
                  </div>
                </Fragment>
              )
            })}
            {filteredRows.length === 0 && complete ? (
              <p className={styles.paneNote}>
                {historyItems.length === 0 ? '活動履歴はまだありません。上の「友だち追加の記録」がこの友だちの最初の記録です。' : 'この種類の記録はありません。'}
              </p>
            ) : null}
          </>
        )}
      </div>

      {historyStatus === 'ready' && historyNextCursor ? (
        <div className={styles.centered}>
          {/* FRIEND-26: 続きの取り損ねはここだけ。読めていた行とカーソルは残る。 */}
          {historyMoreError ? <Notice tone="danger" className={styles.dangerNoticePlacement} >続きを読み込めませんでした。同じところから試せます。</Notice> : null}
          <Button onClick={() => void data.loadHistory(historyNextCursor)} disabled={historyLoadingMore} busy={historyLoadingMore} busyLabel="読み込み中…">
            {historyMoreError ? 'もう一度試す' : 'さらに読み込む'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
