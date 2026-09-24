'use client'

import Disclosure from '@/components/shared/disclosure'
import SelectField from '@/components/shared/select-field'
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import WebinarNotifications from '@/components/webinars/webinar-notifications'
import { notificationPreview, videoPreview } from './preview-body'
import { ctaCardProblems } from './cta-card-validation'
import {
  STEPS,
  nextLabelOf,
  nextStepOf,
  publishBlockers,
  stepStateOf,
  type StepKey,
} from './edit-steps'
import WebinarForm from '@/components/webinars/webinar-form'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import StickyBar from '@/components/shared/sticky-bar'
import { CheckCircle2, Circle, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { MediaItem } from '@line-crm/shared'
import {
  ApiError,
  api,
  downloadApiFile,
  fetchApi,
  webinarApi,
  type WebinarCtaCard,
  type Webinar,
  type WebinarSakuraComment,
  type WebinarAnalytics,
  type WebinarUserComment,
  type WebinarAction,
  type WebinarEditor,
  type WebinarNotificationOverview,
  type WebinarNotificationSettings,
  type WebinarPublishValidation,
  type WebinarParticipantPage,
  type WebinarParticipantClassification,
} from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { WEBINAR_SAKURA_COMMENTS_MAX } from '@/components/webinars/webinar-limits'
import { publicationStateLabel } from '@/components/webinars/publication-label'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'

function fmtSec(sec: number): string {
  // 負 = 開始前 (待機ルーム) の相対時刻。-330 → -5:30
  const sign = sec < 0 ? '-' : ''
  const abs = Math.abs(sec)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  return h > 0
    ? `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${sign}${m}:${String(s).padStart(2, '0')}`
}

function largestDropoffAt(segments: NonNullable<WebinarAnalytics['viewSegments']>): number | null {
  if (segments.length < 2) return null
  let largest = { at: segments[1].startSeconds, lost: -Infinity }
  for (let index = 1; index < segments.length; index += 1) {
    const lost = segments[index - 1].viewers - segments[index].viewers
    if (lost > largest.lost) largest = { at: segments[index].startSeconds, lost }
  }
  return largest.at
}

function fmtSession(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString('ja-JP')
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

function webinarStatusLabel(status: Webinar['status']): string {
  if (status === 'active') return '公開中'
  if (status === 'draft') return '下書き'
  return 'アーカイブ'
}

function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}分${String(rest).padStart(2, '0')}秒`
}

type WebinarWithPublication = Webinar & {
  publicationState?: 'period' | 'always' | 'scheduled' | 'ended' | 'unset' | null
  publicationStartsAt?: string | null
  publicationEndsAt?: string | null
}

function deliveryWindow(webinar: Webinar): string {
  /* 5枝の決まりは共有(`components/webinars/publication-label`)。ここは編集画面だけの落としどころ。 */
  const publication = webinar as WebinarWithPublication
  const shared = publicationStateLabel(publication.publicationState, publication.publicationStartsAt, publication.publicationEndsAt)
  if (shared !== null) return shared
  const daily = webinar.schedule.find((rule) => rule.type === 'daily' && rule.time)
  const once = webinar.schedule.find((rule) => rule.type === 'once' && rule.at)
  if (once?.at) return fmtSession(Math.floor(new Date(once.at).getTime() / 1000))
  if (daily?.time) return `毎日 ${daily.time}`
  return '—（公開期間は未設定）'
}

function SummaryAside({
  rows,
  previewBody,
  previewButton,
  previewFirst = false,
  children,
}: {
  rows: Array<[string, string]>
  previewBody: string
  previewButton?: string | null
  previewFirst?: boolean
  children?: ReactNode
}) {
  const summary = (
    <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
        <h2 className="text-ink text-sm font-bold">設定サマリー</h2>
        <dl className="divide-hairline mt-3 divide-y">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-3 text-xs"><dt className="text-ink-faint">{label}</dt><dd className="text-ink text-right font-semibold">{value}</dd></div>
          ))}
        </dl>
        <p className="text-ink mt-2 text-xs font-semibold">タグ「配信済み」を追加</p>
    </section>
  )
  const preview = (
    <section className="bg-line-preview min-h-[365px] rounded-card p-4 text-on-accent shadow-card">
        <h2 className="text-center text-sm font-bold">LINEプレビュー</h2>
        <p className="bg-line-preview-label mx-auto mt-3 w-fit rounded-pill px-3 py-1 text-micro">実際のLINE表示に近いプレビューです</p>
        <div className="bg-canvas text-ink mt-4 rounded-control p-4 text-sm font-medium leading-relaxed">{previewBody}</div>
        {previewButton ? <div className="bg-accent-deep text-on-accent mx-auto mt-3 w-fit rounded-control px-4 py-2 text-xs font-bold">{previewButton}</div> : null}
    </section>
  )
  return (
    <aside className="space-y-3 xl:w-[390px] xl:shrink-0">
      {previewFirst ? <>{preview}{summary}</> : <>{summary}{preview}</>}
      {children}
    </aside>
  )
}

function EditorDetails({ label, children }: { label: string; children: ReactNode }) {
  return <Disclosure title={label}>{children}</Disclosure>
}

function CommentsTab({ webinarId }: { webinarId: string }) {
  const [comments, setComments] = useState<WebinarSakuraComment[]>([])
  const [loading, setLoading] = useState(true)
  const [importJson, setImportJson] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isErrorMessage, setIsErrorMessage] = useState(false)

  useEffect(() => {
    webinarApi
      .comments(webinarId)
      .then((res) => setComments(res.data))
      .finally(() => setLoading(false))
  }, [webinarId])

  const update = (i: number, patch: Partial<WebinarSakuraComment>) =>
    setComments((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const save = async () => {
    setMessage(null)
    /* 上限を超えたまま送るとサーバーの 400 で初めて気づく。手前で止める。 */
    if (comments.length > WEBINAR_SAKURA_COMMENTS_MAX) {
      setIsErrorMessage(true)
      setMessage(`コメントは${WEBINAR_SAKURA_COMMENTS_MAX}件までです（いま${comments.length}件）。減らしてから保存してください。`)
      return
    }
    try {
      const sorted = [...comments].sort((a, b) => a.atSeconds - b.atSeconds)
      const res = await webinarApi.saveComments(webinarId, sorted)
      setComments(sorted)
      setIsErrorMessage(false)
      setMessage(`${res.data.count}件保存しました`)
    } catch (err) {
      setIsErrorMessage(true)
      setMessage(`保存に失敗しました: ${webinarErrorText(err, '保存できませんでした。入力を見直してください。')}`)
    }
  }

  // サーバー側 (PUT /api/webinars/:id/comments) と同じ検証条件を事前に適用する。
  // ここで弾いておかないと、不正な行が NaN / "undefined" のまま
  // 「◯件読み込みました」と成功表示されてしまい、保存時のサーバー 400 で
  // 初めて気づく上にどの行が悪いか分からない。
  function validateImportRow(raw: unknown): WebinarSakuraComment | string {
    if (typeof raw !== 'object' || raw === null) return 'オブジェクトではありません'
    const rec = raw as Record<string, unknown>
    const atSeconds = Math.floor(Number(rec.atSeconds))
    // 負の atSeconds = 開始前 (待機ルーム) コメント。サーバーと同じく -3600 まで許容
    if (!Number.isFinite(atSeconds) || atSeconds < -3600) return 'atSeconds が不正です (-3600〜)'
    const authorName = typeof rec.authorName === 'string' ? rec.authorName.trim() : ''
    if (!authorName) return 'authorName が空です'
    if (authorName.length > 50) return 'authorName が50字を超えています'
    const body = typeof rec.body === 'string' ? rec.body.trim() : ''
    if (!body) return 'body が空です'
    if (body.length > 500) return 'body が500字を超えています'
    return { atSeconds, authorName, body }
  }

  const doImport = () => {
    try {
      const parsed = JSON.parse(importJson) as unknown
      if (!Array.isArray(parsed)) throw new Error('配列ではありません')
      const rows: WebinarSakuraComment[] = []
      for (let i = 0; i < parsed.length; i++) {
        const result = validateImportRow(parsed[i])
        if (typeof result === 'string') {
          throw new Error(`${i + 1}行目が不正です: ${result}`)
        }
        rows.push(result)
      }
      setComments(rows)
      setImportJson('')
      setIsErrorMessage(false)
      setMessage(`${rows.length}件読み込みました（保存ボタンで確定）`)
    } catch (err) {
      setIsErrorMessage(true)
      setMessage(`JSON が不正です: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (loading) {
    return <div className="text-gray-500 text-sm">読み込み中...</div>
  }

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={`p-3 rounded-lg text-sm border ${
            isErrorMessage
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          {message}
        </div>
      )}
      <div>
        <p className="mb-1 text-sm text-gray-600">
          JSON 一括インポート（形式: {'[{"atSeconds":10,"authorName":"田中","body":"こんばんは"}]'}、{WEBINAR_SAKURA_COMMENTS_MAX}件まで）
        </p>
        <textarea
          value={importJson}
          onChange={(e) => setImportJson(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-gray-300 p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={doImport}
          className="mt-1 px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          読み込む
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="w-24 px-4 py-3 font-medium">秒数</th>
            <th className="w-40 px-4 py-3 font-medium">名前</th>
            <th className="px-4 py-3 font-medium">本文</th>
            <th className="w-12 px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {comments.map((c, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-1 pr-2">
                <input
                  type="number"
                  value={c.atSeconds}
                  onChange={(e) => update(i, { atSeconds: Number(e.target.value) })}
                  className={`${inputClass} w-20`}
                />
              </td>
              <td className="pr-2">
                <input
                  value={c.authorName}
                  onChange={(e) => update(i, { authorName: e.target.value })}
                  className={inputClass}
                />
              </td>
              <td className="pr-2">
                <input
                  value={c.body}
                  onChange={(e) => update(i, { body: e.target.value })}
                  className={inputClass}
                />
              </td>
              <td>
                <button
                  onClick={() => setComments((prev) => prev.filter((_, j) => j !== i))}
                  className="text-red-500 hover:text-red-600"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <StickyBar actions={(
        <>
        <button
          onClick={() => setComments((prev) => [...prev, { atSeconds: 0, authorName: '', body: '' }])}
          className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          ＋ 追加
        </button>
        <button
          onClick={() => void save()}
          className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          保存
        </button>
        </>
      )} />
    </div>
  )
}

function percent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '—'
}

/**
 * 視聴者コメントは分析の概要でだけ使う。**参加者管理では取らない。**
 * 取得・読込・失敗をここに閉じ込めるので、コメントの失敗で
 * 参加者一覧や集計が消えることはない。
 */
function UserCommentsSection({ webinarId }: { webinarId: string }) {
  const [comments, setComments] = useState<WebinarUserComment[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    webinarApi.userComments(webinarId)
      .then((res) => { if (!cancelled) setComments(res.data) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [webinarId, attempt])

  if (failed) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        <p>視聴者コメントを読み込めませんでした。</p>
        <button type="button" onClick={() => setAttempt((count) => count + 1)} className="mt-1 font-medium underline">もう一度読み込む</button>
      </div>
    )
  }
  if (!comments || comments.length === 0) return null

  return (
    <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between p-5">
        <div><h3 className="font-bold text-slate-900">視聴者コメント</h3><p className="mt-1 text-xs text-slate-500">実際に届いたコメントを参加者の顔と一緒に確認</p></div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{comments.length}件 ▾</span>
      </summary>
      <div className="grid gap-3 border-t border-slate-100 p-5 md:grid-cols-2">
        {comments.map((c) => {
          const name = c.friendName ?? `友だち ${c.friendId.slice(0, 6)}`
          return (
            <Link key={c.id} href={`/chats?friend=${c.friendId}`} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 hover:border-blue-200 hover:bg-blue-50/40">
              <ParticipantAvatar name={name} pictureUrl={c.pictureUrl} />
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-800">{name}</span><span className="text-[10px] text-slate-400">{fmtSec(c.atSeconds)}</span></div><p className="mt-1 text-sm leading-6 text-slate-700">{c.body}</p></div>
            </Link>
          )
        })}
      </div>
    </details>
  )
}

function compactDateTime(value: string): string {
  return new Date(value).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function ParticipantAvatar({
  name,
  pictureUrl,
  size = 'md',
}: {
  name: string
  pictureUrl: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClass = size === 'lg' ? 'h-11 w-11 text-sm' : size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'
  // 外部 URL は https だけ読み、http 等は頭文字表示に落とす。
  if (pictureUrl && pictureUrl.startsWith('https://')) {
    return (
      <img
        src={pictureUrl}
        alt=""
        referrerPolicy="no-referrer"
        className={`${sizeClass} shrink-0 rounded-full bg-canvas-sunken object-cover ring-2 ring-canvas`}
      />
    )
  }
  return (
    <span className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-info-bg font-bold text-info ring-2 ring-canvas`}>
      {name.trim().charAt(0) || '?'}
    </span>
  )
}

/* 参加者一覧の1頁ぶん。サーバーは最大200件まで返す。 */
const PARTICIPANTS_PAGE_SIZE = 50

/*
 * 参加者の分類フィルタ（IDEA-10）。分類ルールはサーバーが持ち、
 * 画面はラベルだけを決める。計測外 = 外部動画などで個人の視聴を
 * 取得できず、視聴データが無いことを未視聴と断定しない区分。
 */
const PARTICIPANT_FILTER_OPTIONS: Array<{ value: '' | WebinarParticipantClassification; label: string }> = [
  { value: '', label: 'すべての申込・参加者' },
  { value: 'unviewed', label: '未参加（申込のみ・入場記録なし）' },
  { value: 'dropped_off', label: '途中離脱（入場したが未完了）' },
  { value: 'completed', label: '視聴完了' },
  { value: 'unmeasured', label: '計測外' },
]

type ParticipantRow = WebinarParticipantPage['items'][number]

/**
 * 参加者行の分類表示。サーバーの classification を優先し、
 * 無い古い応答だけ従来の推測へ落とす。
 */
function participantStateLabel(participant: ParticipantRow, durationSeconds: number): string {
  const rate = Math.min(100, Math.round((participant.maxWatchedSeconds / Math.max(1, durationSeconds)) * 100))
  const hasWatchError = participant.staffIntegrationStatus === 'needs_attention' || Boolean(participant.errorDetail)
  if (participant.classification === undefined) {
    return participant.maxWatchedSeconds === 0
      ? hasWatchError ? '視聴エラー' : participant.latestJoinedAt ? '視聴開始直後' : '未視聴'
      : rate >= 90 ? `視聴完了 ${rate}%` : rate > 0 ? `視聴中 ${rate}%` : '未視聴'
  }
  switch (participant.classification) {
    case 'unmeasured': return '計測外'
    case 'unviewed': return '未参加'
    case 'completed': return `視聴完了 ${rate}%`
    case 'dropped_off':
      return participant.maxWatchedSeconds === 0
        ? hasWatchError ? '視聴エラー' : '入場のみ（再生を確認できず）'
        : `途中離脱 ${rate}%`
  }
}

/** 入場がライブ時間内か終了後（録画）かを回数つきで短く示す。 */
function joinKindLabel(participant: ParticipantRow): string {
  const live = participant.liveSessions ?? 0
  const replay = participant.replaySessions ?? 0
  if (live === 0 && replay === 0) return ''
  const parts: string[] = []
  if (live > 0) parts.push(`ライブ${live}`)
  if (replay > 0) parts.push(`録画${replay}`)
  return `（${parts.join('・')}）`
}

