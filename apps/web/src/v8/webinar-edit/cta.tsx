'use client'

/*
 * ★V8 ウェビナーの ③CTA・フォーム（Pencil Q0Jrk・同時編集の帯 pvimJ）。
 * CTA カードの並び（時刻・見出し・種類・「…」）→ 選んでいるカードの中身 → 申込に使う回答フォーム。
 * 右はカードの見え方。
 * 口・保存前の確かめ・同時編集（409）の扱いは app/webinars/edit/cta-v8.tsx と同じ（BEHAVIOR.md）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { SaveConflictBand } from '@/components/shared/save-conflict'
import { GitCompare, Play, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { RowMenu } from '@/components/shared/row-actions'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { EntityKindField } from '@/components/shared/entity-picker-sources'
import Toggle from '@/components/shared/toggle'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import TapActionField from '@/components/shared/tap-action-field'
import type { TapActionKind } from '@/lib/tap-actions'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { ApiError, fetchApi, webinarApi, type WebinarCtaCard, type WebinarEditor } from '@/lib/api'
import { useFormErrors } from '@/lib/use-form-errors'
import { ErrorCountBadge } from '@/components/shared/error-count-badge'
import ValidationSummary from '@/components/shared/validation-summary'
import { FieldError } from '@/components/shared/form-controls'
import { ReadValue } from './parts'
import type { EditContext, PaneSaveProps, WizardChrome } from './types'
import form from './form.module.css'
import styles from './cta.module.css'

type FormCandidates = { state: 'idle' | 'loading' | 'ready' | 'error' | 'forbidden'; items: Array<{ id: string; name: string; isActive: boolean }> }

function fmtMinSec(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
function parseMinSec(text: string): number | null {
  const match = /^(\d{1,4}):([0-5]?\d)$/.exec(text.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}
/** CTA の押したら：URL を開く・回答フォーム。 */
const WEBINAR_CTA_KINDS: readonly TapActionKind[] = ['uri', 'form']
const EMPTY_CARD = (atSeconds: number): WebinarCtaCard => ({ atSeconds, kind: 'form', title: '', body: null, buttonLabel: '', autoOpen: false, formId: null, url: null })

/** 1枚のカードの欄ごとの誤り（B-139）。欄の真下に出すので「n枚目」は付けない。 */
function cardFieldProblems(card: WebinarCtaCard, time: string, durationSeconds: number): { time: string | null; title: string | null; button: string | null; link: string | null } {
  const at = parseMinSec(time)
  const url = card.url?.trim() ?? ''
  return {
    time: at === null
      ? '出す時刻は 分:秒 で入れてください（例: 45:00）'
      : durationSeconds > 0 && at > durationSeconds ? `出す時刻が動画の長さ（${Math.floor(durationSeconds / 60)}分）を超えています。動画の中の時刻に直してください` : null,
    title: card.title?.trim() ? null : 'カードの見出しを入れてください',
    button: card.buttonLabel?.trim() ? null : 'ボタンに出す文字を入れてください',
    link: card.kind === 'form'
      ? (card.formId ? null : '公開中のフォームを選ぶか、種類を URL へ変えてください')
      : !url ? 'https:// から始まる URL を入れてください' : !/^https:\/\//.test(url) ? 'URL は https:// で始めてください（http は使えません）' : null,
  }
}

function isConflict(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 409 && (!cause.code || /version_conflict/i.test(cause.code))
}

