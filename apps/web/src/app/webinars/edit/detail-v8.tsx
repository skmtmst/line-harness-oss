'use client'

/*
 * ★V8-B ウェビナーの結果まわり（板 `uNsEy` 参加者・`z2dgw` 分析・`Omqd4` コメント演出）。
 *
 * 設定の段とは別の器。題・タブの帯（設定・参加者・分析・コメント演出）を持ち、
 * 中身は3つの見え方から選ぶ。集計は親から受け取り、参加者の一覧だけここで読む
 * （v7 の `page.tsx` の `AnalyticsTab` と同じ口。v7 側は触らない）。
 * 検索の字は手元で絞るだけ（口に探す口は無い。今の作りのまま）。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import {
  ApiError,
  downloadApiFile,
  webinarApi,
  type Webinar,
  type WebinarAnalytics,
  type WebinarParticipantClassification,
  type WebinarParticipantPage,
} from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { WEBINAR_SAKURA_COMMENTS_MAX } from '@/components/webinars/webinar-limits'
import RetentionSection from './retention-section'
import CommentsView from './comments-v8'
import styles from './detail-v8.module.css'

export type DetailTab = 'participants' | 'analytics' | 'comments'

type ParticipantRow = WebinarParticipantPage['items'][number]

/* 参加者一覧の1頁ぶん。サーバーは最大200件まで返す。 */
const PARTICIPANTS_PAGE_SIZE = 50

const FILTER_OPTIONS: Array<{ value: '' | WebinarParticipantClassification; label: string }> = [
  { value: '', label: 'すべて' },
  { value: 'completed', label: '視聴完了' },
  { value: 'dropped_off', label: '途中で離れた' },
  { value: 'unviewed', label: '見ていない' },
]

function percent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '—'
}

/* 開催の形の短い言い方。見本の題の下に出す。 */
function deliveryLabel(kind: 'on_demand' | 'scheduled' | 'external'): string {
  if (kind === 'scheduled') return '日時指定配信'
  if (kind === 'external') return '外部配信'
  return 'オンデマンド・いつでも視聴'
}

function fmtSec(sec: number): string {
  const sign = sec < 0 ? '-' : ''
  const abs = Math.abs(sec)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  return h > 0 ? `${sign}${h}時間${m}分` : `${sign}${m}分${String(s).padStart(2, '0')}秒`
}

function compactDateTime(value: string): string {
  return formatDateTime(value)
}

