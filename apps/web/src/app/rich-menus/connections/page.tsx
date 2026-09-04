'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CircleAlert, CircleCheck, CornerUpLeft } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import type { RichMenuAreaResponse } from '@/lib/api'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { analyzeConnections, type ConnectionPage } from './connection-analysis'

type RichMenuGroup = {
  id: string
  accountId: string
  name: string
  status: 'draft' | 'published'
  defaultPageId: string | null
  pages: Array<ConnectionPage & { areas: RichMenuAreaResponse[] }>
}

function ConnectionsContent() {
  const groupId = useSearchParams().get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const activeAccountIdRef = useRef(selectedAccountId)
  const requestGenerationRef = useRef(0)
  const [group, setGroup] = useState<RichMenuGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  usePageTitle(group ? `${group.name}・切替のつながり` : '切替メニューのつながり')

  activeAccountIdRef.current = selectedAccountId

  const load = useCallback(async () => {
    if (!groupId || !selectedAccountId) {
      setLoading(false)
      return
    }
    const accountId = selectedAccountId
    const requestGeneration = ++requestGenerationRef.current
    setLoading(true)
    setGroup(null)
    setError('')
    try {
      const response = await api.richMenuGroups.get(groupId)
      if (
        activeAccountIdRef.current !== accountId
        || requestGenerationRef.current !== requestGeneration
      ) return
      if (!response.success) throw new Error(response.error)
      setGroup(response.data as RichMenuGroup)
    } catch {
      if (
        activeAccountIdRef.current !== accountId
        || requestGenerationRef.current !== requestGeneration
      ) return
      setGroup(null)
      setError('切替のつながりを表示できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      if (
        activeAccountIdRef.current === accountId
        && requestGenerationRef.current === requestGeneration
      ) setLoading(false)
    }
  }, [groupId, selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
  }, [accountLoading, load])

  const analysis = useMemo(
    () => group ? analyzeConnections(group.pages, group.defaultPageId) : null,
    [group],
  )

  if (accountLoading || loading) {
    return <ListState kind="loading" title="切替のつながりを読み込んでいます" />
  }
  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINE公式アカウントを選んでください" description="表示するアカウントを上の切替から選んでください。" />
  }
  if (!groupId) {
    return <ListState kind="empty" title="メニューを特定できませんでした" action={<Button href="/rich-menus">メニュー一覧へ戻る</Button>} />
  }
  if (error || !group || !analysis) {
    return <ListState kind="error" title="切替のつながりを表示できませんでした" description={error} onRetry={() => void load()} />
  }
  if (group.accountId !== selectedAccountId) {
    return <ListState kind="forbidden" title="選択中のアカウントでは表示できません" description="このメニューが所属するLINE公式アカウントへ切り替えてください。" />
  }

  const pages = [...group.pages].sort((a, b) => a.orderIndex - b.orderIndex)
  const pageName = new Map(pages.map((page) => [page.id, page.name]))
  const issueCount = analysis.missingTargetEdges.length
    + analysis.unreachablePageIds.size
    + analysis.cannotReturnPageIds.size
    + analysis.selfOnlyPageIds.size

  if (analysis.edges.length === 0) {
    return (
      <div data-design-node="NXdDk" className="space-y-4 pb-10">
        <NoteBar>ページを切り替えるボタンを作ると、ここで行き先と戻り道を確認できます。</NoteBar>
        <ListState
          kind="empty"
          title="切替のつながりはありません"
          description="このメニューには、別ページへ切り替えるボタンがまだありません。"
          action={<Button href={`/rich-menus/edit?id=${encodeURIComponent(group.id)}`}>メニューのボタンを編集</Button>}
        />
        <div className="flex justify-center"><Button href="/rich-menus">メニュー一覧へ戻る</Button></div>
      </div>
    )
  }

  return (
    <div data-design-node="DIUbO" className="space-y-4 pb-10">
      <NoteBar tone={issueCount > 0 ? 'warn' : 'info'}>
        {issueCount > 0
          ? `${issueCount}件の確認事項があります。公開する前に、入口からの行き先と戻り道を確認してください。`
          : '入口からすべてのページへ進め、どのページからも入口へ戻れます。'}
      </NoteBar>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="ページ" value={`${pages.length}枚`} />
        <Summary label="切替ボタン" value={`${analysis.edges.length}件`} />
        <Summary label="確認事項" value={`${issueCount}件`} danger={issueCount > 0} />
        <Summary label="公開状態" value={group.status === 'published' ? '公開中' : '下書き'} />
      </section>

      <section className="rounded-card border-hairline bg-canvas border p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-ink text-sm font-bold">ページと切替先</p>
            <p className="text-ink-faint mt-1 text-xs">矢印は保存済みの切替ボタンです。番号や内部IDは表示しません。</p>
          </div>
          <Button href={`/rich-menus/edit?id=${encodeURIComponent(group.id)}`}>メニューのボタンを編集</Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {pages.map((page) => {
            const outgoing = analysis.edges.filter((edge) => edge.fromPageId === page.id)
            const hasMissingTarget = analysis.missingTargetEdges.some((edge) => edge.fromPageId === page.id)
            const issues = [
              hasMissingTarget && '行き先を確認できないボタンがあります',
              analysis.unreachablePageIds.has(page.id) && '入口から進めません',
              analysis.cannotReturnPageIds.has(page.id) && '入口へ戻れません',
              analysis.selfOnlyPageIds.has(page.id) && '同じページだけを回ります',
            ].filter(Boolean) as string[]
            return (
              <article key={page.id} className="rounded-card border-hairline border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-ink truncate text-sm font-bold" title={page.name}>{page.name}</p>
                    <p className="text-ink-faint mt-1 text-xs">
                      {page.id === analysis.entryPageId ? '入口のページ' : page.lineRichmenuId ? 'LINEへ公開済み' : 'LINEへ未公開'}
                    </p>
                  </div>
                  {issues.length === 0 ? <CircleCheck className="text-accent" size={20} aria-label="つながりに問題なし" /> : <CircleAlert className="text-danger" size={20} aria-label="確認事項あり" />}
                </div>

                <div className="mt-3 space-y-2">
                  {outgoing.length === 0 ? (
                    <p className="text-ink-faint text-xs">別ページへ切り替えるボタンはありません。</p>
                  ) : outgoing.map((edge, index) => {
                    const target = edge.targetPageId ? pageName.get(edge.targetPageId) : null
                    return (
                      <div key={`${edge.fromPageId}-${edge.targetPageId ?? 'missing'}-${index}`} className="bg-canvas-sunken rounded-control flex min-w-0 items-center gap-2 px-3 py-2 text-xs">
                        <span className="text-ink-secondary min-w-0 flex-1 truncate" title={edge.label}>{edge.label}</span>
                        <ArrowRight className="text-ink-faint shrink-0" size={14} aria-hidden="true" />
                        <span className={target ? 'text-ink min-w-0 flex-1 truncate font-medium' : 'text-danger min-w-0 flex-1 font-medium'} title={target ?? undefined}>
                          {target ?? '行き先を確認できません'}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {issues.length > 0 ? (
                  <ul className="text-danger mt-3 space-y-1 text-xs">
                    {issues.map((issue) => <li key={issue}>・{issue}</li>)}
                  </ul>
                ) : page.id !== analysis.entryPageId ? (
                  <p className="text-accent mt-3 flex items-center gap-1 text-xs"><CornerUpLeft size={13} aria-hidden="true" />入口へ戻れます</p>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      {analysis.missingTargetEdges.length > 0 ? (
        <section className="border-danger/30 bg-danger-bg rounded-card border p-4">
          <p className="text-danger text-sm font-bold">行き先を確認できないボタン</p>
          <ul className="text-danger mt-2 space-y-1 text-xs">
            {analysis.missingTargetEdges.map((edge, index) => (
              <li key={`${edge.fromPageId}-${index}`}>
                {pageName.get(edge.fromPageId) ?? '名前未取得'}の「{edge.label}」
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3">
        <Button href="/rich-menus">メニュー一覧へ戻る</Button>
        <Button variant="primary" href={`/rich-menus/edit?id=${encodeURIComponent(group.id)}`}>切替を修正</Button>
      </div>
    </div>
  )
}

function Summary({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-card border-hairline bg-canvas border p-4">
      <p className="text-ink-faint text-xs">{label}</p>
      <p className={danger ? 'text-danger mt-1 text-xl font-bold' : 'text-ink mt-1 text-xl font-bold'}>{value}</p>
    </div>
  )
}

export default function RichMenuConnectionsPage() {
  return (
    <Suspense fallback={<ListState kind="loading" title="切替のつながりを読み込んでいます" />}>
      <ConnectionsContent />
    </Suspense>
  )
}
