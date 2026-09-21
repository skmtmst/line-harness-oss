'use client'

import { useState } from 'react'
import { api, type OpsKnowledgeArticle, type OpsKnowledgeReference, type OpsSupportDetail } from '@/lib/api'
import { opsCall } from './ops-ui'
import KnowledgeEditor from './knowledge-editor'
import Button from '@/components/shared/button'
import NoteBar from '@/components/shared/note-bar'

/** Approved V6 37-6-C: automatic generation is separate from explicit human approval. */
export function TicketKnowledge({ detail, onRefresh }: { detail: OpsSupportDetail; onRefresh: () => void }) {
  const [article, setArticle] = useState<OpsKnowledgeArticle | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = detail.knowledge?.article
  const job = detail.knowledge?.job
  if (detail.ticket.stage !== 'resolved' && detail.ticket.stage !== 'closed') return null
  const open = async () => {
    if (!current) return
    setBusy(true); setError('')
    const res = await opsCall(api.ops.knowledge.article(current.id))
    setBusy(false)
    if (res.success) setArticle(res.data)
    else setError(res.error || '読み込めませんでした')
  }
  const retry = async () => {
    setBusy(true); setError('')
    const res = await opsCall(api.ops.knowledge.retry(detail.ticket.id))
    setBusy(false)
    if (res.success) onRefresh()
    else setError(res.error || '再試行できませんでした')
  }
  return <section className="grid gap-2" aria-label="ナレッジの確認">
    <NoteBar>{current?.sourceCurrent
      ? current.reviewState === 'approved' && current.status === 'active' ? '確認済みの記事をナレッジに保存しています。' : '自動確認した下書きです。解決の根拠と内容を確認し、承認するまで AI の返信には使われません。'
      : job?.status === 'failed' ? '下書きを作れませんでした。時間をおいて再試行できます。'
        : '解決した内容を自動で確認します。根拠が足りない場合は「要確認」になります。承認前の記事は AI の返信に使われません。'}</NoteBar>
    <div className="flex justify-end gap-2">
      {current && <Button data-design-node="rY1Kc" size="field" disabled={busy} onClick={() => void open()}>下書きを確認</Button>}
      {job?.status === 'failed' && <Button size="field" disabled={busy} onClick={() => void retry()}>もう一度試す</Button>}
    </div>
    {error && <p role="alert" className="text-caption text-status-danger">{error}</p>}
    {article && <KnowledgeEditor key={article.id} article={article} onClose={() => setArticle(null)} onSaved={onRefresh} />}
  </section>
}

/** V6 37-6-A l87aC. Feedback only concerns references actually used by this draft. */
export function KnowledgeReferences({ references, requestId, busy, onExclude }: {
  references: OpsKnowledgeReference[]; requestId: string; busy: boolean; onExclude: (id: string) => void
}) {
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [article, setArticle] = useState<OpsKnowledgeArticle | null>(null)
  const vote = async (id: string, value: 'helpful' | 'unhelpful') => {
    setPending(true); setError('')
    const res = await opsCall(api.ops.knowledge.feedback(id, requestId, value))
    setPending(false)
    if (res.success) setFeedback(state => ({ ...state, [id]: value }))
    else setError(res.error || '保存できませんでした')
  }
  const open = async (id: string) => {
    setPending(true); setError('')
    const res = await opsCall(api.ops.knowledge.article(id))
    setPending(false)
    if (res.success) setArticle(res.data)
    else setError(res.error || '読み込めませんでした')
  }
  if (!references.length) return null
  return <section data-design-node="l87aC" className="grid gap-2" aria-label="参考にした記事">
    <h4 className="text-caption font-bold text-ink">参考にした記事（{references.length} 件）</h4>
    {references.map(ref => <div key={`${ref.id}-${ref.version}`} className="flex flex-wrap items-center gap-2">
      <Button className="min-w-0 flex-1 truncate text-accent-deep" size="field" disabled={busy || pending} onClick={() => void open(ref.id)}>{ref.title}</Button>
      <Button size="field" disabled={busy || pending} aria-pressed={feedback[ref.id] === 'helpful'} onClick={() => void vote(ref.id, 'helpful')}>役に立った</Button>
      <Button size="field" disabled={busy || pending} aria-pressed={feedback[ref.id] === 'unhelpful'} onClick={() => void vote(ref.id, 'unhelpful')}>立たなかった</Button>
      <Button size="field" disabled={busy || pending} onClick={() => onExclude(ref.id)}>外して作り直す</Button>
    </div>)}
    {error && <p role="alert" className="text-caption text-status-danger">{error}</p>}
    {article && <KnowledgeEditor key={article.id} article={article} onClose={() => setArticle(null)} onSaved={() => setArticle(null)} />}
  </section>
}
