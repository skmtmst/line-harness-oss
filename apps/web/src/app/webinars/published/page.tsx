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

  return (
    <div data-design-node="TimXl" className="space-y-5 pb-10">
      <section className="rounded-card border border-hairline bg-canvas px-6 py-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto text-accent" size={42} aria-hidden="true" />
        <p className="mt-3 text-xl font-bold text-ink">公開しました</p>
        <p className="mt-2 text-sm text-ink-secondary">{webinar.title}</p>
      </section>

      <section className="grid gap-3 rounded-card border border-hairline bg-canvas p-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-ink-faint">公開状態</p>
          <p className="mt-1 font-bold text-ink">公開中</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-ink-faint">公開URL</p>
          <p className="mt-1 truncate font-mono text-sm text-ink" title={`/webinar/${webinar.slug}`}>
            /webinar/{webinar.slug}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold text-ink-faint">動画の長さ</p>
          <p className="mt-1 font-bold text-ink">{Math.ceil(webinar.durationSeconds / 60)}分</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-ink-faint">配信枠</p>
          <p className="mt-1 font-bold text-ink">{webinar.schedule.length}件</p>
        </div>
      </section>

      <NoteBar>
        公開後の申込数や視聴結果は、このウェビナーの編集画面にある「概要・分析」で確認できます。
      </NoteBar>

      {!publicUrl ? (
        <NoteBar>
          所属するLINE公式アカウントのLIFF IDを確認できないため、公開ページのボタンは出していません。
        </NoteBar>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3">
        {publicUrl ? (
          <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button>
        ) : null}
        <Button href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}`}>設定と結果を確認</Button>
        <Button href="/webinars">ウェビナー一覧へ</Button>
      </div>
    </div>
  )
}

export default function PublishedWebinarPage() {
  return (
    <Suspense fallback={<ListState kind="loading" title="公開結果を確認しています" />}>
      <PublishedWebinarContent />
    </Suspense>
  )
}
