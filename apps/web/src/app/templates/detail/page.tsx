'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { usePageTitle } from '@/components/shell/page-chrome'
import { templateDeleteDescription } from '../template-delete-message'

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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

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

  /**
   * 削除の確認。ブラウザの `confirm()` では、何が止まり・何が残り・
   * 戻せるのかを本文で読ませられず、画像比較にも写らなかった。
   * 共通の `ConfirmDialog` へ移した（設計 `H2S1T4`）。
   */
  const remove = async () => {
    // 押している間は受け付けない。二度押しの2回目は404になり、
    // 消えているのに「削除できませんでした」と出る。
    if (deleting) return
    setDeleting(true)
    setDeleteError('')
    setError('')
    try {
      const res = await api.templates.delete(id)
      if (!res.success) throw new Error(res.error)
      setConfirmOpen(false)
      router.push('/templates')
    } catch {
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      setDeleteError('このテンプレートを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
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
  ]

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/templates" className="hover:underline">
          テンプレート
        </Link>
        <span className="mx-1.5">/</span>
        <span>詳細</span>
      </nav>

      <div data-design="Head">
        <Header
          title={template?.name ?? 'テンプレートの詳細'}
          description="本文と、このテンプレートがどこで使われているかを確認できます。"
          action={
            <div className="flex flex-wrap gap-2">
              {/* 既存を種にして新しく作る口が無い。 */}
              <button
                disabled
                title="複製は準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                複製
              </button>
              <Link
                href={`/templates/edit?id=${id}`}
                className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium"
              >
                編集
              </Link>
            </div>
          }
        />
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
              {/* 一斉配信とリマインダからの参照は、usages API が返さない。 */}
              <p className="text-ink-faint mt-3 text-xs leading-relaxed">
                一斉配信・リマインダからの参照は、まだ数えられません。ここに出るのは自動応答とシナリオ配信だけです。
              </p>
            </section>

            <section className="border-danger-bg bg-canvas rounded-card border p-5">
              <p className="text-danger text-sm font-semibold">このテンプレートを削除する</p>
              <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                {usageCount > 0
                  ? `${usageCount}か所で使われています。削除すると、その箇所の本文が空になります。`
                  : 'どこからも呼ばれていないので、削除しても他の画面に影響しません。'}
              </p>
              <button
                onClick={() => { setDeleteError(''); setConfirmOpen(true) }}
                className="text-danger hover:bg-danger-bg rounded-control mt-3 px-4 py-2 text-sm font-medium"
              >
                削除する
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

      <ConfirmDialog
        open={confirmOpen}
        title={`テンプレート「${template?.name ?? ''}」を削除しますか？`}
        description={templateDeleteDescription(usageCount)}
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void remove()}
        onCancel={() => {
          if (deleting) return
          setConfirmOpen(false)
          setDeleteError('')
        }}
      >
        {/* 使用箇所は自動応答とシナリオ配信しか数えられていない。
            0か所と出ていても「どこからも使われていない」とは言い切れない。 */}
        <p className="text-ink-faint text-xs leading-relaxed">
          一斉配信・リマインダからの参照は、まだ数えられません。上の数に入っていません。
        </p>
      </ConfirmDialog>
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
  usePageTitle('テンプレートの詳細')
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <TemplateDetailInner />
    </Suspense>
  )
}
