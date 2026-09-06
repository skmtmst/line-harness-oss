'use client'

import SelectField from '@/components/shared/select-field'
import { Suspense, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import WebinarNotifications from '@/components/webinars/webinar-notifications'
import { notificationPreview, videoPreview } from './preview-body'
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
import StickyBar from '@/components/shared/sticky-bar'
import {
  fetchApi,
  webinarApi,
  type WebinarCtaCard,
  type Webinar,
  type WebinarSakuraComment,
  type WebinarAnalytics,
  type WebinarUserComment,
  type WebinarAction,
} from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'

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

function deliveryWindow(webinar: Webinar): string {
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
  children,
}: {
  rows: Array<[string, string]>
  previewBody: string
  previewButton?: string | null
  children?: ReactNode
}) {
  return (
    <aside className="space-y-3 xl:w-[390px] xl:shrink-0">
      <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
        <h2 className="text-ink text-sm font-bold">設定サマリー</h2>
        <dl className="divide-hairline mt-3 divide-y">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-3 text-xs"><dt className="text-ink-faint">{label}</dt><dd className="text-ink text-right font-semibold">{value}</dd></div>
          ))}
        </dl>
        <p className="text-ink mt-2 text-xs font-semibold">タグ「配信済み」を追加</p>
      </section>
      <section className="bg-info min-h-[365px] rounded-card p-4 text-on-accent shadow-card">
        <h2 className="text-center text-sm font-bold">LINEプレビュー</h2>
        <p className="mx-auto mt-3 w-fit rounded-pill bg-ink/20 px-3 py-1 text-micro">実際のLINE表示に近いプレビューです</p>
        <div className="bg-canvas text-ink mt-4 rounded-control p-4 text-sm font-medium leading-relaxed">{previewBody}</div>
        {previewButton ? <div className="bg-accent-deep text-on-accent mx-auto mt-3 w-fit rounded-control px-4 py-2 text-xs font-bold">{previewButton}</div> : null}
      </section>
      {children}
    </aside>
  )
}

