'use client'
import Link from '@/components/shared/list-navigation'
import { Check } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type OpsKnowledgeArticle, type OpsKnowledgeInput } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import { KNOWLEDGE_KINDS, knowledgeTime, knowledgeArticleKind } from '@/components/ops/knowledge-format'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog, { DialogActions } from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { TextArea, TextField } from '@/components/shared/text-field'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { OpsHead } from './shell'
import { usePageTitle } from '@/components/shell/page-chrome'
import parts from './parts.module.css'
import styles from './ops-knowledge-v8.module.css'
import { useFormErrors } from '@/lib/use-form-errors'
import { FieldError } from '@/components/shared/form-controls'
import ValidationSummary from '@/components/shared/validation-summary'
import { Field } from '@/components/shared/form-controls'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { CreateStepColumns } from '@/components/templates/create-step-columns'

/**
 * ナレッジの記事 V8。一覧の「開く」から出す。
 *
 * 動きは 管理画面（components/ops/knowledge-editor の全画面）と同じ：
 * - 承認待ち・要確認：見送る・下書きを保存・保存して承認（承認の前に「記事を承認する前に」で確かめる）
 * - 承認済み：保存すると承認待ちに戻る。一覧から行っていた「無効にする」もここに置く
 * 保存してから承認する（承認に失敗しても、勝手に有効にはならない）。
 */