function ParticipantAvatar({ name, pictureUrl }: { name: string; pictureUrl: string | null }) {
  // 外部 URL は https だけ読み、http 等は頭文字表示に落とす。
  if (pictureUrl && pictureUrl.startsWith('https://')) {
    return (
      <img
        src={pictureUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="h-9 w-9 shrink-0 rounded-pill bg-canvas-sunken object-cover ring-2 ring-canvas"
      />
    )
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-info-bg text-xs font-bold text-info ring-2 ring-canvas">
      {name.trim().charAt(0) || '?'}
    </span>
  )
}

/*
 * 参加者行の分類表示。サーバーの classification を優先し、
 * 無い古い応答だけ従来の推測へ落とす。
 */
function participantStateLabel(participant: ParticipantRow, durationSeconds: number): string {
  const rate = Math.min(100, Math.round((participant.maxWatchedSeconds / Math.max(1, durationSeconds)) * 100))
  if (participant.classification === undefined) {
    return participant.maxWatchedSeconds === 0
      ? participant.latestJoinedAt ? '視聴開始直後' : '未視聴'
      : rate >= 90 ? `視聴完了 ${rate}%` : rate > 0 ? `視聴中 ${rate}%` : '未視聴'
  }
  switch (participant.classification) {
    case 'unmeasured': return '計測外'
    case 'unviewed': return '未参加'
    case 'completed': return `視聴完了 ${rate}%`
    case 'dropped_off':
      return participant.maxWatchedSeconds === 0
        ? '入場のみ（再生を確認できず）'
        : `途中離脱 ${rate}%`
  }
}

/* 参加の回数と、予約からか直接かを短く示す。 */
function joinLine(participant: ParticipantRow): string {
  const times = participant.sessions > 0 ? `${participant.sessions}回参加` : null
  const kind = participant.registered ? '予約から参加' : participant.sessions > 0 ? '直接参加' : '申込のみ'
  return [times, kind].filter(Boolean).join('・')
}

function actionBadge(participant: ParticipantRow): { label: string; tone: 'success' | 'neutral' } {
  if (participant.formSubmittedAt) return { label: 'フォーム送信', tone: 'success' }
  if (participant.ctaClickedAt) return { label: 'CTAクリック', tone: 'success' }
  if (participant.maxWatchedSeconds > 0) return { label: '視聴のみ', tone: 'neutral' }
  return { label: '—', tone: 'neutral' }
}

function ParticipantsView({ webinarId, durationSeconds, analytics }: {
  webinarId: string
  durationSeconds: number
  analytics: WebinarAnalytics | null
}) {
  const [items, setItems] = useState<ParticipantRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState<'' | WebinarParticipantClassification>('')
  const [query, setQuery] = useState('')
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvError, setCsvError] = useState('')

  const downloadCsv = (classification?: WebinarParticipantClassification) => {
    if (csvBusy) return
    setCsvBusy(true)
    setCsvError('')
    void downloadApiFile(webinarApi.participantsCsvUrl(webinarId, classification), 'webinar-participants.csv')
      .catch(() => setCsvError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'))
      .finally(() => setCsvBusy(false))
  }

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setItems([])
    setNextCursor(null)
    setMoreError('')
    /*
      個人の参加履歴はオーナー・管理者だけの口。staff には 403 が返るので、
      失敗扱いにせず「見られない」とだけ覚えて集計の表示は続ける。
    */
    webinarApi.participants(webinarId, undefined, PARTICIPANTS_PAGE_SIZE, filter || undefined)
      .then((res) => {
        if (cancelled) return
        setItems(res.data.items)
        setNextCursor(res.data.nextCursor)
        setState('ready')
      })
      .catch((cause) => {
        if (cancelled) return
        setState(cause instanceof ApiError && cause.status === 403 ? 'denied' : 'error')
      })
    return () => { cancelled = true }
  }, [webinarId, attempt, filter])

  /* サーバーが nextCursor を返す限り、次の頁を読み足せる。重複は friendId で除く。 */
  const loadMore = async () => {
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
    } catch {
      setMoreError('続きを読み込めませんでした。もう一度お試しください。')
    } finally {
      setLoadingMore(false)
    }
  }

  const summary = analytics?.summary ?? null
  const unviewed = summary ? Math.max(0, summary.reservations - summary.viewers) : null
  const dropped = summary ? Math.max(0, summary.viewers - summary.completed) : null
  /* 口に探す口は無いので、手元の一覧から名前で絞る。 */
  const needle = query.trim()
  const shown = needle ? items.filter((item) => (item.friendName ?? '').includes(needle)) : items

  return (
    <div className={styles.stack}>
      {summary ? (
        <div className={styles.kpis}>
          <KpiCard title="申込" value={summary.reservations} unit="人" detail="申込の人数" />
          <KpiCard title="視聴完了" value={summary.completed} unit="人" detail={summary.reservations > 0 ? `申込の${percent(summary.completed, summary.reservations)}` : '申込の—'} />
          <KpiCard title="途中で離れた" value={dropped} unit="人" detail={summary.viewers > 0 ? `平均${fmtSec(summary.avgWatchedSeconds)}で離脱` : '視聴の—'} />
          <KpiCard title="見ていない" value={unviewed} unit="人" detail="見逃し案内の対象" />
        </div>
      ) : null}
      <Notice tone="info">「見ていない」は申込だけで入場の記録がない人です。「入場のみ」は入場したが再生を確かめられなかった人です。</Notice>
      {state === 'denied' ? (
        <div className="border-hairline bg-canvas rounded-card border p-8 text-center shadow-card" role="note">
          <p className="text-ink text-sm font-bold">個人の参加履歴はオーナーと管理者だけが確認できます。</p>
          <p className="text-ink-faint mt-2 text-xs">友だちごとの視聴・申込の記録を出す権限がないため、この段は表示できません。集計だけは「分析」から確認できます。</p>
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <TextField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="友だちの名前で探す" aria-label="友だちの名前で探す" />
            <div className={styles.chips} role="group" aria-label="分類で絞り込む">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={filter === option.value ? styles.chipOn : styles.chip}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className={styles.toolbarSide}>
              <Button onClick={() => setFilter('')}>よく使う絞り込み</Button>
              <Select aria-label="1頁の件数" value="20" onChange={() => {}} options={[{ value: '20', label: '20件表示' }]} />
            </div>
          </div>
          {csvError ? <p className="text-danger text-xs" role="alert">{csvError}</p> : null}
          {state === 'loading' ? <ListState kind="loading" /> : state === 'error' ? (
            <Notice
              tone="danger"
              action={<button type="button" onClick={() => setAttempt((count) => count + 1)} className="font-medium underline">もう一度読み込む</button>}
            >
              参加者一覧を読み込めませんでした。
            </Notice>
          ) : shown.length === 0 ? (
            <p className="text-ink-faint p-8 text-center text-sm">{filter || needle ? 'この条件に合う人はいません。' : 'まだ参加者がいません。'}</p>
          ) : (
            <DataTable>
              <TableHeadRow>
                <Th>参加者</Th>
                <Th>最終参加</Th>
                <Th>視聴</Th>
                <Th>アクション</Th>
                <Th align="right">詳細</Th>
              </TableHeadRow>
              {shown.map((participant) => {
                const name = participant.friendName ?? '名前未取得'
                const rate = Math.min(100, Math.round((participant.maxWatchedSeconds / Math.max(1, durationSeconds)) * 100))
                const stateLabel = participantStateLabel(participant, durationSeconds)
                const action = actionBadge(participant)
                return (
                  <Tr key={participant.friendId}>
                    <Td>
                      <span className={styles.who}>
                        <ParticipantAvatar name={name} pictureUrl={participant.pictureUrl} />
                        <span>
                          <span className={styles.whoName}>{name}</span>
                          <span className={styles.whoSub}>{joinLine(participant)}</span>
                        </span>
                      </span>
                    </Td>
                    <Td>{participant.latestJoinedAt ? compactDateTime(participant.latestJoinedAt) : '—'}</Td>
                    <Td>
                      {participant.maxWatchedSeconds > 0 || participant.latestJoinedAt ? (
                        <span>
                          <span>{fmtSec(participant.maxWatchedSeconds)}（{rate}%）</span>
                          <span className={styles.whoSub}>{stateLabel}</span>
                        </span>
                      ) : (
                        <span>
                          <span>—</span>
                          <span className={styles.whoSub}>{participant.registered ? '見ていない・見逃し案内を送った' : stateLabel}</span>
                        </span>
                      )}
                    </Td>
                    <Td>
                      <StatusBadge tone={action.tone === 'success' ? 'success' : 'neutral'}>{action.label}</StatusBadge>
                    </Td>
                    <Td align="right">
                      <Button href={`/chats?friend=${encodeURIComponent(participant.friendId)}`}>チャットを見る →</Button>
                    </Td>
                  </Tr>
                )
              })}
            </DataTable>
          )}
          {state === 'ready' && (nextCursor || moreError) ? (
            <div className="border-hairline border-t px-4 py-3 text-center">
              {moreError ? <p className="text-danger mb-2 text-xs" role="alert">{moreError}</p> : null}
              {nextCursor ? (
                <Button onClick={() => void loadMore()} disabled={loadingMore} busy={loadingMore} busyLabel="読み込み中…">続きを読み込む</Button>
              ) : null}
            </div>
          ) : null}
          <p className="text-ink-faint text-xs">行の「チャットを見る」から友だちの記録を開けます。見逃し案内は通知の段で送ります。</p>
        </>
      )}
    </div>
  )
}

