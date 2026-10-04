import React, { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import styles from './participants-v8.module.css'
import Select from '@/components/shared/select'
import { Th } from '@/components/shared/table'
import {
  ApiError,
  downloadApiFile,
  webinarApi,
  type WebinarAnalytics,
  type WebinarParticipantClassification,
  type WebinarParticipantPage,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import {
  fmtSec,
  joinKindLabel,
  ParticipantAvatar,
  PARTICIPANT_FILTER_OPTIONS,
  PARTICIPANTS_PAGE_SIZE,
  participantStateLabel,
  percent,
  type ParticipantRow,
} from './participants-shared'

/*
 * ★V8 参加者管理（`uNsEy`）。中身は v7 の参加者の段と同じ。
 * 差し替えるのは見た目だけ。一覧・分類・CSV・友だち詳細への導線が実在する。
 * v7 の参加者の段は `page.tsx` に残し、`data-theme="v8"` のときだけ使う。
 */

type ParticipantsState = 'loading' | 'ready' | 'error' | 'denied'

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10件表示' },
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
]

/** 9/30 10:12。サーバーの記録時刻を日本時間で短く出す。 */
function shortDateTime(value: string | null): string {
  if (!value) return '—'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(time))
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${pick('month')}/${pick('day')} ${pick('hour')}:${pick('minute')}`
}

/** 行の注。参加の回数と、予約から来たか直接来たか。 */
function joinNote(participant: ParticipantRow): string {
  const sessions = participant.sessions ?? 0
  if (sessions <= 0) return '申込のみ'
  return `${sessions}回参加・${participant.registered ? '予約から参加' : '直接参加'}`
}

/** 行の成果の札。CTA・フォーム・視聴だけ。 */
function actionBadge(participant: ParticipantRow): { label: string; done: boolean } {
  if (participant.formSubmittedAt) return { label: 'フォーム送信', done: true }
  if (participant.ctaClickedAt) return { label: 'CTAクリック', done: true }
  if (participant.maxWatchedSeconds > 0) return { label: '視聴のみ', done: false }
  return { label: '—', done: false }
}

export default function ParticipantsV8({
  webinarId,
  durationSeconds,
  analytics,
  analyticsState,
  onRetry,
}: {
  webinarId: string
  durationSeconds: number
  analytics: WebinarAnalytics | null
  analyticsState: 'idle' | 'loading' | 'ready' | 'error'
  onRetry: () => void
}) {
  const [items, setItems] = useState<WebinarParticipantPage['items']>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [state, setState] = useState<ParticipantsState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState<'' | WebinarParticipantClassification>('')
  const [rule, setRule] = useState<WebinarParticipantPage['rule'] | null>(null)
  const [measurement, setMeasurement] = useState<WebinarParticipantPage['measurement'] | null>(null)
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvError, setCsvError] = useState('')
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState('20')
  const [page, setPage] = useState(1)

  const downloadCsv = (selected?: WebinarParticipantClassification): void => {
    if (csvBusy) return
    setCsvBusy(true)
    setCsvError('')
    void downloadApiFile(webinarApi.participantsCsvUrl(webinarId, selected), 'webinar-participants.csv')
      .catch(() => setCsvError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'))
      .finally(() => setCsvBusy(false))
  }

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setItems([])
    setNextCursor(null)
    setMoreError('')
    setPage(1)
    /*
      個人の参加履歴はオーナー・管理者だけの口。staff には 403 が返るので、
      失敗扱いにせず「見られない」とだけ覚えて集計の表示は続ける。
    */
    webinarApi
      .participants(webinarId, undefined, PARTICIPANTS_PAGE_SIZE, filter || undefined)
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
    }
  }, [webinarId, attempt, filter])

  /* サーバーが nextCursor を返す限り、次の頁を読み足せる。重複は friendId で除く。 */
  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setMoreError('')
    try {
      const res = await webinarApi.participants(webinarId, nextCursor, PARTICIPANTS_PAGE_SIZE, filter || undefined)
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.friendId))
        return [...prev, ...res.data.items.filter((item) => !seen.has(item.friendId))]
      })
      setNextCursor(res.data.nextCursor)
      setRule(res.data.rule ?? null)
      setMeasurement(res.data.measurement ?? null)
    } catch {
      setMoreError('続きを読み込めませんでした。もう一度お試しください。')
    } finally {
      setLoadingMore(false)
    }
  }

  if (state === 'denied') {
    return (
      <div className="border-hairline bg-canvas rounded-card border p-8 text-center shadow-card" role="note">
        <p className="text-ink text-sm font-bold">個人の参加履歴はオーナーと管理者だけが確認できます。</p>
        <p className="text-ink-faint mt-2 text-xs">友だちごとの視聴・申込の記録を出す権限がないため、この段は表示できません。集計だけは「分析」から確認できます。</p>
      </div>
    )
  }

  const summary = analytics?.summary ?? null
  const unviewed = summary ? Math.max(0, summary.reservations - summary.viewers) : 0
  const watching = summary ? Math.max(0, summary.viewers - summary.completed) : 0
  const size = Number(pageSize) || 20
  const searched =
    query.trim() === ''
      ? items
      : items.filter((item) => (item.friendName ?? '').includes(query.trim()))
  const pageCount = Math.max(1, Math.ceil(searched.length / size))
  const currentPage = Math.min(page, pageCount)
  const pageItems = searched.slice((currentPage - 1) * size, currentPage * size)
  const from = searched.length === 0 ? 0 : (currentPage - 1) * size + 1
  const to = Math.min(searched.length, currentPage * size)

  const chips: Array<{ key: WebinarParticipantClassification; label: string; count: number | null }> = [
    { key: 'completed', label: '視聴完了', count: summary ? summary.completed : null },
    { key: 'dropped_off', label: '途中で離れた', count: summary ? watching : null },
    { key: 'unviewed', label: '見ていない', count: summary ? unviewed : null },
  ]

  return (
    <div className="space-y-4" data-design-node="uNsEy">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-ink text-lg font-bold">参加者管理</h2>
          <p className="text-ink-faint mt-1 text-xs">申込・視聴・CTA・フォームの結果を友だち単位で確認します。</p>
        </div>
        {state === 'ready' ? (
          <Button disabled={csvBusy} onClick={() => downloadCsv(filter || undefined)} busy={csvBusy} busyLabel="書き出しています…">
            CSVで書き出す
          </Button>
        ) : null}
      </div>
      {csvError ? (
        <p className="text-danger text-xs" role="alert">
          {csvError}
        </p>
      ) : null}

      {summary ? (
        <section aria-label="参加の集計" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: '申込', value: summary.reservations, unit: '人', note: `視聴開始 ${formatNumber(summary.viewers)}人` },
            { label: '視聴完了', value: summary.completed, unit: '人', note: `申込の${percent(summary.completed, summary.reservations)}` },
            { label: '途中で離れた', value: watching, unit: '人', note: `平均${fmtSec(summary.avgWatchedSeconds)}で離脱` },
            { label: '見ていない', value: unviewed, unit: '人', note: '見逃し案内の対象' },
          ].map((card) => (
            <div key={card.label} className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
              <p className="text-ink-faint text-xs">{card.label}</p>
              <p className="text-ink mt-2 text-2xl font-medium tabular-nums">
                {formatNumber(card.value)}
                <span className="ml-1 text-sm font-normal">{card.unit}</span>
              </p>
              <p className="text-ink-faint mt-1 text-xs">{card.note}</p>
            </div>
          ))}
        </section>
      ) : (
        <p
          className={`rounded-card p-4 text-sm ${analyticsState === 'error' ? 'border-danger bg-danger-bg text-danger border' : 'text-ink-faint'}`}
          role={analyticsState === 'error' ? 'alert' : undefined}
        >
          {analyticsState === 'error' ? '集計を読み込めませんでした。' : '集計を読み込んでいます。'}
          {analyticsState === 'error' ? (
            <button type="button" onClick={onRetry} className="ml-2 font-medium underline">
              もう一度読み込む
            </button>
          ) : null}
        </p>
      )}

      <Notice tone="info">「見ていない」は申込だけで入場の記録がない人です。「入場のみ」は入場したが再生を確かめられなかった人です。</Notice>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1)
          }}
          placeholder="友だちの名前で探す"
          aria-label="友だちの名前で探す"
          className="border-hairline bg-canvas text-ink w-52 rounded-control border px-3 py-2 text-sm"
        />
        {chips.map((chip) => {
          const active = filter === chip.key
          return (
            <button
              key={chip.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setFilter(active ? '' : chip.key)
              }}
              className={styles.chip}
              data-selected={active}
            >
              {chip.label}
              {chip.count !== null ? ` ${formatNumber(chip.count)}` : ''}
            </button>
          )
        })}
        <span className="flex-1" />
        <Select
          aria-label="よく使う絞り込み"
          size="page-size"
          value={filter}
          onChange={(value) => setFilter(value as '' | WebinarParticipantClassification)}
          options={PARTICIPANT_FILTER_OPTIONS}
        />
        <Select
          aria-label="1ページの件数"
          size="page-size"
          value={pageSize}
          onChange={(value) => {
            setPageSize(value)
            setPage(1)
          }}
          options={PAGE_SIZE_OPTIONS}
        />
      </div>

      <section aria-label="参加者一覧" className="border-hairline bg-canvas overflow-hidden rounded-card border shadow-card">
        <div className="border-hairline border-b px-4 py-3">
          <h3 className="text-ink font-bold">参加者</h3>
          <p className="text-ink-faint mt-1 text-xs">
            何をきっかけに、何が実行されたかを分析できます。
            {state === 'ready' ? `${formatNumber(searched.length)}人を表示${nextCursor ? '（まだ続きがあります）' : ''}` : ''}
          </p>
          {rule || measurement?.state === 'unavailable' ? (
            <p className="text-ink-faint mt-1 text-xs">
              {rule ? `分類の根拠：視聴完了＝最大視聴位置が動画の90%（${fmtSec(rule.completionThresholdSeconds)}）以上。未参加＝申込のみで入場記録なし。ライブ／録画は入場時刻で区別。` : ''}
              {measurement?.state === 'unavailable' ? `${rule ? ' ' : ''}${measurement.reason}。個人の分類は「計測外」になります。` : ''}
            </p>
          ) : null}
        </div>
        {state === 'loading' ? (
          <p className="text-ink-faint p-8 text-center text-sm">読み込み中...</p>
        ) : state === 'error' ? (
          <div className="p-8 text-center text-sm" role="alert">
            <p className="text-danger">参加者一覧を読み込めませんでした。</p>
            <button type="button" onClick={() => setAttempt((count) => count + 1)} className="text-action mt-2 font-medium underline">
              もう一度読み込む
            </button>
          </div>
        ) : pageItems.length === 0 ? (
          <p className="text-ink-faint p-8 text-center text-sm">
            {filter || query.trim() !== '' ? 'この条件に該当する人はいません。' : 'まだ参加者がいません。'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-hairline text-ink-faint border-b text-left text-xs">
                  <Th>参加者</Th>
                  <Th>最終参加</Th>
                  <Th>視聴</Th>
                  <Th>アクション</Th>
                  <Th>詳細</Th>
                </tr>
              </thead>
              <tbody className="divide-hairline divide-y">
                {pageItems.map((participant) => {
                  const name = participant.friendName ?? '名前未取得'
                  const rate = Math.min(100, Math.round((participant.maxWatchedSeconds / Math.max(1, durationSeconds)) * 100))
                  const badge = actionBadge(participant)
                  return (
                    <tr key={participant.friendId}>
                      <td className="px-4 py-3">
                        <span className="flex min-w-0 items-center gap-3">
                          <ParticipantAvatar name={name} pictureUrl={participant.pictureUrl} size="sm" />
                          <span className="min-w-0">
                            <span className="text-ink block truncate font-semibold">{name}</span>
                            <span className="text-ink-faint block truncate text-xs">
                              {joinNote(participant)}
                              {joinKindLabel(participant)}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="text-ink-secondary whitespace-nowrap px-4 py-3 tabular-nums">
                        {shortDateTime(participant.latestJoinedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-ink block tabular-nums">
                          {participant.maxWatchedSeconds > 0 ? `${fmtSec(participant.maxWatchedSeconds)}（${rate}%）` : '—'}
                        </span>
                        <span className="text-ink-faint block text-xs">{participantStateLabel(participant, durationSeconds)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            badge.done
                              ? 'rounded-pill w-fit bg-success-bg px-2 py-1 text-xs font-semibold text-success'
                              : 'rounded-pill w-fit bg-canvas-sunken px-2 py-1 text-xs font-semibold text-ink-faint'
                          }
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="secondary" href={`/friends/detail?id=${encodeURIComponent(participant.friendId)}`}>
                          チャットを見る →
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {state === 'ready' && (nextCursor || moreError) ? (
          <div className="border-hairline border-t px-4 py-3 text-center">
            {moreError ? (
              <p className="text-danger mb-2 text-xs" role="alert">
                {moreError}
              </p>
            ) : null}
            {nextCursor ? (
              <Button onClick={() => void loadMore()} disabled={loadingMore} busy={loadingMore} busyLabel="読み込み中…">
                続きを読み込む
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <Pagination
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        ariaLabel="参加者一覧のページ送り"
        summary={`${formatNumber(searched.length)}件中 ${from}～${to}件`}
      />
      <p className="text-ink-faint text-xs">「チャットを見る」は友だちの詳細を開きます。トークの確認・見逃し案内はそこから行えます。</p>
    </div>
  )
}
