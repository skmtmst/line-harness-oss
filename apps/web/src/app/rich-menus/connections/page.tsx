'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
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

  usePageTitle('切替メニューのつながり')

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
  const missingDirectReturn = pages.filter((page) =>
    page.id !== analysis.entryPageId
    && !analysis.edges.some((edge) => edge.fromPageId === page.id && edge.targetPageId === analysis.entryPageId),
  )

  if (analysis.edges.length === 0) {
    return (
      <div data-design-node="NXdDk" className="space-y-5 pb-24">
        <ConnectionHeading group={group} />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="border-hairline bg-canvas rounded-card min-h-[520px] border p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-ink text-base font-bold">つながりの図</h2><p className="text-ink-faint mt-1 text-xs">切替先を足すと、ここに「どのメニューからどこへ移れるか」が出ます</p></div>
              <Button href={`/rich-menus/edit?id=${encodeURIComponent(group.id)}`}>切替先のメニューを追加</Button>
            </div>
            <div className="mt-16 flex min-h-64 flex-col items-center justify-center rounded-card border border-dashed border-hairline bg-canvas-sunken px-6 text-center">
              <p className="text-ink text-lg font-bold">まだ切替先がありません</p>
              <p className="text-ink-faint mt-2 max-w-md text-sm leading-6">このメニューだけで動きます。切替先を足すと、タブでメニューを行き来できます。</p>
              <Button className="mt-5" variant="primary" href={`/rich-menus/edit?id=${encodeURIComponent(group.id)}`}>切替先のメニューを追加</Button>
            </div>
          </section>
          <ConnectionAside />
        </div>
        <ConnectionFooter status="切替先はまだありません" groupId={group.id} />
      </div>
    )
  }

  return (
    <div data-design-node="DIUbO" className="space-y-5 pb-24">
      <ConnectionHeading group={group} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="border-hairline bg-canvas rounded-card border p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-ink text-base font-bold">つながりの図</h2><p className="text-ink-faint mt-1 text-xs">緑のタブが「別のメニューへ移る」ボタン</p></div><Button href={`/rich-menus/edit?id=${encodeURIComponent(group.id)}`}>切替先のメニューを追加（最大10枚）</Button></div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {pages.map((page, index) => {
                const outgoing = analysis.edges.filter((edge) => edge.fromPageId === page.id)
                const lacksReturn = missingDirectReturn.some((item) => item.id === page.id)
                return <article key={page.id} className={`rounded-card border p-4 ${lacksReturn ? 'border-danger bg-danger-bg/30' : 'border-hairline'}`}><div className="flex items-center gap-3"><span className="bg-canvas-sunken flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">{index + 1}</span><strong className="text-ink truncate text-sm" title={page.name}>{page.name}</strong></div><div className="mt-4 grid grid-cols-3 gap-1">{['A','B','C'].map((tab, tabIndex) => { const edge = outgoing[tabIndex]; return <div key={tab} className={`rounded-control border px-2 py-2 text-center text-xs font-bold ${edge ? 'border-accent bg-accent/10 text-accent' : 'border-hairline text-ink-faint'}`}>{tab}</div> })}</div>{lacksReturn ? <p className="text-danger mt-3 text-xs font-semibold">トップへ戻るタブがありません</p> : <p className="text-accent mt-3 flex items-center gap-1 text-xs"><CircleCheck size={13} />戻り道を確認済み</p>}</article>
              })}
            </div>
            {missingDirectReturn.length > 0 ? <NoteBar tone="warn">「{missingDirectReturn.map((page) => page.name).join('」「')}」からトップへ戻るタブがありません。お客さまが戻れなくなります。</NoteBar> : null}
          </section>

          <section className="border-hairline bg-canvas rounded-card overflow-hidden border shadow-sm">
            <div className="px-5 py-4"><h2 className="text-ink text-sm font-bold">それぞれのメニューのタブ</h2></div>
            <table className="w-full table-fixed text-sm"><thead className="bg-canvas-sunken text-ink-secondary text-xs"><tr><th className="px-4 py-3 text-left">メニュー</th><th className="px-4 py-3 text-left">タブA</th><th className="px-4 py-3 text-left">タブB</th><th className="px-4 py-3 text-left">タブC</th></tr></thead><tbody className="divide-y divide-hairline">{pages.map((page) => { const outgoing = analysis.edges.filter((edge) => edge.fromPageId === page.id); return <tr key={page.id}><td className="px-4 py-3 font-semibold">{page.name}</td>{[0,1,2].map((index) => { const edge = outgoing[index]; const target = edge?.targetPageId ? pageName.get(edge.targetPageId) : null; return <td key={index} className={`px-4 py-3 text-xs ${edge && !target ? 'text-danger font-semibold' : 'text-ink-secondary'}`}>{target ? `→ ${target}` : index === pages.indexOf(page) ? '（このページ）' : '未設定'}</td> })}</tr> })}</tbody></table>
          </section>
        </div>
        <ConnectionAside />
      </div>
      <ConnectionFooter status={`つながりに問題が ${Math.max(issueCount, missingDirectReturn.length)}件 あります`} groupId={group.id} />
    </div>
  )
}

