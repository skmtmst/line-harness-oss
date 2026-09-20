'use client'

import { useState } from 'react'
import Link from 'next/link'
import { api, type OpsKnowledgeArticle, type OpsKnowledgeInput } from '@/lib/api'
import { opsCall } from './ops-ui'
import { KNOWLEDGE_KINDS } from './knowledge-format'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import NoteBar from '@/components/shared/note-bar'
import SelectField from '@/components/shared/select-field'
import { TextArea, TextField } from '@/components/shared/text-field'
import styles from './knowledge.module.css'

/** ★V6 37-11-A twq67 / 37-11-B MGgKT. Mount with key={article.id}. */
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
  const eligible = article.sourceCurrent && article.reviewState === 'pending' && article.evidence.length >= 2
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
    setArticle(saved.data)
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
    designNode={editing ? 'MGgKT' : 'twq67'} busy={busy} error={error} onCancel={onClose}
    footer={<div className={styles.footer}>
      <Button onClick={editing ? onClose : () => void dismiss()} disabled={busy}>{editing ? '保存せず閉じる' : '見送る'}</Button>
      <Button onClick={() => void save()} disabled={busy} variant={editing ? 'primary' : 'secondary'}>{editing ? '承認待ちで保存' : '下書き保存'}</Button>
      {!editing && <Button variant="primary" disabled={busy || !eligible || !confirmed} onClick={() => void save(true)}>承認して有効にする</Button>}
    </div>}>
    <div className={styles.editor}>
      <NoteBar className={styles.note}>{editing
        ? '変更を保存すると承認待ちに戻ります。再承認するまで、この記事は AI の返信に使われません。'
        : '自動で作成した下書きです。解決の根拠と記事案を確認してください。承認するまで AI の返信には使われません。'}</NoteBar>
      <p className={styles.source}>元の問い合わせ：#MB-{String(article.ticketNo ?? '').padStart(4, '0')}</p>
      {!editing && <section className={styles.evidence} data-design-node="JHOza" aria-label="解決の根拠">
        <h3>解決の根拠</h3>
        {article.evidence.map((e, i) => <p key={`${e.messageId}-${i}`}>
          <time dateTime={e.createdAt}>{e.createdAt.replace('T', ' ').slice(0, 16)}</time> {e.authorKind === 'ops' ? '担当者' : 'お客様'}：{e.quote}
        </p>)}
        {(!eligible || article.reviewReason) && <p>{!article.sourceCurrent ? '元のやり取りが更新されています。この記事は承認できません。' : article.reviewReason}</p>}
        <Link href={`/ops/support?id=${encodeURIComponent(article.sourceRequestId)}`}>元のやり取りを開く →</Link>
      </section>}
      <label className={styles.field}><span>題名</span><TextField value={form.title} maxLength={120} disabled={busy} onChange={e => change('title', e.target.value)} /></label>
      <label className={styles.field}><span>質問</span><TextArea className={styles.question} value={form.question} maxLength={1000} disabled={busy} onChange={e => change('question', e.target.value)} /></label>
      <label className={styles.field}><span>答え</span><TextArea className={styles.answer} value={form.answer} maxLength={6000} disabled={busy} onChange={e => change('answer', e.target.value)} /></label>
      <label className={styles.field}><span>キーワード</span><TextField value={keywords} maxLength={480} disabled={busy} onChange={e => { setKeywords(e.target.value); setConfirmed(false) }} /></label>
      <label className={`${styles.field} ${styles.kind}`}><span>種類</span><SelectField options={KNOWLEDGE_KINDS} value={form.kind} disabled={busy} onChange={e => change('kind', e.target.value as OpsKnowledgeInput['kind'])} /></label>
      {!editing && <label className={styles.confirm} data-design-node="S0Bvaf">
        <input type="checkbox" checked={confirmed} disabled={busy || !eligible} onChange={e => setConfirmed(e.target.checked)} />
        解決策と結果を元のやり取りで確認しました
      </label>}
    </div>
  </Dialog>
}
