'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import StickyBar from '@/components/shared/sticky-bar'
import CampaignEditor from './campaign-editor'
import { useAccount } from '@/contexts/account-context'

interface Column {
  id: string
  slug: string
  title: string
  intro_text: string | null
  published_at: string | null
}

/**
 * NENコラムに添える紹介文の編集。
 *
 * コラムの本文はEC側にある。ここで直せるのは「LINEで配るときに前に付ける
 * 一言」だけ。本文まで直せるように見せると、直したのに反映されない、
 * という食い違いになる。
 */
function NenColumnEditInner() {
  const params = useSearchParams()
  const campaignKey = params.get('key') ?? ''
  const { selectedAccountId } = useAccount()

  const [columns, setColumns] = useState<Column[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // ?key= が付いていれば、その配信そのものを編集する（設計 9-1-1）。
  // 付いていないときは、EC側のコラムに添える紹介文の一覧を出す。

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    if (!selectedAccountId) {
      setColumns([])
      setLoading(false)
      setError('LINEアカウントを選んでください')
      return
    }
    try {
      const res = await api.nenColumns.list(selectedAccountId)
      if (res.success) {
        setColumns(res.data)
        const next: Record<string, string> = {}
        for (const c of res.data) next[c.id] = c.intro_text ?? ''
        setDrafts(next)
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (column: Column) => {
    if (!selectedAccountId) return
    setSavingId(column.id)
    setError('')
    setNotice('')
    try {
      const res = await api.nenColumns.updateMessage(selectedAccountId, column.id, drafts[column.id] ?? '')
      if (!res.success) {
        setError(res.error)
        return
      }
      setNotice(`「${column.title}」の紹介文を保存しました`)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingId(null)
    }
  }

  if (campaignKey) return <CampaignEditor campaignKey={campaignKey} />

  return (
    <div>
      <Header
        title="NENコラムを編集する"
        description="LINEで配るときに前に付ける一言を決めます。"
      />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/nen-campaigns" className="hover:underline">
          フォロー配信
        </Link>
        <span className="mx-1.5">›</span>
        <span>コラムの編集</span>
      </nav>

      <p className="text-ink-secondary mb-4 text-sm">
        コラムの本文はEC側にあります。ここで直せるのは、LINEで配るときに前に付ける一言だけです。
      </p>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}
      {notice && <p className="text-success mb-4 text-sm">{notice}</p>}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : columns.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          コラムがまだありません。EC側で公開されると、ここに出ます。
        </div>
      ) : (
        <div className="max-w-3xl space-y-3">
          {columns.map((column) => (
            <div key={column.id} className="bg-canvas rounded-card border-hairline border p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-ink text-sm font-medium">{column.title}</p>
                <p className="text-ink-faint text-xs">
                  {column.published_at
                    ? new Date(column.published_at).toLocaleDateString('ja-JP')
                    : '未公開'}
                </p>
              </div>
              <textarea
                rows={3}
                value={drafts[column.id] ?? ''}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [column.id]: e.target.value }))}
                placeholder="例: 今週のコラムです。よろしければご覧ください。"
                aria-label={`${column.title}の紹介文`}
                className="border-hairline rounded-control w-full resize-y border px-3 py-2 text-sm"
              />
              <StickyBar
                className="mt-2"
                actions={(
                <button
                  onClick={() => save(column)}
                  disabled={savingId === column.id || (drafts[column.id] ?? '') === (column.intro_text ?? '')}
                  className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  {savingId === column.id ? '保存中...' : '保存'}
                </button>
                )}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function NenColumnEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <NenColumnEditInner />
    </Suspense>
  )
}