function EditorDetails({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group border-hairline bg-canvas overflow-hidden rounded-card border">
      <summary className="text-ink-secondary flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">{label}<span className="text-ink-faint group-open:rotate-180">▾</span></summary>
      <div className="border-hairline border-t p-4">{children}</div>
    </details>
  )
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
    try {
      const sorted = [...comments].sort((a, b) => a.atSeconds - b.atSeconds)
      const res = await webinarApi.saveComments(webinarId, sorted)
      setComments(sorted)
      setIsErrorMessage(false)
      setMessage(`${res.data.count}件保存しました`)
    } catch (err) {
      setIsErrorMessage(true)
      setMessage(`保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`)
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
          JSON 一括インポート（形式: {'[{"atSeconds":10,"authorName":"田中","body":"こんばんは"}]'}）
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
            <th className="w-24 py-1 font-medium">秒数</th>
            <th className="w-40 font-medium">名前</th>
            <th className="font-medium">本文</th>
            <th className="w-12"></th>
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
  if (pictureUrl) {
    return (
      <img
        src={pictureUrl}
        alt=""
        className={`${sizeClass} shrink-0 rounded-full bg-slate-100 object-cover ring-2 ring-white`}
      />
    )
  }
  return (
    <span className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 font-bold text-blue-700 ring-2 ring-white`}>
      {name.trim().charAt(0) || '?'}
    </span>
  )
}

function AnalyticsTab({ webinarId, durationSeconds, view = 'analytics' }: { webinarId: string; durationSeconds: number; view?: 'participants' | 'analytics' | 'legacy' }) {
  const [analytics, setAnalytics] = useState<WebinarAnalytics | null>(null)
  const [userComments, setUserComments] = useState<WebinarUserComment[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    Promise.all([webinarApi.analytics(webinarId), webinarApi.userComments(webinarId)])
      .then(([analyticsRes, commentsRes]) => {
        setAnalytics(analyticsRes.data)
        setUserComments(commentsRes.data)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [webinarId])

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        分析データを読み込めませんでした。ページを再読み込みしてください。
      </div>
    )
  }
  if (!analytics) return <div className="text-gray-500 text-sm">読み込み中...</div>

  const { summary } = analytics
  const completionRate = percent(summary.completed, summary.viewers)
  const participationRows = analytics.participants.slice(0, 8)

  if (view === 'participants') {
    const unviewed = Math.max(0, summary.reservations - summary.viewers)
    const watching = Math.max(0, summary.viewers - summary.completed)
    return (
      <div className="space-y-4" data-design-node="Q8sHa">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-ink text-lg font-bold">参加者管理</h2><p className="text-ink-faint mt-1 text-xs">申込・視聴・CTA・フォームの結果を友だち単位で確認します。</p></div><Button href={webinarApi.participantsCsvUrl(webinarId)}>参加者をCSVで書き出す</Button></div>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[['申込', summary.reservations, 'text-success'], ['視聴開始', summary.viewers, 'text-accent'], ['視聴完了', summary.completed, 'text-warning'], ['エラー', analytics.formFunnel.submitErrors, 'text-danger']].map(([label, value, tone]) => <div key={String(label)} className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><p className="text-ink-faint text-xs">{label}</p><p className={`${tone} mt-2 text-2xl font-bold tabular-nums`}>{Number(value).toLocaleString('ja-JP')}{label === 'エラー' ? '件' : '人'}</p></div>)}
        </section>
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="border-hairline bg-canvas overflow-hidden rounded-card border shadow-card">
            <div className="border-hairline border-b px-4 py-3"><h3 className="text-ink font-bold">参加者一覧</h3><p className="text-ink-faint mt-1 text-xs">何をきっかけに、何が実行されたかを分析できます。</p></div>
            <div className="divide-hairline divide-y">{participationRows.length === 0 ? <p className="text-ink-faint p-8 text-center text-sm">まだ参加者がいません。</p> : participationRows.map((participant) => {
              const name = participant.friendName ?? '名前未取得'
              const rate = Math.min(100, Math.round((participant.maxWatchedSeconds / Math.max(1, durationSeconds)) * 100))
              const state = participant.maxWatchedSeconds === 0 ? '視聴エラー' : rate >= 90 ? `視聴完了 ${rate}%` : rate > 0 ? `視聴中 ${rate}%` : '未視聴'
              const action = participant.formSubmittedAt ? '動画・CTA＋フォーム送信' : participant.ctaClickedAt ? '動画・CTA' : participant.maxWatchedSeconds > 0 ? '動画視聴' : '要対応へ追加'
              const status = participant.maxWatchedSeconds === 0 ? 'エラー' : rate >= 90 ? '成功' : '分析待ち'
              return <div key={participant.friendId} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[minmax(150px,1.2fr)_minmax(130px,1fr)_minmax(170px,1.3fr)_90px_70px] md:items-center"><div className="flex min-w-0 items-center gap-3"><ParticipantAvatar name={name} pictureUrl={participant.pictureUrl} /><span className="truncate font-semibold">{name}</span></div><span className="text-ink-secondary">{state}</span><span className="text-ink-secondary">{action}</span><span className={`rounded-pill w-fit px-2 py-1 text-[11px] font-semibold ${status === '成功' ? 'bg-success-bg text-success' : status === 'エラー' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning'}`}>{status}</span><time className="text-ink-faint text-xs">{compactDateTime(participant.latestJoinedAt).split(' ').at(-1)}</time></div>
            })}</div>
          </section>
          <aside className="space-y-3">
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h3 className="text-ink text-sm font-bold">参加状況の内訳</h3><p className="text-ink-faint mt-1 text-xs">一覧を開かずに効果を分析できます。</p><dl className="divide-hairline mt-3 divide-y">{[['予約', summary.registeredAndJoined, percent(summary.registeredAndJoined, summary.reservations)], ['視聴中', watching, percent(watching, summary.reservations)], ['未視聴', unviewed, percent(unviewed, summary.reservations)]].map(([label, count, rate]) => <div key={String(label)} className="flex items-center justify-between py-3 text-xs"><dt className="text-ink-secondary">{label}</dt><dd className="text-ink font-bold">{Number(count).toLocaleString('ja-JP')}回 <span className="text-ink-faint ml-2 font-normal">{rate}</span></dd></div>)}</dl></section>
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h3 className="text-ink text-sm font-bold">稼働状況</h3><dl className="divide-hairline mt-3 divide-y text-xs"><div className="flex justify-between py-3"><dt className="text-ink-faint">状態</dt><dd className="text-success font-bold">稼働中</dd></div><div className="flex justify-between py-3"><dt className="text-ink-faint">公開状態</dt><dd className="text-ink font-bold">公開中</dd></div><div className="flex justify-between py-3"><dt className="text-ink-faint">平均視聴</dt><dd className="text-ink font-bold">{fmtSec(summary.avgWatchedSeconds)}</dd></div></dl></section>
            <section className="border-danger bg-danger-bg rounded-card border p-4"><h3 className="text-danger text-sm font-bold">要分析</h3><p className="text-danger mt-2 text-xs">視聴・送信エラー {analytics.formFunnel.submitErrors}件</p></section>
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h3 className="text-ink text-sm font-bold">担当者視聴完了</h3><p className="text-ink-faint mt-2 text-xs">未視聴・相談希望の連携状況は運用者通知で確認します。</p></section>
          </aside>
        </div>
      </div>
    )
  }

  if (view === 'analytics') {
    const avgRate = durationSeconds > 0 ? Math.round((summary.avgWatchedSeconds / durationSeconds) * 1000) / 10 : 0
    return (
      <div className="space-y-4" data-design-node="yxyzQ">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2">{['概要', '視聴', '離脱', 'CTA', '申込'].map((label, index) => <span key={label} className={`rounded-control px-3 py-2 text-sm font-semibold ${index === 0 ? 'bg-accent-deep text-on-accent' : 'border-hairline bg-canvas text-ink-secondary border'}`}>{label}</span>)}</div><Button href={webinarApi.participantsCsvUrl(webinarId)}>CSVで書き出す</Button></div>
        <div className="flex flex-col gap-4 xl:flex-row">
          <div className="min-w-0 flex-1 space-y-3">
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">視聴結果</h2><p className="text-ink-faint mt-1 text-xs">申込・再生・完了率を確認します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">申込</dt><dd className="text-ink text-sm font-bold">{summary.reservations.toLocaleString('ja-JP')}人</dd></div><div className="flex justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">再生</dt><dd className="text-ink text-sm font-bold">{summary.viewers.toLocaleString('ja-JP')}人（{percent(summary.viewers, summary.reservations)}）</dd></div></dl></section>
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">視聴行動</h2><p className="text-ink-faint mt-1 text-xs">離脱箇所とCTA反応を確認します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">平均視聴時間</dt><dd className="text-ink text-sm font-bold">{fmtSec(summary.avgWatchedSeconds)}（{avgRate}%）</dd></div><div className="flex justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">最大離脱</dt><dd className="text-ink text-sm font-bold">{analytics.dropoff.length > 0 ? `${fmtSec(analytics.dropoff[0].bucketStart)}付近` : '—（区間未取得）'}</dd></div></dl></section>
          </div>
          <SummaryAside rows={[
            ['視聴完了', `${summary.completed.toLocaleString('ja-JP')}人`],
            ['CTAクリック', `${summary.ctaClicks.toLocaleString('ja-JP')}人`],
            ['申込転換', percent(summary.ctaClicks, summary.reservations)],
          ]} previewBody={analytics.dropoff.length > 0 ? 'もっとも視聴された区間を分析できます。' : '視聴区間の集計はまだ取得できていません。'}>
            <div className="flex gap-2"><Button disabled>テスト送信</Button><Button disabled>公開ページを見る</Button></div>
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
          <Button href={webinarApi.participantsCsvUrl(webinarId)}>
            参加者をCSVで書き出す
          </Button>
        </div>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="border-hairline bg-canvas rounded-card border p-4">
            <p className="text-ink-faint text-xs">申込</p>
            <p className="text-success mt-2 text-2xl font-bold tabular-nums">{summary.reservations.toLocaleString('ja-JP')}人</p>
          </div>
          <div className="border-hairline bg-canvas rounded-card border p-4">
            <p className="text-ink-faint text-xs">視聴開始</p>
            <p className="text-accent mt-2 text-2xl font-bold tabular-nums">{summary.viewers.toLocaleString('ja-JP')}人</p>
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
                    <Link href={`/chats?friend=${participant.friendId}`} className="text-accent font-semibold">確認する</Link>
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
    <div className="space-y-6" data-design-node="yxyzQ">
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
            <div className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{metric.value}</div>
            <div className="mt-1 text-xs text-slate-500">{metric.detail}</div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                    <th className="px-5 py-3">参加者</th>
                    <th className="px-4 py-3">最終参加</th>
                    <th className="px-4 py-3">視聴</th>
                    <th className="px-4 py-3">アクション</th>
                    <th className="px-5 py-3 text-right">詳細</th>
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
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">フォーム送信</span>
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

      <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                  <tr><th className="px-3 py-2 font-medium">開始</th><th className="font-medium">参加</th><th className="font-medium">平均視聴</th><th className="font-medium">CTA</th></tr>
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

      {userComments.length > 0 && (
        <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between p-5">
            <div><h3 className="font-bold text-slate-900">視聴者コメント</h3><p className="mt-1 text-xs text-slate-500">実際に届いたコメントを参加者の顔と一緒に確認</p></div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{userComments.length}件 ▾</span>
          </summary>
          <div className="grid gap-3 border-t border-slate-100 p-5 md:grid-cols-2">
            {userComments.map((c) => {
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
      )}
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

function VideoDesignStep({ webinar, registrations }: { webinar: Webinar; registrations: number | null }) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="PV1Vh">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">動画設定</h2>
          <p className="text-ink-faint mt-1 text-xs">動画ファイルまたは外部動画URLを設定します。</p>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,1fr)]">
            <div><p className="text-ink-faint text-xs font-semibold">動画</p><div className="border-hairline text-ink mt-1 rounded-control border px-3 py-3 text-sm font-semibold">{webinar.videoPrefix ? `${webinar.slug}.mp4` : '—（未設定）'}</div></div>
            <div><p className="text-ink-faint text-xs font-semibold">再生時間</p><div className="border-hairline text-ink mt-1 rounded-control border px-3 py-3 text-sm font-semibold">{durationLabel(webinar.durationSeconds)}</div></div>
          </div>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">公開設定</h2>
          <p className="text-ink-faint mt-1 text-xs">公開期間・視聴条件・自動再生を設定します。</p>
          <div className="mt-4 space-y-3">
            <div className="border-hairline flex items-center justify-between gap-4 rounded-control border bg-canvas-sunken px-4 py-4"><div><p className="text-ink text-sm font-bold">公開期間</p><p className="text-ink-faint mt-1 text-xs">{deliveryWindow(webinar)}</p></div><span className="text-action">›</span></div>
            <div className="border-hairline flex items-center justify-between gap-4 rounded-control border bg-canvas-sunken px-4 py-4"><div><p className="text-ink text-sm font-bold">視聴条件</p><p className="text-ink-faint mt-1 text-xs">—（対象条件はAPI未接続）</p></div><span className="text-action">›</span></div>
          </div>
        </section>
        <EditorDetails label="動画・公開の詳細を編集する"><WebinarForm initial={webinar} /></EditorDetails>
      </div>
      <SummaryAside rows={[
        ['動画', webinar.videoPrefix ? 'アップロード済み' : '未設定'],
        ['公開', webinarStatusLabel(webinar.status)],
        ['申込', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
      ]} previewBody={videoPreview(webinar).body ?? videoPreview(webinar).empty}>
        <div className="flex gap-2"><Button disabled>テスト送信</Button><Button disabled={!webinar.videoPrefix}>公開ページを見る</Button></div>
      </SummaryAside>
    </div>
  )
}

function NotificationDesignStep({ webinarId, registrations }: { webinarId: string; registrations: number | null }) {
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof webinarApi.notifications>>['data']['settings'] | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    webinarApi.notifications(webinarId)
      .then((response) => setSettings(response.data.settings))
      .catch(() => setSettings(null))
      .finally(() => setLoaded(true))
  }, [webinarId])

  const enabled = (value: boolean | undefined) => !loaded ? '—（確認中）' : value ? '設定済み' : '未設定'

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="Ho8z4">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">事前案内</h2>
          <p className="text-ink-faint mt-1 text-xs">申込直後・前日・1時間前の案内を設定します。</p>
          <dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline">
            <div className="flex items-center justify-between gap-4 px-4 py-4"><div><dt className="text-ink text-sm font-bold">申込完了</dt><dd className="text-ink-faint mt-1 text-xs">申込完了直後に案内を送信</dd></div><span className="text-success text-xs font-semibold">{enabled(settings?.registrationEnabled)}</span></div>
            <div className="flex items-center justify-between gap-4 px-4 py-4"><div><dt className="text-ink text-sm font-bold">開催前日</dt><dd className="text-ink-faint mt-1 text-xs">LINEでリマインド</dd></div><span className="text-success text-xs font-semibold">{enabled(settings?.dayBeforeEnabled)}</span></div>
          </dl>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">当日・見逃し案内</h2>
          <p className="text-ink-faint mt-1 text-xs">開始前・開始時・未視聴者への案内を設定します。</p>
          <dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline">
            <div className="px-4 py-4"><dt className="text-ink text-sm font-bold">配信タイミング</dt><dd className="text-ink-faint mt-1 text-xs">前日 {settings?.dayBeforeTime ?? '—'}／{settings?.hourBeforeMinutes ? `${settings.hourBeforeMinutes}分前` : '—'}／開始時</dd></div>
            <div className="px-4 py-4"><dt className="text-ink text-sm font-bold">見逃し案内</dt><dd className="text-ink-faint mt-1 text-xs">未視聴者へ翌日{settings?.missedTime ?? '—'}に送信</dd></div>
          </dl>
        </section>
        <EditorDetails label="通知ごとの送信設定を編集する"><WebinarNotifications webinarId={webinarId} /></EditorDetails>
      </div>
      <SummaryAside rows={[
        ['申込完了', enabled(settings?.registrationEnabled)],
        ['リマインド', settings?.dayBeforeEnabled || settings?.hourBeforeEnabled ? 'リマインド中' : loaded ? '未設定' : '—（確認中）'],
        ['対象', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
      ]} previewBody={notificationPreview(null).empty}>
        <div className="flex gap-2"><Button disabled>テスト送信</Button><Button disabled>公開ページを見る</Button></div>
      </SummaryAside>
    </div>
  )
}