export default function CtaPane({ ctx, chrome, onDirtyChange, registerSave }: { ctx: EditContext; chrome: WizardChrome } & PaneSaveProps) {
  const { webinar, editor, readOnly } = ctx
  const webinarId = webinar.id
  const accountId = webinar.accountId
  const [ctas, setCtas] = useState<WebinarCtaCard[] | null>(null)
  const [times, setTimes] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [savedCards, setSavedCards] = useState<string | null>(null)
  const [savedForm, setSavedForm] = useState(editor.registrationFormId ?? '')
  const [registrationFormId, setRegistrationFormId] = useState(editor.registrationFormId ?? '')
  const [forms, setForms] = useState<FormCandidates>({ state: 'idle', items: [] })
  const [registrationError, setRegistrationError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [latest, setLatest] = useState<{ editor: WebinarEditor; ctas: WebinarCtaCard[] | null } | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [reading, setReading] = useState(false)
  const [replaceConfirm, setReplaceConfirm] = useState(false)
  const lock = useRef(false)
  const requestId = useRef(0)
  const formRequestId = useRef(0)
  const onCtasReport = ctx.onCtasReport

  const loadCtas = useCallback(async () => {
    const id = ++requestId.current
    setCtas(null)
    setMessage(null)
    setLoadFailed(false)
    try {
      const res = await webinarApi.ctas(webinarId)
      if (id !== requestId.current) return
      if (!Array.isArray(res.data)) throw new Error('cta_list_not_array')
      setCtas(res.data)
      setTimes(res.data.map((card) => fmtMinSec(card.atSeconds)))
      setSavedCards(JSON.stringify([res.data, res.data.map((card) => fmtMinSec(card.atSeconds))]))
      setSelected(0)
      onCtasReport(res.data)
    } catch {
      if (id !== requestId.current) return
      setLoadFailed(true)
      onCtasReport(null)
    }
  }, [webinarId, onCtasReport])
  useEffect(() => {
    void loadCtas()
    return () => { requestId.current += 1 }
  }, [loadCtas])

  const loadForms = useCallback(() => {
    const id = ++formRequestId.current
    if (!accountId) { setForms({ state: 'idle', items: [] }); return }
    setForms({ state: 'loading', items: [] })
    fetchApi<{ success: boolean; data: Array<{ id: string; name: string; isActive?: boolean }> }>(`/api/forms?account_id=${encodeURIComponent(accountId)}`)
      .then((response) => {
        if (id !== formRequestId.current) return
        if (!response.success || !Array.isArray(response.data)) throw new Error('forms_not_loaded')
        setForms({ state: 'ready', items: response.data.map((item) => ({ id: item.id, name: item.name, isActive: item.isActive === true })) })
      })
      .catch((cause: unknown) => {
        if (id !== formRequestId.current) return
        setForms({ state: cause instanceof ApiError && (cause.status === 403 || cause.status === 404) ? 'forbidden' : 'error', items: [] })
      })
  }, [accountId])
  useEffect(() => {
    loadForms()
    return () => { formRequestId.current += 1 }
  }, [loadForms])

  const published = forms.items.filter((item) => item.isActive)
  /* 選ぶ窓の候補：公開中のフォーム。選んであるのが公開中でないときも消さずに出す。 */
  const formRows = (current: string | null | undefined) => {
    const kept = current && !published.some((item) => item.id === current) ? forms.items.find((item) => item.id === current) : undefined
    return kept ? [...published, kept] : published
  }
  const formMeta = (row: { isActive?: boolean | null }) => row.isActive ? '公開中' : '公開中ではありません'
  const update = (index: number, patch: Partial<WebinarCtaCard>) => setCtas((prev) => (prev ? prev.map((card, j) => (j === index ? { ...card, ...patch } : card)) : prev))

  /*
   * 保存で落ちた欄（B-139）。カードは1枚ずつしか開いていないので、落ちた欄が別のカードなら
   * そのカードを選んでから移る。カードの行には直す欄の数の赤い丸を付ける。
   */
  const fields = useFormErrors()
  ;(ctas ?? []).forEach((card, i) => {
    const check = () => cardFieldProblems(card, times[i] ?? '', webinar.durationSeconds)
    const opts = { reveal: () => setSelected(i), group: `card-${i}` }
    fields.define(`cta-${i}-title`, `カード${i + 1}の見出し`, () => check().title, opts)
    fields.define(`cta-${i}-time`, `カード${i + 1}の出す時刻`, () => check().time, opts)
    fields.define(`cta-${i}-button`, `カード${i + 1}のボタンの言葉`, () => check().button, opts)
    fields.define(`cta-${i}-link`, card.kind === 'form' ? `カード${i + 1}の使うフォーム` : `カード${i + 1}の開く URL`, () => check().link, opts)
  })

  /* 下書きを保存：カードは読めていれば今の中身をそのまま保存する（同時編集の 409 はここでも見つける）。 */
  const saveCards = async (): Promise<boolean> => {
    if (ctas === null) return false
    if (fields.submit().length > 0) { setMessage(null); return false }
    const next = ctas.map((card, i) => ({ ...card, atSeconds: parseMinSec(times[i]) ?? 0 }))
    try {
      await webinarApi.saveCtas(webinarId, next)
      setCtas(next)
      setTimes(next.map((card) => fmtMinSec(card.atSeconds)))
      setSavedCards(JSON.stringify([next, next.map((card) => fmtMinSec(card.atSeconds))]))
      setMessage(null)
      onCtasReport(next)
      return true
    } catch (cause) {
      if (isConflict(cause)) { setConflict(true); setLatest(null); return false }
      setMessage('CTA カードを保存できませんでした。入力は残っています。もう一度保存してください。')
      return false
    }
  }
  const saveForm = async (): Promise<boolean> => {
    if (forms.state !== 'ready') { setRegistrationError('回答フォームの候補を読み込んでから保存してください。'); return false }
    if (registrationFormId && !published.some((item) => item.id === registrationFormId)) { setRegistrationError('選んだ申込フォームは今の候補にありません。公開中のフォームを選び直してください。'); return false }
    setRegistrationError('')
    try {
      const response = await webinarApi.saveEditor(webinarId, {
        expectedVersion: editor.version,
        ...(editor.updatedAt ? { expectedUpdatedAt: editor.updatedAt } : null),
        registrationFormId: registrationFormId || null,
      })
      ctx.onEditorChange(response.data)
      setSavedForm(registrationFormId)
      return true
    } catch (cause) {
      if (isConflict(cause)) { setConflict(true); setLatest(null); return false }
      if (cause instanceof ApiError && ['form_inactive_or_missing', 'form_account_mismatch'].includes(cause.code ?? '')) loadForms()
      setRegistrationError(webinarErrorText(cause, '申込フォームを保存できませんでした。入力は残っています。'))
      return false
    }
  }

  const cardsDirty = savedCards !== null && JSON.stringify([ctas, times]) !== savedCards
  const formDirty = registrationFormId !== savedForm
  const saveCurrent = useRef<() => Promise<boolean>>(async () => false)
  saveCurrent.current = async () => {
    if (readOnly || ctas === null || lock.current || conflict) return false
    lock.current = true
    setSaving(true)
    try {
      if (!(await saveCards())) return false
      if (formDirty && !(await saveForm())) return false
      return true
    } finally {
      lock.current = false
      setSaving(false)
    }
  }
  useEffect(() => { onDirtyChange(cardsDirty || formDirty) }, [cardsDirty, formDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => {
    if (readOnly) { registerSave(null); return }
    registerSave(() => saveCurrent.current())
    return () => registerSave(null)
  }, [registerSave, readOnly])

  /* 同時編集：最新を読んで見比べる → 最新を読み込んで続ける（自分のカードの入力は残さない／申込フォームは最新へ）。 */
  const readLatest = async () => {
    if (reading) return
    setReading(true)
    try {
      const [editorRes, ctasRes] = await Promise.all([webinarApi.editor(webinarId), webinarApi.ctas(webinarId).catch(() => null)])
      setLatest({ editor: editorRes.data, ctas: ctasRes && Array.isArray(ctasRes.data) ? ctasRes.data : null })
      setCompareOpen(true)
    } catch {
      setRegistrationError('最新版を読み込めませんでした。入力は残っています。もう一度お試しください。')
    } finally {
      setReading(false)
    }
  }
  const acceptLatest = async () => {
    setReplaceConfirm(false)
    const next = latest ?? await webinarApi.editor(webinarId).then((res) => ({ editor: res.data, ctas: null })).catch(() => null)
    if (!next) { setRegistrationError('最新版を読み込めませんでした。もう一度お試しください。'); return }
    ctx.onEditorChange(next.editor)
    setRegistrationFormId(next.editor.registrationFormId ?? '')
    setSavedForm(next.editor.registrationFormId ?? '')
    setConflict(false)
    setLatest(null)
    setCompareOpen(false)
    await loadCtas()
  }

  const currentIndex = ctas === null ? 0 : Math.min(selected, Math.max(ctas.length - 1, 0))
  const current = ctas === null ? null : ctas[currentIndex] ?? null
  const errId = (part: 'title' | 'time' | 'button' | 'link') => (fields.invalid(`cta-${currentIndex}-${part}`) ? `cta-${part}-error` : undefined)
  const formName = (id: string | null | undefined) => (id ? forms.items.find((item) => item.id === id)?.name ?? '選んだフォーム' : '未設定')
  const busy = saving || reading

  return (
    <CreatePage
      boardId={conflict ? 'pvimJ' : 'Q0Jrk'}
      title={chrome.title}
      actions={chrome.actions}
      identity={chrome.identity}
      steps={chrome.steps}
      description="動画の途中や終わりに出すカードと、申込に使う回答フォームを決めます。"
      /* 競合の間は「下書きを保存」を「比べてから保存」に替える（押すと違いを比べる窓。絵 pvimJ）。 */
      footerActions={conflict && chrome.footerWithDraft
        ? chrome.footerWithDraft(<Button disabled={busy} busy={reading} onClick={() => void readLatest()}>比べてから保存</Button>)
        : chrome.footerActions}
      status={chrome.status}
      /* 競合の帯は左右の列の上に横いっぱい（絵 pvimJ）。 */
      notice={conflict ? (
        <SaveConflictBand designNode="pvimJ"
          title={latest?.editor.updatedAt ? `ほかの人が ${new Date(latest.editor.updatedAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })} にこのウェビナーを保存しました` : 'ほかの人がこのウェビナーを保存しました'}
          compareBusy={busy || reading} onCompare={readLatest} onReload={() => setReplaceConfirm(true)} />
      ) : undefined}
      preview={<>
        <h2 className={form.previewTitle}>カードの見え方</h2>
        <div className={styles.previewCard}>
          <span className={styles.player} aria-hidden="true"><Play size={32} /></span>
          <div className={styles.ctaCard}>
            <p className={styles.ctaTitle}>{current?.title || '（見出しなし）'}</p>
            {current?.body ? <p className={styles.ctaBody}>{current.body}</p> : null}
            <p className={styles.ctaButton}>{current?.buttonLabel || 'ボタン'}</p>
          </div>
        </div>
      </>}
    >

      <section className={form.card} data-gap="tight" aria-labelledby="webinar-cta-title" data-wc-pane="cta">
        <div className={form.cardHeadRow}><h2 id="webinar-cta-title" className={form.cardTitle}>{ctas === null ? 'CTA カード' : `CTA カード ${ctas.length}枚`}</h2></div>
        <p className={styles.desc}>動画の途中で出す申し込みボタンです。出す時刻は 分:秒 で入れます。</p>
        {message ? <Notice tone="danger">{message}</Notice> : null}
        <ValidationSummary problems={fields.listProblems()} onFocusFirst={fields.focusFirst} minProblems={2} />
        {loadFailed ? (
          <ListState kind="error" title="CTA カードを読み込めませんでした" description="読み込めるまで保存はできません。" onRetry={() => void loadCtas()} />
        ) : ctas === null ? <ListState kind="loading" /> : <>
          {ctas.map((card, index) => (
            <div key={index} className={form.listRow} data-selected={index === currentIndex || undefined}>
              <button type="button" className={styles.cardPick} aria-current={index === currentIndex || undefined} onClick={() => setSelected(index)}>
                <span className={styles.cardTime}>{times[index] ?? fmtMinSec(card.atSeconds)}</span>
                <span className={`${form.rowMain} ${form.ellipsis}`} title={card.title}>{card.title || '（見出しなし）'}</span>
                <span className={form.pill} data-tone={card.kind === 'form' ? 'success' : undefined}><span className={form.pillDot} aria-hidden="true" />{card.kind === 'form' ? '回答フォーム' : 'URL'}</span>
                <ErrorCountBadge count={fields.countIn(`card-${index}`)} label={`カード${index + 1}`} />
              </button>
              {readOnly ? null : (
                <div className={form.menuBox}>
                  <RowMenu label={`カード${index + 1}の操作`} triggerProps={{ disabled: busy }} open={menuOpen === index} onOpenChange={(next) => setMenuOpen(next ? index : null)} items={[
                    { id: 'copy', label: '複製する', onSelect: () => { setMenuOpen(null); setCtas((prev) => (prev ? [...prev.slice(0, index + 1), { ...prev[index] }, ...prev.slice(index + 1)] : prev)); setTimes((prev) => [...prev.slice(0, index + 1), prev[index], ...prev.slice(index + 1)]) } },
                    { id: 'delete', label: '消す', tone: 'danger', onSelect: () => { setMenuOpen(null); setCtas((prev) => (prev ? prev.filter((_, j) => j !== index) : prev)); setTimes((prev) => prev.filter((_, j) => j !== index)); setSelected(0) } },
                  ]} />
                </div>
              )}
            </div>
          ))}
          {ctas.length === 0 ? <p className={form.cardNote}>まだカードがありません。</p> : null}
          {readOnly ? null : (
            <div><Button disabled={busy} onClick={() => { setCtas((prev) => [...(prev ?? []), EMPTY_CARD(0)]); setTimes((prev) => [...prev, '0:00']); setSelected(ctas.length) }}><Plus size={15} aria-hidden="true" />CTA カードを足す</Button></div>
          )}
          {current ? (
            <fieldset className={styles.editor} disabled={busy}>
              {/* 閲覧のみ：文字の欄は読み取りだけ、選ぶ部品は選んでいる値を文字で見せる（2026-10-06 オーナー決定）。 */}
              <p className={styles.editorTitle}>{`選んでいるカード：${times[currentIndex] ?? fmtMinSec(current.atSeconds)}`}</p>
              <div className={form.pair}>
                <div className={form.field}><label htmlFor="cta-title" className={form.label}>見出し</label><TextField {...fields.bind(`cta-${currentIndex}-title`)} id="cta-title" value={current.title} readOnly={readOnly} invalid={fields.invalid(`cta-${currentIndex}-title`)} aria-describedby={errId('title')} onChange={(event) => update(currentIndex, { title: event.target.value })} /><FieldError id="cta-title-error">{fields.error(`cta-${currentIndex}-title`)}</FieldError></div>
                <div className={form.field}><label htmlFor="cta-time" className={form.label}>出す時刻（分:秒）</label><TextField {...fields.bind(`cta-${currentIndex}-time`)} id="cta-time" value={times[currentIndex] ?? ''} readOnly={readOnly} inputMode="numeric" placeholder="12:00" invalid={fields.invalid(`cta-${currentIndex}-time`)} aria-describedby={errId('time')} onChange={(event) => setTimes((prev) => prev.map((value, j) => (j === currentIndex ? event.target.value : value)))} /><FieldError id="cta-time-error">{fields.error(`cta-${currentIndex}-time`)}</FieldError></div>
              </div>
              <div className={form.field}><label htmlFor="cta-button" className={form.label}>ボタンの言葉</label><TextField {...fields.bind(`cta-${currentIndex}-button`)} id="cta-button" value={current.buttonLabel} readOnly={readOnly} invalid={fields.invalid(`cta-${currentIndex}-button`)} aria-describedby={errId('button')} onChange={(event) => update(currentIndex, { buttonLabel: event.target.value })} /><FieldError id="cta-button-error">{fields.error(`cta-${currentIndex}-button`)}</FieldError></div>
              <div className={form.field}>
                <span className={form.labelSmall}>押したら</span>
                {/*
                  押したらの共通の欄（TapActionField・YPzmo）。ウェビナーの視聴ページの CTA なので URL と回答フォームの2つだけ
                  （回答フォームは視聴ページの中で開くので LIFF は要らない）。保存の形（kind・formId・url）は今のまま。
                  保存で落ちたら（B-139）この欄の下に理由を出し、欄の中の1つ目へ移る。
                */}
                <div {...fields.bind(`cta-${currentIndex}-link`)} aria-describedby={errId('link')}>
                  <TapActionField
                    name="CTA"
                    kindLabel="リンクの種類"
                    value={{ kind: current.kind === 'form' ? 'form' : 'uri', uri: current.url ?? '', text: '', refId: current.formId ?? '' }}
                    onChange={(patch) => {
                      /* 種類を変えても、もう一方の値（formId・url）は今までどおり残す。 */
                      if (patch.kind !== undefined) { update(currentIndex, { kind: patch.kind === 'form' ? 'form' : 'url' }); return }
                      if (patch.uri !== undefined) update(currentIndex, { url: patch.uri })
                      if (patch.refId !== undefined) update(currentIndex, { formId: patch.refId || null })
                    }}
                    kinds={WEBINAR_CTA_KINDS}
                    hasLiff
                    readOnly={readOnly}
                    sources={forms.state === 'ready' ? { form: forms.items.map((item) => ({ id: item.id, name: item.name, note: item.isActive ? '公開中' : '公開していません', disabled: !item.isActive })) } : undefined}
                  />
                </div>
                <FieldError id="cta-link-error">{fields.error(`cta-${currentIndex}-link`)}</FieldError>
              </div>
              <div className={styles.toggleRow}>
                {readOnly ? null : <Toggle checked={current.autoOpen} label="ボタンを押したら、フォームを自動で開く" onChange={(next) => update(currentIndex, { autoOpen: next })} />}
                <span className={styles.toggleText}>{readOnly ? `ボタンを押したら、フォームを自動で${current.autoOpen ? '開く' : '開かない'}` : 'ボタンを押したら、フォームを自動で開く'}</span>
              </div>
            </fieldset>
          ) : null}
        </>}
      </section>

      <section className={form.card} data-gap="tight" aria-labelledby="webinar-regform-title">
        <div className={form.cardHeadRow}><h2 id="webinar-regform-title" className={form.cardTitle}>申込に使う回答フォーム</h2></div>
        <p className={styles.desc}>申し込みのときに答えてもらうフォームです。公開中のフォームから1つ選びます。</p>
        <div className={form.field}>
          <span className={form.labelSmall}>申込フォーム</span>
          {forms.state === 'ready' ? (
            <div className={styles.formSelect}>
              {readOnly ? <ReadValue label="申込に使う回答フォーム">{editor.publicPage.form?.name ?? formName(registrationFormId)}</ReadValue> : <EntityKindField kind="form" label="申込に使う回答フォーム" options={formRows(registrationFormId)} meta={formMeta} accountId={accountId} value={registrationFormId} disabled={busy || conflict} invalid={Boolean(registrationFormId) && !published.some((item) => item.id === registrationFormId)} onChange={setRegistrationFormId} />}
            </div>
          ) : forms.state === 'loading' ? <p className={form.cardNote}>回答フォームを読み込んでいます。</p>
            : forms.state === 'forbidden' ? <p className={form.cardNote}>回答フォームを見る権限がありません。管理者に権限の確認を頼んでください。</p>
              : forms.state === 'error' ? <p className={form.cardNote} role="alert">回答フォームを読み込めませんでした。<Button size="compact" onClick={loadForms}>もう一度読み込む</Button></p>
                : <p className={form.cardNote}>LINE 公式アカウントを確かめられないため、候補を出せません。</p>}
        </div>
        {forms.state === 'ready' && published.length === 0 ? <p className={form.cardNote}>公開中の回答フォームがありません。</p> : null}
        {forms.state === 'ready' && registrationFormId && !published.some((item) => item.id === registrationFormId) ? <p className={form.fieldError} role="alert">前に選んだフォームは使えなくなりました。公開中のフォームを選び直してください。</p> : null}
        {registrationError ? <p className={form.fieldError} role="alert">{registrationError}</p> : null}
      </section>

      <ConfirmDialog open={replaceConfirm} title="最新を読み込んで続けますか？" description="保存されている最新の CTA カードと申込フォームに置き換えます。この画面で直したところは消えます。" confirmLabel="最新を読み込んで続ける" onCancel={() => setReplaceConfirm(false)} onConfirm={() => acceptLatest()} />
      {compareOpen && latest ? (
        <Dialog open title="違いを比べる" description="左がこの画面の入力、右が保存されている最新です。" confirmLabel="最新を読み込んで続ける" onConfirm={() => acceptLatest()} onCancel={() => setCompareOpen(false)}>
          <DataTable className={styles.compare}>
            <thead><TableHeadRow><Th>項目</Th><Th>この画面</Th><Th>最新</Th></TableHeadRow></thead>
            <tbody>
              <Tr><Td>申込フォーム</Td><Td>{formName(registrationFormId)}</Td><Td>{latest.editor.publicPage.form?.name ?? formName(latest.editor.registrationFormId)}</Td></Tr>
              {Array.from({ length: Math.max(ctas?.length ?? 0, latest.ctas?.length ?? 0) }, (_, i) => {
                const mine = ctas?.[i]
                const theirs = latest.ctas?.[i]
                const describe = (card: WebinarCtaCard | undefined, time?: string) => (card ? `「${card.title || '（見出しなし）'}」／${time ?? fmtMinSec(card.atSeconds)}から` : '（なし）')
                return <Tr key={i}><Td>{`カード${i + 1}`}</Td><Td>{describe(mine, times[i])}</Td><Td>{latest.ctas ? describe(theirs) : '—'}</Td></Tr>
              })}
            </tbody>
          </DataTable>
        </Dialog>
      ) : null}
    </CreatePage>
  )
}