function ConnectionHeading({ group }: { group: RichMenuGroup }) {
  return (
    <div>
      <nav className="text-ink-faint text-xs"><Link href="/rich-menus">リッチメニュー</Link><span className="mx-1.5">/</span>{group.name}</nav>
      <div className="mt-2 flex items-end justify-between gap-3"><div><h1 className="text-ink text-2xl font-bold">切替メニューのつながり</h1><p className="text-ink-secondary mt-1 text-sm">{group.name} <span className="bg-accent/10 text-accent ml-2 rounded px-2 py-0.5 text-xs font-semibold">切替メニュー</span></p></div></div>
    </div>
  )
}

function ConnectionAside() {
  return <aside className="space-y-4"><section className="border-hairline bg-canvas rounded-card border p-5 shadow-sm"><h2 className="text-ink text-sm font-bold">LINEプレビュー</h2><p className="text-ink-faint mt-1 text-xs">「商品を見る」を開いたとき</p><div className="mt-4 overflow-hidden rounded-[24px] border-4 border-slate-800 bg-[#eff5ef] p-3 shadow-inner"><div className="flex min-h-60 items-center justify-center text-xs text-slate-400">トーク画面</div><div className="grid grid-cols-3 gap-1 rounded-lg bg-white p-2 text-center text-xs font-semibold text-slate-700"><span>トップ</span><span className="bg-accent rounded px-2 py-1 text-white">商品</span><span>予約</span><span>新着</span><span>定番</span></div></div></section><section className="bg-warning-bg text-warning rounded-card p-5 text-xs leading-5"><h2 className="text-sm font-bold">切替メニューでよくある事故</h2><ul className="mt-2 space-y-1"><li>・戻るタブが無く、元のメニューに帰れない</li><li>・切替先が下書きのままで、押しても動かない</li><li>・切替先だけ「誰に出すか」が違う</li></ul></section></aside>
}

function ConnectionFooter({ status, groupId }: { status: string; groupId: string }) {
  return <div className="border-hairline bg-canvas fixed right-0 bottom-0 left-0 z-20 flex items-center justify-between border-t px-6 py-3 shadow-lg"><span className="text-ink-secondary text-sm">{status}</span><div className="flex gap-2"><Button href="/rich-menus">メニュー一覧へ</Button><Button variant="primary" href={`/rich-menus/edit?id=${encodeURIComponent(groupId)}`}>リッチメニューを保存</Button></div></div>
}

export default function RichMenuConnectionsPage() {
  return (
    <Suspense fallback={<ListState kind="loading" title="切替のつながりを読み込んでいます" />}>
      <ConnectionsContent />
    </Suspense>
  )
}
