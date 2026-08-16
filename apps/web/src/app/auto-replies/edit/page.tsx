'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import EditDialog, { type AutoReplyDraft } from '@/components/auto-replies/edit-dialog'

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

  const [draft, setDraft] = useState<AutoReplyDraft | null>(null)
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; messageType: string; messageContent: string }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const tplRes = await api.templates.list()
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
          const res = await api.autoReplies.get(id)
          if (res.success) {
            setDraft({
              id: res.data.id,
              keyword: res.data.keyword,
              matchType: res.data.matchType,
              responseType: res.data.responseType,
              responseContent: res.data.responseContent,
              templateId: res.data.templateId,
              lineAccountId: res.data.lineAccountId,
              isActive: res.data.isActive,
              activeFrom: res.data.activeFrom,
              activeUntil: res.data.activeUntil,
              cooldownMinutes: res.data.cooldownMinutes,
              skipWhenOperatorActive: res.data.skipWhenOperatorActive,
              priority: res.data.priority,
              messageKinds: res.data.messageKinds,
            })
          } else {
            setError(res.error)
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
        setError('読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  return (
    <div>
      <Header
        title={id ? '自動応答を編集' : '自動応答を作る'}
        description="決めた言葉が届いたときに、自動で返します。"
      />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/auto-replies" className="hover:underline">
          自動応答
        </Link>
        <span className="mx-1.5">›</span>
        <span>{id ? '編集' : '作成'}</span>
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
          draft={draft}
          templates={templates}
          onClose={() => router.push('/auto-replies')}
          onSaved={() => router.push('/auto-replies')}
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
