'use client'

/*
 * Q&A を作る・直す窓（要件 G2 §2-1 y4nixm の［Q&A を追加］・記録の［Q&A に足す］）。
 * 入るのはいつも下書き。公開は一覧の「…」から（管理者以上）。スタッフには公開のお願いの一言を出す。
 */
import { useEffect, useState } from 'react'
import Dialog from '@/components/shared/dialog'
import { Field } from '@/components/shared/form-controls'
import { TextArea } from '@/components/shared/text-field'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { notifyToast } from '@/components/shared/toast'
import { aiReplyApi, type QaEntry } from './api'
import styles from './qa-list.module.css'

export interface QaDraftSeed { entry?: QaEntry; question?: string }

export default function QaEditDialog({ open, accountId, seed, canPublish, onSaved, onClose }: {
  open: boolean
  accountId: string
  seed: QaDraftSeed | null
  canPublish: boolean
  onSaved: (entry: QaEntry) => void
  onClose: () => void
}) {
  const [questions, setQuestions] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [questionError, setQuestionError] = useState('')
  const [answerError, setAnswerError] = useState('')

  useEffect(() => {
    if (!open) return
    setQuestions(seed?.entry ? seed.entry.questions.join('\n') : seed?.question ?? '')
    setAnswer(seed?.entry?.answerText ?? '')
    setError('')
    setQuestionError('')
    setAnswerError('')
  }, [open, seed])

  const initialQuestions = seed?.entry ? seed.entry.questions.join('\n') : seed?.question ?? ''
  const dirty = questions !== initialQuestions || answer !== (seed?.entry?.answerText ?? '')

  const save = async () => {
    const list = questions.split('\n').map((line) => line.trim()).filter(Boolean)
    const qe = list.length === 0 ? '質問を 1 つ以上入れてください' : ''
    const ae = answer.trim() ? '' : '答えを入れてください'
    setQuestionError(qe)
    setAnswerError(ae)
    if (qe || ae) return
    setBusy(true)
    setError('')
    try {
      const res = seed?.entry
        ? await aiReplyApi.updateQa(accountId, seed.entry.id, { questions: list, answerText: answer.trim(), expectedVersion: seed.entry.version })
        : await aiReplyApi.createQa(accountId, { questions: list, answerText: answer.trim() })
      notifyToast(seed?.entry ? 'Q&A を保存しました' : 'Q&A を下書きで作りました')
      onSaved(res.data)
    } catch (caught) {
      setError(describeApiFailure(caught, 'Q&A の保存'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title={seed?.entry ? 'Q&A を編集する' : 'Q&A を追加する'}
      designWidth={560}
      dirty={dirty}
      busy={busy}
      error={error || undefined}
      confirmLabel={seed?.entry ? '保存する' : '下書きで保存する'}
      onConfirm={() => void save()}
      onCancel={() => { if (!busy) onClose() }}
    >
      <div className={styles.form}>
        <Field label="質問" htmlFor="qa-questions" required note="言い方が違う聞かれ方を 1 行に 1 つ入れます" error={questionError || undefined}>
          <TextArea id="qa-questions" rows={3} value={questions} invalid={Boolean(questionError)} onChange={(event) => setQuestions(event.target.value)} placeholder="例：駐車場はありますか" />
        </Field>
        <Field label="答え" htmlFor="qa-answer" required note="自動で答えるときは、この文をそのまま返します" error={answerError || undefined}>
          <TextArea id="qa-answer" rows={5} value={answer} invalid={Boolean(answerError)} onChange={(event) => setAnswer(event.target.value)} />
        </Field>
        {!canPublish ? <p className={styles.formNote}>公開は管理者にお願いしてください。保存すると下書きで入ります。</p> : null}
      </div>
    </Dialog>
  )
}