function CtasTab({ webinarId, accountId }: { webinarId: string; accountId: string | null }) {
  const [ctas, setCtas] = useState<WebinarCtaCard[]>([])
  const [forms, setForms] = useState<Array<{ id: string; name: string }>>([])
  const [times, setTimes] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // ロード失敗時に空の状態で保存すると all-or-nothing 置換で既存 CTA を消して
    // しまうため、初回 GET が成功するまで保存を無効化する
    webinarApi
      .ctas(webinarId)
      .then((res) => {
        /*
          **配列で来なかったら、読めなかったこととして扱う。**
          口の契約は配列（`apps/worker/src/routes/webinars.ts:904` が
          `data: ctas.map(...)` を返す）だが、器だけ違う返事が来ると
          `ctas.map is not a function` で**この面が白い画面になる**。
          そのまま保存に進むと、置き換えで既存のCTAを消してしまう。
        */
        if (!Array.isArray(res.data)) throw new Error('cta_list_not_array')
        setCtas(res.data)
        setTimes(res.data.map((c) => fmtMinSec(c.atSeconds)))
        setLoaded(true)
      })
      .catch(() => setMessage('CTAカードを読み込めませんでした。もう一度読み込んでください。読み込めるまで保存はできません。'))
    if (accountId) {
      fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>(
        `/api/forms?account_id=${encodeURIComponent(accountId)}`,
      )
        /* 同上。フォームの一覧も配列で来るとは限らない。 */
        .then((res) => setForms(Array.isArray(res.data) ? res.data.map((f) => ({ id: f.id, name: f.name })) : []))
        .catch(() => undefined)
    } else {
      setForms([])
    }
  }, [accountId, webinarId])

  const update = (i: number, patch: Partial<WebinarCtaCard>) =>
    setCtas((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const save = async () => {
    setMessage(null)
    const merged: WebinarCtaCard[] = []
    for (let i = 0; i < ctas.length; i++) {
      const at = parseMinSec(times[i] ?? '')
      if (at === null) {
        setMessage(`${i + 1}行目の表示時間が不正です（例: 45:00 または秒数）`)
        return
      }
      merged.push({ ...ctas[i], atSeconds: at })
    }
    setSaving(true)
    try {
      const sorted = [...merged].sort((a, b) => a.atSeconds - b.atSeconds)
      await webinarApi.saveCtas(webinarId, sorted)
      setCtas(sorted)
      setTimes(sorted.map((c) => fmtMinSec(c.atSeconds)))
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
      {message && <p className="rounded bg-blue-50 p-2 text-sm">{message}</p>}
      {ctas.map((c, i) => (
        <div key={i} className="space-y-2 rounded border border-gray-200 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              表示時間
              <input
                value={times[i] ?? ''}
                onChange={(e) =>
                  setTimes((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))
                }
                placeholder="45:00"
                className="w-20 rounded border px-2 py-1"
              />
            </label>
            <SelectField value={c.kind} onChange={(e) => update(i, { kind: e.target.value as 'form' | 'url' })} options={[{ value: "form", label: "フォーム" }, { value: "url", label: "URL" }]} className="rounded border px-2 py-1" />
            {c.kind === 'form' ? (
              <SelectField
                value={c.formId ?? ''}
                onChange={(e) => update(i, { formId: e.target.value || null })}
                options={[{ value: '', label: 'フォームを選択...' }, ...forms.map((f) => ({ value: f.id, label: f.name }))]}
              />
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
                setCtas((prev) => prev.filter((_, j) => j !== i))
                setTimes((prev) => prev.filter((_, j) => j !== i))
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
            setCtas((prev) => [...prev, {
              atSeconds: 0, kind: 'form', title: '', body: null,
              buttonLabel: '', autoOpen: false, formId: null, url: null,
            }])
            setTimes((prev) => [...prev, '0:00'])
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

function CtaDesignStep({ webinarId, accountId, registrations }: { webinarId: string; accountId: string | null; registrations: number | null }) {
  const [ctas, setCtas] = useState<WebinarCtaCard[]>([])
  const [forms, setForms] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    webinarApi.ctas(webinarId).then((response) => setCtas(Array.isArray(response.data) ? response.data : [])).catch(() => setCtas([]))
    if (!accountId) return
    fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>(`/api/forms?account_id=${encodeURIComponent(accountId)}`)
      .then((response) => setForms(Array.isArray(response.data) ? response.data : []))
      .catch(() => setForms([]))
  }, [accountId, webinarId])

  const primary = ctas[0]
  const selectedForm = forms.find((form) => form.id === primary?.formId)

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="d3rFGD">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">CTA設定</h2><p className="text-ink-faint mt-1 text-xs">動画内に表示するボタンとタイミングを設定します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">表示タイミング</dt><dd className="text-ink text-sm font-bold">{primary ? `動画の${Math.floor(primary.atSeconds / 60)}分${String(primary.atSeconds % 60).padStart(2, '0')}秒` : '—（未設定）'}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">ボタン文言</dt><dd className="text-ink text-sm font-bold">{primary?.buttonLabel || '—（未設定）'}</dd></div></dl></section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">申込フォーム</h2><p className="text-ink-faint mt-1 text-xs">申込情報の保存先と完了アクションを設定します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">入力項目</dt><dd className="text-ink text-sm font-bold">{selectedForm?.name ?? (primary?.formId ? '選択した回答フォーム' : '—（未設定）')}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">完了アクション</dt><dd className="text-ink text-sm font-bold">回答フォーム側の設定に従う</dd></div></dl></section>
        <EditorDetails label="CTAカードとフォームの詳細を編集する"><CtasTab webinarId={webinarId} accountId={accountId} /></EditorDetails>
      </div>
      <SummaryAside rows={[
        ['CTA', `${ctas.length.toLocaleString('ja-JP')}件`],
        ['フォーム', primary?.formId ? '公開中' : '未設定'],
        ['申込', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
      ]} previewBody={primary?.body || 'CTAの説明文はまだ設定されていません。'} previewButton={primary?.buttonLabel || null}>
        <div className="flex gap-2"><Button disabled>テスト送信</Button><Button disabled>公開ページを見る</Button></div>
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

function WebinarActionsTab({ webinarId }: { webinarId: string }) {
  const [actions, setActions] = useState<WebinarAction[]>([])
  const [trigger, setTrigger] = useState<WebinarAction['trigger']>('completed')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

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
          <div className="mt-4 flex flex-wrap gap-2">{TRIGGERS.map((item) => <span key={item.key} className={`rounded-pill border px-3 py-1 text-xs font-semibold ${item.key === 'completed' ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-secondary'}`}>{item.label}</span>)}</div>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <div className="flex items-center justify-between gap-3"><h2 className="text-ink text-base font-bold">視聴完了メッセージ</h2><Button disabled>変数を挿入</Button></div>
          <div className="border-hairline bg-canvas-sunken text-ink-faint mt-4 min-h-28 rounded-control border p-4 text-sm leading-relaxed">送信するテンプレート本文は共通アクションへの接続後に表示します。</div>
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
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-sm font-bold">視聴結果を取得できない場合</h2><p className="text-ink-faint mt-1 text-xs">再取得するか、要対応へ追加するか選択できます。</p><div className="mt-3 flex gap-2"><Button disabled>要対応へ追加</Button><Button disabled>翌日に再取得</Button></div></section>
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
        ['結果未取得時', '要対応／翌日再取得'],
      ]} previewBody="送信するテンプレート本文は共通アクションへの接続後に表示します。" />
    </div>
  )
}

function PublicPreviewStep({
  webinar,
  publicUrl,
  registrations,
  publicPageReason,
}: {
  webinar: Webinar
  publicUrl: string | null
  registrations: number | null
  publicPageReason: string
}) {
  const canOpenPublicPage = webinar.status === 'active' && publicUrl !== null
  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="GB0NR">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">公開ページ</h2><p className="text-ink-faint mt-1 text-xs">タイトル・説明・申込フォームを最終確認します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">ページタイトル</dt><dd className="text-ink text-sm font-bold">{webinar.title}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">公開URL</dt><dd className="text-ink max-w-[70%] truncate text-sm font-bold" title={publicUrl ?? undefined}>{publicUrl ?? '—（LIFF ID未設定）'}</dd></div></dl></section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-bold">表示内容</h2><p className="text-ink-faint mt-1 text-xs">PC・スマートフォンの表示を確認します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">メイン動画</dt><dd className="text-ink text-sm font-bold">16:9・自動再生なし</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">申込フォーム</dt><dd className="text-ink text-sm font-bold">動画視聴前に表示</dd></div></dl></section>
      </div>
      <SummaryAside rows={[
        ['状態', webinar.videoPrefix ? '公開準備完了' : '動画未設定'],
        ['公開期間', deliveryWindow(webinar)],
        ['対象', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
      ]} previewBody={webinar.title}>
        <div className="flex gap-2"><Button disabled>テスト送信</Button>{canOpenPublicPage ? <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : <Button disabled title={publicPageReason}>公開ページを見る</Button>}</div>
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
function ReviewStep({ webinar, registrations, onBack }: { webinar: Webinar; registrations: number | null; onBack: (key: StepKey) => void }) {
  const blockers = publishBlockers(webinar)
  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="D6yO7e">
      <div className="min-w-0 flex-1 space-y-3">
      <section className="border-hairline bg-canvas space-y-4 rounded-card border p-5 shadow-card">
      <div><h2 className="text-ink font-bold">公開前チェック</h2><p className="text-ink-faint mt-1 text-xs">公開に必要な設定を確認します。</p></div>
      {blockers.length > 0 ? (
        <div className="text-warning bg-warning-bg rounded-card p-4 text-sm">
          <p className="font-bold">このままでは公開できません。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {blockers.map((text) => <li key={text}>{text}</li>)}
          </ul>
        </div>
      ) : (
        <p className="bg-success-bg text-success rounded-card p-4 text-sm font-bold">
          必要なものは揃っています。
        </p>
      )}
      <ul className="divide-hairline border-hairline divide-y rounded-xl border text-sm">
        <li className="text-ink flex items-center gap-2 px-4 py-3"><span className="text-success">✓</span>動画・公開が設定されています</li>
        <li className="text-ink flex items-center gap-2 px-4 py-3"><span className="text-success">✓</span>CTA・フォームとアクションが設定されています</li>
        <li className="text-ink flex items-center gap-2 px-4 py-3"><span className="text-warning">!</span>公開ページと通知のテスト結果は未接続です</li>
        <li className="text-ink flex items-center gap-2 px-4 py-3"><span className="text-success">✓</span>リマインド重複と公開期間を確認します</li>
      </ul>
      </section>
      <section className="border-hairline bg-canvas space-y-4 rounded-card border p-5 shadow-card">
      <div><h2 className="text-ink font-bold">最終確認</h2><p className="text-ink-faint mt-1 text-xs">公開すると、申込・配信条件に合う友だちが視聴できます。</p></div>
      <dl className="divide-hairline border-hairline divide-y rounded-xl border">
        {[
          ['ウェビナー名', webinar.title || '未設定'],
          ['動画・公開', webinar.videoPrefix ? '申込者向け' : '未設定'],
          ['公開期間', deliveryWindow(webinar)],
          ['対象', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
          ['CTA・フォーム', webinar.cta ? '動画＋CTA＋フォーム' : '未設定'],
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
      </div>
      <p className="text-ink-faint text-xs">公開するときは、基本設定の「公開状態」を公開中にして保存してください。</p>
      </section>
      </div>
      <SummaryAside rows={[
        ['状態', webinar.status === 'active' ? '公開中' : '有効化前'],
        ['申込見込み', registrations === null ? '—（未取得）' : `${registrations.toLocaleString('ja-JP')}人`],
        ['通知重複', '—（検査API未接続）'],
        ['監視', '運用者通知へ連携'],
      ]} previewBody="公開ページと通知のテスト結果は、検査APIへの接続後に表示します。" />
    </div>
  )
}

function EditWebinarInner() {
  const searchParams = useSearchParams()
  const id = searchParams.get('id')
  const { accounts, loading: accountsLoading } = useAccount()
  const [webinar, setWebinar] = useState<Webinar | null>(null)
  const [analytics, setAnalytics] = useState<WebinarAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  /*
    **編集画面なので、開いた直後は設定の1段目**。前は「概要・分析」を先頭に
    置いていたので、直しに来た人が結果の画面から始めることになっていた。
  */
  const requestedPane = searchParams.get('pane')
  const initialPane = ([...STEPS.map((step) => step.key), ...EXTRAS.map(([key]) => key)] as string[]).includes(requestedPane ?? '')
    ? requestedPane as PaneKey
    : 'basic'
  const [pane, setPane] = useState<PaneKey>(initialPane)

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
    setLoading(true)
    webinarApi
      .get(id)
      .then((res) => setWebinar(res.data))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
    webinarApi.analytics(id).then((response) => setAnalytics(response.data)).catch(() => setAnalytics(null))
  }, [id])

  if (!id) {
    return (
      <>

        <div className="p-6 text-red-700">id クエリが必要です</div>
      </>
    )
  }
  if (loading) {
    return (
      <>

        <div className="p-6 text-gray-500">読み込み中...</div>
      </>
    )
  }
  if (loadError || !webinar) {
    return (
      <>

        <div className="p-6 text-red-700">{loadError ?? '見つかりませんでした'}</div>
      </>
    )
  }

  const webinarAccount = webinar.accountId
    ? accounts.find((account) => account.id === webinar.accountId)
    : null
  const publicUrl = webinarAccount?.liffId
    ? `https://liff.line.me/${encodeURIComponent(webinarAccount.liffId)}/webinar/${encodeURIComponent(webinar.slug)}`
    : null
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

  return (
    <main className="mx-auto max-w-[1600px] px-6 pb-24 pt-4">
      <nav data-design="Crumb" className="text-action mb-5 text-xs font-semibold"><Link href="/webinars" className="hover:underline">← ウェビナー一覧</Link></nav>

      {showSteps ? (
        <ol className="border-hairline bg-canvas mb-4 flex flex-wrap items-center gap-1 rounded-2xl border p-3 shadow-sm">
          {STEPS.map((step) => {
            const state = stepStateOf(step.key, railPane, webinar)
            return (
              <li key={step.key} className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  data-qa-open={step.mark}
                  data-design-node={step.node}
                  onClick={() => setPane(step.key)}
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
                          ? 'border-accent text-accent border-2'
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

      {pane === 'basic' && <WebinarForm initial={webinar} />}
      {pane === 'video' && <VideoDesignStep webinar={webinar} registrations={registrations} />}
      {pane === 'cta' && <CtaDesignStep webinarId={webinar.id} accountId={webinar.accountId} registrations={registrations} />}
      {pane === 'notifications' && <NotificationDesignStep webinarId={webinar.id} registrations={registrations} />}
      {pane === 'review' && <ReviewStep webinar={webinar} registrations={registrations} onBack={setPane} />}
      {pane === 'comments' && <CommentsTab webinarId={webinar.id} />}
      {pane === 'actions' && <WebinarActionsTab webinarId={webinar.id} />}
      {pane === 'preview' && <PublicPreviewStep webinar={webinar} publicUrl={publicUrl} registrations={registrations} publicPageReason={publicPageReason} />}
      {pane === 'participants' && <AnalyticsTab webinarId={webinar.id} durationSeconds={webinar.durationSeconds} view="participants" />}
      {pane === 'analytics' && <AnalyticsTab webinarId={webinar.id} durationSeconds={webinar.durationSeconds} />}

      {showSteps && nextPane && nextPaneLabel ? (
        <div className="border-hairline bg-canvas fixed inset-x-0 bottom-0 z-20 flex justify-end border-t px-8 py-3 shadow-card"><div className="flex gap-2"><Button disabled>下書き保存</Button><Button variant="primary" onClick={() => setPane(nextPane)}>{nextPaneLabel}</Button></div></div>
      ) : null}
      {pane === 'participants' ? <div className="mt-4 flex justify-end gap-2"><Button href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}&pane=analytics`}>分析を見る</Button><Button href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}`}>ウェビナーの設定を編集</Button></div> : null}
    </main>
  )
}

export default function EditWebinarPage() {
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
