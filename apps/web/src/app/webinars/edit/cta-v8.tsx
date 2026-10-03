'use client'

/*
 * ★V8-B ウェビナー編集③CTA（板 `Q0Jrk`）。
 *
 * 見本の形：カードの一覧（出す時刻・見出し・リンクの種類・…）から
 * 1枚を選んで、見出し・時刻・ボタンの言葉・種類・使うフォーム・
 * 自動で開くを変える。申込に使う回答フォームの選択もここで持つ。
 * 保存は下の帯の「下書きを保存」に載せる（段の登録式）。
 * 口は v7 と同じ（`ctas`・`saveCtas`・回答フォームの一覧・`saveEditor`）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import Toggle from '@/components/shared/toggle'
import { ApiError, fetchApi, webinarApi, type Webinar, type WebinarCtaCard, type WebinarEditor } from '@/lib/api'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { ctaCardProblems } from './cta-card-validation'
import styles from './cta-v8.module.css'

function fmtMinSec(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function parseMinSec(v: string): number | null {
  const m = /^(\d+):([0-5]?\d)$/.exec(v.trim())
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const n = Number(v.trim())
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

type FormCandidateState = 'idle' | 'loading' | 'ready' | 'error' | 'forbidden'

type RegistrationFormOption = { id: string; name: string; isActive: boolean }

function emptyCard(): WebinarCtaCard {
  return { atSeconds: 0, kind: 'form', title: '', body: null, buttonLabel: '', autoOpen: false, formId: null, url: null }
}

export default function CtaStepV8({ webinar, editor, accountId, onEditorChange, onCtasReport, onDirtyChange, registerSave }: {
  webinar: Webinar
  editor: WebinarEditor
  accountId: string | null
  onEditorChange: (editor: WebinarEditor) => void
  onCtasReport?: (ctas: WebinarCtaCard[] | null) => void
  onDirtyChange: (dirty: boolean) => void
  registerSave: (save: (() => Promise<boolean>) | null) => void
}) {
  const webinarId = webinar.id
  const durationSeconds = webinar.durationSeconds
  const [ctas, setCtas] = useState<WebinarCtaCard[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [baseline, setBaseline] = useState('')
  /* 取得の世代印。切替後に遅れて届いた前のウェビナーの応答はここで捨てる。 */
  const requestId = useRef(0)

  const loadCtas = useCallback(async () => {
    const id = ++requestId.current
    /* 取得を始めた時点で前の中身を捨てる。読み込み中に旧 CTA を触らせない。 */
    setCtas(null)
    setFailed(false)
    try {
      const res = await webinarApi.ctas(webinarId)
      /* 先に世代印を見る。切替後に届いた前の応答はここで終わり。 */
      if (id !== requestId.current) return
      /* 配列で来なかったら、読めなかったこととして扱う（空で置き換えると消える）。 */
      if (!Array.isArray(res.data)) throw new Error('cta_list_not_array')
      setCtas(res.data)
      setBaseline(JSON.stringify(res.data))
      setSelected(0)
      onCtasReport?.(res.data)
    } catch {
      if (id !== requestId.current) return
      setCtas(null)
      setFailed(true)
      onCtasReport?.(null)
    }
  }, [webinarId, onCtasReport])

  useEffect(() => {
    void loadCtas()
    return () => { requestId.current += 1 }
  }, [loadCtas])

  const dirty = ctas !== null && JSON.stringify(ctas) !== baseline
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const save = useCallback(async (): Promise<boolean> => {
    /* 読めていない間は保存しない（空で全置換して既存 CTA を消さない）。 */
    if (ctas === null) return false
    const times = ctas.map((c) => fmtMinSec(c.atSeconds))
    const problems = ctaCardProblems(ctas, times, durationSeconds, parseMinSec)
    if (problems.length > 0) {
      setMessage(problems.join('\n'))
      return false
    }
    try {
      const sorted = [...ctas].sort((a, b) => a.atSeconds - b.atSeconds)
      await webinarApi.saveCtas(webinarId, sorted)
      setCtas(sorted)
      setBaseline(JSON.stringify(sorted))
      onCtasReport?.(sorted)
      setMessage(`${sorted.length}件保存しました`)
      return true
    } catch (err) {
      setMessage(`保存に失敗しました: ${(err as Error).message}`)
      return false
    }
  }, [ctas, durationSeconds, webinarId, onCtasReport])

  useEffect(() => {
    registerSave(dirty ? save : null)
    return () => registerSave(null)
  }, [dirty, registerSave, save])

  const update = (patch: Partial<WebinarCtaCard>) => {
    setCtas((prev) => {
      if (!prev) return prev
      const next = prev.map((c, i) => (i === selected ? { ...c, ...patch } : c))
      return next
    })
  }

  const [forms, setForms] = useState<RegistrationFormOption[]>([])
  const [formsState, setFormsState] = useState<FormCandidateState>(accountId ? 'loading' : 'idle')
  const [selectedRegistrationFormId, setSelectedRegistrationFormId] = useState<string>(editor.registrationFormId ?? '')
  const [formNotice, setFormNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [savingForm, setSavingForm] = useState(false)
  const formRequestId = useRef(0)

  const loadForms = useCallback(() => {
    const id = ++formRequestId.current
    if (!accountId) {
      setFormsState('idle')
      setForms([])
      return
    }
    setFormsState('loading')
    setForms([])
    fetchApi<{ success: boolean; data: Array<{ id: string; name: string; isActive?: boolean }> }>(`/api/forms?account_id=${encodeURIComponent(accountId)}`)
      .then((response) => {
        if (id !== formRequestId.current) return
        const items = Array.isArray(response.data) ? response.data : []
        setForms(items.map((form) => ({ id: form.id, name: form.name, isActive: form.isActive === true })))
        setFormsState('ready')
      })
      .catch((cause) => {
        if (id !== formRequestId.current) return
        setFormsState(cause instanceof ApiError && (cause.status === 403 || cause.status === 404) ? 'forbidden' : 'error')
      })
  }, [accountId])

  useEffect(() => {
    loadForms()
    return () => { formRequestId.current += 1 }
  }, [loadForms])

  const publishedForms = forms.filter((form) => form.isActive)

  const saveRegistrationForm = async () => {
    if (formsState !== 'ready') {
      setFormNotice('')
      setFormError('回答フォームの候補を読み込んでから保存してください。')
      return
    }
    if (selectedRegistrationFormId && !publishedForms.some((form) => form.id === selectedRegistrationFormId)) {
      setFormNotice('')
      setFormError('選んだ申込フォームは今の候補にありません。公開中のフォームを選び直してください。')
      return
    }
    setSavingForm(true)
    setFormNotice('')
    setFormError('')
    try {
      const response = await webinarApi.saveEditor(webinarId, {
        expectedVersion: editor.version,
        registrationFormId: selectedRegistrationFormId || null,
      })
      onEditorChange(response.data)
      setFormNotice('申込フォームを保存しました。公開前確認で申込フォームが公開中か確認してください。')
    } catch (cause) {
      if (cause instanceof ApiError && (cause.code === 'form_inactive_or_missing' || cause.code === 'form_account_mismatch')) {
        loadForms()
      }
      setFormError(webinarErrorText(cause, '申込フォームを保存できませんでした。開き直して試してください。'))
    } finally {
      setSavingForm(false)
    }
  }

  const current = ctas?.[selected] ?? null
  const selectedFormName = current?.formId ? publishedForms.find((form) => form.id === current.formId)?.name : null

  return (
    <div className={styles.columns}>
      <div className={styles.main}>
        {message ? <Notice tone="info">{message}</Notice> : null}
        <section className={styles.card} aria-label="CTAカード">
          <h2 className={styles.cardTitle}>CTAカード {ctas === null ? '' : `${ctas.length}枚`}</h2>
          <p className={styles.cardDesc}>動画の途中で出す申し込みボタンです。出す時刻は分:秒で入れます。</p>
          {ctas === null ? (
            failed ? (
              <Notice
                tone="danger"
                action={<button type="button" onClick={() => void loadCtas()} className="font-medium underline">もう一度読み込む</button>}
              >
                CTAカードを読み込めませんでした。読み込めるまで保存はできません。
              </Notice>
            ) : <ListState kind="loading" />
          ) : (
            <>
              <ul className={styles.rows}>
                {ctas.map((card, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      aria-current={index === selected}
                      onClick={() => { setSelected(index); setMessage(null) }}
                      className={index === selected ? styles.rowOn : styles.row}
                    >
                      <span className={styles.rowTime}>{fmtMinSec(card.atSeconds)}</span>
                      <span className={styles.rowTitle}>{card.title || '（見出し未入力）'}</span>
                      <StatusBadge tone={card.kind === 'form' ? 'success' : 'neutral'}>
                        {card.kind === 'form' ? '回答フォーム' : 'URL'}
                      </StatusBadge>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={styles.addLink}
                onClick={() => { setCtas((prev) => [...(prev ?? []), emptyCard()]); setSelected(ctas.length) }}
              >
                ＋ CTAカードを足す
              </button>
              {current ? (
                <div className={styles.editor}>
                  <p className={styles.editorTitle}>選んでいるカード：{fmtMinSec(current.atSeconds)}</p>
                  <div className={styles.grid2}>
                    <label className={styles.field}>見出し
                      <input value={current.title} onChange={(e) => update({ title: e.target.value })} placeholder="個別導入診断、受付中です" className={styles.textInput} />
                    </label>
                    <label className={styles.field}>出す時刻（分:秒）
                      <input
                        value={fmtMinSec(current.atSeconds)}
                        onChange={(e) => {
                          const parsed = parseMinSec(e.target.value)
                          if (parsed !== null) update({ atSeconds: parsed })
                        }}
                        placeholder="12:00"
                        className={styles.textInput}
                      />
                    </label>
                  </div>
                  <label className={styles.field}>ボタンの言葉
                    <input value={current.buttonLabel} onChange={(e) => update({ buttonLabel: e.target.value })} placeholder="無料で診断を受ける" className={styles.textInput} />
                  </label>
                  <div className={styles.grid2}>
                    <label className={styles.field}>リンクの種類
                      <Select
                        aria-label="リンクの種類"
                        value={current.kind}
                        onChange={(value) => update({ kind: value as 'form' | 'url' })}
                        options={[{ value: 'form', label: '回答フォーム' }, { value: 'url', label: 'URL' }]}
                      />
                    </label>
                    {current.kind === 'form' ? (
                      <label className={styles.field}>使うフォーム
                        <Select
                          aria-label="使うフォーム"
                          value={current.formId ?? ''}
                          onChange={(value) => update({ formId: value || null })}
                          options={[{ value: '', label: 'フォームを選ぶ' }, ...publishedForms.map((form) => ({ value: form.id, label: form.name }))]}
                        />
                      </label>
                    ) : (
                      <label className={styles.field}>開くURL
                        <input value={current.url ?? ''} onChange={(e) => update({ url: e.target.value || null })} placeholder="https://..." className={styles.textInput} />
                      </label>
                    )}
                  </div>
                  {(formsState === 'error' || formsState === 'forbidden') && current.kind === 'form' ? (
                    <p className="text-danger text-xs" role="alert">
                      {formsState === 'forbidden' ? 'フォーム候補を見る権限がありません。' : 'フォーム候補を読み込めませんでした。'}
                      <button type="button" onClick={loadForms} className="ml-2 font-medium underline">もう一度読み込む</button>
                    </p>
                  ) : null}
                  {current.kind === 'form' ? (
                    <Toggle checked={current.autoOpen} onChange={(checked) => update({ autoOpen: checked })} label="ボタンを押したら、フォームを自動で開く" />
                  ) : null}
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.deleteLink}
                      onClick={() => {
                        setCtas((prev) => (prev ?? []).filter((_, i) => i !== selected))
                        setSelected((prev) => Math.max(0, prev - 1))
                      }}
                    >
                      このカードを消す
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
        <section className={styles.card} aria-label="申込に使う回答フォーム">
          <h2 className={styles.cardTitle}>申込に使う回答フォーム</h2>
          <p className={styles.cardDesc}>申し込みのときに答えてもらうフォームです。公開中のフォームから1つ選びます。</p>
          <label className={styles.field}>申込フォーム
            <Select
              aria-label="申込に使う回答フォーム"
              value={selectedRegistrationFormId}
              onChange={(value) => setSelectedRegistrationFormId(value)}
              options={[{ value: '', label: '申込フォームを選ぶ' }, ...publishedForms.map((form) => ({ value: form.id, label: `${form.name}（公開中）` }))]}
            />
          </label>
          {selectedFormName === null && current?.formId ? (
            <p className="text-warning text-xs">前に選んだフォームは使えなくなりました（停止・削除・別アカウント）。選び直してください。</p>
          ) : null}
          <div className={styles.rowActions}>
            <Button variant="primary" onClick={() => void saveRegistrationForm()} disabled={savingForm || formsState !== 'ready' || !accountId} busy={savingForm}>申込フォームを保存する</Button>
          </div>
          {formNotice ? <p className="text-ink-secondary text-xs">{formNotice}</p> : null}
          {formError ? <p className="text-danger text-xs" role="alert">{formError}</p> : null}
        </section>
      </div>
      <div>
        <h2 className={styles.previewTitle}>カードの見え方</h2>
        <div className={styles.previewCard}>
          <div className={styles.previewScreen} aria-hidden="true">▶</div>
          <div className={styles.previewBody}>
            <p className={styles.previewHeading}>{current?.title || 'カードの見出し'}</p>
            <p className={styles.previewText}>{current?.body || 'この配信を見ている方限定・枠が少なめです'}</p>
            <p className={styles.previewButton}>{current?.buttonLabel || '無料で診断を受ける'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
