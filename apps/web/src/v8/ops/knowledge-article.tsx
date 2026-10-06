'use client'

import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, type OpsKnowledgeArticle, type OpsKnowledgeInput } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import { KNOWLEDGE_KINDS, knowledgeTime } from '@/components/ops/knowledge-format'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { TextArea, TextField } from '@/components/shared/text-field'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { OpsHead } from './shell'
import parts from './parts.module.css'
import styles from './ops-knowledge-v8.module.css'

/**
 * ナレッジの記事 V8（絵 `R5ckwJ`）。一覧の「開く」から出す。
 *
 * 動きは v7（components/ops/knowledge-editor の全画面）と同じ：
 * - 承認待ち・要確認：見送る・下書きを保存・保存して承認（承認の前に「記事を承認する前に」で確かめる）
 * - 承認済み：保存すると承認待ちに戻る。一覧から行っていた「無効にする」もここに置く
 * 保存してから承認する（承認に失敗しても、勝手に有効にはならない）。
 */
export default function KnowledgeArticleV8({ article: initial, onClose, onSaved }: {
  article: OpsKnowledgeArticle
  onClose: () => void
  onSaved: () => void
}) {
  const [article, setArticle] = useState(initial)
  const [form, setForm] = useState<OpsKnowledgeInput>({ title: initial.title, question: initial.question, answer: initial.answer, kind: initial.kind, keywords: initial.keywords })
  const [keywords, setKeywords] = useState(initial.keywords.join(', '))
  const [approving, setApproving] = useState(false)
  const [readChecked, setReadChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)

  const editing = initial.reviewState === 'approved' && initial.sourceCurrent
  const eligible = article.sourceCurrent && (article.articleKind === 'verified'
    ? article.reviewState === 'pending' && article.evidence.length >= 2
    : (article.reviewState === 'pending' || article.reviewState === 'needs_review'))
  const canApprove = eligible && Boolean(form.question.trim()) && Boolean(form.answer.trim())

  const input = () => ({ ...form, keywords: keywords.split(/[、,\n]/).map((v) => v.trim()).filter(Boolean) })
  const change = <K extends keyof OpsKnowledgeInput>(key: K, value: OpsKnowledgeInput[K]) => {
    setForm((f) => ({ ...f, [key]: value })); setReadChecked(false)
  }

  const save = async (approve = false) => {
    if (approve && (!readChecked || !eligible)) return
    const value = input()
    if (!value.title.trim() || (eligible && (!value.question.trim() || !value.answer.trim()))) {
      setError('題名・質問・答えを入力してください'); return
    }
    setBusy(true); setError('')
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

  const review = async (action: 'dismiss' | 'disable') => {
    setBusy(true); setError('')
    const res = await opsCall(api.ops.knowledge.review(article.id, { version: article.version, action }))
    setBusy(false)
    if (!res.success) { setError(res.error || (action === 'dismiss' ? '見送りにできませんでした' : '無効にできませんでした')); return }
    onSaved(); onClose()
  }

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify({ title: initial.title, question: initial.question, answer: initial.answer, kind: initial.kind, keywords: initial.keywords }) || keywords !== initial.keywords.join(', '),
    [form, keywords, initial],
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })
  const close = () => { if (busy) return; if (dirty) setClosing(true); else onClose() }
  const ticketLabel = article.ticketNo == null ? '番号未取得' : `#${article.ticketNo}`

  return (
    <div data-design-node="R5ckwJ">
      <OpsHead
        title={form.title || 'ナレッジの記事'}
        description={`${editing ? '承認済み' : '承認待ち'}・${ticketLabel} の解決から自動で下書き`}
        environment={opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)}
        actions={(
          <>
            <Button onClick={close} disabled={busy}><ArrowLeft aria-hidden="true" />ナレッジ一覧へ</Button>
            {editing ? (
              <Button variant="primary" onClick={() => void save()} disabled={busy}>承認待ちで保存する</Button>
            ) : (
              <Button variant="primary" disabled={busy || !canApprove} onClick={() => { setError(''); setApproving(true) }}><Check aria-hidden="true" />保存して承認</Button>
            )}
          </>
        )}
      />
      {error && !approving ? <p role="alert" className={`${parts.alert} ${styles.articleError}`}>{error}</p> : null}
      <div className={styles.article}>
        <section className={styles.fields} aria-label="記事の中身">
          <label className={styles.field}>
            <span className={styles.label}>題名</span>
            <TextField value={form.title} maxLength={120} disabled={busy} onChange={(e) => change('title', e.target.value)} />
          </label>
          <div className={styles.field}>
            <span className={styles.smallLabel} id="ops-article-kind">種類</span>
            <div className={styles.wideSelect}>
              <Select aria-label="種類" options={KNOWLEDGE_KINDS} value={form.kind} disabled={busy} onChange={(value) => change('kind', value as OpsKnowledgeInput['kind'])} />
            </div>
          </div>
          <label className={styles.field}>
            <span className={styles.smallLabel}>質問</span>
            <TextArea className={styles.question} value={form.question} maxLength={1000} disabled={busy} onChange={(e) => change('question', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.smallLabel}>答え</span>
            <TextArea className={styles.answer} value={form.answer} maxLength={12000} disabled={busy} onChange={(e) => change('answer', e.target.value)} />
          </label>
          {!form.answer.trim() && article.articleKind === 'answer_example' ? <p className={parts.note}>運営の回答がありません。答えを書いて承認できます</p> : null}
          <label className={styles.field}>
            <span className={styles.label}>キーワード</span>
            <TextField value={keywords} maxLength={480} disabled={busy} onChange={(e) => { setKeywords(e.target.value); setReadChecked(false) }} />
          </label>
        </section>
        <aside className={styles.side}>
          {editing ? (
            <Notice tone="info">変更を保存すると承認待ちに戻ります。再承認するまで、この記事は AI の返信に使われません。</Notice>
          ) : (
            <section className={parts.panel} aria-label="解決の根拠">
              <h3 className={parts.panelTitle}>解決の根拠</h3>
              {article.evidence.filter((e) => e.role !== 'condition').length === 0 ? (
                <p className={styles.evidence}>{`${ticketLabel} の解決から自動で下書きにしました`}</p>
              ) : article.evidence.filter((e) => e.role !== 'condition').map((e, i) => (
                <p key={`${e.messageId}-${i}`} className={styles.evidence}>
                  <time dateTime={e.createdAt} title={e.createdAt}>{knowledgeTime(e.createdAt)}</time>
                  {` ${e.authorKind === 'ops' ? '運営' : 'お客様'}：「${e.quote}」`}
                </p>
              ))}
              {article.articleKind === 'verified' ? (
                <p className={styles.evidence}>適用条件：{article.evidence.filter((e) => e.role === 'condition').map((e) => e.quote).join('／') || '原文に明示なし'}</p>
              ) : null}
              {(!eligible || article.reviewReason) && !editing ? (
                <p className={parts.alert}>{!article.sourceCurrent ? '元のやり取りが更新されています。この記事は承認できません。' : article.reviewReason}</p>
              ) : null}
              <Link href={`/ops/support?id=${encodeURIComponent(article.sourceRequestId)}`} className={parts.textLink}>元のやり取りを開く →</Link>
            </section>
          )}
          <p className={parts.dialogNote}>
            {article.articleKind === 'verified'
              ? '未確認の原因や途中の提案は記事に含めません。お客様が「直った」と返したやり取りだけを根拠にします。'
              : '回答例はお客様の成功確認を示すものではありません。質問と運営の回答内容を元のやり取りで確認してください。'}
          </p>
          <div className={styles.sideActions}>
            {editing ? (
              <>
                <Button onClick={close} disabled={busy}>保存せず閉じる</Button>
                <Button variant="danger" onClick={() => void review('disable')} disabled={busy}>無効にする</Button>
              </>
            ) : (
              <>
                {article.reviewState !== 'dismissed' ? <Button onClick={() => void review('dismiss')} disabled={busy}>見送る</Button> : null}
                <Button onClick={() => void save()} disabled={busy}>下書きを保存</Button>
              </>
            )}
          </div>
        </aside>
      </div>

      {editing ? null : (
        <Dialog
          open={approving}
          title="記事を承認する前に"
          designNode="eSXxA"
          busy={busy}
          error={error || undefined}
          onCancel={() => { if (!busy) setApproving(false) }}
          footer={(
            <div className={styles.dialogActions}>
              <Button onClick={() => void save()} disabled={busy}>下書きで保存</Button>
              <Button variant="primary" disabled={busy || !canApprove || !readChecked} busy={busy} busyLabel="処理中…" onClick={() => void save(true)}>保存して承認</Button>
            </div>
          )}
        >
          <div className={parts.dialogBody}>
            <p className={parts.line}>{form.title.trim() || '題名未入力'}</p>
            <Checkbox checked={readChecked} disabled={busy || !eligible} onCheckedChange={setReadChecked}>
              本文と手順を読み、いまの作りと合っていることを確かめました
            </Checkbox>
            <Notice tone="info">承認すると、AIの返事の下書きにこの記事が使われます。保存だけ通って承認に失敗したときは、下書きのまま残ります。</Notice>
          </div>
        </Dialog>
      )}
      <UnsavedLeaveDialog open={closing || leaveTarget !== null} onConfirm={closing ? onClose : confirmLeave} onCancel={closing ? () => setClosing(false) : cancelLeave} />
    </div>
  )
}