function AnalyticsView({ durationSeconds, analytics }: {
  durationSeconds: number
  analytics: WebinarAnalytics | null
}) {
  if (!analytics) return <ListState kind="loading" />
  const { summary } = analytics
  const stages = [
    { label: '申込', value: summary.reservations },
    { label: '参加（入場）', value: summary.viewers },
    { label: '視聴完了', value: summary.completed },
    { label: 'CTAを押した', value: summary.ctaClicks },
    { label: 'フォーム送信', value: summary.formSubmissions },
  ]
  const max = Math.max(1, ...stages.map((stage) => stage.value))
  return (
    <div className={styles.stack}>
      <div className={styles.kpis}>
        <KpiCard title="申込" value={summary.reservations} unit="人" detail="申込の人数" />
        <KpiCard title="参加" value={summary.viewers} unit="人" detail={summary.reservations > 0 ? `申込の${percent(summary.viewers, summary.reservations)}` : '申込の—'} />
        <KpiCard title="視聴完了" value={summary.completed} unit="人" detail={summary.viewers > 0 ? `参加の${percent(summary.completed, summary.viewers)}` : '参加の—'} />
        <KpiCard title="フォーム送信" value={summary.formSubmissions} unit="件" detail={summary.ctaClicks > 0 ? `CTAを押した${summary.ctaClicks}人のうち` : 'CTAの—'} />
      </div>
      <section className={styles.card} aria-label="どこで人数が減っているか">
        <h2 className={styles.cardTitle}>どこで人数が減っているか</h2>
        <ul className={styles.funnel}>
          {stages.map((stage, index) => {
            const lost = index === 0 ? null : stages[index - 1].value - stage.value
            return (
              <li key={stage.label} className={styles.funnelRow}>
                <span className={styles.funnelLabel}>{stage.label}</span>
                <span className={styles.funnelTrack}>
                  <span className={styles.funnelBar} style={{ width: `${Math.max(2, Math.round((stage.value / max) * 100))}%` }} />
                </span>
                <span className={styles.funnelValue}>{formatNumber(stage.value)}人</span>
                <span className={styles.funnelLost}>{lost === null ? '' : `−${formatNumber(Math.max(0, lost))}`}</span>
              </li>
            )
          })}
        </ul>
      </section>
      <section className={styles.card} aria-label="どこまで見られたか">
        <h2 className={styles.cardTitle}>どこまで見られたか</h2>
        <RetentionSection
          retention={analytics.retention ?? { bucketSeconds: 60, started: 0, points: [] }}
          completed={summary.completed}
          ctaAtSeconds={analytics.ctaAtSeconds ?? null}
          heartbeatRejects={analytics.heartbeatRejects ?? 0}
          durationSeconds={durationSeconds}
        />
      </section>
    </div>
  )
}

