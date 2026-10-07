'use client'

/*
 * ★V8 ウェビナーの ③CTA・フォーム（Pencil Q0Jrk・同時編集の帯 pvimJ）。
 * CTA カードの並び（時刻・見出し・種類・「…」）→ 選んでいるカードの中身 → 申込に使う回答フォーム。
 * 右はカードの見え方。
 * 口・保存前の確かめ・同時編集（409）の扱いは app/webinars/edit/cta-v8.tsx と同じ（BEHAVIOR.md）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { GitCompare, MoreHorizontal, Play, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { CreatePage } from '@/components/templates'
import ActionMenu from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { ApiError, fetchApi, webinarApi, type WebinarCtaCard, type WebinarEditor } from '@/lib/api'
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
const EMPTY_CARD = (atSeconds: number): WebinarCtaCard => ({ atSeconds, kind: 'form', title: '', body: null, buttonLabel: '', autoOpen: false, formId: null, url: null })

/** 保存前の確かめ（app/webinars/edit/cta-card-validation と同じ）。1件でもあれば保存は呼ばない。 */
function cardProblems(ctas: WebinarCtaCard[], times: string[], durationSeconds: number): string[] {
  const problems: string[] = []
  ctas.forEach((card, i) => {
    const label = `${i + 1}枚目`
    const at = parseMinSec(times[i] ?? '')
    if (at === null) problems.push(`${label}: 出す時刻は 分:秒 で入れてください（例: 45:00）`)
    else if (durationSeconds > 0 && at > durationSeconds) problems.push(`${label}: 出す時刻が動画の長さ（${Math.floor(durationSeconds / 60)}分）を超えています。動画の中の時刻に直してください`)
    if (!card.title?.trim()) problems.push(`${label}: 見出しが空です。カードの見出しを入れてください`)
    if (!card.buttonLabel?.trim()) problems.push(`${label}: ボタンの言葉が空です。ボタンに出す文字を入れてください`)
    if (card.kind === 'form') {
      if (!card.formId) problems.push(`${label}: フォームが選ばれていません。公開中のフォームを選ぶか、種類を URL へ変えてください`)
    } else {
      const url = card.url?.trim() ?? ''
      if (!url) problems.push(`${label}: URL が空です。https:// から始まる URL を入れてください`)
      else if (!/^https:\/\//.test(url)) problems.push(`${label}: URL は https:// で始めてください（http は使えません）`)
    }
  })
  return problems
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
  const update = (index: number, patch: Partial<WebinarCtaCard>) => setCtas((prev) => (prev ? prev.map((card, j) => (j === index ? { ...card, ...patch } : card)) : prev))

  /* 下書きを保存：カードは読めていれば今の中身をそのまま保存する（同時編集の 409 はここでも見つける）。 */
  const saveCards = async (): Promise<boolean> => {
    if (ctas === null) return false
    const problems = cardProblems(ctas, times, webinar.durationSeconds)
    if (problems.length > 0) { setMessage(problems[0]); return false }
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
  const formName = (id: string | null | undefined) => (id ? forms.items.find((item) => item.id === id)?.name ?? '選んだフォーム' : '未設定')
  const busy = saving || reading

  return (
    <CreatePage
      boardId={conflict ? 'pvimJ' : 'Q0Jrk'}
      title={chrome.title}
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
        <div className={styles.conflict} role="alert" data-design-node="pvimJ">
          <TriangleAlert size={16} aria-hidden="true" className={styles.conflictIcon} />
          <div className={styles.conflictText}>
            <p className={styles.conflictTitle}>{latest?.editor.updatedAt ? `ほかの人が ${new Date(latest.editor.updatedAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })} にこのウェビナーを保存しました` : 'ほかの人がこのウェビナーを保存しました'}</p>
            <p className={styles.conflictNote}>このまま保存すると、ほかの人の変更が消えます</p>
          </div>
          <Button disabled={busy} busy={reading} onClick={() => void readLatest()}><GitCompare size={15} aria-hidden="true" />違いを比べる</Button>
          <Button disabled={busy} onClick={() => setReplaceConfirm(true)}><RefreshCw size={15} aria-hidden="true" />最新を読み込んで続ける</Button>
        </div>
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
        {loadFailed ? (
          <ListState kind="error" title="CTA カードを読み込めませんでした" description="読み込めるまで保存はできません。" action={<Button onClick={() => void loadCtas()}>もう一度読み込む</Button>} />
        ) : ctas === null ? <ListState kind="loading" /> : <>
          {ctas.map((card, index) => (
            <div key={index} className={form.listRow} data-selected={index === currentIndex || undefined}>
              <button type="button" className={styles.cardPick} aria-current={index === currentIndex || undefined} onClick={() => setSelected(index)}>
                <span className={styles.cardTime}>{times[index] ?? fmtMinSec(card.atSeconds)}</span>
                <span className={`${form.rowMain} ${form.ellipsis}`} title={card.title}>{card.title || '（見出しなし）'}</span>
                <span className={form.pill} data-tone={card.kind === 'form' ? 'success' : undefined}><span className={form.pillDot} aria-hidden="true" />{card.kind === 'form' ? '回答フォーム' : 'URL'}</span>
              </button>
              {readOnly ? null : (
                <div className={form.menuBox}>
                  <IconButton aria-label={`カード${index + 1}の操作`} title={`カード${index + 1}の操作`} aria-haspopup="menu" aria-expanded={menuOpen === index} disabled={busy} onClick={() => setMenuOpen((open) => (open === index ? null : index))}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </IconButton>
                  <ActionMenu open={menuOpen === index} onClose={() => setMenuOpen(null)} ariaLabel={`カード${index + 1}の操作`} items={[
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
                <label className={form.field}><span className={form.label}>見出し</span><TextField value={current.title} readOnly={readOnly} onChange={(event) => update(currentIndex, { title: event.target.value })} /></label>
                <label className={form.field}><span className={form.label}>出す時刻（分:秒）</span><TextField value={times[currentIndex] ?? ''} readOnly={readOnly} inputMode="numeric" placeholder="12:00" onChange={(event) => setTimes((prev) => prev.map((value, j) => (j === currentIndex ? event.target.value : value)))} /></label>
              </div>
              <label className={form.field}><span className={form.label}>ボタンの言葉</span><TextField value={current.buttonLabel} readOnly={readOnly} onChange={(event) => update(currentIndex, { buttonLabel: event.target.value })} /></label>
              <div className={form.pair}>
                <div className={form.field}>
                  <span className={form.labelSmall}>リンクの種類</span>
                  {readOnly
                    ? <ReadValue label="リンクの種類">{current.kind === 'form' ? '回答フォーム' : 'URL'}</ReadValue>
                    : <Select aria-label="リンクの種類" size="full" value={current.kind} onChange={(value) => update(currentIndex, { kind: value as 'form' | 'url' })} options={[{ value: 'form', label: '回答フォーム' }, { value: 'url', label: 'URL' }]} />}
                </div>
                {current.kind === 'form' ? (
                  <div className={form.field}>
                    <span className={form.labelSmall}>使うフォーム</span>
                    {readOnly
                      ? <ReadValue label="使うフォーム">{formName(current.formId)}</ReadValue>
                      : <Select aria-label="使うフォーム" size="full" value={current.formId ?? ''} onChange={(value) => update(currentIndex, { formId: value || null })} options={[{ value: '', label: 'フォームを選ぶ' }, ...published.map((item) => ({ value: item.id, label: `${item.name}（公開中）` }))]} />}
                  </div>
                ) : (
                  <label className={form.field}><span className={form.labelSmall}>開く URL</span><TextField value={current.url ?? ''} readOnly={readOnly} inputMode="url" placeholder="https://" onChange={(event) => update(currentIndex, { url: event.target.value })} /></label>
                )}
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
              {readOnly ? <ReadValue label="申込に使う回答フォーム">{editor.publicPage.form?.name ?? formName(registrationFormId)}</ReadValue> : <Select aria-label="申込に使う回答フォーム" size="full" value={registrationFormId} disabled={busy || conflict} onChange={setRegistrationFormId} options={[{ value: '', label: '申込フォームを選ぶ' }, ...published.map((item) => ({ value: item.id, label: `${item.name}（公開中）` })), ...(registrationFormId && !published.some((item) => item.id === registrationFormId) ? [{ value: registrationFormId, label: '公開中ではないフォーム' }] : [])]} />}
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

      <ConfirmDialog open={replaceConfirm} title="最新を読み込んで続けますか？" description="保存されている最新の CTA カードと申込フォームに置き換えます。この画面で直したところは消えます。" confirmLabel="最新を読み込んで続ける" onCancel={() => setReplaceConfirm(false)} onConfirm={() => void acceptLatest()} />
      {compareOpen && latest ? (
        <Dialog open title="違いを比べる" description="左がこの画面の入力、右が保存されている最新です。" confirmLabel="最新を読み込んで続ける" onConfirm={() => void acceptLatest()} onCancel={() => setCompareOpen(false)}>
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
