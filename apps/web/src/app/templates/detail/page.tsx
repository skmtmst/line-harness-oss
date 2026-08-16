'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import Header from '@/components/layout/header'

interface Usage {
  autoReplies: Array<{ id: string; keyword: string }>
  scenarioSteps: Array<{ scenarioId: string; scenarioName: string; stepOrder: number }>
}

function TemplateDetailInner() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const [template, setTemplate] = useState<{
    id: string
    name: string
    category: string | null
    messageType: string
    messageContent: string
  } | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const [detail, usages] = await Promise.all([
          api.templates.get(id),
          api.templates.usages(id).catch(() => null),
        ])
        if (detail.success) setTemplate(detail.data)
        if (usages?.success) setUsage(usages.data)
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  const usageCount = (usage?.autoReplies.length ?? 0) + (usage?.scenarioSteps.length ?? 0)

  const remove = async () => {
    const message =
      usageCount > 0
        ? `このテンプレートは ${usageCount} か所で使われています。\n削除すると、その箇所の本文が空になります。よろしいですか？`
        : 'このテンプレートを削除しますか？'
    if (!confirm(message)) return
    setError('')
    try {
      await api.templates.delete(id)
      router.push('/templates')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '削除に失敗しました')
    }
  }

  if (!id) {
    return (
      <div>
        <Header title="テンプレートの詳細" />
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          テンプレートが指定されていません。
          <Link href="/templates" className="text-accent ml-1 hover:underline">
            一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <Header title={template?.name ?? 'テンプレートの詳細'} />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/templates" className="hover:underline">
          テンプレート
        </Link>
        <span className="mx-1.5">›</span>
        <span>{template?.name ?? '詳細'}</span>
      </nav>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : !template ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          このテンプレートは見つかりませんでした。
        </p>
      ) : (
        <div className="max-w-3xl space-y-5">
          <div className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink-secondary mb-2 text-sm font-medium">本文</p>
            <pre className="bg-canvas-sunken text-ink-secondary overflow-x-auto rounded p-3 text-xs whitespace-pre-wrap">
              {template.messageContent}
            </pre>
          </div>

          <div className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink-secondary mb-2 text-sm font-medium">
              使われている場所（{usageCount} か所）
            </p>
            {usageCount === 0 ? (
              <p className="text-ink-faint text-sm">どこでも使われていません。</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {usage?.autoReplies.map((a) => (
                  <li key={a.id} className="text-ink-secondary">
                    自動応答「{a.keyword}」
                  </li>
                ))}
                {usage?.scenarioSteps.map((s) => (
                  <li key={`${s.scenarioId}-${s.stepOrder}`} className="text-ink-secondary">
                    シナリオ「{s.scenarioName}」の{s.stepOrder + 1}番目
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={
                template.messageType === 'carousel'
                  ? `/templates/carousel?id=${id}`
                  : `/templates/edit?id=${id}`
              }
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors"
            >
              編集する
            </Link>
            <button
              onClick={remove}
              className="text-danger hover:bg-danger-bg rounded-control px-4 py-2 text-sm font-medium"
            >
              削除する
            </button>
            <Link
              href="/templates"
              className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium"
            >
              一覧へ戻る
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TemplateDetailPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <TemplateDetailInner />
    </Suspense>
  )
}