export default function DetailV8({ webinar, deliveryKind, participantCount, analytics, analyticsState, tab, onRetry }: {
  webinar: Webinar
  deliveryKind: 'on_demand' | 'scheduled' | 'external'
  participantCount: number | null
  analytics: WebinarAnalytics | null
  analyticsState: 'idle' | 'loading' | 'ready' | 'error'
  tab: DetailTab
  onRetry: () => void
}) {
  const node = tab === 'participants' ? 'uNsEy' : tab === 'analytics' ? 'z2dgw' : 'Omqd4'
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvError, setCsvError] = useState('')
  const downloadCsv = () => {
    if (csvBusy) return
    setCsvBusy(true)
    setCsvError('')
    void downloadApiFile(webinarApi.participantsCsvUrl(webinar.id), 'webinar-participants.csv')
      .catch(() => setCsvError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'))
      .finally(() => setCsvBusy(false))
  }
  return (
    <div data-design-node={node}>
      <Link href="/webinars" className={styles.backLink}>← ウェビナーへ</Link>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{webinar.title || '無題のウェビナー'}</h1>
          <p className={styles.sub}>{deliveryLabel(deliveryKind)}・{webinar.status === 'active' ? '公開中' : '有効化前'}</p>
        </div>
        <span className={styles.csvWrap}>
          <Button disabled={csvBusy} onClick={downloadCsv} busy={csvBusy} busyLabel="書き出しています…">
            CSVで書き出す
          </Button>
        </span>
      </div>
      <nav className={styles.tabs} aria-label="結果の見え方">
        <Link href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}&pane=basic`} className={styles.tab}>設定</Link>
        <Link
          href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}&pane=participants`}
          aria-current={tab === 'participants' ? 'page' : undefined}
          className={tab === 'participants' ? styles.tabOn : styles.tab}
        >
          参加者{participantCount !== null ? ` ${participantCount}` : ''}
        </Link>
        <Link
          href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}&pane=analytics`}
          aria-current={tab === 'analytics' ? 'page' : undefined}
          className={tab === 'analytics' ? styles.tabOn : styles.tab}
        >
          分析
        </Link>
        <Link
          href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}&pane=comments`}
          aria-current={tab === 'comments' ? 'page' : undefined}
          className={tab === 'comments' ? styles.tabOn : styles.tab}
        >
          コメント演出
        </Link>
      </nav>
      {csvError ? <p className="text-danger text-xs" role="alert">{csvError}</p> : null}
      {analyticsState === 'error' && tab !== 'comments' ? (
        <Notice
          tone="danger"
          action={<button type="button" onClick={onRetry} className="font-medium underline">もう一度読み込む</button>}
        >
          分析データを読み込めませんでした。
        </Notice>
      ) : null}
      {tab === 'participants' ? (
        <ParticipantsView webinarId={webinar.id} durationSeconds={webinar.durationSeconds} analytics={analytics} />
      ) : tab === 'analytics' ? (
        <AnalyticsView durationSeconds={webinar.durationSeconds} analytics={analytics} />
      ) : (
        <CommentsView webinarId={webinar.id} />
      )}
    </div>
  )
}
