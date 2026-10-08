'use client'

/*
 * ★V8 ウェビナーの参加者（Pencil uNsEy）。
 * 頭（戻る・題・説明・CSV）→ タブ → 数の帯 → 案内の帯 → 道具の段 → 表 → ページ送り。
 * 口・権限・失敗の扱いは app/webinars/edit/participants-v8.tsx と同じ（BEHAVIOR.md）。
 */
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, CircleCheck, CircleSlash, Download, History, LogOut, Undo2 } from 'lucide-react'
import { ListPageBody, ListPagePagination } from '@/components/templates'
import { PageFrame } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Notice from '@/components/shared/notice'
import FilterChip from '@/components/shared/filter-chip'
import ListToolbar from '@/components/shared/list-toolbar'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import Pagination from '@/components/shared/pagination'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import {
  ApiError,
  downloadApiFile,
  webinarApi,
  type WebinarParticipantClassification,
  type WebinarParticipantPage,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { DetailHead } from './chrome'
import {
  PARTICIPANTS_PAGE_SIZE,
  actionBadge,
  fmtJaDuration,
  fmtSec,
  joinKindLabel,
  joinNote,
  participantStateLabel,
  percent,
  shortDateTime,
  thisMonthReservations,
} from './helpers'
import type { DetailChrome, EditContext } from './types'
import styles from './participants.module.css'

type LoadState = 'loading' | 'ready' | 'error' | 'denied'

const SAVED_OPTIONS: Array<{ value: '' | WebinarParticipantClassification; label: string }> = [
  { value: '', label: 'よく使う絞り込み' },
  { value: 'unviewed', label: '見ていない（申込のみ）' },
  { value: 'dropped_off', label: '途中で離れた' },
  { value: 'completed', label: '視聴完了' },
  { value: 'unmeasured', label: '計測外' },
]

export default function ParticipantsPane({ ctx, chrome }: { ctx: EditContext; chrome: DetailChrome }) {
  const { webinar, analytics, analyticsState } = ctx
  const [items, setItems] = useState<WebinarParticipantPage['items']>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState<'' | WebinarParticipantClassification>('')
  const [rule, setRule] = useState<WebinarParticipantPage['rule'] | null>(null)
  const [measurement, setMeasurement] = useState<WebinarParticipantPage['measurement'] | null>(null)
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvError, setCsvError] = useState('')
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const generation = useRef(0)
  const csvLock = useRef(false)
  const moreLock = useRef(false)

  const downloadCsv = useCallback(() => {
    if (csvLock.current) return
    csvLock.current = true
    const request = generation.current
    setCsvBusy(true)
    setCsvError('')
    void downloadApiFile(webinarApi.participantsCsvUrl(webinar.id, filter || undefined), 'webinar-participants.csv')
      .catch(() => { if (request === generation.current) setCsvError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。') })
      .finally(() => { csvLock.current = false; setCsvBusy(false) })
  }, [webinar.id, filter])

  useEffect(() => {
    let cancelled = false
    generation.current += 1
    moreLock.current = false
    setLoadingMore(false)
    setRule(null)
    setMeasurement(null)
    setCsvError('')
    setState('loading')
    setItems([])
    setNextCursor(null)
    setMoreError('')
    setPage(1)
    /* 個人の参加履歴はオーナー・管理者だけの口。staff には 403 が返るので「見られない」とだけ覚え、集計は出し続ける。 */
    webinarApi
      .participants(webinar.id, undefined, PARTICIPANTS_PAGE_SIZE, filter || undefined)
      .then((res) => {
        if (cancelled) return
        setItems(res.data.items)
        setNextCursor(res.data.nextCursor)
        setRule(res.data.rule ?? null)
        setMeasurement(res.data.measurement ?? null)
        setState('ready')
      })
      .catch((cause) => {
        if (cancelled) return
        setState(cause instanceof ApiError && cause.status === 403 ? 'denied' : 'error')
      })
    return () => {
      cancelled = true
      generation.current += 1
    }
  }, [webinar.id, attempt, filter])

  /* サーバーが nextCursor を返す限り、次の頁を読み足せる。重複は friendId で除く。 */
  const loadMore = async (): Promise<void> => {
    if (!nextCursor || moreLock.current) return
    moreLock.current = true
    const request = generation.current
    setLoadingMore(true)
    setMoreError('')
    try {
      const res = await webinarApi.participants(webinar.id, nextCursor, PARTICIPANTS_PAGE_SIZE, filter || undefined)
      if (request !== generation.current) return
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.friendId))
        return [...prev, ...res.data.items.filter((item) => !seen.has(item.friendId))]
      })
      setNextCursor(res.data.nextCursor)
      setRule(res.data.rule ?? null)
      setMeasurement(res.data.measurement ?? null)
    } catch {
      if (request !== generation.current) return
      setMoreError('続きを読み込めませんでした。もう一度お試しください。')
    } finally {
      if (request === generation.current) { moreLock.current = false; setLoadingMore(false) }
    }
  }

  const summary = analytics?.summary ?? null
  const unviewed = summary ? Math.max(0, summary.reservations - summary.registeredAndJoined) : null
  const dropped = summary ? Math.max(0, summary.viewers - summary.completed) : null
  const searched = query.trim() === '' ? items : items.filter((item) => (item.friendName ?? '').includes(query.trim()))
  const pageCount = Math.max(1, Math.ceil(searched.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageItems = searched.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const from = searched.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const to = Math.min(searched.length, currentPage * pageSize)

  const kpis = [
    { key: 'reservations', title: '申込', icon: History, value: summary?.reservations ?? null, unit: '人', detail: summary ? `今月 +${formatNumber(thisMonthReservations(analytics?.daily ?? []))}` : '—', help: '申し込んだ人の数です。今月の数はサーバーの集計日（UTC）を基準にしています。' },
    { key: 'completed', title: '視聴完了', icon: CircleCheck, value: summary?.completed ?? null, unit: '人', detail: summary ? `申込の ${percent(summary.completed, summary.reservations)}` : '—', help: '動画の9割以上を見た人です。' },
    { key: 'dropped', title: '途中で離れた', icon: LogOut, value: dropped, unit: '人', detail: summary ? `平均 ${Math.round(summary.avgWatchedSeconds / 60)}分で離脱` : '—', help: '視聴を始めた人から、視聴完了の人を引いた数です。' },
    { key: 'unviewed', title: '見ていない', icon: Undo2, value: unviewed, unit: '人', detail: '見逃し案内の対象', help: '申し込んだが入場の記録がない人です。' },
  ]

  const chips: Array<{ key: WebinarParticipantClassification; label: string; count: number | null; icon: typeof CircleCheck }> = [
    { key: 'completed', label: '視聴完了', count: summary?.completed ?? null, icon: CircleCheck },
    { key: 'dropped_off', label: '途中で離れた', count: dropped, icon: LogOut },
    { key: 'unviewed', label: '見ていない', count: unviewed, icon: CircleSlash },
  ]

  let body
  if (state === 'denied') {
    body = <ListState kind="forbidden" title="個人の参加履歴はオーナーと管理者だけが確認できます" description="友だちごとの視聴・申込の記録を出す権限がないため、表は出せません。集計は上の数と「分析」で確認できます。" />
  } else if (state === 'loading') {
    body = <p className={styles.state} role="status">読み込み中...</p>
  } else if (state === 'error') {
    body = <ListState kind="error" title="参加者の一覧を読み込めませんでした" description="通信を確認して、もう一度読み込んでください。" action={<Button onClick={() => setAttempt((count) => count + 1)}>もう一度読み込む</Button>} />
  } else if (pageItems.length === 0) {
    body = <ListState kind="empty" title={filter || query.trim() !== '' ? 'この条件に当てはまる人はいません' : 'まだ参加者はいません'} />
  } else {
    body = (
      <DataTable className={styles.table} aria-label="参加者一覧">
        <thead>
          <TableHeadRow className={styles.headRow} data-table-layout="columns">
            <Th className={styles.colName}>参加者</Th>
            <Th className={styles.colWhen}>最終参加</Th>
            <Th className={styles.colWatch}>視聴</Th>
            <Th className={styles.colAction}>アクション</Th>
            <Th className={styles.colDetail}>詳細</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {pageItems.map((participant) => {
            const name = participant.friendName ?? '名前未取得'
            const rate = Math.min(100, Math.round((participant.maxWatchedSeconds / Math.max(1, webinar.durationSeconds)) * 100))
            const badge = actionBadge(participant)
            return (
              <Tr key={participant.friendId} className={styles.row} data-table-layout="columns">
                <Td className={styles.colName}>
                  <Link href={`/friends/detail?id=${encodeURIComponent(participant.friendId)}`} title={name} className={styles.name}>{name}</Link>
                  <span className={styles.sub}>{`${joinNote(participant)}${joinKindLabel(participant)}`}</span>
                </Td>
                <Td className={styles.colWhen}><span className={styles.main}>{shortDateTime(participant.latestJoinedAt)}</span></Td>
                <Td className={styles.colWatch}>
                  <span className={styles.main}>{participant.maxWatchedSeconds > 0 ? `${fmtJaDuration(participant.maxWatchedSeconds)}（${rate}%）` : '—'}</span>
                  <span className={styles.sub}>{participantStateLabel(participant, webinar.durationSeconds)}</span>
                </Td>
                <Td className={styles.colAction}>
                  <span className={styles.pill} data-tone={badge.done ? 'done' : 'neutral'}>
                    <span className={styles.pillDot} aria-hidden="true" />
                    {badge.label}
                  </span>
                </Td>
                <Td className={styles.colDetail}>
                  <Button href={`/chats?friend=${encodeURIComponent(participant.friendId)}`}>チャットを見る →</Button>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    )
  }

  const csvButton = state === 'ready'
    ? <Button onClick={downloadCsv} disabled={csvBusy} busy={csvBusy} busyLabel="書き出しています…"><Download size={15} aria-hidden="true" />CSV で書き出す</Button>
    : null

  return (
    <PageFrame kind="list" boardId="uNsEy">
      <DetailHead {...chrome} current="participants" actions={csvButton} />
      <ListPageBody
        stats={<>
          {analyticsState === 'error' ? (
            <div className={styles.statsNotice}>
              <Notice tone="info" action={<Button onClick={ctx.retryAnalytics}>もう一度読み込む</Button>}>集計を読み込めませんでした。</Notice>
            </div>
          ) : null}
          <KpiBand>
            {kpis.map((kpi) => (
              <KpiCard key={kpi.key} presentation="band" title={kpi.title} icon={<kpi.icon size={13} aria-hidden="true" />} help={kpi.help} value={kpi.value} unit={kpi.value === null ? '' : kpi.unit} detail={kpi.detail} />
            ))}
          </KpiBand>
        </>}
        toolbar={<>
          <div className={styles.noticeRow}>
            <Notice tone="info">「見ていない」は申込だけで入場の記録がない人です。「入場のみ」は入場したが再生を確かめられなかった人です。</Notice>
          </div>
          {csvError ? <div className={styles.noticeRow}><Notice tone="danger">{csvError}</Notice></div> : null}
          <ListToolbar
            search={{ placeholder: '友だちの名前で探す', label: '友だちの名前で探す', width: 240, value: query, onChange: (value) => { setQuery(value); setPage(1) } }}
            filters={(
              <div role="group" aria-label="視聴の結果で絞り込む" className={styles.chips}>
                {chips.map((chip) => (
                  <FilterChip key={chip.key} selected={filter === chip.key} onChange={(selected) => setFilter(selected ? chip.key : '')} icon={<chip.icon size={13} aria-hidden="true" />}>
                    {chip.count === null ? chip.label : `${chip.label} ${formatNumber(chip.count)}`}
                  </FilterChip>
                ))}
              </div>
            )}
            trailing={<>
              <div className={styles.savedBox}>
                <Bookmark size={15} aria-hidden="true" className={styles.savedIcon} />
                <Select aria-label="よく使う絞り込み" value={filter} onChange={(value) => setFilter(value as '' | WebinarParticipantClassification)} options={SAVED_OPTIONS} />
              </div>
              <PageSizeSelect value={pageSize} onChange={(value) => { setPageSize(value); setPage(1) }} options={[10, 20, 50]} label={null} />
            </>}
          />
        </>}
        pagination={<>
          {state === 'ready' && searched.length > 0 ? (
            <ListPagePagination>
              <span className={styles.pagerCount}>{`${formatNumber(searched.length)}件中 ${from}〜${to}件`}</span>
              <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="参加者一覧のページ送り" />
            </ListPagePagination>
          ) : null}
          <p className={styles.footNote}>
            名前から友だちの詳細、「チャットを見る」からトークを開きます。
            {rule ? ` 視聴完了＝動画の9割（${fmtSec(rule.completionThresholdSeconds)}）以上を見た人。` : ''}
            {measurement?.state === 'unavailable' ? ` ${measurement.reason}。個人の分類は「計測外」になります。` : ''}
          </p>
        </>}
      >
        {body}
        {state === 'ready' && (nextCursor || moreError) ? (
          <div className={styles.more}>
            {moreError ? <p className={styles.moreError} role="alert">{moreError}</p> : null}
            {nextCursor ? <Button onClick={() => void loadMore()} disabled={loadingMore} busy={loadingMore} busyLabel="読み込み中…">続きを読み込む</Button> : null}
          </div>
        ) : null}
      </ListPageBody>
    </PageFrame>
  )
}