export default function KnowledgeArticleV8({ article: initial, onClose, onSaved, ticket, fullPage = true }: {
  article: OpsKnowledgeArticle
  fullPage?: boolean
  ticket?: { label: string; resolved: boolean; stageLabel: string } | null
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
  const [loadedTicket, setLoadedTicket] = useState<typeof ticket>(null)
  const [ticketError, setTicketError] = useState('')
  const [ticketAttempt, setTicketAttempt] = useState(0)
  useEffect(() => {
    if (!approving || ticket) return
    let current = true
    setLoadedTicket(null); setTicketError('')
    void opsCall(api.ops.support.ticket(initial.sourceRequestId)).then(result => {
      if (!current) return
      if (!result.success || result.data.ticket.id !== initial.sourceRequestId) {
        setTicketError('元の問い合わせの状態を確認できませんでした。もう一度読み込んでください。')
        return
      }
      const source = result.data.ticket
      setLoadedTicket({ label: source.ticketLabel, resolved: source.stage === 'resolved' || source.stage === 'closed', stageLabel: source.stageLabel })
    })
    return () => { current = false }
  }, [approving, initial.sourceRequestId, ticket, ticketAttempt])
  const sourceTicket = ticket ?? loadedTicket

  const editing = initial.reviewState === 'approved' && initial.sourceCurrent
  const eligible = article.sourceCurrent && (article.articleKind === 'verified'
    ? article.reviewState === 'pending' && article.evidence.length >= 2
    : (article.reviewState === 'pending' || article.reviewState === 'needs_review'))
  const canApprove = eligible && Boolean(form.question.trim()) && Boolean(form.answer.trim())
  const ticketBlocked = !sourceTicket?.resolved

  const input = () => ({ ...form, keywords: keywords.split(/[、,\n]/).map((v) => v.trim()).filter(Boolean) })
  const change = <K extends keyof OpsKnowledgeInput>(key: K, value: OpsKnowledgeInput[K]) => {
    setForm((f) => ({ ...f, [key]: value })); setReadChecked(false)
  }

  /* 保存で落ちた欄は、その欄の真下に理由を出して移る。 */
  const fields = useFormErrors()
  fields.define('title', '題名', () => (form.title.trim() ? null : '題名を入力してください'), { required: true })
  fields.define('question', '質問', () => (eligible && !form.question.trim() ? '質問を入力してください' : null), { required: eligible })
  fields.define('answer', '答え', () => (eligible && !form.answer.trim() ? '答えを入力してください' : null), { required: eligible })

  const save = async (approve = false) => {
    if (busy || (approve && (!readChecked || !eligible || ticketBlocked))) return
    const value = input()
    if (fields.submit().length > 0) { setError(''); return }
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
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: fullPage && dirty, busy })
  const close = () => { if (busy) return; if (fullPage && dirty) setClosing(true); else onClose() }
  // 全画面のときは、上の帯のパンくずの最後に保存済みの題名を出す。
  usePageTitle(fullPage ? initial.title : null, fullPage)
  const ticketLabel = article.ticketNo == null ? '番号未取得' : `#${article.ticketNo}`

  return (
    <KnowledgeSurface fullPage={fullPage} editing={editing} busy={busy} onCancel={close} actions={(
      <>
        {/* 全画面の戻り道はパンくずと左のメニュー（R5ckwJ は頭に主ボタンだけ）。窓のときは閉じる口として残す。 */}
        {!fullPage ? <Button onClick={close} disabled={busy}>キャンセル</Button> : null}
        {editing ? (
          <Button variant="primary" onClick={() => save()} disabled={busy} busy={Boolean(busy)} busyLabel="処理中…">承認待ちで保存する</Button>
        ) : (
          <Button variant="primary" disabled={busy || !canApprove} onClick={() => { setError(''); setApproving(true) }}><Check aria-hidden="true" />保存して承認</Button>
        )}
      </>
    )} title={form.title || 'ナレッジの記事'} description={`${editing ? '承認済み' : '承認待ち'}・${ticketLabel} の解決から自動で下書き`}>
      {/* 現役の全画面と、問い合わせから開く共通の窓で同じ保存・承認を使う。 */}
      {error && !approving ? <Notice tone="danger" >{error}</Notice> : null}
      <ValidationSummary problems={fields.listProblems()} onFocusFirst={fields.focusFirst} minProblems={2} />
      <KnowledgeBody fullPage={fullPage} preview={(
        <aside className={styles.side}>
          {editing ? (
            <Notice tone="info">変更を保存すると承認待ちに戻ります。再承認するまで、この記事は AI の返信に使われません。</Notice>
          ) : (
            <section className={parts.panel} aria-label="解決の根拠" title={`元の問い合わせ：${article.ticketNo == null ? '番号未取得' : `#MB-${String(article.ticketNo).padStart(4, '0')}`}${article.sourceSubject ? ` ${article.sourceSubject}` : ''}・${knowledgeArticleKind(article.articleKind).label}`}>
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
                <Button variant="danger" onClick={() => review('disable')} disabled={busy} busy={Boolean(busy)} busyLabel="処理中…">無効にする</Button>
              </>
            ) : (
              <>
                {article.reviewState !== 'dismissed' ? <Button onClick={() => review('dismiss')} disabled={busy} busy={Boolean(busy)} busyLabel="処理中…">見送る</Button> : null}
                <Button onClick={() => save()} disabled={busy} busy={Boolean(busy)} busyLabel="処理中…">下書きを保存</Button>
              </>
            )}
          </div>
        </aside>
      )}>
        <section className={styles.fields} aria-label="記事の中身">
          <div className={styles.field}><Field label="題名" htmlFor="ka-title" requirement={fields.requirement('title')}><SaveErrorField names={["title","form.title"]}><TextField {...fields.bind('title')} id="ka-title" invalid={fields.invalid('title')} aria-describedby={fields.invalid('title') ? 'ka-title-error' : undefined} value={form.title} maxLength={120} disabled={busy} onChange={(e) => change('title', e.target.value)} /></SaveErrorField>
<FieldError id="ka-title-error">{fields.error('title')}</FieldError></Field></div>
          <div className={styles.field}>
            <span className={styles.smallLabel} id="ops-article-kind">種類</span>
              <SaveErrorField names={["kind","form.kind"]}><Select size="full" aria-label="種類" options={KNOWLEDGE_KINDS} value={form.kind} disabled={busy} onChange={(value) => change('kind', value as OpsKnowledgeInput['kind'])} /></SaveErrorField>
          </div>
          <div className={styles.field}><Field label="質問" htmlFor="ka-question" requirement={fields.requirement('question')}><SaveErrorField names={["question","form.question"]}><TextArea {...fields.bind('question')} id="ka-question" invalid={fields.invalid('question')} aria-describedby={fields.invalid('question') ? 'ka-question-error' : undefined} className={styles.question} value={form.question} maxLength={1000} disabled={busy} onChange={(e) => change('question', e.target.value)} /></SaveErrorField>
<FieldError id="ka-question-error">{fields.error('question')}</FieldError></Field></div>
          <div className={styles.field}><Field label="答え" htmlFor="ka-answer" requirement={fields.requirement('answer')}><SaveErrorField names={["answer","form.answer"]}><TextArea {...fields.bind('answer')} id="ka-answer" invalid={fields.invalid('answer')} aria-describedby={fields.invalid('answer') ? 'ka-answer-error' : undefined} className={styles.answer} value={form.answer} maxLength={12000} disabled={busy} onChange={(e) => change('answer', e.target.value)} /></SaveErrorField>
<FieldError id="ka-answer-error">{fields.error('answer')}</FieldError></Field></div>
          {!form.answer.trim() && article.articleKind === 'answer_example' ? <p className={parts.note}>運営の回答がありません。答えを書いて承認できます</p> : null}
          <Field label="キーワード"><SaveErrorField names={["keywords"]}><TextField value={keywords} maxLength={480} disabled={busy} onChange={(e) => { setKeywords(e.target.value); setReadChecked(false) }} /></SaveErrorField></Field>
        </section>
      </KnowledgeBody>

      {editing ? null : (
        <Dialog
          open={approving}
          title="記事を承認する前に"
          designNode="eSXxA" designTop={240}
          busy={busy}
          error={error || undefined}
          onCancel={() => { if (!busy) setApproving(false) }}
          footer={(
            <DialogActions>
              <Button onClick={() => save()} disabled={busy} busy={Boolean(busy)} busyLabel="処理中…">下書きで保存</Button>
              <Button variant="primary" disabled={busy || !canApprove || !readChecked || ticketBlocked} title={ticketBlocked ? ticketError || (sourceTicket ? '元の問い合わせを解決にしてから承認してください' : '元の問い合わせの状態を確認しています') : !readChecked ? '本文と手順の確認にチェックを入れてください' : !canApprove ? '承認できる状態ではありません' : undefined} busy={busy} busyLabel="処理中…" onClick={() => save(true)}><Check aria-hidden="true" />保存して承認</Button>
            </DialogActions>
          )}
        >
          <div className={parts.dialogBody}>
            <p className={parts.line}>{form.title.trim() || '題名未入力'}</p>
            <SaveErrorField names={["readChecked","read_checked"]}><Checkbox checked={readChecked} disabled={busy || !eligible} onCheckedChange={setReadChecked}>
              本文と手順を読み、いまの作りと合っていることを確かめました
            </Checkbox></SaveErrorField>
            {sourceTicket ? <Checkbox checked={sourceTicket.resolved} disabled title="元の問い合わせの状態は問い合わせ側で変更します。" onCheckedChange={() => {}}>元の問い合わせ {sourceTicket.label} が「解決」になっている</Checkbox> : null}
            {sourceTicket && ticketBlocked ? <Notice tone="danger" appearance="soft" density="compact" icon={null}>{`元の問い合わせ ${sourceTicket.label} がまだ「${sourceTicket.stageLabel}」です。解決にしてから承認できます。`}</Notice> : null}
            {!sourceTicket ? <Notice tone={ticketError ? 'danger' : 'info'} action={ticketError ? <Button onClick={() => setTicketAttempt(value => value + 1)}>もう一度読み込む</Button> : undefined}>{ticketError || '元の問い合わせの状態を確認しています。'}</Notice> : null}
            <p className={styles.evidence}>承認すると、AIの返事の下書きにこの記事が使われます。保存だけ通って承認に失敗したときは、下書きのまま残ります。</p>
          </div>
        </Dialog>
      )}
      <UnsavedLeaveDialog open={closing || leaveTarget !== null} onConfirm={closing ? onClose : confirmLeave} onCancel={closing ? () => setClosing(false) : cancelLeave} />
    </KnowledgeSurface>
  )
}

function KnowledgeSurface({ fullPage, editing, busy, onCancel, actions, title, description, children }: {
  fullPage: boolean; editing: boolean; busy: boolean; onCancel: () => void; actions: ReactNode; title: string; description: string; children: ReactNode
}) {
  if (!fullPage) return <Dialog open title={editing ? '記事を直す' : '下書きの内容を確認'} designNode={editing ? 'ZAOc7' : 'DHdsw'} busy={busy} onCancel={onCancel} footer={actions}>{children}</Dialog>
  return <div data-design-node="R5ckwJ"><OpsHead title={title} description={description} environment={opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)} actions={actions} />{children}</div>
}

function KnowledgeBody({ fullPage, preview, children }: { fullPage: boolean; preview: ReactNode; children: ReactNode }) {
  return fullPage ? <CreateStepColumns standalone preview={preview} previewTitle="解決の根拠と操作">{children}</CreateStepColumns> : <div className={parts.stack}>{children}{preview}</div>
}