function AnalyticsTab({ webinarId, durationSeconds, view = 'analytics', analytics, analyticsState, webinarStatus, onRetry, onOpenParticipants }: { webinarId: string; durationSeconds: number; view?: 'participants' | 'analytics' | 'legacy'; analytics: WebinarAnalytics | null; analyticsState: 'idle' | 'loading' | 'ready' | 'error'; webinarStatus: Webinar['status']; onRetry: () => void; onOpenParticipants?: () => void }) {
  /*
    参加者一覧は表示目的ごとに独立して読む。コメントや集計の失敗で
    個人履歴まで消えないよう、読込・失敗はここだけの状態にする。
  */
  const [participantItems, setParticipantItems] = useState<WebinarParticipantPage['items']>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [participantsState, setParticipantsState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [attempt, setAttempt] = useState(0)
  /* 分類フィルタと、応答が教える分類の根拠・計測可否。古い応答では欠ける。 */
  const [participantFilter, setParticipantFilter] = useState<'' | WebinarParticipantClassification>('')
  const [participantRule, setParticipantRule] = useState<WebinarParticipantPage['rule'] | null>(null)
  const [participantMeasurement, setParticipantMeasurement] = useState<WebinarParticipantPage['measurement'] | null>(null)
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvError, setCsvError] = useState('')

  /*
    #1053: 直リンクは Cookie が届かない経路（Bearer 補完）で401になるため、
    認証付きで取得してから保存する。失敗は保存しない。
  */
  const downloadParticipantsCsv = (filter?: WebinarParticipantClassification) => {
    if (csvBusy) return
    setCsvBusy(true)
    setCsvError('')
    void downloadApiFile(webinarApi.participantsCsvUrl(webinarId, filter), 'webinar-participants.csv')
      .catch(() => setCsvError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'))
      .finally(() => setCsvBusy(false))
  }

  /*
    集計(`analytics`)は親が1回だけ取る。ここで取ると、分析の段を開くたびに
    8並列の重い集計が2回走る(親と子で二重取得)。
  */
  useEffect(() => {
    let cancelled = false
    setParticipantsState('loading')
    setParticipantItems([])
    setNextCursor(null)
    setMoreError('')
    /*
      個人の参加履歴はオーナー・管理者だけの口。staff には 403 が返るので、
      失敗扱いにせず「見られない」とだけ覚えて集計の表示は続ける。
    */
    webinarApi.participants(webinarId, undefined, PARTICIPANTS_PAGE_SIZE, participantFilter || undefined)
      .then((res) => {
        if (cancelled) return
        setParticipantItems(res.data.items)
        setNextCursor(res.data.nextCursor)
        setParticipantRule(res.data.rule ?? null)
        setParticipantMeasurement(res.data.measurement ?? null)
        setParticipantsState('ready')
      })
      .catch((cause) => {
        if (cancelled) return
        setParticipantsState(cause instanceof ApiError && cause.status === 403 ? 'denied' : 'error')
      })
    return () => { cancelled = true }
  }, [webinarId, attempt, participantFilter])

  /* サーバーが nextCursor を返す限り、次の頁を読み足せる。重複は friendId で除く。 */
  const loadMoreParticipants = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setMoreError('')
    try {
      const res = await webinarApi.participants(webinarId, nextCursor, PARTICIPANTS_PAGE_SIZE, participantFilter || undefined)
      setParticipantItems((prev) => {
        const seen = new Set(prev.map((item) => item.friendId))
        return [...prev, ...res.data.items.filter((item) => !seen.has(item.friendId))]
      })
      setNextCursor(res.data.nextCursor)
      setParticipantRule(res.data.rule ?? null)
      setParticipantMeasurement(res.data.measurement ?? null)
    } catch {
      setMoreError('続きを読み込めませんでした。もう一度お試しください。')
    } finally {
      setLoadingMore(false)
    }
  }

  /*
    参加者管理は個人履歴の面。集計が読めなくても一覧は出し、
    一覧が読めなくても集計は出す——片方の失敗で面全体を消さない。
  */
  if (view === 'participants') {
    if (participantsState === 'denied') {
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
    return (
      <div className="space-y-4" data-design-node="Q8sHa">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-ink text-lg font-bold">参加者管理</h2><p className="text-ink-faint mt-1 text-xs">申込・視聴・CTA・フォームの結果を友だち単位で確認します。</p></div>{participantsState === 'ready' ? <div className="flex flex-wrap items-center gap-2"><SelectField aria-label="参加者の分類で絞り込む" size="compact" value={participantFilter} onChange={(event) => setParticipantFilter(event.target.value as '' | WebinarParticipantClassification)} options={PARTICIPANT_FILTER_OPTIONS} /><Button disabled={csvBusy} onClick={() => downloadParticipantsCsv(participantFilter || undefined)}>{csvBusy ? '書き出しています…' : '参加者をCSVで書き出す'}</Button></div> : null}</div>
        {csvError ? <p className="text-danger text-xs" role="alert">{csvError}</p> : null}
        {summary ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[['申込', summary.reservations, 'text-success'], ['視聴開始', summary.viewers, 'text-accent-deep'], ['視聴完了', summary.completed, 'text-warning'], ['エラー', analytics?.formFunnel.submitErrors ?? 0, 'text-danger']].map(([label, value, tone]) => <div key={String(label)} className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><p className="text-ink-faint text-xs">{label}</p><p className={`${tone} mt-2 text-2xl font-bold tabular-nums`}>{Number(value).toLocaleString('ja-JP')}{label === 'エラー' ? '件' : '人'}</p></div>)}
        </section>
        ) : (
        <p className={`rounded-card p-4 text-sm ${analyticsState === 'error' ? 'border-danger bg-danger-bg text-danger border' : 'text-ink-faint'}`} role={analyticsState === 'error' ? 'alert' : undefined}>
          {analyticsState === 'error' ? '集計を読み込めませんでした。' : '集計を読み込んでいます。'}
          {analyticsState === 'error' ? <button type="button" onClick={onRetry} className="ml-2 font-medium underline">もう一度読み込む</button> : null}
        </p>
        )}
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="border-hairline bg-canvas overflow-hidden rounded-card border shadow-card">
            <div className="border-hairline border-b px-4 py-3"><h3 className="text-ink font-bold">参加者一覧</h3><p className="text-ink-faint mt-1 text-xs">何をきっかけに、何が実行されたかを分析できます。{participantsState === 'ready' ? `${participantItems.length.toLocaleString('ja-JP')}人を表示${nextCursor ? '（まだ続きがあります）' : ''}` : ''}</p>{participantRule || participantMeasurement?.state === 'unavailable' ? <p className="text-ink-faint mt-1 text-xs">{participantRule ? `分類の根拠：視聴完了＝最大視聴位置が動画の90%（${fmtSec(participantRule.completionThresholdSeconds)}）以上。未参加＝申込のみで入場記録なし。ライブ／録画は入場時刻で区別。` : ''}{participantMeasurement?.state === 'unavailable' ? `${participantRule ? ' ' : ''}${participantMeasurement.reason}。個人の分類は「計測外」になります。` : ''}</p> : null}</div>
            {participantsState === 'loading' ? (
              <p className="text-ink-faint p-8 text-center text-sm">読み込み中...</p>
            ) : participantsState === 'error' ? (
              <div className="p-8 text-center text-sm" role="alert">
                <p className="text-danger">参加者一覧を読み込めませんでした。</p>
                <button type="button" onClick={() => setAttempt((count) => count + 1)} className="text-action mt-2 font-medium underline">もう一度読み込む</button>
              </div>
            ) : null}
            <div className="divide-hairline divide-y">{participantsState === 'ready' && participantItems.length === 0 ? <p className="text-ink-faint p-8 text-center text-sm">{participantFilter ? 'この分類に該当する人はいません。' : 'まだ参加者がいません。'}</p> : participantItems.map((participant) => {
              const name = participant.friendName ?? '名前未取得'
              const rate = Math.min(100, Math.round((participant.maxWatchedSeconds / Math.max(1, durationSeconds)) * 100))
              const operational = 'staffIntegrationStatus' in participant ? participant : null
              /*
                分類はサーバーの一つのルールで決まる（応答の rule を参照）。
                視聴データの無い人を未視聴と断定せず、入場記録が無い人は
                「未参加」、外部動画など計測不能な人は「計測外」と表示する。
              */
              const state = participantStateLabel(participant, durationSeconds)
              const action = operational?.errorDetail
                ? operational.errorDetail
                : participant.formSubmittedAt ? '動画・CTA＋フォーム送信' : participant.ctaClickedAt ? '動画・CTA' : participant.maxWatchedSeconds > 0 ? '動画視聴' : '要対応へ追加'
              const status = operational?.staffIntegrationStatus === 'needs_attention'
                ? 'エラー'
                : operational?.staffIntegrationStatus === 'completed' || rate >= 90
                  ? '成功'
                  : '分析待ち'
              return <div key={participant.friendId} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-5 md:items-center"><div className="flex min-w-0 items-center gap-3"><ParticipantAvatar name={name} pictureUrl={participant.pictureUrl} /><span className="truncate font-semibold">{name}</span></div><span className="text-ink-secondary">{state}{joinKindLabel(participant)}</span><span className="text-ink-secondary" title={operational?.errorDetail ?? undefined}>{action}</span><span className={`rounded-pill w-fit px-2 py-1 text-[11px] font-semibold ${status === '成功' ? 'bg-success-bg text-success' : status === 'エラー' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning'}`}>{status}</span><time className="text-ink-faint text-xs">{participant.latestJoinedAt ? compactDateTime(participant.latestJoinedAt).split(' ').at(-1) : '—'}</time></div>
            })}</div>
            {/* まだ続きがあるときだけ「次の頁」を出す。9人目以降もここから辿れる。 */}
            {participantsState === 'ready' && (nextCursor || moreError) ? (
              <div className="border-hairline border-t px-4 py-3 text-center">
                {moreError ? <p className="text-danger mb-2 text-xs" role="alert">{moreError}</p> : null}
                {nextCursor ? (
                  <Button onClick={() => void loadMoreParticipants()} disabled={loadingMore}>{loadingMore ? '読み込み中…' : '続きを読み込む'}</Button>
                ) : null}
              </div>
            ) : null}
          </section>
          {/* 集計が読めていない間・読めなかったときは、内訳の段を出さない。 */}
          {summary && analytics ? (
          <aside className="space-y-3">
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h3 className="text-ink text-sm font-bold">参加状況の内訳</h3><p className="text-ink-faint mt-1 text-xs">一覧を開かずに効果を分析できます。</p><dl className="divide-hairline mt-3 divide-y">{[['予約', summary.registeredAndJoined, percent(summary.registeredAndJoined, summary.reservations)], ['視聴中', watching, percent(watching, summary.reservations)], ['未参加', unviewed, percent(unviewed, summary.reservations)]].map(([label, count, rate]) => <div key={String(label)} className="flex items-center justify-between py-3 text-xs"><dt className="text-ink-secondary">{label}</dt><dd className="text-ink font-bold">{Number(count).toLocaleString('ja-JP')}回 <span className="text-ink-faint ml-2 font-normal">{rate}</span></dd></div>)}</dl></section>
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h3 className="text-ink text-sm font-bold">稼働状況</h3><dl className="divide-hairline mt-3 divide-y text-xs"><div className="flex justify-between py-3"><dt className="text-ink-faint">状態</dt><dd className={`${webinarStatus === 'active' ? 'text-success' : 'text-ink'} font-bold`}>{webinarStatusLabel(webinarStatus)}</dd></div><div className="flex justify-between py-3"><dt className="text-ink-faint">申込→視聴</dt><dd className="text-ink font-bold">{percent(summary.viewers, summary.reservations)}</dd></div><div className="flex justify-between py-3"><dt className="text-ink-faint">平均視聴</dt><dd className="text-ink font-bold">{fmtSec(summary.avgWatchedSeconds)}</dd></div></dl></section>
            <section className="border-danger bg-danger-bg rounded-card border p-4"><h3 className="text-danger text-sm font-bold">要分析</h3><p className="text-danger mt-2 text-xs">視聴・送信エラー {analytics.formFunnel.submitErrors}件</p></section>
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h3 className="text-ink text-sm font-bold">担当者視聴完了</h3><p className="text-ink-faint mt-2 text-xs">未参加・相談希望の連携状況は運用者通知で確認します。</p></section>
          </aside>
          ) : null}
        </div>
      </div>
    )
  }

  /* 分析・一覧の面は集計が本体。集計の失敗だけは面全体の失敗として扱う。 */
  if (analyticsState === 'error') {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        <p>分析データを読み込めませんでした。</p>
        <button type="button" onClick={() => { setAttempt((count) => count + 1); onRetry() }} className="mt-1 font-medium underline">もう一度読み込む</button>
      </div>
    )
  }
  if (!analytics) return <div className="text-gray-500 text-sm">読み込み中...</div>

  const { summary } = analytics

  if (view === 'analytics') {
    const avgRate = durationSeconds > 0 ? Math.round((summary.avgWatchedSeconds / durationSeconds) * 1000) / 10 : 0
    const largestDropoff = largestDropoffAt(analytics.viewSegments ?? [])
    return (
      <div className="space-y-4" data-design-node="yxyzQ">
        <div className="flex flex-wrap items-center justify-between gap-3"><nav aria-label="この段の見出しへ移動" className="flex flex-wrap gap-2">{[{ label: '概要', href: '#webinar-overview' }, { label: '視聴', href: '#webinar-watch-funnel' }, { label: '離脱', href: '#webinar-dropoff' }, { label: 'CTA', href: '#webinar-cta-funnel' }, { label: '申込', href: '#webinar-recent' }].map((item) => <a key={item.label} href={item.href} className="border-hairline bg-canvas text-ink-secondary rounded-control border px-3 py-2 text-sm font-semibold hover:underline">{item.label}</a>)}</nav>{participantsState === 'ready' ? <div className="flex gap-2">{onOpenParticipants ? <Button onClick={onOpenParticipants}>参加者一覧へ</Button> : null}<Button disabled={csvBusy} onClick={() => downloadParticipantsCsv()}>{csvBusy ? '書き出しています…' : 'CSVで書き出す'}</Button></div> : null}</div>
        {csvError ? <p className="text-danger text-xs" role="alert">{csvError}</p> : null}
        <div className="flex flex-col gap-4 xl:flex-row">
          <div className="min-w-0 flex-1 space-y-3">
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">視聴結果</h2><p className="text-ink-faint mt-1 text-xs">申込・再生・完了率を確認します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">申込</dt><dd className="text-ink text-sm font-bold">{summary.reservations.toLocaleString('ja-JP')}人</dd></div><div className="flex justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">再生</dt><dd className="text-ink text-sm font-bold">{summary.viewers.toLocaleString('ja-JP')}人（{percent(summary.viewers, summary.reservations)}）</dd></div></dl></section>
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">視聴行動</h2><p className="text-ink-faint mt-1 text-xs">離脱箇所とCTA反応を確認します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">平均視聴時間</dt><dd className="text-ink text-sm font-bold">{fmtSec(summary.avgWatchedSeconds)}（{avgRate}%）</dd></div><div className="flex justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">最大離脱</dt><dd className="text-ink text-sm font-bold">{largestDropoff !== null ? `${fmtSec(largestDropoff)}付近` : `—（${analytics.measurement?.reason ?? '区間未取得'}）`}</dd></div></dl></section>
          </div>
          <SummaryAside rows={[
            ['視聴完了', `${summary.completed.toLocaleString('ja-JP')}人`],
            ['CTAクリック', `${summary.ctaClicks.toLocaleString('ja-JP')}人`],
            ['申込転換', percent(summary.ctaClicks, summary.reservations)],
          ]} previewBody={analytics.measurement?.state === 'available' ? 'もっとも視聴された区間を分析できます。' : analytics.measurement?.reason ?? '視聴区間の集計はまだ取得できていません。'}>
            <div className="flex gap-2"><Button disabled title="分析の段では実行できません">テスト送信</Button><Button disabled title="分析の段では実行できません">公開ページを見る</Button></div>
          </SummaryAside>
        </div>
      </div>
    )
  }

  const maxDropoff = Math.max(1, ...analytics.dropoff.map((d) => d.viewers))
  const daily = analytics.daily.slice(-14)
  const maxDaily = Math.max(
    1,
    ...daily.flatMap((d) => [d.reservations, d.viewers, d.ctaClicks, d.formSubmissions]),
  )
  const recentParticipants = analytics.participants.slice(0, 16)
  const formFunnelStages = [
    { label: 'CTA表示', value: analytics.formFunnel.ctaImpressions },
    { label: 'CTAクリック', value: analytics.formFunnel.ctaClicks },
    { label: 'フォーム表示', value: analytics.formFunnel.formOpens },
    { label: '入力開始', value: analytics.formFunnel.formStarts },
    { label: '送信操作', value: analytics.formFunnel.submitAttempts },
    { label: '送信完了', value: analytics.formFunnel.submitSuccesses },
  ]
  const maxFormFunnel = Math.max(1, ...formFunnelStages.map((stage) => stage.value))
  const fieldLabels: Record<string, string> = {
    name: 'お名前',
    company: '会社名・屋号',
    annual_revenue: '年商規模',
    budget: '予算感',
    ai_goal: '改善したいこと',
    meeting_date_1: '第1希望日',
    meeting_time_1: '第1希望時刻',
    meeting_date_2: '第2希望日',
    meeting_time_2: '第2希望時刻',
    meeting_date_3: '第3希望日',
    meeting_time_3: '第3希望時刻',
  }
  const funnel = [
    { label: '参加', value: summary.viewers, color: 'bg-blue-500', note: 'ユニーク' },
    { label: '5分視聴', value: summary.watched5m, color: 'bg-cyan-500', note: percent(summary.watched5m, summary.viewers) },
    { label: 'CTAクリック', value: summary.ctaClicks, color: 'bg-violet-500', note: percent(summary.ctaClicks, summary.viewers) },
    { label: 'フォーム送信', value: summary.formSubmissions, color: 'bg-emerald-500', note: percent(summary.formSubmissions, summary.viewers) },
  ]
  const metricCards = [
    {
      label: 'ユニーク参加者',
      value: summary.viewers.toLocaleString('ja-JP'),
      detail: `予約 ${summary.reservations.toLocaleString('ja-JP')}人`,
      tone: 'from-blue-50 to-white border-blue-100',
      dot: 'bg-blue-500',
    },
    {
      label: '予約者の参加率',
      value: percent(summary.registeredAndJoined, summary.reservations),
      detail: `${summary.registeredAndJoined.toLocaleString('ja-JP')} / ${summary.reservations.toLocaleString('ja-JP')}人`,
      tone: 'from-cyan-50 to-white border-cyan-100',
      dot: 'bg-cyan-500',
    },
    {
      label: '90%以上視聴',
      value: percent(summary.completed, summary.viewers),
      detail: `${summary.completed.toLocaleString('ja-JP')}人・平均 ${fmtSec(summary.avgWatchedSeconds)}`,
      tone: 'from-violet-50 to-white border-violet-100',
      dot: 'bg-violet-500',
    },
    {
      label: 'フォーム送信',
      value: summary.formSubmissions.toLocaleString('ja-JP'),
      detail: `CTAから ${percent(summary.formSubmissions, summary.ctaClicks)}`,
      tone: 'from-emerald-50 to-white border-emerald-100',
      dot: 'bg-emerald-500',
    },
  ]

  if (view === 'legacy') {
    return (
      <div className="space-y-4" data-design-node="Q8sHa">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-ink text-lg font-bold">参加者管理</h2>
            <p className="text-ink-faint mt-1 text-xs">申込・視聴・CTA・フォームの結果を友だち単位で確認します。</p>
          </div>
          {participantsState === 'ready' ? (
            <Button disabled={csvBusy} onClick={() => downloadParticipantsCsv()}>
              {csvBusy ? '書き出しています…' : '参加者をCSVで書き出す'}
            </Button>
          ) : null}
        </div>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="border-hairline bg-canvas rounded-card border p-4">
            <p className="text-ink-faint text-xs">申込</p>
            <p className="text-success mt-2 text-2xl font-bold tabular-nums">{summary.reservations.toLocaleString('ja-JP')}人</p>
          </div>
          <div className="border-hairline bg-canvas rounded-card border p-4">
            <p className="text-ink-faint text-xs">視聴開始</p>
            <p className="text-accent-deep mt-2 text-2xl font-bold tabular-nums">{summary.viewers.toLocaleString('ja-JP')}人</p>
          </div>
          <div className="border-hairline bg-canvas rounded-card border p-4">
            <p className="text-ink-faint text-xs">視聴完了</p>
            <p className="text-warning mt-2 text-2xl font-bold tabular-nums">{summary.completed.toLocaleString('ja-JP')}人</p>
          </div>
          <div className="border-hairline bg-canvas rounded-card border p-4">
            <p className="text-ink-faint text-xs">エラー</p>
            <p className="text-danger mt-2 text-2xl font-bold tabular-nums">{analytics.formFunnel.submitErrors.toLocaleString('ja-JP')}件</p>
          </div>
        </section>
        <section className="border-hairline bg-canvas overflow-hidden rounded-card border">
          <div className="border-hairline border-b px-4 py-3">
            <h3 className="text-ink font-bold">参加者一覧</h3>
            <p className="text-ink-faint mt-1 text-xs">何をきっかけに、何が実行されたかを確認できます。</p>
          </div>
          {recentParticipants.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">まだ参加者がいません</div>
          ) : (
            <div className="divide-hairline divide-y">
              {recentParticipants.map((participant) => {
                const name = participant.friendName ?? `友だち ${participant.friendId.slice(0, 6)}`
                const watchedRate = Math.min(100, Math.round((participant.maxWatchedSeconds / Math.max(1, durationSeconds)) * 100))
                const action = participant.formSubmittedAt ? 'フォーム送信' : participant.ctaClickedAt ? 'CTAクリック' : '視聴のみ'
                return (
                  <div key={participant.friendId} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-4 md:items-center">
                    <div className="flex min-w-0 items-center gap-3"><ParticipantAvatar name={name} pictureUrl={participant.pictureUrl} /><span className="truncate font-semibold">{name}</span></div>
                    <span className="text-ink-secondary">視聴完了 {watchedRate}%</span>
                    <span className="text-ink-secondary">{action}</span>
                    <Link href={`/chats?friend=${participant.friendId}`} className="text-action font-semibold">確認する</Link>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-6 scroll-mt-4" id="webinar-overview" data-design-node="yxyzQ">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Performance overview</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">参加の流れをひと目で確認</h2>
          <p className="mt-1 text-sm text-slate-500">再入場や複数回参加は、同じ友だちとしてまとめています。</p>
        </div>
        {analytics.participants.length > 0 && (
          <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="flex -space-x-2">
              {analytics.participants.slice(0, 5).map((p) => (
                <ParticipantAvatar
                  key={p.friendId}
                  name={p.friendName ?? '友だち'}
                  pictureUrl={p.pictureUrl}
                  size="sm"
                />
              ))}
            </div>
            <span className="text-xs font-medium text-slate-600">最近の参加者</span>
          </div>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metricCards.map((metric) => (
          <div key={metric.label} className={`rounded-2xl border bg-gradient-to-br p-4 ${metric.tone}`}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span className={`h-2 w-2 rounded-full ${metric.dot}`} />
              {metric.label}
            </div>
            <div className="mt-3 text-3xl font-bold tabular-nums tracking-[-0.02em] text-slate-950">{metric.value}</div>
            <div className="mt-1 text-xs text-slate-500">{metric.detail}</div>
          </div>
        ))}
      </section>

      <section id="webinar-cta-funnel" className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="font-bold text-slate-900">CTAから相談完了まで</h3>
            <p className="mt-1 text-xs text-slate-500">計測開始後のユニーク人数。どの操作で離脱したかを確認できます。</p>
          </div>
          <span className="text-xs text-slate-500">
            送信エラー {analytics.formFunnel.submitErrors.toLocaleString('ja-JP')}人
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {formFunnelStages.map((stage, index) => {
            const previous = index === 0 ? stage.value : formFunnelStages[index - 1].value
            return (
              <div key={stage.label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-600">{stage.label}</span>
                  <span className="text-[11px] text-slate-400">
                    {index === 0 ? '起点' : percent(stage.value, previous)}
                  </span>
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-950">
                  {stage.value.toLocaleString('ja-JP')}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-violet-500"
                    style={{ width: `${Math.max(0, Math.min(100, (stage.value / maxFormFunnel) * 100))}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {analytics.formFunnel.fieldCompletions.length > 0 && (
          <details className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
              項目ごとの到達人数を見る
            </summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {analytics.formFunnel.fieldCompletions.map((field) => (
                <div key={field.fieldName} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs">
                  <span className="text-slate-600">{fieldLabels[field.fieldName] ?? field.fieldName}</span>
                  <span className="font-bold text-slate-900">{field.users.toLocaleString('ja-JP')}人</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <section id="webinar-watch-funnel" className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">参加ファネル</h3>
              <p className="mt-1 text-xs text-slate-500">どこで人数が減っているか</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">全期間</span>
          </div>
          <div className="mt-5 space-y-4">
            {funnel.map((stage) => (
              <div key={stage.label}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{stage.label}</span>
                  <span className="text-slate-500"><strong className="text-slate-900">{stage.value}</strong>人 · {stage.note}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${stage.color}`}
                    style={{ width: `${Math.max(stage.value > 0 ? 3 : 0, (stage.value / Math.max(1, summary.viewers)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
            <div>
              <div className="text-[11px] text-slate-500">15分以上視聴</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{summary.watched15m}人</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">CTA → フォーム</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{percent(summary.formSubmissions, summary.ctaClicks)}</div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">日別の参加ペース</h3>
              <p className="mt-1 text-xs text-slate-500">直近14日・日ごとのユニーク人数</p>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-slate-300" />予約</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-500" />参加</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-violet-500" />CTA</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />フォーム</span>
            </div>
          </div>
          {daily.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-sm text-slate-400">まだ日別データがありません</div>
          ) : (
            <div className="mt-5 flex h-52 items-end gap-2 overflow-x-auto border-b border-slate-200 pb-7">
              {daily.map((day) => (
                <div key={day.date} className="relative flex h-full min-w-10 flex-1 items-end justify-center gap-0.5" title={`${day.date} 予約${day.reservations}・参加${day.viewers}・CTA${day.ctaClicks}・フォーム${day.formSubmissions}`}>
                  <div className="w-2 rounded-t bg-slate-300" style={{ height: `${Math.max(day.reservations > 0 ? 3 : 0, (day.reservations / maxDaily) * 100)}%` }} />
                  <div className="w-2 rounded-t bg-blue-500" style={{ height: `${Math.max(day.viewers > 0 ? 3 : 0, (day.viewers / maxDaily) * 100)}%` }} />
                  <div className="w-2 rounded-t bg-violet-500" style={{ height: `${Math.max(day.ctaClicks > 0 ? 3 : 0, (day.ctaClicks / maxDaily) * 100)}%` }} />
                  <div className="w-2 rounded-t bg-emerald-500" style={{ height: `${Math.max(day.formSubmissions > 0 ? 3 : 0, (day.formSubmissions / maxDaily) * 100)}%` }} />
                  <span className="absolute -bottom-6 whitespace-nowrap text-[10px] text-slate-400">
                    {new Date(`${day.date}T00:00:00+09:00`).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section id="webinar-recent" className="scroll-mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-bold text-slate-900">最近の参加者</h3>
            <p className="mt-1 text-xs text-slate-500">顔写真・視聴状況・フォーム到達を友だち単位で表示</p>
          </div>
          <span className="text-xs text-slate-500">全 {analytics.participants.length.toLocaleString('ja-JP')}人</span>
        </div>
        {recentParticipants.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">まだ参加者がいません</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">参加者</th>
                    <th className="px-4 py-3">最終参加</th>
                    <th className="px-4 py-3">視聴</th>
                    <th className="px-4 py-3">アクション</th>
                    <th className="px-4 py-3 text-right">詳細</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentParticipants.map((p) => {
                    const name = p.friendName ?? `友だち ${p.friendId.slice(0, 6)}`
                    const watchedRate = Math.min(100, Math.round((p.maxWatchedSeconds / Math.max(1, durationSeconds)) * 100))
                    return (
                      <tr key={p.friendId} className="hover:bg-blue-50/30">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <ParticipantAvatar name={name} pictureUrl={p.pictureUrl} size="lg" />
                            <div className="min-w-0">
                              <div className="max-w-48 truncate font-semibold text-slate-900">{name}</div>
                              <div className="mt-0.5 text-[11px] text-slate-400">{p.sessions > 1 ? `${p.sessions}回参加` : p.registered ? '予約から参加' : '直接参加'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-600">{compactDateTime(p.latestJoinedAt)}</td>
                        <td className="w-48 px-4 py-3.5">
                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span>{fmtSec(p.maxWatchedSeconds)}</span><span>{watchedRate}%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${watchedRate}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap gap-1.5">
                            {p.formSubmittedAt ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-success">フォーム送信</span>
                            ) : p.ctaClickedAt ? (
                              <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">CTAクリック</span>
                            ) : (
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">視聴のみ</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Link href={`/chats?friend=${p.friendId}`} className="text-xs font-semibold text-blue-600 hover:text-blue-700">チャットを見る →</Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 md:hidden">
              {recentParticipants.map((p) => {
                const name = p.friendName ?? `友だち ${p.friendId.slice(0, 6)}`
                return (
                  <Link key={p.friendId} href={`/chats?friend=${p.friendId}`} className="flex items-center gap-3 p-4 active:bg-slate-50">
                    <ParticipantAvatar name={name} pictureUrl={p.pictureUrl} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{compactDateTime(p.latestJoinedAt)} · {fmtSec(p.maxWatchedSeconds)}視聴</div>
                    </div>
                    <span className={`h-2.5 w-2.5 rounded-full ${p.formSubmittedAt ? 'bg-emerald-500' : p.ctaClickedAt ? 'bg-violet-500' : 'bg-slate-300'}`} />
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </section>

      <details id="webinar-dropoff" className="group scroll-mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5">
          <div>
            <h3 className="font-bold text-slate-900">視聴維持・回別の詳細</h3>
            <p className="mt-1 text-xs text-slate-500">必要なときだけ、離脱位置と各回の数字を確認</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 group-open:bg-blue-50 group-open:text-blue-700">{analytics.sessions.length}回 ▾</span>
        </summary>
        <div className="grid gap-6 border-t border-slate-100 p-5 xl:grid-cols-2">
          <div>
            <h4 className="mb-3 text-sm font-semibold text-slate-800">最終視聴位置</h4>
            {analytics.dropoff.length === 0 ? (
              <p className="text-sm text-slate-400">まだ視聴データがありません</p>
            ) : analytics.dropoff.map((d) => (
              <div key={d.bucketStart} className="mb-2 flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-slate-500">{fmtSec(d.bucketStart)}〜</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${(d.viewers / maxDropoff) * 100}%` }} />
                </div>
                <span className="w-7 text-right font-semibold text-slate-700">{d.viewers}</span>
              </div>
            ))}
          </div>
          <div className="min-w-0">
            <h4 className="mb-3 text-sm font-semibold text-slate-800">直近の開催回</h4>
            <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr><th className="px-4 py-3 font-medium">開始</th><th className="px-4 py-3 font-medium">参加</th><th className="px-4 py-3 font-medium">平均視聴</th><th className="px-4 py-3 font-medium">CTA</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.sessions.slice(0, 30).map((s) => (
                    <tr key={s.sessionStartAt}><td className="px-3 py-2 text-slate-700">{fmtSession(s.sessionStartAt)}</td><td>{s.viewers}</td><td>{fmtSec(s.avgWatchedSeconds)}</td><td>{s.ctaClicks} ({percent(s.ctaClicks, s.viewers)})</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </details>

      {/* コメントはこの面だけが取る。失敗しても集計・参加者はそのまま残る。 */}
      <UserCommentsSection webinarId={webinarId} />
    </div>
  )
}

function fmtMinSec(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function parseMinSec(v: string): number | null {
  const m = /^(\d+):([0-5]?\d)$/.exec(v.trim())
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const n = Number(v.trim())
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

const MEDIA_KIND_LABEL: Record<MediaItem['kind'], string> = {
  image: '画像',
  video: '動画',
  audio: '音声',
  file: 'ファイル',
}

/*
  動画欄の表示名。**URL識別子から `<slug>.mp4` という存在しない
  ファイル名を作らない**(監査 DETAIL-18)。
  ライブラリのメディアを選んでいれば実ファイル名・種別・長さを出す。
  prefix だけの旧形式や、ライブラリで名前を取れないときは
  「設定済みの動画」とだけ書く。
*/
function VideoMediaLabel({ webinar }: { webinar: Webinar }) {
  const mediaId = webinar.videoMediaId ?? null
  const accountId = webinar.accountId ?? null
  const [media, setMedia] = useState<MediaItem | null>(null)

  useEffect(() => {
    setMedia(null)
    if (!mediaId || !accountId) return
    let cancelled = false
    api.media
      .detail(mediaId, accountId)
      .then((res) => {
        if (!cancelled && res.success) setMedia(res.data.item)
      })
      .catch(() => {
        /* 名前が取れなくても偽名は出さない。「設定済みの動画」に落ちる。 */
      })
    return () => {
      cancelled = true
    }
  }, [mediaId, accountId])

  if (!webinar.videoPrefix && !mediaId) return <span>—（未設定）</span>
  if (!media) return <span>設定済みの動画</span>
  return (
    <span className="block min-w-0">
      <span className="block truncate" title={media.filename}>
        {media.filename}
      </span>
      <span className="text-ink-faint mt-0.5 block text-xs font-normal">
        {MEDIA_KIND_LABEL[media.kind]}
        {media.durationMs !== null && media.durationMs > 0
          ? `・${fmtSec(Math.round(media.durationMs / 1000))}`
          : ''}
      </span>
    </span>
  )
}

function VideoDesignStep({ webinar, editor, registrations, publicUrl, canOpenPublicPage, publicPageReason, onWebinarSaved, onDirtyChange, registerSave }: { webinar: Webinar; editor: WebinarEditor; registrations: number | null; publicUrl: string | null; canOpenPublicPage: boolean; publicPageReason: string; onWebinarSaved: (next: Webinar) => void; onDirtyChange?: (dirty: boolean) => void; registerSave?: (save: (() => Promise<boolean>) | null) => void }) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="PV1Vh">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">動画設定</h2>
          <p className="text-ink-faint mt-1 text-xs">動画ファイルまたは外部動画URLを設定します。</p>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,1fr)]">
            <div><p className="text-ink-faint text-xs font-semibold">動画</p><div className="border-hairline text-ink mt-1 rounded-control border px-3 py-3 text-sm font-semibold"><VideoMediaLabel webinar={webinar} /></div></div>
            <div><p className="text-ink-faint text-xs font-semibold">再生時間</p><div className="border-hairline text-ink mt-1 rounded-control border px-3 py-3 text-sm font-semibold">{durationLabel(webinar.durationSeconds)}</div></div>
          </div>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">公開設定</h2>
          <p className="text-ink-faint mt-1 text-xs">公開期間・視聴条件・自動再生を設定します。</p>
          <div className="mt-4 space-y-3">
            <div className="border-hairline flex items-center justify-between gap-4 rounded-control border bg-canvas-sunken px-4 py-4"><div><p className="text-ink text-sm font-bold">公開期間</p><p className="text-ink-faint mt-1 text-xs">{deliveryWindow(webinar)}</p></div><span className="text-action">›</span></div>
            <div className="border-hairline flex items-center justify-between gap-4 rounded-control border bg-canvas-sunken px-4 py-4"><div><p className="text-ink text-sm font-bold">視聴条件</p><p className="text-ink-faint mt-1 text-xs">{editor.viewingCondition.label}</p></div><span className="text-action">›</span></div>
          </div>
        </section>
        <EditorDetails label="動画・公開の詳細を編集する"><WebinarForm key={`${webinar.id}-${webinar.updatedAt}`} initial={webinar} hideBar onSaved={onWebinarSaved} onDirtyChange={onDirtyChange} registerSave={registerSave} /></EditorDetails>
      </div>
      <SummaryAside rows={[
        ['動画', webinar.videoPrefix ? 'アップロード済み' : '未設定'],
        ['公開', webinarStatusLabel(webinar.status)],
        ['申込', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
      ]} previewBody={videoPreview(webinar).body ?? videoPreview(webinar).empty}>
        <div className="flex gap-2"><Button disabled title="確認の段で実行します">テスト送信</Button>{canOpenPublicPage && publicUrl ? <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : <Button disabled title={publicPageReason}>公開ページを見る</Button>}</div>
        {/* 押せないときは理由を文字で出す。実行できるように見せて無反応にしない。 */}
        {!(canOpenPublicPage && publicUrl) && publicPageReason ? <p className="text-ink-faint text-xs">{publicPageReason}</p> : null}
      </SummaryAside>
    </div>
  )
}

/*
  通知概要の状態は1つの定義から描く。文字だけ変えて成功色のままにすると、
  未設定・確認中・取得失敗まで設定済みと同じ緑になる(監査 DETAIL-19)。
  色が見分けにくくてもアイコンと文字で区別できるようにする。
*/
type NotificationRowState = 'configured' | 'unset' | 'pending' | 'failed'

const NOTIFICATION_ROW_STATE: Record<
  NotificationRowState,
  { label: string; icon: typeof CheckCircle2; tone: 'success' | 'neutral' | 'pending' | 'danger' }
> = {
  configured: { label: '設定済み', icon: CheckCircle2, tone: 'success' },
  unset: { label: '未設定', icon: Circle, tone: 'neutral' },
  pending: { label: '—（確認中）', icon: LoaderCircle, tone: 'pending' },
  failed: { label: '取得できません', icon: TriangleAlert, tone: 'danger' },
}

function notificationRowState(
  value: boolean | undefined,
  ready: boolean,
  failed: boolean,
): NotificationRowState {
  if (!ready) return 'pending'
  if (failed) return 'failed'
  return value ? 'configured' : 'unset'
}

/*
  「当日・見逃し案内」の要約文は、時刻の有無ではなく保存された
  各通知の有効フラグから組み立てる（監査 WEBINAR-10）。
  全OFFで保存しても時刻の既定値は残るので、値だけ見ると
  切った通知まで「送る」と読めてしまう。読み込み中・取得失敗・
  まだ設定が無いのも「送る」ではないので、状態ごとに分ける。
  説明は概要バッジと同じ NOTIFICATION_ROW_STATE の言葉を使う。
*/
function deliveryTimingSummary(
  settings: WebinarNotificationSettings | null,
  ready: boolean,
  failed: boolean,
): string {
  if (!ready) return NOTIFICATION_ROW_STATE.pending.label
  if (failed) return NOTIFICATION_ROW_STATE.failed.label
  if (!settings) return NOTIFICATION_ROW_STATE.unset.label
  const parts: string[] = []
  if (settings.dayBeforeEnabled) parts.push(`前日 ${settings.dayBeforeTime || '—'}`)
  if (settings.hourBeforeEnabled) parts.push(settings.hourBeforeMinutes ? `${settings.hourBeforeMinutes}分前` : '開始前')
  if (settings.startEnabled) parts.push('開始時')
  return parts.length > 0 ? parts.join('／') : '送りません'
}

function missedNoticeSummary(
  settings: WebinarNotificationSettings | null,
  ready: boolean,
  failed: boolean,
): string {
  if (!ready) return NOTIFICATION_ROW_STATE.pending.label
  if (failed) return NOTIFICATION_ROW_STATE.failed.label
  if (!settings) return NOTIFICATION_ROW_STATE.unset.label
  return settings.missedEnabled
    ? `未視聴者へ翌日${settings.missedTime || '—'}に送信`
    : '送りません'
}

function completedNoticeSummary(
  settings: WebinarNotificationSettings | null,
  ready: boolean,
  failed: boolean,
): string {
  if (!ready) return NOTIFICATION_ROW_STATE.pending.label
  if (failed) return NOTIFICATION_ROW_STATE.failed.label
  if (!settings) return NOTIFICATION_ROW_STATE.unset.label
  return settings.completedEnabled ? '見終わった人へお礼を送信' : '送りません'
}

function NotificationStateBadge({ state }: { state: NotificationRowState }) {
  const view = NOTIFICATION_ROW_STATE[state]
  const Icon = view.icon
  /*
    className は静的に読める字面だけで書く（design-debt 計測が識別子を
    追えないため）。色の対応は NOTIFICATION_ROW_STATE の tone が持ち、
    ここはその言い換えに留める。
  */
  return (
    <span
      className={
        view.tone === 'success'
          ? 'inline-flex items-center gap-1.5 text-xs font-semibold text-success'
          : view.tone === 'neutral'
            ? 'inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint'
            : view.tone === 'pending'
              ? 'inline-flex items-center gap-1.5 text-xs font-semibold text-ink-secondary'
              : 'inline-flex items-center gap-1.5 text-xs font-semibold text-danger'
      }
    >
      <Icon aria-hidden="true" size={14} />
      {view.label}
    </span>
  )
}

function NotificationDesignStep({ webinarId, webinarTitle, registrations, publicUrl, canOpenPublicPage, publicPageReason, onDirtyChange, registerSave }: { webinarId: string; webinarTitle: string; registrations: number | null; publicUrl: string | null; canOpenPublicPage: boolean; publicPageReason: string; onDirtyChange?: (dirty: boolean) => void; registerSave?: (save: (() => Promise<boolean>) | null) => void }) {
  const [settings, setSettings] = useState<WebinarNotificationSettings | null>(null)
  const [settingsReady, setSettingsReady] = useState(false)
  const [settingsFailed, setSettingsFailed] = useState(false)
  const [notifAttempt, setNotifAttempt] = useState(0)
  const [editor, setEditor] = useState<WebinarEditor | null>(null)
  const [testConfirmOpen, setTestConfirmOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  /*
    通知の取得は子の編集タブ(`WebinarNotifications`)に一本化し、親は
    報告を受けて概要だけ描く。同じ口を親子で2回叩かない。
  */
  const handleNotificationsLoaded = useCallback((data: { settings: WebinarNotificationSettings | null; overview: WebinarNotificationOverview | null } | null) => {
    if (data === null) {
      setSettings(null)
      setSettingsFailed(true)
    } else {
      setSettings(data.settings)
      setSettingsFailed(false)
    }
    setSettingsReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    webinarApi.editor(webinarId)
      .then((editorResponse) => { if (!cancelled) setEditor(editorResponse.data) })
      .catch(() => { if (!cancelled) setEditor(null) })
    return () => { cancelled = true }
  }, [webinarId])

  /*
    テスト送信は実際にLINEへ届く。押す前に、送る相手と文面を確認させる。
    設定が読めていない間は実行可能に見せない。
  */
  const notificationTestDone = editor?.notificationTest?.status === 'passed'
  const testDisabledReason = !settingsReady || settingsFailed
    ? '通知の設定を読み込んでから実行できます'
    : null
  const runNotificationTest = async () => {
    setTestConfirmOpen(false)
    setTesting(true)
    setTestResult('')
    try {
      const response = await webinarApi.testNotifications(webinarId)
      setTestResult(`テスト送信しました。成功 ${response.data.sent}件・失敗 ${response.data.failed}件`)
      /* 結果はエディタの notificationTest に記録される。取り直して印を更新する。 */
      webinarApi.editor(webinarId)
        .then((editorResponse) => setEditor(editorResponse.data))
        .catch(() => undefined)
    } catch (cause) {
      setTestResult(webinarErrorText(cause, 'テスト送信できませんでした。時間をおいてもう一度お試しください。'))
    } finally {
      setTesting(false)
    }
  }


  const registrationState = notificationRowState(settings?.registrationEnabled, settingsReady, settingsFailed)
  const dayBeforeState = notificationRowState(settings?.dayBeforeEnabled, settingsReady, settingsFailed)
  const reminderState = notificationRowState(
    Boolean(settings?.dayBeforeEnabled || settings?.hourBeforeEnabled),
    settingsReady,
    settingsFailed,
  )
  const startState = notificationRowState(settings?.startEnabled, settingsReady, settingsFailed)
  const missedState = notificationRowState(settings?.missedEnabled, settingsReady, settingsFailed)
  const completedState = notificationRowState(settings?.completedEnabled, settingsReady, settingsFailed)

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="Ho8z4">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">事前案内</h2>
          <p className="text-ink-faint mt-1 text-xs">申込直後・前日・1時間前の案内を設定します。</p>
          <dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline">
            <div className="flex items-center justify-between gap-4 px-4 py-4"><div><dt className="text-ink text-sm font-bold">申込完了</dt><dd className="text-ink-faint mt-1 text-xs">申込完了直後に案内を送信</dd></div><NotificationStateBadge state={registrationState} /></div>
            <div className="flex items-center justify-between gap-4 px-4 py-4"><div><dt className="text-ink text-sm font-bold">開催前日</dt><dd className="text-ink-faint mt-1 text-xs">LINEでリマインド</dd></div><NotificationStateBadge state={dayBeforeState} /></div>
          </dl>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">当日・見逃し案内</h2>
          <p className="text-ink-faint mt-1 text-xs">開始前・開始時・未視聴者・見終わった人への案内を設定します。</p>
          <dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline">
            <div className="px-4 py-4"><dt className="text-ink text-sm font-bold">配信タイミング</dt><dd className="text-ink-faint mt-1 text-xs">{deliveryTimingSummary(settings, settingsReady, settingsFailed)}</dd></div>
            <div className="px-4 py-4"><dt className="text-ink text-sm font-bold">見逃し案内</dt><dd className="text-ink-faint mt-1 text-xs">{missedNoticeSummary(settings, settingsReady, settingsFailed)}</dd></div>
            <div className="px-4 py-4"><dt className="text-ink text-sm font-bold">視聴完了のお礼</dt><dd className="text-ink-faint mt-1 text-xs">{completedNoticeSummary(settings, settingsReady, settingsFailed)}</dd></div>
          </dl>
        </section>
        {settingsFailed && (
          <button
            type="button"
            onClick={() => { setSettingsReady(false); setSettingsFailed(false); setNotifAttempt((count) => count + 1) }}
            className="text-action text-xs font-medium underline"
          >
            通知の設定をもう一度読み込む
          </button>
        )}
        <EditorDetails label="通知ごとの送信設定を編集する"><WebinarNotifications key={notifAttempt} webinarId={webinarId} onLoaded={handleNotificationsLoaded} onDirtyChange={onDirtyChange} registerSave={registerSave} /></EditorDetails>
      </div>
      <SummaryAside rows={[
        ['申込完了', NOTIFICATION_ROW_STATE[registrationState].label],
        ['リマインド', reminderState === 'configured' ? 'リマインド中' : NOTIFICATION_ROW_STATE[reminderState].label],
        ['開始時', NOTIFICATION_ROW_STATE[startState].label],
        ['見逃し案内', NOTIFICATION_ROW_STATE[missedState].label],
        ['視聴完了', NOTIFICATION_ROW_STATE[completedState].label],
        ['対象', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
      ]} previewBody={editor?.notificationMessages.registration || notificationPreview(null).empty}>
        <div className="flex gap-2"><Button disabled={testing || notificationTestDone || testDisabledReason !== null} title={notificationTestDone ? 'テスト済みです' : testDisabledReason ?? undefined} onClick={() => setTestConfirmOpen(true)}>{testing ? '送信中…' : notificationTestDone ? 'テスト送信済み' : 'テスト送信'}</Button>{canOpenPublicPage && publicUrl ? <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : <Button disabled title={publicPageReason}>公開ページを見る</Button>}</div>
        {testResult ? <p className="text-ink-secondary text-xs" role="status">{testResult}</p> : null}
        {!(canOpenPublicPage && publicUrl) && publicPageReason ? <p className="text-ink-faint text-xs">{publicPageReason}</p> : null}
      </SummaryAside>
      {/* 相手と文面を確認してから実送信する。申込者全員には届かない。 */}
      <ConfirmDialog
        open={testConfirmOpen}
        title="通知をテスト送信しますか？"
        description="アカウント設定で登録したテスト受信者へ、実際のLINEメッセージを送ります。申込者全員には届きません。"
        confirmLabel="テスト送信する"
        busy={testing}
        onCancel={() => { if (!testing) setTestConfirmOpen(false) }}
        onConfirm={() => void runNotificationTest()}
      >
        <p className="text-ink-secondary text-xs">送る文面（開始のお知らせ）：「{webinarTitle}」が始まりました、という案内に参加URLを添えて送ります。</p>
      </ConfirmDialog>
    </div>
  )
}

type FormCandidateState = 'idle' | 'loading' | 'ready' | 'error' | 'forbidden'

/*
  CTA の編集状態は「どのウェビナーの分か」を必ず一緒に持つ。
  ウェビナーを切り替えた瞬間から前のウェビナーの CTA は出さない・保存させない。
*/
type CtaEditing = { webinarId: string; loaded: boolean; ctas: WebinarCtaCard[]; times: string[]; message: string | null }

function emptyCtaEditing(webinarId: string): CtaEditing {
  return { webinarId, loaded: false, ctas: [], times: [], message: null }
}

function CtasTab({ webinarId, durationSeconds, forms, formsState, onRetryForms, onCtasLoaded }: { webinarId: string; durationSeconds: number; forms: Array<{ id: string; name: string }>; formsState: FormCandidateState; onRetryForms: () => void; onCtasLoaded?: (ctas: WebinarCtaCard[] | null) => void }) {
  const [editing, setEditing] = useState<CtaEditing>(() => emptyCtaEditing(webinarId))
  const [saving, setSaving] = useState(false)
  /* 取得の世代印。切替後に遅れて届いた前のウェビナーの応答はここで捨てる。 */
  const ctaRequestId = useRef(0)

  /* 描くのは今のウェビナーの分だけ。印が違えば「まだ何も無い」として描く。 */
  const current = editing.webinarId === webinarId ? editing : emptyCtaEditing(webinarId)
  const { ctas, times, message, loaded } = current
  /* 編集も今のウェビナーの分にだけ効かせる。 */
  const editCurrent = useCallback((update: (prev: CtaEditing) => CtaEditing) => {
    setEditing((prev) => (prev.webinarId === webinarId ? update(prev) : prev))
  }, [webinarId])
  const setMessage = useCallback((next: string | null) => {
    editCurrent((prev) => ({ ...prev, message: next }))
  }, [editCurrent])

  /*
    CTA の取得はここに一本化し、親の概要段は報告を受けて件数だけ描く。
    同じ口を親子で2回叩かない。
  */
  const loadCtas = useCallback(async () => {
    // ロード失敗時に空の状態で保存すると all-or-nothing 置換で既存 CTA を消して
    // しまうため、初回 GET が成功するまで保存を無効化する
    const requestId = ++ctaRequestId.current
    /* 取得を始めた時点で前の中身を捨てる。読み込み中に旧 CTA を触らせない。 */
    setEditing(emptyCtaEditing(webinarId))
    try {
      const res = await webinarApi.ctas(webinarId)
      /* 先に世代印を見る。切替後に届いた前の応答はここで終わり。 */
      if (requestId !== ctaRequestId.current) return
      /*
        **配列で来なかったら、読めなかったこととして扱う。**
        口の契約は配列（`apps/worker/src/routes/webinars.ts:904` が
        `data: ctas.map(...)` を返す）だが、器だけ違う返事が来ると
        `ctas.map is not a function` で**この面が白い画面になる**。
        そのまま保存に進むと、置き換えで既存のCTAを消してしまう。
      */
      if (!Array.isArray(res.data)) throw new Error('cta_list_not_array')
      setEditing({ webinarId, loaded: true, ctas: res.data, times: res.data.map((c) => fmtMinSec(c.atSeconds)), message: null })
      onCtasLoaded?.(res.data)
    } catch {
      if (requestId !== ctaRequestId.current) return
      setEditing({ webinarId, loaded: false, ctas: [], times: [], message: 'CTAカードを読み込めませんでした。もう一度読み込んでください。読み込めるまで保存はできません。' })
      onCtasLoaded?.(null)
    }
  }, [webinarId, onCtasLoaded])

  useEffect(() => {
    void loadCtas()
    return () => { ctaRequestId.current += 1 }
  }, [loadCtas])

  const update = (i: number, patch: Partial<WebinarCtaCard>) =>
    editCurrent((prev) => ({ ...prev, ctas: prev.ctas.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))

  const save = async () => {
    /* 読めていない間は保存しない（空で全置換して既存 CTA を消さない）。 */
    if (!loaded) return
    setMessage(null)
    /*
      保存前に「どのカードの何が足りないか」を枚数で示す。公開前検証で
      止まる前に、ここで直し方まで伝える。1件でもあれば保存しない。
    */
    const problems = ctaCardProblems(ctas, times, durationSeconds, parseMinSec)
    if (problems.length > 0) {
      setMessage(problems.join('\n'))
      return
    }
    const merged: WebinarCtaCard[] = ctas.map((card, i) => ({
      ...card,
      atSeconds: parseMinSec(times[i] ?? '') as number,
    }))
    setSaving(true)
    try {
      const sorted = [...merged].sort((a, b) => a.atSeconds - b.atSeconds)
      await webinarApi.saveCtas(webinarId, sorted)
      editCurrent((prev) => ({ ...prev, ctas: sorted, times: sorted.map((c) => fmtMinSec(c.atSeconds)) }))
      /* 保存した中身を親の概要段へ流す。取り直しの GET は要らない。 */
      onCtasLoaded?.(sorted)
      setMessage(`${sorted.length}件保存しました`)
    } catch (err) {
      setMessage(`保存に失敗しました: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        指定時間にチャット欄へ CTA カードが流れます。「フォーム」はウェビナー内でそのまま回答でき、
        フォーム機能のタグ付与・シナリオ発火が自動で動きます。「URL」は外部ページを開きます。
      </p>
      {message && (
        <p className="whitespace-pre-line rounded bg-blue-50 p-2 text-sm">
          {message}
          {!loaded && (
            <button type="button" onClick={() => void loadCtas()} className="ml-2 font-medium underline">もう一度読み込む</button>
          )}
        </p>
      )}
      {ctas.map((c, i) => (
        <div key={i} className="space-y-2 rounded border border-gray-200 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              表示時間
              <input
                value={times[i] ?? ''}
                onChange={(e) =>
                  editCurrent((prev) => ({ ...prev, times: prev.times.map((t, j) => (j === i ? e.target.value : t)) }))
                }
                placeholder="45:00"
                className="w-20 rounded border px-2 py-1"
              />
            </label>
            <SelectField value={c.kind} onChange={(e) => update(i, { kind: e.target.value as 'form' | 'url' })} options={[{ value: "form", label: "フォーム" }, { value: "url", label: "URL" }]} className="rounded border px-2 py-1" />
            {c.kind === 'form' ? (
              <>
                <SelectField
                  value={c.formId ?? ''}
                  onChange={(e) => update(i, { formId: e.target.value || null })}
                  options={[{ value: '', label: 'フォームを選択...' }, ...forms.map((f) => ({ value: f.id, label: f.name }))]}
                />
                {(formsState === 'error' || formsState === 'forbidden') && (
                  <p className="text-danger w-full text-xs" role="alert">
                    {formsState === 'forbidden' ? 'フォーム候補を見る権限がありません。アカウントの権限を確認してください。' : 'フォーム候補を読み込めませんでした。'}
                    <button type="button" onClick={onRetryForms} className="ml-2 font-medium underline">もう一度読み込む</button>
                    <span className="text-ink-faint ml-2">候補が取れない間は種類をURLに切り替えて保存できます。</span>
                  </p>
                )}
              </>
            ) : (
              <input
                value={c.url ?? ''}
                onChange={(e) => update(i, { url: e.target.value || null })}
                placeholder="https://..."
                className="min-w-60 flex-1 rounded border px-2 py-1"
              />
            )}
            {c.kind === 'form' && (
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={c.autoOpen}
                  onChange={(e) => update(i, { autoOpen: e.target.checked })}
                />
                自動でフォームを開く
              </label>
            )}
            <button
              onClick={() => {
                editCurrent((prev) => ({ ...prev, ctas: prev.ctas.filter((_, j) => j !== i), times: prev.times.filter((_, j) => j !== i) }))
              }}
              className="ml-auto text-red-500"
            >
              削除
            </button>
          </div>
          <input
            value={c.title}
            onChange={(e) => update(i, { title: e.target.value })}
            placeholder="カード見出し（例: 個別導入診断、受付中です）"
            className="w-full rounded border px-2 py-1 text-sm font-bold"
          />
          <input
            value={c.body ?? ''}
            onChange={(e) => update(i, { body: e.target.value || null })}
            placeholder="補足文（任意。例: この配信を見ている方限定・枠が少なめです）"
            className="w-full rounded border px-2 py-1 text-sm"
          />
          <input
            value={c.buttonLabel}
            onChange={(e) => update(i, { buttonLabel: e.target.value })}
            placeholder="ボタン文言（例: 無料で診断を受ける）"
            className="w-full rounded border px-2 py-1 text-sm"
          />
        </div>
      ))}
      <StickyBar actions={(
        <>
        <button
          onClick={() => {
            editCurrent((prev) => ({
              ...prev,
              ctas: [...prev.ctas, {
                atSeconds: 0, kind: 'form', title: '', body: null,
                buttonLabel: '', autoOpen: false, formId: null, url: null,
              }],
              times: [...prev.times, '0:00'],
            }))
          }}
          className="rounded border px-3 py-1 text-sm"
        >
          + CTAカード追加
        </button>
        <button
          onClick={() => void save()}
          disabled={saving || !loaded}
          className="rounded bg-blue-600 px-4 py-1 text-sm text-white disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        </>
      )} />
    </div>
  )
}

type RegistrationFormOption = { id: string; name: string; isActive: boolean }

/*
  フォーム候補は「どの account の分か」を必ず一緒に持つ。
  account を切り替えた瞬間から前の account の候補は出さない・選ばせない・保存させない。
*/
type FormCandidates = { accountId: string | null; state: FormCandidateState; items: RegistrationFormOption[] }

function emptyFormCandidates(accountId: string | null): FormCandidates {
  return { accountId, state: accountId ? 'loading' : 'idle', items: [] }
}

function CtaDesignStep({ webinarId, accountId, durationSeconds, editor, registrations, onEditorChange, onCtasReport }: { webinarId: string; accountId: string | null; durationSeconds: number; editor: WebinarEditor; registrations: number | null; onEditorChange: (editor: WebinarEditor) => void; onCtasReport?: (ctas: WebinarCtaCard[] | null) => void }) {
  /* 子から受け取った CTA も「どのウェビナーの分か」を一緒に持つ。 */
  const [reportedCtas, setReportedCtas] = useState<{ webinarId: string; items: WebinarCtaCard[] }>(() => ({ webinarId, items: [] }))
  const ctas = reportedCtas.webinarId === webinarId ? reportedCtas.items : []
  /*
    申込フォームの候補。CTA内で使うフォームとは別の選択肢。
    公開中のものだけを候補にし、停止・削除・別アカウントは選ばせない。
  */
  const [formCandidates, setFormCandidates] = useState<FormCandidates>(() => emptyFormCandidates(accountId))
  const [selectedRegistrationFormId, setSelectedRegistrationFormId] = useState<string>(editor.registrationFormId ?? '')
  const [savingRegistrationForm, setSavingRegistrationForm] = useState(false)
  const [registrationNotice, setRegistrationNotice] = useState('')
  const [registrationError, setRegistrationError] = useState('')
  /* 取得の世代印。切替後に遅れて届いた前の account の応答はここで捨てる。 */
  const formRequestId = useRef(0)

  /* 描くのは今の account の分だけ。印が違えば「これから読む」として描く。 */
  const currentFormCandidates = formCandidates.accountId === accountId ? formCandidates : emptyFormCandidates(accountId)
  const registrationForms = currentFormCandidates.items
  const registrationFormState = currentFormCandidates.state

  /*
    CTA の取得は子の編集タブ(`CtasTab`)に一本化し、親は報告を受けて
    件数だけ描く。同じ口を親子で2回叩かない。
  */
  const handleCtasLoaded = useCallback((next: WebinarCtaCard[] | null) => {
    setReportedCtas({ webinarId, items: next ?? [] })
    /* 段の印と最終確認もカード件数で決めるため、親へも届ける。 */
    onCtasReport?.(next)
  }, [webinarId, onCtasReport])

  const loadRegistrationForms = useCallback(() => {
    const requestId = ++formRequestId.current
    if (!accountId) {
      setFormCandidates({ accountId, state: 'idle', items: [] })
      return
    }
    /* 取得を始めた時点で前の候補を捨てる。読み込み中に旧候補を出さない。 */
    setFormCandidates({ accountId, state: 'loading', items: [] })
    fetchApi<{ success: boolean; data: Array<{ id: string; name: string; isActive?: boolean }> }>(`/api/forms?account_id=${encodeURIComponent(accountId)}`)
      .then((response) => {
        if (requestId !== formRequestId.current) return
        const items = Array.isArray(response.data) ? response.data : []
        setFormCandidates({ accountId, state: 'ready', items: items.map((form) => ({ id: form.id, name: form.name, isActive: form.isActive === true })) })
      })
      .catch((cause) => {
        if (requestId !== formRequestId.current) return
        /* 口自体は同一アカウントに絞っている。403・404 は権限不足、それ以外は取得失敗。 */
        setFormCandidates({ accountId, state: cause instanceof ApiError && (cause.status === 403 || cause.status === 404) ? 'forbidden' : 'error', items: [] })
      })
  }, [accountId])

  useEffect(() => {
    loadRegistrationForms()
    return () => { formRequestId.current += 1 }
  }, [loadRegistrationForms])

  /* 候補は公開中だけ。停止中は一覧に混ぜない。 */
  const publishedRegistrationForms = registrationForms.filter((form) => form.isActive)

  const saveRegistrationForm = async () => {
    /* 今の account の候補が揃うまで保存しない。切替直後に旧候補のIDを書き込ませない。 */
    if (registrationFormState !== 'ready') {
      setRegistrationNotice('')
      setRegistrationError('回答フォームの候補を読み込んでから保存してください。')
      return
    }
    /* 選択が今の候補に無いなら送らない。前の account の選択を新しい相手に保存させない。 */
    if (selectedRegistrationFormId && !publishedRegistrationForms.some((form) => form.id === selectedRegistrationFormId)) {
      setRegistrationNotice('')
      setRegistrationError('選んだ申込フォームは今の候補にありません。公開中のフォームを選び直してください。')
      return
    }
    setSavingRegistrationForm(true)
    setRegistrationNotice('')
    setRegistrationError('')
    try {
      const response = await webinarApi.saveEditor(webinarId, {
        expectedVersion: editor.version,
        registrationFormId: selectedRegistrationFormId || null,
      })
      onEditorChange(response.data)
      setRegistrationNotice('申込フォームを保存しました。公開前確認で申込フォームが公開中か確認してください。')
    } catch (cause) {
      if (cause instanceof ApiError && (cause.code === 'form_inactive_or_missing' || cause.code === 'form_account_mismatch')) {
        /* 停止・削除・別アカウントはサーバーが拒否する。候補を取り直して選び直しを促す。 */
        loadRegistrationForms()
      }
      setRegistrationError(webinarErrorText(cause, '申込フォームを保存できませんでした。開き直して試してください。'))
    } finally {
      setSavingRegistrationForm(false)
    }
  }

  const primary = ctas[0]
  const forms = registrationForms.map(({ id, name }) => ({ id, name }))
  const selectedForm = forms.find((form) => form.id === primary?.formId)
  /* 保存済みだが候補に無い = 停止・削除・別アカウント。拒否理由と選び直しを出す。 */
  const savedRegistrationFormMissing = Boolean(
    editor.registrationFormId && !publishedRegistrationForms.some((form) => form.id === editor.registrationFormId),
  )

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="d3rFGD">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">CTA設定</h2><p className="text-ink-faint mt-1 text-xs">動画内に表示するボタンとタイミングを設定します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">表示タイミング</dt><dd className="text-ink text-sm font-bold">{primary ? `動画の${Math.floor(primary.atSeconds / 60)}分${String(primary.atSeconds % 60).padStart(2, '0')}秒` : '—（未設定）'}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">ボタン文言</dt><dd className="text-ink text-sm font-bold">{primary?.buttonLabel || '—（未設定）'}</dd></div></dl>{(registrationFormState === 'error' || registrationFormState === 'forbidden') && (<p className="text-danger mt-3 text-xs" role="alert">{registrationFormState === 'forbidden' ? 'フォーム候補を見る権限がありません。' : 'フォーム候補を読み込めませんでした。'}<button type="button" onClick={loadRegistrationForms} className="ml-2 font-medium underline">もう一度読み込む</button></p>)}</section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">申込フォーム</h2><p className="text-ink-faint mt-1 text-xs">申込情報の保存先と完了アクションを設定します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">入力項目</dt><dd className="text-ink max-w-2xl text-right text-sm font-bold">{editor.publicPage.form?.fields.join('・') || selectedForm?.name || '—（未設定）'}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">完了アクション</dt><dd className="text-ink max-w-2xl text-right text-sm font-bold">{editor.publicPage.form?.completionActions.join('・') || '設定なし'}</dd></div></dl></section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">申込フォームの選択</h2>
          <p className="text-ink-faint mt-1 text-xs">公開前の確認で使う申込フォームを選びます。動画内のCTAボタンで使うフォームとは別です。同じLINE公式アカウントの公開中の回答フォームだけが候補に出ます。</p>
          <dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">保存済み</dt><dd className="text-ink max-w-2xl text-right text-sm font-bold">{editor.publicPage.form ? `${editor.publicPage.form.name}（${editor.publicPage.form.fields.length}項目）` : '—（未設定）'}</dd></div></dl>
          <div className="mt-4 space-y-3">
            {!accountId ? <p className="text-ink-faint text-sm">このウェビナーのLINE公式アカウントを確認できません。</p> : null}
            {accountId && registrationFormState === 'loading' ? <p className="text-ink-faint text-sm">回答フォームを読み込んでいます。</p> : null}
            {accountId && registrationFormState === 'forbidden' ? (
              <div className="space-y-2"><p className="text-danger text-sm">回答フォームを見る権限がありません。アカウントの権限を確認してください。</p><Button onClick={loadRegistrationForms}>もう一度読み込む</Button></div>
            ) : null}
            {accountId && registrationFormState === 'error' ? (
              <div className="space-y-2"><p className="text-danger text-sm">回答フォームを読み込めませんでした。</p><Button onClick={loadRegistrationForms}>もう一度読み込む</Button></div>
            ) : null}
            {accountId && registrationFormState === 'ready' && publishedRegistrationForms.length === 0 ? (
              <p className="text-ink-faint text-sm">公開中の回答フォームがありません。フォーム機能で公開中のフォームを作ってください。</p>
            ) : null}
            {accountId && registrationFormState === 'ready' && publishedRegistrationForms.length > 0 ? (
              <div className="max-w-md">
                <SelectField
                  value={selectedRegistrationFormId}
                  onChange={(event) => setSelectedRegistrationFormId(event.target.value)}
                  aria-label="申込に使う回答フォーム"
                  options={[{ value: '', label: '申込フォームを選ぶ' }, ...publishedRegistrationForms.map((form) => ({ value: form.id, label: form.name }))]}
                />
              </div>
            ) : null}
            {registrationFormState === 'ready' && selectedRegistrationFormId && !publishedRegistrationForms.some((form) => form.id === selectedRegistrationFormId) ? (
              <p className="text-warning text-sm">前に選んだフォームは使えなくなりました（停止・削除・別アカウント）。公開中のフォームを選び直して保存してください。</p>
            ) : null}
            {savedRegistrationFormMissing && registrationFormState === 'ready' ? (
              <p className="text-warning text-sm">保存済みの申込フォームは公開中ではありません（停止・削除・別アカウント）。このままでは公開前確認を通りません。</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void saveRegistrationForm()} disabled={savingRegistrationForm || registrationFormState !== 'ready' || !accountId}>{savingRegistrationForm ? '保存中…' : '申込フォームを保存'}</Button>
            </div>
            {registrationNotice ? <p className="text-ink-secondary text-sm">{registrationNotice}</p> : null}
            {registrationError ? <p className="text-danger text-sm" role="alert">{registrationError}</p> : null}
          </div>
        </section>
        <EditorDetails label="CTAカードとフォームの詳細を編集する"><CtasTab webinarId={webinarId} durationSeconds={durationSeconds} forms={forms} formsState={registrationFormState} onRetryForms={loadRegistrationForms} onCtasLoaded={handleCtasLoaded} /></EditorDetails>
      </div>
      <SummaryAside rows={[
        ['CTA', `${ctas.length.toLocaleString('ja-JP')}件`],
        ['フォーム', primary?.formId ? '公開中' : '未設定'],
        ['申込', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
      ]} previewBody={primary?.body || 'CTAの説明文はまだ設定されていません。'} previewButton={primary?.buttonLabel || null}>
        <div className="flex gap-2"><Button disabled title="確認の段で実行します">テスト送信</Button><Button disabled title="この段では実行できません">公開ページを見る</Button></div>
      </SummaryAside>
    </div>
  )
}

const ACTION_LABELS: Record<WebinarAction['actionType'], string> = {
  add_tag: 'タグを付ける',
  remove_tag: 'タグを外す',
  start_scenario: 'シナリオを開始する',
  stop_scenario: 'シナリオを停止する',
  resume_scenario: 'シナリオを再開する',
  send_message: 'LINEメッセージまたはテンプレートを送る',
  send_webhook: '外部Webhookへ送る',
  switch_rich_menu: 'リッチメニューを切り替える',
  remove_rich_menu: 'リッチメニューを外す',
}

const TRIGGERS: Array<{ key: WebinarAction['trigger']; label: string }> = [
  { key: 'completed', label: '視聴完了' },
  { key: 'cta_clicked', label: 'CTAクリック' },
  { key: 'unviewed', label: '未視聴' },
]

function actionReferenceKey(type: WebinarAction['actionType']): string | null {
  if (type === 'add_tag' || type === 'remove_tag') return 'tagId'
  if (type === 'start_scenario' || type === 'stop_scenario' || type === 'resume_scenario') return 'scenarioId'
  if (type === 'send_message') return 'templateId'
  if (type === 'send_webhook') return 'webhookId'
  if (type === 'switch_rich_menu') return 'richMenuPageId'
  return null
}

function WebinarActionsTab({ webinarId, editor, onEditorChange }: { webinarId: string; editor: WebinarEditor; onEditorChange: (editor: WebinarEditor) => void }) {
  const [actions, setActions] = useState<WebinarAction[]>([])
  const [trigger, setTrigger] = useState<WebinarAction['trigger']>('completed')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [templateBody, setTemplateBody] = useState(editor.actionPolicy.templateBody)
  const [missingResultPolicy, setMissingResultPolicy] = useState(editor.actionPolicy.missingResultPolicy)

  const load = useCallback(() => {
    setState('loading')
    webinarApi.actions(webinarId)
      .then((response) => { setActions(response.data); setState('ready') })
      .catch(() => setState('error'))
  }, [webinarId])

  useEffect(() => { load() }, [load])

  if (state === 'loading') return <div className="text-ink-faint py-12 text-center text-sm">読み込んでいます</div>
  if (state === 'error') return <div className="text-danger py-12 text-center text-sm">視聴後アクションを読み込めませんでした。<span className="ml-2"><Button onClick={load}>もう一度読み込む</Button></span></div>

  const visible = actions.filter((action) => action.trigger === trigger)
  const update = (index: number, patch: Partial<WebinarAction>) => {
    const target = visible[index]
    setActions((current) => current.map((action) => action === target ? { ...action, ...patch } : action))
  }
  const remove = (index: number) => {
    const target = visible[index]
    setActions((current) => current.filter((action) => action !== target))
  }
  const save = async () => {
    setSaving(true)
    setNotice('')
    try {
      const response = await webinarApi.saveActions(webinarId, actions)
      setActions(response.data)
      const editorResponse = await webinarApi.saveEditor(webinarId, {
        expectedVersion: editor.version,
        actionTemplateBody: templateBody,
        missingResultPolicy,
      })
      onEditorChange(editorResponse.data)
      setNotice('視聴後アクションを保存しました。')
    } catch {
      setNotice('保存できませんでした。状態を読み直して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const completedActions = actions.filter((action) => action.trigger === 'completed')

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="Xjk8q">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">CTA・フォーム</h2>
          <p className="text-ink-faint mt-1 text-xs">視聴完了・CTAクリック・未視聴ごとの処理を設定します。</p>
          <div className="mt-4 flex flex-wrap gap-2">{TRIGGERS.map((item) => <span key={item.key} className={`rounded-pill border px-3 py-1 text-xs font-semibold ${item.key === 'completed' ? 'border-accent bg-accent-soft text-accent-deep' : 'border-hairline text-ink-secondary'}`}>{item.label}</span>)}</div>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <div className="flex items-center justify-between gap-3"><h2 className="text-ink text-base font-bold">視聴完了メッセージ</h2><Button disabled>変数を挿入</Button></div>
          <textarea value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} className="border-hairline bg-canvas-sunken text-ink mt-4 min-h-28 w-full rounded-control border p-4 text-sm leading-relaxed" aria-label="視聴完了メッセージ本文" />
          <div className="mt-3 flex flex-wrap gap-2"><Button disabled>資料を受け取る</Button><Button disabled>個別相談を予約</Button><Button disabled>あとで見る</Button></div>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <dl className="divide-hairline divide-y rounded-control border border-hairline">
            <div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">実行タイミング</dt><dd className="text-ink text-sm font-bold">視聴完了直後</dd></div>
            <div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">同じ視聴への実行</dt><dd className="text-ink text-sm font-bold">1回だけ</dd></div>
          </dl>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-ink text-base font-bold">配信後の通知・アクション</h2><p className="text-ink-faint mt-1 text-xs">保存済みの実行内容です。</p></div><span className="text-ink-faint text-xs">{completedActions.length}件</span></div>
          <ul className="divide-hairline mt-3 divide-y rounded-control border border-hairline">{completedActions.length === 0 ? <li className="text-ink-faint p-4 text-sm">まだ設定されていません。</li> : completedActions.map((action, index) => <li key={action.id ?? index} className="text-ink px-4 py-3 text-sm font-semibold">{ACTION_LABELS[action.actionType]}</li>)}</ul>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-sm font-bold">視聴結果を取得できない場合</h2><p className="text-ink-faint mt-1 text-xs">再取得するか、要対応へ追加するか選択できます。</p><div className="mt-3 max-w-sm"><SelectField value={missingResultPolicy} onChange={(event) => setMissingResultPolicy(event.target.value as WebinarEditor['actionPolicy']['missingResultPolicy'])} options={[{ value: 'escalate', label: '要対応へ追加' }, { value: 'retry_next_day', label: '翌日に再取得' }]} /></div></section>
        <EditorDetails label="通知・アクションの詳細を編集する">
        <section className="space-y-4">
      <div><h2 className="text-ink font-bold">視聴後の通知・アクション</h2><p className="text-ink-faint mt-1 text-xs">視聴完了・CTAクリック・未視聴ごとの処理を設定します。</p></div>
      <div className="flex flex-wrap gap-2">
        {TRIGGERS.map((item) => <Button key={item.key} variant={trigger === item.key ? 'primary' : 'secondary'} onClick={() => setTrigger(item.key)}>{item.label}</Button>)}
      </div>
      <div className="border-hairline divide-hairline divide-y overflow-hidden rounded-xl border">
        {visible.length === 0 ? <p className="text-ink-faint p-8 text-center text-sm">この条件のアクションはまだありません。</p> : visible.map((action, index) => {
          const referenceKey = actionReferenceKey(action.actionType)
          return (
            <div key={action.id ?? `${trigger}-${index}`} className="bg-canvas grid gap-3 p-4 md:grid-cols-3 md:items-center">
              <SelectField
                value={action.actionType}
                onChange={(event) => update(index, { actionType: event.target.value as WebinarAction['actionType'], config: {} })}
                aria-label="実行するアクション"
                options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
                className="border-hairline rounded-control border px-3 py-2 text-sm"
              />
              {referenceKey ? <input value={String(action.config[referenceKey] ?? '')} onChange={(event) => update(index, { config: { [referenceKey]: event.target.value } })} placeholder={`${referenceKey}を入力`} className="border-hairline rounded-control border px-3 py-2 text-sm" /> : <span className="text-ink-faint text-xs">追加設定はありません</span>}
              <Button type="button" onClick={() => remove(index)}>外す</Button>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={() => setActions((current) => [...current, { trigger, actionType: 'add_tag', config: { tagId: '' } }])}>通知・アクションを追加</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '視聴後アクションを保存'}</Button>
      </div>
      {notice ? <p className="text-ink-secondary text-sm">{notice}</p> : null}
        </section>
        </EditorDetails>
      </div>
      <SummaryAside rows={[
        ['完了案内', '視聴完了＋ボタン'],
        ['実行時点', '視聴完了直後'],
        ['通知・アクション', completedActions.length > 0 ? `${completedActions.length}件` : '未設定'],
        ['結果未取得時', missingResultPolicy === 'escalate' ? '要対応へ追加' : '翌日に再取得'],
      ]} previewBody={templateBody || '視聴完了メッセージは未設定です。'} previewFirst />
    </div>
  )
}

function PublicPreviewStep({
  webinar,
  editor,
  publicUrl,
  registrations,
  publicPageReason,
  onEditorChange,
}: {
  webinar: Webinar
  editor: WebinarEditor
  publicUrl: string | null
  registrations: number | null
  publicPageReason: string
  onEditorChange: (editor: WebinarEditor) => void
}) {
  const canOpenPublicPage = webinar.status === 'active' && publicUrl !== null
  const [testing, setTesting] = useState(false)
  const [testNotice, setTestNotice] = useState('')
  const testPublicPage = async () => {
    setTesting(true)
    setTestNotice('')
    try {
      const response = await webinarApi.testPublicPage(webinar.id, editor.version)
      onEditorChange(response.data)
      setTestNotice(response.data.publicPage.test?.status === 'passed' ? '公開ページを確認しました。' : '公開ページに未設定があります。')
    } catch (cause) {
      setTestNotice(webinarErrorText(cause, '公開ページを確認できませんでした。'))
    } finally {
      setTesting(false)
    }
  }
  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="GB0NR">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">公開ページ</h2><p className="text-ink-faint mt-1 text-xs">タイトル・説明・申込フォームを最終確認します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">ページタイトル</dt><dd className="text-ink text-sm font-bold">{webinar.title}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">公開URL</dt><dd className="text-ink max-w-2xl truncate text-sm font-bold" title={publicUrl ?? undefined}>{publicUrl ?? '—（LIFF ID未設定）'}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">説明</dt><dd className="text-ink max-w-2xl text-right text-sm font-bold">{editor.publicDescription || '—（未設定）'}</dd></div></dl></section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">表示内容</h2><p className="text-ink-faint mt-1 text-xs">PC・スマートフォンの表示を確認します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">メイン動画</dt><dd className="text-ink text-sm font-bold">16:9・自動再生なし</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">申込フォーム</dt><dd className="text-ink text-sm font-bold">{editor.publicPage.form ? `${editor.publicPage.form.name}（${editor.publicPage.form.fields.length}項目）` : '—（未設定）'}</dd></div></dl></section>
      </div>
      <SummaryAside rows={[
        ['状態', webinar.videoPrefix ? '公開準備完了' : '動画未設定'],
        ['公開期間', deliveryWindow(webinar)],
        ['対象', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
      ]} previewBody={editor.publicDescription || webinar.title}>
        <div className="flex gap-2"><Button disabled={testing || !publicUrl} onClick={() => void testPublicPage()}>{testing ? '確認中…' : editor.publicPage.test?.status === 'passed' ? 'ページ確認済み' : 'ページをテスト'}</Button>{canOpenPublicPage ? <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : <Button disabled title={publicPageReason}>公開ページを見る</Button>}</div>
        {testNotice ? <p className="text-ink-secondary text-xs">{testNotice}</p> : null}
        {!canOpenPublicPage ? <p className="text-ink-faint text-xs">{publicPageReason}</p> : null}
      </SummaryAside>
    </div>
  )
}

/**
 * タブの並び。設計（4-8-1）は「どのウェビナーか → いつ見られるようにするか →
 * 見ている途中に出すもの → 見終わったあとの動き」の順に並べている。
 * 実装は分析タブを先頭に置いていたが、編集画面なので設定を先にする。
 */
/**
 * 段の外にあるもの。**設計の5段には無いが、実装が持っている。**
 * 段に混ぜると「作り終えるのに必要な手順」に見えてしまうので、分けて置く。
 */
const EXTRAS = [
  ['comments', 'コメント演出'],
  ['actions', '視聴後アクション'],
  ['preview', '公開プレビュー'],
  ['participants', '参加者'],
  ['analytics', '分析'],
] as const

type ExtraKey = (typeof EXTRAS)[number][0]
type PaneKey = StepKey | ExtraKey

/**
 * STEP 5 確認（設計 `D6yO7e`）。**公開の前に、足りないものを1つずつ言う。**
 * ここで言えないと、公開してから友だちの画面で気づくことになる。
 */
function ReviewStep({ webinar, editor, registrations, ctaCount, onBack, onPublished }: { webinar: Webinar; editor: WebinarEditor; registrations: number | null; ctaCount: number; onBack: (key: StepKey) => void; onPublished: () => void }) {
  const [validation, setValidation] = useState<WebinarPublishValidation | null>(null)
  const [validationState, setValidationState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const validationRequestId = useRef(0)
  /*
    検査の取得に失敗しても「読み込み中」のまま公開ボタンを固めない。
    失敗は失敗と出して、やり直しと次の一手を添える。
  */
  const loadValidation = useCallback(() => {
    const requestId = ++validationRequestId.current
    setValidationState('loading')
    webinarApi.publishValidation(webinar.id)
      .then((response) => {
        if (requestId !== validationRequestId.current) return
        setValidation(response.data)
        setValidationState('ready')
      })
      .catch(() => {
        if (requestId !== validationRequestId.current) return
        setValidation(null)
        setValidationState('error')
      })
  }, [webinar.id])
  useEffect(() => {
    loadValidation()
    return () => { validationRequestId.current += 1 }
  }, [loadValidation])
  const blockers = validation
    ? validation.checks.filter((check) => check.status === 'failed').map((check) => check.detail || check.label)
    : publishBlockers(webinar)
  const publish = async () => {
    setPublishing(true)
    setPublishError('')
    try {
      await webinarApi.publish(webinar.id, editor.version)
      /*
        公開できたあとの遷移は「入力を捨てる離脱」ではない。未保存の印が
        残っていてもブラウザ標準の離脱確認が出ないよう、遷移の直前に
        未保存ガードを外す。
      */
      onPublished()
      window.location.assign(`/webinars/published?id=${encodeURIComponent(webinar.id)}`)
    } catch (cause) {
      setPublishError(webinarErrorText(cause, '公開できませんでした'))
      setPublishing(false)
    }
  }
  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="D6yO7e">
      <div className="min-w-0 flex-1 space-y-3">
      <section className="border-hairline bg-canvas space-y-4 rounded-card border p-5 shadow-card">
      <div><h2 className="text-ink font-bold">公開前チェック</h2><p className="text-ink-faint mt-1 text-xs">公開に必要な設定を確認します。</p></div>
      {validationState === 'ready' && blockers.length > 0 ? (
        <div className="text-warning bg-warning-bg rounded-card p-4 text-sm">
          <p className="font-bold">このままでは公開できません。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {blockers.map((text) => <li key={text}>{text}</li>)}
          </ul>
        </div>
      ) : validationState === 'ready' ? (
        <p className="bg-success-bg text-success rounded-card p-4 text-sm font-bold">
          必要なものは揃っています。
        </p>
      ) : null}
      <ul className="divide-hairline border-hairline divide-y rounded-xl border text-sm">
        {(validation?.checks ?? []).map((check) => <li key={check.key} className="text-ink flex items-start gap-2 px-4 py-3"><span className={check.status === 'passed' ? 'text-success' : check.status === 'warning' ? 'text-warning' : 'text-danger'}>{check.status === 'passed' ? '✓' : '!'}</span><span><strong className="block">{check.label}</strong><span className="text-ink-faint text-xs">{check.detail}</span></span></li>)}
        {validationState === 'loading' ? <li className="text-ink-faint px-4 py-3">公開前検査を読み込んでいます。</li> : null}
      </ul>
      {validationState === 'error' ? (
        <div className="border-danger bg-danger-bg rounded-card border p-4 text-sm" role="alert">
          <p className="text-danger font-bold">公開前検査を読み込めませんでした。このままでは公開できません。</p>
          <p className="text-ink-secondary mt-1 text-xs">まず下のボタンでもう一度読み込んでください。直らなければ基本設定・動画・CTAの各段が保存済みか確かめ、時間をおいて開き直してください。</p>
          <div className="mt-3"><Button onClick={loadValidation}>もう一度読み込む</Button></div>
        </div>
      ) : null}
      </section>
      <section className="border-hairline bg-canvas space-y-4 rounded-card border p-5 shadow-card">
      <div><h2 className="text-ink font-bold">最終確認</h2><p className="text-ink-faint mt-1 text-xs">公開すると、申込・配信条件に合う友だちが視聴できます。</p></div>
      <dl className="divide-hairline border-hairline divide-y rounded-xl border">
        {[
          ['ウェビナー名', webinar.title || '未設定'],
          ['動画・公開', webinar.videoPrefix ? '申込者向け' : '未設定'],
          ['公開期間', deliveryWindow(webinar)],
          ['対象', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
          ['CTA・フォーム', ctaCount > 0 ? `${ctaCount}件のCTA` : webinar.cta ? '動画＋CTA＋フォーム' : '未設定'],
          ['アクション', '設定内容は視聴後アクションで確認'],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
            <dt className="text-ink-faint text-xs font-semibold">{label}</dt>
            <dd className="text-ink text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onBack('basic')}>基本設定へ戻る</Button>
        <Button onClick={() => onBack('video')}>動画へ戻る</Button>
        <Button variant="primary" disabled={!validation || blockers.length > 0 || publishing} onClick={() => void publish()}>{publishing ? '公開中…' : 'この版を公開'}</Button>
      </div>
      {publishError ? <p className="text-danger text-xs" role="alert">{publishError}</p> : null}
      <p className="text-ink-faint text-xs">公開時点の版を固定し、編集中の下書きとは分けて保存します。</p>
      </section>
      </div>
      <SummaryAside rows={[
        ['状態', webinar.status === 'active' ? '公開中' : '有効化前'],
        ['申込見込み', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
        ['通知重複', validation?.checks.find((check) => check.key === 'notification_duplicates')?.status === 'passed' ? '重複なし' : '要確認'],
        ['監視', '運用者通知へ連携'],
      ]} previewBody={validation ? '公開ページと通知のテスト結果を確認しました。' : validationState === 'error' ? '公開前検査を取得できませんでした。左の段からもう一度読み込んでください。' : '公開前検査を読み込んでいます。'} previewFirst />
    </div>
  )
}

function EditWebinarInner() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const id = searchParams.get('id')
  const { accounts, loading: accountsLoading } = useAccount()
  /*
    読み込んだ中身も失敗も「どのウェビナーの分か」を一緒に持つ。
    別のウェビナーへ切り替えた瞬間から、前のウェビナーの中身も失敗文も画面に出さない。
  */
  const [loadedWebinar, setLoadedWebinar] = useState<{ id: string; webinar: Webinar; editor: WebinarEditor } | null>(null)
  const [loadFailure, setLoadFailure] = useState<{ id: string; message: string } | null>(null)
  const [analytics, setAnalytics] = useState<WebinarAnalytics | null>(null)
  const [analyticsState, setAnalyticsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [analyticsId, setAnalyticsId] = useState<string | null>(null)
  /* 取得の世代印。切替後に遅れて届いた前のウェビナーの応答はここで捨てる。 */
  const loadRequestId = useRef(0)

  const webinar = loadedWebinar && loadedWebinar.id === id ? loadedWebinar.webinar : null
  const editor = loadedWebinar && loadedWebinar.id === id ? loadedWebinar.editor : null
  const loadError = loadFailure && loadFailure.id === id ? loadFailure.message : null
  /* 今のウェビナーの中身も失敗も無い間が読み込み中。切替の1コマ目から前の中身を描かない。 */
  const loading = webinar === null && loadError === null
  const setEditor = useCallback((next: WebinarEditor) => {
    setLoadedWebinar((prev) => (prev && prev.id === id ? { ...prev, editor: next } : prev))
  }, [id])
  /*
    **編集画面なので、開いた直後は設定の1段目**。前は「概要・分析」を先頭に
    置いていたので、直しに来た人が結果の画面から始めることになっていた。
  */
  const requestedPane = searchParams.get('pane')
  const initialPane = ([...STEPS.map((step) => step.key), ...EXTRAS.map(([key]) => key)] as string[]).includes(requestedPane ?? '')
    ? requestedPane as PaneKey
    : 'basic'
  const [pane, setPane] = useState<PaneKey>(initialPane)
  /*
    CTAの印と最終確認が見るカード件数。初期値はエディタ応答の ctaCount、
    CTAの段を開いた後は子タブが保存・再取得した結果を正本にする。
    「どのウェビナーの分か」を一緒に持ち、切替後に前の件数を出さない。
  */
  const [reportedCtaCount, setReportedCtaCount] = useState<{ webinarId: string; count: number } | null>(null)
  const ctaCount = reportedCtaCount && reportedCtaCount.webinarId === id
    ? reportedCtaCount.count
    : (editor?.ctaCount ?? 0)
  const handleCtasReport = useCallback((ctas: WebinarCtaCard[] | null) => {
    setReportedCtaCount({ webinarId: id ?? '', count: ctas?.length ?? 0 })
  }, [id])

  /*
    **段を行き来しても入力を消さないための仕組み。**
    編集の段（基本・動画・通知）は一度開いたら畳まずに隠すだけにし、
    各段は「保存する操作」と「未保存かどうかの報告」を親へ登録する。
    固定バーはこの登録を使って1本だけで保存・未保存表示を行う。
  */
  const [visitedPanes, setVisitedPanes] = useState<ReadonlySet<PaneKey>>(() => new Set([initialPane]))
  const [savablePanes, setSavablePanes] = useState<ReadonlySet<PaneKey>>(new Set())
  const [unsavedPanes, setUnsavedPanes] = useState<ReadonlySet<PaneKey>>(new Set())
  const saveHandlers = useRef(new Map<PaneKey, () => Promise<boolean>>())
  const dirtyReporters = useRef(new Map<PaneKey, (dirty: boolean) => void>())
  const saveRegistrars = useRef(new Map<PaneKey, (save: (() => Promise<boolean>) | null) => void>())
  /* 保存してから段を変える間の押し口。'draft' はその場保存、'next' は保存して次へ。 */
  const [savingForNav, setSavingForNav] = useState<false | 'draft' | 'next'>(false)

  /* 呼ぶたびに新しい関数を渡すと子の登録効果が毎回走る。段ごとに1つだけ作って使い回す。 */
  const dirtyReporterFor = (key: PaneKey): ((dirty: boolean) => void) => {
    let reporter = dirtyReporters.current.get(key)
    if (!reporter) {
      reporter = (dirty: boolean) => {
        setUnsavedPanes((prev) => {
          if (prev.has(key) === dirty) return prev
          const next = new Set(prev)
          if (dirty) next.add(key)
          else next.delete(key)
          return next
        })
      }
      dirtyReporters.current.set(key, reporter)
    }
    return reporter
  }
  const saveRegistrarFor = (key: PaneKey): ((save: (() => Promise<boolean>) | null) => void) => {
    let registrar = saveRegistrars.current.get(key)
    if (!registrar) {
      registrar = (save) => {
        if (save) saveHandlers.current.set(key, save)
        else saveHandlers.current.delete(key)
        setSavablePanes((prev) => {
          const has = save !== null
          if (prev.has(key) === has) return prev
          const next = new Set(prev)
          if (has) next.add(key)
          else next.delete(key)
          return next
        })
      }
      saveRegistrars.current.set(key, registrar)
    }
    return registrar
  }

  /*
    未保存の入力を持ったまま画面の外へ出る操作を止める（DETAIL-04 残存経路）。
    一覧リンク・左メニュー・ブラウザの戻る・再読込を捕まえ、破棄か編集継続かを
    確認する。段の行き来は画面内の移動なのでここには触れない——入力は隠すだけで
    畳まないため失われない。契約は共通の `useUnsavedGuard` と同じ。
  */
  const { leaveTarget, confirmLeave, cancelLeave, disarm } = useUnsavedGuard({
    dirty: unsavedPanes.size > 0,
    busy: savingForNav !== false,
    /*
      段の行き来で変わるのは pane だけ。同じウェビナーの中での戻る・進むは
      離脱ではないので、確認も復元もしない。一覧や別のウェビナーへ出る
      操作はこれまで通り止める（DETAIL-04 の pane 例外）。
    */
    samePage: (destination) =>
      destination.pathname === pathname && destination.searchParams.get('id') === id,
  })
  /*
    離脱の確認はどの段・どの画面状態にいても出す。読み込み失敗や未指定の
    分岐は別ツリーへ早期 return するため、ここで要素化して全経路へ差し込む。
    片方だけに置くと、dirty 中のリンクが黙って止まり「保存せずに移動」を
    選ぶ手段がなくなる。
  */
  const leaveConfirmDialog = (
    <ConfirmDialog
      open={leaveTarget !== null}
      title="保存していない変更があります"
      description="このまま移動すると、ウェビナーの変更は失われます。保存せずに移動しますか？"
      confirmLabel="保存せずに移動"
      cancelLabel="編集を続ける"
      onConfirm={confirmLeave}
      onCancel={cancelLeave}
    />
  )

  /*
    段の移動はURLにも残す。再読み込み・ブラウザの戻るで
    同じ段へ戻れるようにする（DETAIL-03/04）。
  */
  const goStep = useCallback((next: PaneKey) => {
    setVisitedPanes((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
    setPane(next)
    try {
      window.history?.pushState?.(null, '', `?id=${encodeURIComponent(id ?? '')}&pane=${next}`)
    } catch {
      /* 履歴を持たない環境（試験用の簡易DOM）では画面内の状態だけで動く。 */
    }
  }, [id])

  /* ブラウザの戻るでURLが戻ったときは、その段を開き直す。 */
  useEffect(() => {
    const onPop = () => {
      const requested = new URLSearchParams(window.location.search).get('pane')
      const valid = ([...STEPS.map((step) => step.key), ...EXTRAS.map(([key]) => key)] as string[]).includes(requested ?? '')
      const next = (valid ? requested : 'basic') as PaneKey
      setVisitedPanes((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
      setPane(next)
    }
    window.addEventListener?.('popstate', onPop)
    return () => window.removeEventListener?.('popstate', onPop)
  }, [])

  /* 保存に成功した段の新しい中身を正本にする。一覧へ戻らず画面を続ける。 */
  const handleWebinarSaved = useCallback((next: Webinar) => {
    setLoadedWebinar((prev) => (prev && prev.id === id ? { ...prev, webinar: next } : prev))
  }, [id])

  /* 今の段の保存操作を呼ぶ。保存を持たない段は何もせず成功扱いにする。 */
  const runPaneSave = async (key: PaneKey): Promise<boolean> => {
    const save = saveHandlers.current.get(key)
    return save ? save() : true
  }

  /* 「下書き保存」はその場で保存するだけ。段は変えない。 */
  const handleDraftSave = async () => {
    if (savingForNav !== false) return
    setSavingForNav('draft')
    try {
      await runPaneSave(pane)
    } finally {
      setSavingForNav(false)
    }
  }

  /*
    次の段へ進む押し口。**未保存の入力がある段では保存してから進み、**
    保存に失敗したら入力も今の段もそのまま残す。
  */
  const handlePrimaryAction = async () => {
    if (nextPane === null || savingForNav !== false) return
    if (unsavedPanes.has(pane) && saveHandlers.current.has(pane)) {
      setSavingForNav('next')
      try {
        if (!(await runPaneSave(pane))) return
      } finally {
        setSavingForNav(false)
      }
    }
    goStep(nextPane)
  }

  const paneTitle: Record<PaneKey, string> = {
    basic: 'ウェビナー編集',
    video: '動画と公開設定',
    cta: 'CTAと申込フォーム',
    notifications: '通知とリマインド',
    review: 'ウェビナー・公開前確認',
    comments: 'コメント演出',
    actions: 'ウェビナー・視聴後通知・アクション',
    preview: '公開ページプレビュー',
    participants: webinar ? `${webinar.title}・参加者管理` : 'ウェビナー参加者管理',
    analytics: 'ウェビナー分析',
  }
  usePageTitle(paneTitle[pane])

  useEffect(() => {
    if (!id) return
    const requestId = ++loadRequestId.current
    /* 切替時は集計も前のウェビナーの分を捨てる（申込数は段をまたいで出る）。 */
    setAnalytics(null)
    setAnalyticsId(null)
    setAnalyticsState('idle')
    Promise.all([webinarApi.get(id), webinarApi.editor(id)])
      .then(([webinarResponse, editorResponse]) => {
        /* 先に世代印を見る。切替後に届いた前の応答はここで終わり。 */
        if (requestId !== loadRequestId.current) return
        /* 読めたら前の失敗文は消す。直ったのに赤い文が残らない。 */
        setLoadFailure(null)
        setLoadedWebinar({ id, webinar: webinarResponse.data, editor: editorResponse.data })
      })
      .catch((err) => {
        if (requestId !== loadRequestId.current) return
        setLoadFailure({ id, message: webinarErrorText(err, '読み込めませんでした。開き直してください。') })
      })
    return () => { loadRequestId.current += 1 }
  }, [id])

  /*
    集計は8並列の重い口。基本設定だけ直す人にも毎回走らせない。
    参加者・分析の段を開いたときだけ取り、段を離れて戻ってきても取り直さない。
    失敗は段を離れたら捨て、次に開いたときに取り直す。
  */
  useEffect(() => {
    if (!id) return
    if (pane !== 'participants' && pane !== 'analytics') {
      if (analyticsState === 'error') {
        setAnalytics(null)
        setAnalyticsId(null)
        setAnalyticsState('idle')
      }
      return
    }
    if (analyticsId === id && analyticsState !== 'idle') return
    let cancelled = false
    setAnalyticsState('loading')
    webinarApi.analytics(id)
      .then((response) => {
        if (cancelled) return
        setAnalytics(response.data)
        setAnalyticsId(id)
        setAnalyticsState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setAnalytics(null)
        setAnalyticsId(id)
        setAnalyticsState('error')
      })
    return () => { cancelled = true }
  }, [id, pane, analyticsId, analyticsState])

  if (!id) {
    /*
      U097: 「一覧から選び直すと表示できます」と言うだけでは戻れない。
      一覧へ戻る操作を文のそばに置く。
    */
    return (
      <>

        <div className="p-6">
          <p className="text-danger">編集するウェビナーが指定されていません。</p>
          <p className="mt-1 text-sm text-ink-secondary">一覧から編集するウェビナーを選び直してください。</p>
          <Link href="/webinars" className="mt-3 inline-block text-sm font-semibold text-action hover:underline">ウェビナー一覧へ戻る</Link>
        </div>
        {leaveConfirmDialog}
      </>
    )
  }
  if (loading) {
    return (
      <>

        <div className="p-6 text-gray-500">読み込み中...</div>
        {leaveConfirmDialog}
      </>
    )
  }
  if (loadError || !webinar || !editor) {
    return (
      <>

        <div className="p-6">
          <p className="text-danger">{loadError ?? 'ウェビナーが見つかりませんでした'}</p>
          <Link href="/webinars" className="mt-3 inline-block text-sm font-semibold text-action hover:underline">ウェビナー一覧へ戻る</Link>
        </div>
        {leaveConfirmDialog}
      </>
    )
  }

  const webinarAccount = webinar.accountId
    ? accounts.find((account) => account.id === webinar.accountId)
    : null
  const publicUrl = editor.publicPage.url
  const publicPageReason = accountsLoading
    ? 'LINE公式アカウントを確認しています。'
    : !webinar.accountId || !webinarAccount
      ? 'このウェビナーのLINE公式アカウントを確認できません。'
      : !webinarAccount.liffId
        ? 'LINE公式アカウントにLIFF IDが設定されていません。'
        : webinar.status !== 'active'
          ? '公開すると、友だちが見るページを確認できます。'
          : ''
  const registrations = analytics?.summary.reservations ?? null
  const railPane: StepKey = pane === 'actions'
    ? 'notifications'
    : pane === 'preview'
      ? 'review'
      : STEPS.some((step) => step.key === pane)
        ? pane as StepKey
        : 'basic'
  const showSteps = ['basic', 'video', 'cta', 'notifications', 'actions', 'preview', 'review'].includes(pane)
  const nextPane: PaneKey | null = pane === 'notifications'
    ? 'actions'
    : pane === 'actions'
      ? 'preview'
      : pane === 'preview'
        ? 'review'
        : nextStepOf(pane as StepKey)
  const nextPaneLabel = pane === 'notifications'
    ? '視聴後アクションへ'
    : pane === 'actions'
      ? 'プレビューへ'
      : pane === 'preview'
        ? '公開前確認へ'
        : nextLabelOf(pane as StepKey)
  const canOpenPublicPage = webinar.status === 'active' && publicUrl !== null
  /* 未保存の入力がある段では、次へ進む押し口が保存を引き受けることを文言で示す。 */
  const primaryLabel = nextPaneLabel && unsavedPanes.has(pane) && savablePanes.has(pane)
    ? `保存して${nextPaneLabel}`
    : nextPaneLabel

  return (
    <div className="mx-auto max-w-[1600px] px-6 pb-24 pt-4">
      <nav data-design="Crumb" className="text-action mb-5 text-xs font-semibold"><Link href="/webinars" className="hover:underline">← ウェビナー一覧</Link></nav>

      {showSteps ? (
        <ol data-design="Steps" className="border-hairline bg-canvas mb-4 flex flex-wrap items-center gap-1 rounded-2xl border p-3 shadow-sm">
          {STEPS.map((step) => {
            const state = stepStateOf(step.key, railPane, webinar, ctaCount)
            return (
              <li key={step.key} className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  data-qa-open={step.mark}
                  data-design-node={step.node}
                  onClick={() => goStep(step.key)}
                  aria-current={railPane === step.key ? 'step' : undefined}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors ${
                    state === 'current'
                      ? 'bg-accent-soft text-ink'
                      : 'text-ink-secondary hover:bg-canvas-sunken'
                  }`}
                >
                  {/* 印の描き方は共通の `StepRail`（設計 `LMiL2`）にそろえる。 */}
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      state === 'done'
                        ? 'bg-accent-deep text-on-accent'
                        : state === 'current'
                          ? 'border-accent text-accent-deep border-2'
                          : 'border-hairline text-ink-faint border'
                    }`}
                    aria-hidden="true"
                  >
                    {state === 'done' ? '✓' : step.no}
                  </span>
                  <span className="min-w-0 truncate">
                    STEP {step.no} {step.title}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : null}

      {/*
        編集の段（基本・動画・通知）は畳まずに隠すだけにする。
        畳むと入力が消えるので、一度開いた段は画面に置いたままにする。
      */}
      {visitedPanes.has('basic') ? (
        <div hidden={pane !== 'basic'}>
          <WebinarForm key={`${webinar.id}-${webinar.updatedAt}`} initial={webinar} hideBar onSaved={handleWebinarSaved} onDirtyChange={dirtyReporterFor('basic')} registerSave={saveRegistrarFor('basic')} />
        </div>
      ) : null}
      {visitedPanes.has('video') ? (
        <div hidden={pane !== 'video'}>
          <VideoDesignStep webinar={webinar} editor={editor} registrations={registrations} publicUrl={publicUrl} canOpenPublicPage={canOpenPublicPage} publicPageReason={publicPageReason} onWebinarSaved={handleWebinarSaved} onDirtyChange={dirtyReporterFor('video')} registerSave={saveRegistrarFor('video')} />
        </div>
      ) : null}
      {visitedPanes.has('cta') ? (
        <div hidden={pane !== 'cta'}>
          <CtaDesignStep webinarId={webinar.id} accountId={webinar.accountId} durationSeconds={webinar.durationSeconds} editor={editor} registrations={registrations} onEditorChange={setEditor} onCtasReport={handleCtasReport} />
        </div>
      ) : null}
      {visitedPanes.has('notifications') ? (
        <div hidden={pane !== 'notifications'}>
          <NotificationDesignStep webinarId={webinar.id} webinarTitle={webinar.title} registrations={registrations} publicUrl={publicUrl} canOpenPublicPage={canOpenPublicPage} publicPageReason={publicPageReason} onDirtyChange={dirtyReporterFor('notifications')} registerSave={saveRegistrarFor('notifications')} />
        </div>
      ) : null}
      {pane === 'review' && <ReviewStep webinar={webinar} editor={editor} registrations={registrations} ctaCount={ctaCount} onBack={goStep} onPublished={disarm} />}
      {visitedPanes.has('comments') ? (
        <div hidden={pane !== 'comments'}>
          <CommentsTab webinarId={webinar.id} />
        </div>
      ) : null}
      {visitedPanes.has('actions') ? (
        <div hidden={pane !== 'actions'}>
          <WebinarActionsTab webinarId={webinar.id} editor={editor} onEditorChange={setEditor} />
        </div>
      ) : null}
      {pane === 'preview' && <PublicPreviewStep webinar={webinar} editor={editor} publicUrl={publicUrl} registrations={registrations} publicPageReason={publicPageReason} onEditorChange={setEditor} />}
      {pane === 'participants' && <AnalyticsTab webinarId={webinar.id} durationSeconds={webinar.durationSeconds} view="participants" analytics={analytics} analyticsState={analyticsState} webinarStatus={webinar.status} onRetry={() => { setAnalytics(null); setAnalyticsId(null); setAnalyticsState('idle') }} />}
      {pane === 'analytics' && <AnalyticsTab webinarId={webinar.id} durationSeconds={webinar.durationSeconds} analytics={analytics} analyticsState={analyticsState} webinarStatus={webinar.status} onRetry={() => { setAnalytics(null); setAnalyticsId(null); setAnalyticsState('idle') }} onOpenParticipants={() => goStep('participants')} />}

      {/* 保存はこの一段だけ。各段の中に別の保存バーは出さない。共通 StickyBar を使い、画面幅いっぱいの fixed 配置でサイドバーに重ねない。 */}
      {showSteps && nextPane && nextPaneLabel ? (
        <StickyBar
          status={unsavedPanes.size > 0 ? '保存していない変更があります' : undefined}
          actions={(
            <>
              <Button disabled={savingForNav !== false || !savablePanes.has(pane)} title={savablePanes.has(pane) ? undefined : 'この段の中の保存ボタンから保存します'} onClick={() => void handleDraftSave()}>{savingForNav === 'draft' ? '保存中…' : '下書き保存'}</Button>
              <Button variant="primary" disabled={savingForNav !== false} onClick={() => void handlePrimaryAction()}>{savingForNav === 'next' ? '保存中…' : primaryLabel}</Button>
            </>
          )}
        />
      ) : null}
      {pane === 'participants' ? <div className="mt-4 flex justify-end gap-2"><Button href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}&pane=analytics`}>分析を見る</Button><Button href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}`}>ウェビナーの設定を編集</Button></div> : null}
      {leaveConfirmDialog}
    </div>
  )
}

function EditWebinarPage() {
  return (
    <Suspense
      fallback={
        <>

          <div className="p-6 text-gray-500">読み込み中...</div>
        </>
      }
    >
      <EditWebinarInner />
    </Suspense>
  )
}

const EditWebinarPageWithTestSupport = Object.assign(EditWebinarPage, {
  __testing: {
    NOTIFICATION_ROW_STATE,
    NotificationStateBadge,
    VideoMediaLabel,
    notificationRowState,
    deliveryTimingSummary,
    missedNoticeSummary,
    completedNoticeSummary,
  },
})

export default EditWebinarPageWithTestSupport
