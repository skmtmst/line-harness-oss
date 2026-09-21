'use client'

import { useState } from 'react'
import { api, type OpsKnowledgeArticle, type OpsKnowledgeReference, type OpsSupportDetail } from '@/lib/api'
import { opsCall } from './ops-ui'
import KnowledgeEditor from './knowledge-editor'
import Button from '@/components/shared/button'
import NoteBar from '@/components/shared/note-bar'
import { BookOpen, ArrowRight } from 'lucide-react'
import styles from './knowledge.module.css'

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

/** Approved V6 37-6-D LT8m5. Votes describe fit for this reply, not article correctness. */
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
    if (res.success) setFeedback(state => ({ ...state, [`${id}:${references.find(ref => ref.id === id)?.version}`]: value }))
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
  return <section className="grid gap-2" aria-label="今回の回答の根拠">
    {references.map(ref => <div data-design-node="LT8m5" key={`${ref.id}-${ref.version}`} className={styles.referenceRow}>
      <BookOpen aria-hidden="true" className={styles.referenceIcon} />
      <button data-design-node="secaz" className={styles.referenceLink} title={`回答の根拠：${ref.title}`} disabled={busy || pending} onClick={() => void open(ref.id)}><span>回答の根拠：{ref.title}</span><ArrowRight aria-hidden="true" /></button>
      <Button data-design-node="HXQxY" className={styles.referenceFits} size="field" disabled={busy || pending} aria-pressed={feedback[`${ref.id}:${ref.version}`] === 'helpful'} onClick={() => void vote(ref.id, 'helpful')}>今回の回答に合う</Button>
      <Button data-design-node="NeS62" className={styles.referenceUnfit} size="field" disabled={busy || pending} aria-pressed={feedback[`${ref.id}:${ref.version}`] === 'unhelpful'} onClick={() => void vote(ref.id, 'unhelpful')}>今回には合わない</Button>
      <Button data-design-node="ACP9c" className={styles.referenceRegenerate} size="field" disabled={busy || pending} onClick={() => onExclude(ref.id)}>除外して回答を作り直す</Button>
    </div>)}
    {error && <p role="alert" className="text-caption text-status-danger">{error}</p>}
    {article && <KnowledgeEditor key={article.id} article={article} onClose={() => setArticle(null)} onSaved={() => setArticle(null)} />}
  </section>
}
