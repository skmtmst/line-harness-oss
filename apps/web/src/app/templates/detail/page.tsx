'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import { usePageTitle } from '@/components/shell/page-chrome'

interface Usage {
  autoReplies: Array<{ id: string; keyword: string }>
  automations: Array<{ id: string; name: string; eventType: string }>
  scenarioSteps: Array<{ scenarioId: string; scenarioName: string; stepOrder: number }>
  reminderSteps: Array<{ reminderId: string; reminderName: string; stepId: string }>
  richMenuAreas: Array<{ groupId: string; groupName: string; pageName: string; areaId: string; label: string | null }>
  trackedLinks: Array<{ id: string; name: string }>
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
  usePageTitle(template?.name ?? null)

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

  const usageCount = usage
    ? usage.autoReplies.length
      + usage.automations.length
      + usage.scenarioSteps.length
      + usage.reminderSteps.length
      + usage.richMenuAreas.length
      + usage.trackedLinks.length
    : 0

  const remove = async () => {
    if (usageCount > 0) {
      setError(`${usageCount}か所で使用中です。下の使用先を差し替えてから削除してください。`)
      return
    }
    if (!confirm('このテンプレートを削除しますか？')) return
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
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          テンプレートが指定されていません。
          <Link href="/templates" className="text-accent ml-1 hover:underline">
            一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  const body = template?.messageContent ?? ''
  // 自動応答はキーワード、シナリオは「シナリオ名 ／ ステップN」で見せる。
  // どこを直せばよいかが、名前だけだと分からないため。
  const usageRows = [
    ...(usage?.autoReplies ?? []).map((u) => ({
      kind: '自動応答',
      name: u.keyword,
      href: '/auto-replies',
    })),
    ...(usage?.scenarioSteps ?? []).map((u) => ({
      kind: 'シナリオ配信',
      name: `${u.scenarioName} ／ ステップ${u.stepOrder}`,
      href: '/scenarios',
    })),
    ...(usage?.automations ?? []).map((u) => ({
      kind: 'オートメーション',
      name: u.name,
      href: '/automations',
    })),
    ...(usage?.reminderSteps ?? []).map((u) => ({
      kind: 'リマインダ',
      name: u.reminderName,
      href: `/reminders/edit?id=${u.reminderId}`,
    })),
    ...(usage?.richMenuAreas ?? []).map((u) => ({
      kind: 'リッチメニュー',
      name: `${u.groupName} ／ ${u.pageName}${u.label ? ` ／ ${u.label}` : ''}`,
      href: `/rich-menus/edit?id=${u.groupId}`,
    })),
    ...(usage?.trackedLinks ?? []).map((u) => ({
      kind: '流入リンク',
      name: u.name,
      href: `/inflow-links/detail?id=${u.id}`,
    })),
  ]

  return (
    <div>
      <div data-design="Head" className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav data-design="Crumb" className="text-ink-faint text-xs">
          <Link href="/templates" className="hover:underline">
            テンプレート
          </Link>
          <span className="mx-1.5">/</span>
          <span>詳細</span>
        </nav>
        <Button href={`/templates/edit?id=${id}`} variant="primary">
          テンプレートを編集
        </Button>
      </div>

      {error && <p className="text-danger mb-3 text-sm">{error}</p>}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : !template ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          このテンプレートは見つかりませんでした。
        </p>
      ) : (
        <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
          <div data-design="Left" className="min-w-0 flex-1 space-y-4">
            <section className="bg-canvas rounded-card border-hairline border p-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-ink text-sm font-semibold">本文</p>
                <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-[11px]">
                  {template.messageType === 'text' ? 'テキスト' : template.messageType}
                </span>
                {template.category && (
                  <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-[11px]">
                    {template.category}
                  </span>
                )}
              </div>
              <pre className="bg-canvas-sunken text-ink-secondary mt-3 overflow-x-auto rounded p-3 text-xs whitespace-pre-wrap">
                {body}
              </pre>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-5">
              <p className="text-ink text-sm font-semibold">どこから呼ばれているか</p>
              <p className="text-ink-faint mt-0.5 mb-3 text-xs">
                使われているテンプレートは、削除する前に差し替えが必要です。
              </p>
              {usageRows.length === 0 ? (
                <p className="text-ink-faint text-xs">どこからも呼ばれていません。</p>
              ) : (
                <ul className="divide-hairline divide-y">
                  {usageRows.map((u) => (
                    <li key={`${u.kind}-${u.name}`} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="text-ink-faint text-xs">{u.kind}</p>
                        <p className="text-ink truncate text-sm">{u.name}</p>
                      </div>
                      <Link href={u.href} className="text-accent shrink-0 text-xs hover:underline">
                        開く
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-ink-faint mt-3 text-xs leading-relaxed">
                送信済みの履歴は削除を止める使用先には含めません。送信時の内容は履歴側に残ります。
              </p>
            </section>

            <section className="border-danger-bg bg-canvas rounded-card border p-5">
              <p className="text-danger text-sm font-semibold">このテンプレートを削除する</p>
              <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                {usageCount > 0
                  ? `${usageCount}か所で使われています。先に上の使用先を差し替えてください。`
                  : 'どこからも呼ばれていないので、削除しても他の画面に影響しません。'}
              </p>
              <button
                onClick={() => void remove()}
                disabled={usageCount > 0}
                title={usageCount > 0 ? '使用先を差し替えると削除できます' : undefined}
                className="text-danger hover:bg-danger-bg rounded-control mt-3 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
              >
                {usageCount > 0 ? '使用中のため削除できません' : 'テンプレートを削除'}
              </button>
            </section>
          </div>

          <div data-design="Right" className="w-full shrink-0 space-y-4 xl:w-80">
            <section className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink text-sm font-semibold">届き方</p>
              <p className="text-ink-faint mt-0.5 mb-2 text-xs">お客様の画面での見え方です。</p>
              <div className="bg-canvas-sunken rounded-card p-3">
                <p className="text-ink-faint mb-1 text-xs">然-NEN-</p>
                <p className="text-ink rounded-2xl bg-white px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
                  {body}
                </p>
              </div>
            </section>

            <section className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink text-sm font-semibold">このテンプレートについて</p>
              <dl className="mt-2 space-y-1.5 text-xs">
                <Row label="分類" value={template.category || '未分類'} />
                <Row
                  label="種類"
                  value={template.messageType === 'text' ? 'テキスト' : template.messageType}
                />
                <Row label="文字数" value={`${body.length}文字`} />
                {/* 作成日・更新日を API が返していない。 */}
                <Row label="作成" value="—" />
                <Row label="最終更新" value="—" />
                <Row label="使われている数" value={`${usageCount}か所`} />
              </dl>
            </section>

            <Link
              href="/templates"
              className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken block border px-4 py-2 text-center text-sm font-medium"
            >
              一覧へ戻る
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-faint shrink-0">{label}</dt>
      <dd className="text-ink min-w-0 truncate text-right">{value}</dd>
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
