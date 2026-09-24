'use client'

import { useState } from 'react'
import Link from 'next/link'
import { api, type OpsKnowledgeArticle, type OpsKnowledgeInput } from '@/lib/api'
import { opsCall } from './ops-ui'
import { KNOWLEDGE_KINDS, knowledgeArticleKind, knowledgeTime } from './knowledge-format'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import SelectField from '@/components/shared/select-field'
import { TextArea, TextField } from '@/components/shared/text-field'
import styles from './knowledge.module.css'

/** ★V6 37-11-A DHdsw / 37-11-B ZAOc7. Mount with key={article.id}. */
export default function KnowledgeEditor({ article: initial, onClose, onSaved }: {
  article: OpsKnowledgeArticle; onClose: () => void; onSaved: () => void
}) {
  const [article, setArticle] = useState(initial)
  const [form, setForm] = useState<OpsKnowledgeInput>({ title: initial.title, question: initial.question,
    answer: initial.answer, kind: initial.kind, keywords: initial.keywords })
  const [keywords, setKeywords] = useState(initial.keywords.join('、'))
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = initial.reviewState === 'approved' && initial.sourceCurrent
  const eligible = article.sourceCurrent && (article.articleKind === 'verified'
    ? article.reviewState === 'pending' && article.evidence.length >= 2
    : (article.reviewState === 'pending' || article.reviewState === 'needs_review'))
  const kindLabel = knowledgeArticleKind(article.articleKind)
  const canApprove = eligible && Boolean(form.question.trim()) && Boolean(form.answer.trim())
  const input = () => ({ ...form, keywords: keywords.split(/[、,\n]/).map(v => v.trim()).filter(Boolean) })
  const change = <K extends keyof OpsKnowledgeInput>(key: K, value: OpsKnowledgeInput[K]) => {
    setForm(f => ({ ...f, [key]: value })); setConfirmed(false)
  }
  const save = async (approve = false) => {
    if (approve && (!confirmed || !eligible)) return
    const value = input()
    if (!value.title.trim() || (eligible && (!value.question.trim() || !value.answer.trim()))) {
      setError('題名・質問・答えを入力してください'); return
    }
    setBusy(true); setError('')
    // Save first; approval has its own optimistic version + source checks. A failed
    // approval leaves a disabled draft, never an implicitly activated article.
    const saved = await opsCall(api.ops.knowledge.update(article.id, article.version, value))
    if (!saved.success) { setError(saved.error || '保存できませんでした'); setBusy(false); return }
    setArticle({ ...saved.data, sourceSubject: article.sourceSubject })
    if (approve) {
      const reviewed = await opsCall(api.ops.knowledge.review(article.id, { version: saved.data.version, action: 'approve', confirmed: true }))
      if (!reviewed.success) {
        setConfirmed(false); setError(reviewed.error || '承認できませんでした。元のやり取りを確認してください')
        setBusy(false); onSaved(); return
      }
    }
    setBusy(false); onSaved(); onClose()
  }
  const dismiss = async () => {
    setBusy(true); setError('')
    const res = await opsCall(api.ops.knowledge.review(article.id, { version: article.version, action: 'dismiss' }))
    setBusy(false)
    if (!res.success) { setError(res.error || '見送りにできませんでした'); return }
    onSaved(); onClose()
  }
  return <Dialog open title={editing ? '記事を直す' : '下書きの内容を確認'}
    designNode={editing ? 'ZAOc7' : 'DHdsw'} busy={busy} error={error} onCancel={onClose}
    footer={<div className={styles.footer}>
      <Button onClick={editing ? onClose : () => void dismiss()} disabled={busy}>{editing ? '保存せず閉じる' : '見送る'}</Button>
      <Button onClick={() => void save()} disabled={busy} variant={editing ? 'primary' : 'secondary'}>{editing ? '承認待ちで保存' : '下書き保存'}</Button>
      {!editing && <Button variant="primary" disabled={busy || !canApprove || !confirmed} onClick={() => void save(true)}>承認して有効にする</Button>}
    </div>}>
    <div className={styles.editor}>
      {/* ★V7: 緑は「正常」だけ。説明の帯は枠なしの info の小さい帯にする。 */}
      <div role="note" className="rounded-control bg-info-bg px-4 py-3 text-xs text-ink-secondary">{editing
        ? '変更を保存すると承認待ちに戻ります。再承認するまで、この記事は AI の返信に使われません。'
        : '自動で作成した下書きです。解決の根拠と記事案を確認してください。承認するまで AI の返信には使われません。'}</div>
      <div className={styles.sourceLine}>
        <p className={styles.source}>元の問い合わせ：{article.ticketNo == null ? '番号未取得' : `#MB-${String(article.ticketNo).padStart(4, '0')}`}{article.sourceSubject ? ` ${article.sourceSubject}` : ''}</p>
        <Chip data-design-node="aeReviewKind" tone={kindLabel.tone} className={styles.articleKindChip}>{kindLabel.label}</Chip>
      </div>
      {!editing && <section className={styles.evidence} data-design-node="mAjGu" aria-label="解決の根拠">
        <h3>解決の根拠</h3>
        {article.evidence.filter(e => e.role !== 'condition').map((e, i) => <p key={`${e.messageId}-${i}`}>
          <time dateTime={e.createdAt} title={e.createdAt}>{knowledgeTime(e.createdAt)}</time> {e.authorKind === 'ops' ? '担当者' : 'お客様'}：「{e.quote}」
        </p>)}
        {article.articleKind === 'verified'
          ? <p>適用条件：{article.evidence.filter(e => e.role === 'condition').map(e => e.quote).join('／') || '原文に明示なし'}。未確認の原因や途中の提案は記事に含めません。</p>
          : <p>回答例はお客様の成功確認を示すものではありません。質問と運営の回答内容を元のやり取りで確認してください。</p>}
        {(!eligible || article.reviewReason) && <p>{!article.sourceCurrent ? '元のやり取りが更新されています。この記事は承認できません。' : article.reviewReason}</p>}
        <Link href={`/ops/support?id=${encodeURIComponent(article.sourceRequestId)}`}>元のやり取りを開く →</Link>
      </section>}
      <label className={styles.field}><span>題名</span><TextField value={form.title} maxLength={120} disabled={busy} onChange={e => change('title', e.target.value)} /></label>
      <label className={styles.field}><span>質問</span><TextArea className={styles.question} value={form.question} maxLength={1000} disabled={busy} onChange={e => change('question', e.target.value)} /></label>
      <label className={styles.field}><span>答え</span><TextArea className={styles.answer} value={form.answer} maxLength={12000} disabled={busy} onChange={e => change('answer', e.target.value)} /></label>
      {!form.answer.trim() && article.articleKind === 'answer_example' && <p data-design-node="aeEmptyAnswerNote" className={styles.emptyAnswerNote}>運営の回答がありません。答えを書いて承認できます</p>}
      <label className={styles.field}><span>キーワード</span><TextField value={keywords} maxLength={480} disabled={busy} onChange={e => { setKeywords(e.target.value); setConfirmed(false) }} /></label>
      <label className={`${styles.field} ${styles.kind}`}><span>種類</span><SelectField options={KNOWLEDGE_KINDS} value={form.kind} disabled={busy} onChange={e => change('kind', e.target.value as OpsKnowledgeInput['kind'])} /></label>
      {!editing && <label className={styles.confirm} data-design-node="xNNWI">
        <input type="checkbox" checked={confirmed} disabled={busy || !eligible} onChange={e => setConfirmed(e.target.checked)} />
        {article.articleKind === 'verified'
          ? '解決策と結果を元のやり取りで確認しました'
          : '回答内容が正しいことを元のやり取りで確認しました'}
      </label>}
    </div>
  </Dialog>
}
