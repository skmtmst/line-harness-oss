'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import type { Webinar } from '@/lib/api'
import { webinarApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'

type PublishedWebinar = Webinar & {
  publicationState?: 'period' | 'always' | 'scheduled' | 'ended' | 'unset' | null
  publicationStartsAt?: string | null
  publicationEndsAt?: string | null
}

function publicationWindow(webinar: PublishedWebinar): string {
  if (webinar.publicationState === 'always') return '常時公開'
  if (webinar.publicationState === 'ended') return '公開終了'
  if (webinar.publicationState === 'unset') return '未設定'
  const format = (value: string | null | undefined, withTime = false) => {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    const dateText = date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' })
    if (!withTime) return dateText
    const time = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' })
    return `${dateText} ${time}`
  }
  if (webinar.publicationState === 'scheduled') return format(webinar.publicationStartsAt, true) ?? '—'
  if (webinar.publicationState === 'period') {
    const start = format(webinar.publicationStartsAt)
    const end = format(webinar.publicationEndsAt)
    if (start && end) return `${start}〜${end}`
  }
  const dailyTime = webinar.schedule.find((rule) => rule.type === 'daily')?.time
  return dailyTime ? `毎日 ${dailyTime}` : '—（公開期間は未接続）'
}

function PublishedWebinarContent() {
  usePageTitle('ウェビナー・公開完了')
  const id = useSearchParams().get('id')
  const { accounts, loading: accountLoading } = useAccount()
  const [webinar, setWebinar] = useState<Webinar | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!id) {
      setError('公開したウェビナーを特定できませんでした。')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await webinarApi.get(id)
      setWebinar(response.data)
    } catch {
      setWebinar(null)
      setError('公開結果を表示できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (accountLoading || loading) {
    return <ListState kind="loading" title="公開結果を確認しています" />
  }

  if (error || !webinar) {
    return (
      <ListState
        kind="error"
        title="公開結果を表示できませんでした"
        description={error || '公開したウェビナーが見つかりませんでした。'}
        action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
      />
    )
  }

  if (webinar.status !== 'active') {
    return (
      <ListState
        kind="error"
        title="公開状態を確認できませんでした"
        description="このウェビナーは公開中ではありません。編集画面で状態を確認してください。"
        action={<Button href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}`}>編集画面へ戻る</Button>}
      />
    )
  }

  const webinarAccount = webinar.accountId
    ? accounts.find((account) => account.id === webinar.accountId)
    : null
  const publicUrl = webinarAccount?.liffId
    ? `https://liff.line.me/${encodeURIComponent(webinarAccount.liffId)}/webinar/${encodeURIComponent(webinar.slug)}`
    : null
  const publicPeriod = publicationWindow(webinar as PublishedWebinar)

  return (
    <main data-design-node="TimXl" className="mx-auto max-w-[1600px] space-y-4 px-6 pb-12 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><a href="/webinars" className="text-action text-sm font-semibold">← ウェビナー一覧</a><Button href="/webinars">ウェビナー一覧へ</Button></div>
      <ol className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-5">{['基本設定', '動画', 'CTA・フォーム', '通知', '確認'].map((label, index) => <li key={label} className="text-ink flex items-center gap-2 px-3 py-2 text-xs font-semibold"><span className="bg-accent-deep text-on-accent flex h-7 w-7 items-center justify-center rounded-full">✓</span><span><span className="text-accent block text-[10px]">STEP {index + 1}</span>{label}</span></li>)}</ol>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="border-hairline bg-canvas min-h-[720px] rounded-card border p-8 shadow-card">
          <div className="text-center"><CheckCircle2 className="mx-auto text-accent" size={48} aria-hidden="true" /><h1 className="text-ink mt-5 text-2xl font-bold">公開しました</h1><p className="text-ink-secondary mt-3 text-sm">申込・配信条件に合う友だちが、このウェビナーを視聴できます。</p></div>
          <dl className="border-hairline divide-hairline mx-auto mt-6 max-w-3xl divide-y rounded-control border">{[
            ['ウェビナー名', webinar.title], ['動画・公開', '申込者向け'], ['対象', publicPeriod], ['公開URL', `/webinar/${webinar.slug}`], ['状態', '稼働中'],
          ].map(([label, value]) => <div key={label} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">{label}</dt><dd className="text-ink max-w-[70%] truncate text-sm font-bold" title={value}>{value}</dd></div>)}</dl>
          <div className="mx-auto mt-4 max-w-3xl space-y-3"><NoteBar>申込通知・動画配信・リマインド・相談予約の失敗は、運用者通知と要対応で確認できます。</NoteBar>{!publicUrl ? <NoteBar>所属するLINE公式アカウントのLIFF IDを確認できないため、公開ページのボタンは出していません。</NoteBar> : null}</div>
          <div className="mt-5 flex flex-wrap justify-center gap-3"><Button href="/webinars">ウェビナー一覧へ</Button><Button variant="primary" href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}&pane=participants`}>参加状況を確認</Button>{publicUrl ? <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : null}</div>
        </section>
        <aside className="space-y-4">
          <section className="border-hairline bg-canvas rounded-card border p-5 shadow-card"><h2 className="text-ink font-bold">次にできること</h2><p className="text-ink-faint mt-1 text-xs">公開中でも下書き版を作り、安全に内容を変更できます。</p><div className="mt-4 grid gap-2"><Button disabled>公開を一時停止</Button><Button href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}`}>ウェビナーを編集</Button><Button disabled>通知をテスト</Button><Button disabled>ウェビナーを複製して作成</Button></div></section>
          <section className="border-hairline bg-canvas rounded-card border p-5 shadow-card"><h2 className="text-ink font-bold">監視中</h2><p className="text-ink-faint mt-1 text-xs">問題が起きた場合だけ表示します。</p><div className="mt-4 space-y-3">{['通知失敗', '申込重複', '視聴履歴の取得失敗', '個別相談連携失敗'].map((label) => <div key={label} className="text-ink-secondary text-sm">{label}<span className="text-ink-faint ml-2">—</span></div>)}</div></section>
        </aside>
      </div>
    </main>
  )
}

export default function PublishedWebinarPage() {
  return (
    <Suspense fallback={<ListState kind="loading" title="公開結果を確認しています" />}>
      <PublishedWebinarContent />
    </Suspense>
  )
}
