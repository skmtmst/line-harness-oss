'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { api, type OpsKnowledgeArticle, type OpsKnowledgeInput } from '@/lib/api'
import { opsCall } from './ops-ui'
import { KNOWLEDGE_KINDS, knowledgeArticleKind, knowledgeTime } from './knowledge-format'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import { TextArea, TextField } from '@/components/shared/text-field'
import styles from './knowledge.module.css'
import Notice from '@/components/shared/notice'
import PageHeader from '@/components/shared/page-header'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import v8 from '@/app/ops/knowledge/article-v8.module.css'

/** ★V6 37-11-A DHdsw / 37-11-B ZAOc7. Mount with key={article.id}. */
export default function KnowledgeEditor({ article: initial, ticket, onClose, onSaved, fullPage = false }: {
  fullPage?: boolean
  article: OpsKnowledgeArticle
  /** 板 `eSXxA` の2つ目の確認と赤帯に使う元の問い合わせ。ないときは出さない。 */
  ticket?: { label: string; resolved: boolean; stageLabel: string } | null
  onClose: () => void; onSaved: () => void
}) {
  const [article, setArticle] = useState(initial)
  const [form, setForm] = useState<OpsKnowledgeInput>({ title: initial.title, question: initial.question,
    answer: initial.answer, kind: initial.kind, keywords: initial.keywords })
  const [keywords, setKeywords] = useState(initial.keywords.join('、'))
  /* 板 `eSXxA`：承認する前に小窓で2つ確かめる。 */
  const [approving, setApproving] = useState(false)
  const [readChecked, setReadChecked] = useState(false)
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
    setForm(f => ({ ...f, [key]: value })); setReadChecked(false)
  }
  const ticketBlocked = Boolean(ticket && !ticket.resolved)
  const save = async (approve = false) => {
    if (approve && (!readChecked || !eligible || ticketBlocked)) return
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
        setReadChecked(false); setError(reviewed.error || '承認できませんでした。元のやり取りを確認してください')
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
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify({ title: initial.title, question: initial.question, answer: initial.answer, kind: initial.kind, keywords: initial.keywords }) || keywords !== initial.keywords.join('、'), [form, keywords, initial])
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: fullPage && dirty, busy })
  const [closing, setClosing] = useState(false)
  const close = () => { if (busy) return; if (fullPage && dirty) setClosing(true); else onClose() }
  return <KnowledgeSurface fullPage={fullPage} articleTitle={form.title || 'ナレッジの記事'} description={`${editing ? '承認済み' : '承認待ち'}・${article.ticketNo == null ? '番号未取得' : `#${article.ticketNo}`} の解決から自動で下書き`} title={editing ? '記事を直す' : '下書きの内容を確認'}
    designNode={editing ? 'ZAOc7' : 'DHdsw'} busy={busy} error={error} onCancel={close}
    footer={<div className={styles.footer}>
      <Button onClick={editing ? onClose : () => void dismiss()} disabled={busy}>{editing ? '保存せず閉じる' : '見送る'}</Button>
      <Button onClick={() => void save()} disabled={busy} variant={editing ? 'primary' : 'secondary'}>{editing ? '承認待ちで保存する' : '下書きを保存する'}</Button>
      {!editing && <Button variant="primary" disabled={busy || !canApprove} onClick={() => { setError(''); setApproving(true) }}>{fullPage ? '保存して承認' : '承認して有効にする'}</Button>}
    </div>}>
    <div className={fullPage ? v8.columns : styles.editor}>
      <section className={fullPage ? v8.fields : styles.editor}>
      <label className={styles.field}><span>題名</span><TextField value={form.title} maxLength={120} disabled={busy} onChange={e => change('title', e.target.value)} /></label>
      <label className={styles.field}><span>質問</span><TextArea className={styles.question} value={form.question} maxLength={1000} disabled={busy} onChange={e => change('question', e.target.value)} /></label>
      <label className={styles.field}><span>答え</span><TextArea className={styles.answer} value={form.answer} maxLength={12000} disabled={busy} onChange={e => change('answer', e.target.value)} /></label>
      {!form.answer.trim() && article.articleKind === 'answer_example' && <p data-design-node="aeEmptyAnswerNote" className={styles.emptyAnswerNote}>運営の回答がありません。答えを書いて承認できます</p>}
      <label className={styles.field}><span>キーワード</span><TextField value={keywords} maxLength={480} disabled={busy} onChange={e => { setKeywords(e.target.value); setReadChecked(false) }} /></label>
      <label className={`${styles.field} ${styles.kind} ${fullPage ? v8.kind : ''}`}><span>種類</span><Select aria-label="種類" options={KNOWLEDGE_KINDS} value={form.kind} disabled={busy} onChange={value => change('kind', value as OpsKnowledgeInput['kind'])} /></label>
      </section>
      <aside className={styles.editor}>
      {/* ★V7: 緑は「正常」だけ。説明の帯は枠なしの info の小さい帯にする。 */}
      <Notice tone="info">{editing
        ? '変更を保存すると承認待ちに戻ります。再承認するまで、この記事は AI の返信に使われません。'
        : '自動で作成した下書きです。解決の根拠と記事案を確認してください。承認するまで AI の返信には使われません。'}</Notice>
      <div className={fullPage ? v8.source : styles.sourceLine}>
        <p className={styles.source}>元の問い合わせ：{article.ticketNo == null ? '番号未取得' : `#MB-${String(article.ticketNo).padStart(4, '0')}`}{article.sourceSubject ? ` ${article.sourceSubject}` : ''}</p>
        <Chip data-design-node="aeReviewKind" tone={kindLabel.tone} className={styles.articleKindChip}>{kindLabel.label}</Chip>
      </div>
      {!editing && <section className={fullPage ? `${styles.evidence} ${v8.evidence}` : styles.evidence} data-design-node="mAjGu" aria-label="解決の根拠">
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
      </aside>

    </div>
    {/* 板 `eSXxA`「記事を承認する前に」。2つ確かめてから保存して承認する。 */}
    {!editing && (
      <Dialog
        open={approving}
        title="記事を承認する前に"
        designNode="eSXxA"
        busy={busy}
        error={error || undefined}
        onCancel={() => { if (!busy) setApproving(false) }}
        footer={(
          <div className={styles.footer}>
            <Button onClick={() => void save()} disabled={busy} variant="secondary">下書きで保存</Button>
            <Button
              variant="primary"
              disabled={busy || !canApprove || !readChecked || ticketBlocked}
              busy={busy}
              busyLabel="処理中…"
              onClick={() => void save(true)}
            >
              保存して承認
            </Button>
          </div>
        )}
      >
        <div className={styles.editor}>
          <p className={styles.source}>{form.title.trim() || '題名未入力'}</p>
          <span data-design-node="xNNWI">
            <Checkbox checked={readChecked} disabled={busy || !eligible} onCheckedChange={setReadChecked}>
              本文と手順を読み、いまの作りと合っていることを確かめました
            </Checkbox>
          </span>
          {ticket ? (
            <Checkbox checked={ticket.resolved} disabled onCheckedChange={() => {}}>
              元の問い合わせ {ticket.label} が「解決」になっている
            </Checkbox>
          ) : null}
          {ticketBlocked ? (
            <Notice tone="error">
              元の問い合わせ {ticket?.label} がまだ「{ticket?.stageLabel}」です。解決にしてから承認できます。
            </Notice>
          ) : null}
          <Notice tone="info">
            承認すると、AIの返事の下書きにこの記事が使われます。保存だけ通って承認に失敗したときは、下書きのまま残ります。
          </Notice>
        </div>
      </Dialog>
    )}
    {fullPage ? <UnsavedLeaveDialog open={closing || leaveTarget !== null} onConfirm={closing ? onClose : confirmLeave} onCancel={closing ? () => setClosing(false) : cancelLeave} /> : null}
  </KnowledgeSurface>
}

function KnowledgeSurface({ fullPage, articleTitle, description, title, designNode, busy, error, onCancel, footer, children }: {
  fullPage: boolean; articleTitle: string; description: string; title: string; designNode: string; busy: boolean; error: string; onCancel: () => void; footer: ReactNode; children: ReactNode
}) {
  if (!fullPage) return <Dialog open title={title} designNode={designNode} busy={busy} error={error} onCancel={onCancel} footer={footer}>{children}</Dialog>
  return <div className={v8.page} data-design-node="R5ckwJ">
    <PageHeader breadcrumb={[]} title={articleTitle} titleDisplay="always" description={description} actions={footer} />
    <Button onClick={onCancel} disabled={busy} size="compact">ナレッジ一覧へ</Button>
    {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
    {children}
  </div>
}
