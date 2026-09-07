'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import EditDialog, { toVersionDraft, type AutoReplyDraft } from '@/components/auto-replies/edit-dialog'

/**
 * 自動応答の編集を、URL で開けるようにする。
 *
 * 中身は一覧で使っているダイアログをそのまま出す。編集の中身を2つ持つと、
 * 片方だけ直したときに食い違う。
 */
function AutoReplyEditInner() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id')
  const requestedStep = params.get('step')
  const step = requestedStep === 'trigger' || requestedStep === 'response' ? requestedStep : 'basic'
  const stepLabel = step === 'basic' ? '基本設定' : step === 'trigger' ? 'どんなときに動くか' : '何を返すか'
  usePageTitle(`自動応答ルールを作成・${stepLabel}`)

  const [draft, setDraft] = useState<AutoReplyDraft | null>(null)
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; messageType: string; messageContent: string }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [tplRes, draftRes, liveRes] = await Promise.all([
          api.templates.list(),
          id ? api.autoReplies.getDraft(id) : Promise.resolve(null),
          id ? api.autoReplies.get(id).catch(() => null) : Promise.resolve(null),
        ])
        if (!active) return
        if (tplRes.success) {
          setTemplates(
            tplRes.data.map((t) => ({
              id: t.id,
              name: t.name,
              messageType: t.messageType,
              messageContent: t.messageContent,
            })),
          )
        }
        if (id) {
          if (draftRes?.success) {
            const [conflictRes, summaryRes] = await Promise.all([
              api.autoReplies.conflicts(id).catch(() => null),
              api.autoReplies.summary(draftRes.data.settings.lineAccountId).catch(() => null),
            ])
            if (!active) return
            setDraft(toVersionDraft(draftRes.data, {
              isActive: liveRes?.success ? liveRes.data.isActive : true,
              conflictAttentionCount: conflictRes?.success ? conflictRes.data.conflicts.length : null,
              receiveSourceCounts: summaryRes?.success ? summaryRes.data.receiveSourceCounts : null,
            }))
          } else {
            setError(draftRes?.error ?? '下書きを読み込めませんでした')
          }
        } else {
          setDraft({
            keyword: '',
            matchType: 'exact',
            responseType: 'text',
            responseContent: '',
            templateId: null,
            lineAccountId: null,
            isActive: true,
            priority: 0,
            messageKinds: null,
          })
        }
      } catch {
        if (active) setError('読み込みに失敗しました')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [id])

  return (
    <div>
      <nav className="mb-4 text-xs">
        <Link href="/auto-replies" className="text-action font-semibold hover:underline">
          ← 自動応答一覧
        </Link>
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
      ) : draft ? (
        <EditDialog
          page
          step={step}
          draft={draft}
          templates={templates}
          onClose={() => router.push('/auto-replies')}
          onSaved={() => router.push('/auto-replies')}
          onStepChange={(nextStep) => {
            const query = new URLSearchParams()
            if (id) query.set('id', id)
            query.set('step', nextStep)
            router.replace(`/auto-replies/edit?${query.toString()}`)
          }}
        />
      ) : null}
    </div>
  )
}

export default function AutoReplyEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <AutoReplyEditInner />
    </Suspense>
  )
}
