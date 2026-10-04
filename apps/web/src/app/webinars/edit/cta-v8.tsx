'use client'

/* ★V8 CTA・フォーム（Q0Jrk）。入力は下書き保存と次の段からも保存する。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu from '@/components/shared/action-menu'
import StatusBadge from '@/components/shared/status-badge'
import ListState from '@/components/shared/list-state'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import Notice from '@/components/shared/notice'
import { ApiError, fetchApi, webinarApi, type WebinarCtaCard, type WebinarEditor } from '@/lib/api'
import { ctaCardProblems } from './cta-card-validation'

/* 申込フォームの候補（編集画面の CtaDesignStep と同じ形）。 */
type FormCandidates = {
  accountId: string | null
  state: 'idle' | 'loading' | 'ready' | 'error' | 'forbidden'
  items: Array<{ id: string; name: string; isActive: boolean }>
}

function emptyFormCandidates(accountId: string | null): FormCandidates {
  return { accountId, state: 'idle', items: [] }
}

function fmtMinSec(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function parseMinSec(text: string): number | null {
  const match = /^(\d{1,4}):([0-5]?\d)$/.exec(text.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

const EMPTY_CARD = (atSeconds: number): WebinarCtaCard => ({
  atSeconds,
  kind: 'form',
  title: '',
  body: null,
  buttonLabel: '',
  autoOpen: false,
  formId: null,
  url: null,
})

export default function CtaV8({
  webinarId,
  accountId,
  durationSeconds,
  editor,
  onEditorChange,
  onCtasReport,
  onDirtyChange,
  registerSave,
}: {
  webinarId: string
  accountId: string | null
  durationSeconds: number
  editor: WebinarEditor
  onEditorChange: (editor: WebinarEditor) => void
  onCtasReport?: (ctas: WebinarCtaCard[] | null) => void
  onDirtyChange?: (dirty: boolean) => void
  registerSave?: (save: (() => Promise<boolean>) | null) => void
}) {
  const [ctas, setCtas] = useState<WebinarCtaCard[] | null>(null)
  const [times, setTimes] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [savedCards, setSavedCards] = useState<string | null>(null)
  const [savedForm, setSavedForm] = useState<string>(editor.registrationFormId ?? '')
  const savingRef = useRef(false)
  const [formCandidates, setFormCandidates] = useState<FormCandidates>(() => emptyFormCandidates(accountId))
  const [selectedRegistrationFormId, setSelectedRegistrationFormId] = useState<string>(editor.registrationFormId ?? '')
  const [savingRegistrationForm, setSavingRegistrationForm] = useState(false)
  const [registrationNotice, setRegistrationNotice] = useState('')
  const [registrationError, setRegistrationError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [latestEditor, setLatestEditor] = useState<WebinarEditor | null>(null)
  const [readingLatest, setReadingLatest] = useState(false)
  const [replaceConfirm, setReplaceConfirm] = useState(false)
  const scope = useRef(webinarId)
  scope.current = webinarId
  const requestId = useRef(0)
  const formRequestId = useRef(0)

  const loadCtas = useCallback(async () => {
    const id = ++requestId.current
    setCtas(null)
    setMessage(null)
    try {
      const res = await webinarApi.ctas(webinarId)
      if (id !== requestId.current) return
      if (!Array.isArray(res.data)) throw new Error('cta_list_not_array')
      setCtas(res.data)
      setTimes(res.data.map((c) => fmtMinSec(c.atSeconds)))
      setSavedCards(JSON.stringify([res.data, res.data.map((c) => fmtMinSec(c.atSeconds))]))
      setSelected(0)
      onCtasReport?.(res.data)
    } catch {
      if (id !== requestId.current) return
      setMessage('CTAカードを読み込めませんでした。もう一度読み込んでください。読み込めるまで保存はできません。')
      onCtasReport?.(null)
    }
  }, [webinarId, onCtasReport])

  useEffect(() => {
    void loadCtas()
    return () => {
      requestId.current += 1
    }
  }, [loadCtas])

  const loadForms = useCallback(() => {
    const id = ++formRequestId.current
    if (!accountId) {
      setFormCandidates({ accountId, state: 'idle', items: [] })
      return
    }
    setFormCandidates({ accountId, state: 'loading', items: [] })
    fetchApi<{ success: boolean; data: Array<{ id: string; name: string; isActive?: boolean }> }>(
      `/api/forms?account_id=${encodeURIComponent(accountId)}`,
    )
      .then((response) => {
        if (id !== formRequestId.current) return
        if (!response.success || !Array.isArray(response.data)) throw new Error('forms_not_loaded')
        const items = response.data
        setFormCandidates({
          accountId,
          state: 'ready',
          items: items.map((form) => ({ id: form.id, name: form.name, isActive: form.isActive === true })),
        })
      })
      .catch((cause: unknown) => {
        if (id !== formRequestId.current) return
        setFormCandidates({
          accountId,
          state:
            cause instanceof ApiError && (cause.status === 403 || cause.status === 404) ? 'forbidden' : 'error',
          items: [],
        })
      })
  }, [accountId])

  useEffect(() => {
    loadForms()
    return () => {
      formRequestId.current += 1
    }
  }, [loadForms])

  const update = (index: number, patch: Partial<WebinarCtaCard>) => {
    setCtas((prev) => (prev ? prev.map((c, j) => (j === index ? { ...c, ...patch } : c)) : prev))
  }

  const save = async (): Promise<boolean> => {
    if (ctas === null || savingRef.current || conflict) return false
    const problems = ctaCardProblems(ctas, times, durationSeconds, parseMinSec)
    if (problems.length > 0) {
      setMessage(problems[0])
      return false
    }
    const parsed = times.map((t) => parseMinSec(t))
    const next = ctas.map((c, i) => ({ ...c, atSeconds: (parsed[i] as number) ?? 0 }))
    savingRef.current = true
    setSaving(true)
    setMessage(null)
    try {
      await webinarApi.saveCtas(webinarId, next)
      setCtas(next)
      setTimes(next.map((c) => fmtMinSec(c.atSeconds)))
      setSavedCards(JSON.stringify([next, next.map((c) => fmtMinSec(c.atSeconds))]))
      setMessage(null)
      onCtasReport?.(next)
      return true
    } catch {
      setMessage('CTAカードを保存できませんでした。入力は残っています。もう一度保存してください。')
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const saveRegistrationForm = async (): Promise<boolean> => {
    if (savingRef.current || conflict) return false
    if (formCandidates.state !== 'ready') {
      setRegistrationError('回答フォームの候補を読み込んでから保存してください。')
      return false
    }
    if (selectedRegistrationFormId && !publishedForms.some((form) => form.id === selectedRegistrationFormId)) {
      setRegistrationError('選んだ申込フォームは今の候補にありません。公開中のフォームを選び直してください。'); return false
    }
    savingRef.current = true
    setSavingRegistrationForm(true)
    setRegistrationNotice('')
    setRegistrationError('')
    try {
      const response = await webinarApi.saveEditor(webinarId, {
        expectedVersion: editor.version,
        registrationFormId: selectedRegistrationFormId || null,
      })
      onEditorChange(response.data)
      setSavedForm(selectedRegistrationFormId)
      setRegistrationNotice('申込フォームを保存しました。公開前確認で申込フォームが公開中か確認してください。')
      return true
    } catch (cause) {
      if (cause instanceof ApiError && (cause.code === 'version_conflict' || (cause.status === 409 && !cause.code))) {
        setConflict(true)
        setLatestEditor(null)
        setRegistrationError('')
        return false
      }
      if (cause instanceof ApiError && ['form_inactive_or_missing', 'form_account_mismatch'].includes(cause.code ?? '')) loadForms()
      setRegistrationError(webinarErrorText(cause, '申込フォームを保存できませんでした。入力は残っています。'))
      return false
    } finally {
      savingRef.current = false
      setSavingRegistrationForm(false)
    }
  }

  const compareLatest = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setReadingLatest(true)
    setRegistrationError('')
    try {
      const response = await webinarApi.editor(webinarId)
      if (scope.current !== webinarId) return
      if (!Number.isInteger(response.data.version)) throw new Error('invalid_editor')
      setLatestEditor(response.data)
    } catch {
      if (scope.current === webinarId) setRegistrationError('最新版を読み込めませんでした。入力は残っています。もう一度お試しください。')
    } finally {
      savingRef.current = false
      if (scope.current === webinarId) setReadingLatest(false)
    }
  }

  const acceptLatest = () => {
    if (!latestEditor) return
    onEditorChange(latestEditor)
    setSelectedRegistrationFormId(latestEditor.registrationFormId ?? '')
    setSavedForm(latestEditor.registrationFormId ?? '')
    setConflict(false)
    setLatestEditor(null)
    setReplaceConfirm(false)
    setRegistrationError('')
    setRegistrationNotice('最新の申込フォームを読み込みました。CTAカードの入力は残しています。')
  }

  const publishedForms = formCandidates.items.filter((form) => form.isActive)
  const current = ctas === null ? null : (ctas[Math.min(selected, ctas.length - 1)] ?? null)
  const currentIndex = ctas === null ? 0 : Math.min(selected, Math.max(ctas.length - 1, 0))

  const cardsDirty = savedCards !== null && JSON.stringify([ctas, times]) !== savedCards
  const formDirty = selectedRegistrationFormId !== savedForm
  const saveCurrent = useRef<() => Promise<boolean>>(async () => false)
  saveCurrent.current = async () => {
    if (ctas === null || savingRef.current || conflict) return false
    if (cardsDirty && !(await save())) return false
    if (formDirty && !(await saveRegistrationForm())) return false
    return true
  }
  useEffect(() => { onDirtyChange?.(cardsDirty || formDirty) }, [cardsDirty, formDirty, onDirtyChange])
  useEffect(() => {
    registerSave?.(() => saveCurrent.current())
    return () => registerSave?.(null)
  }, [registerSave])

  return (
    <>
      {conflict ? <div data-design-node="pvimJ"><Notice tone="warn" action={<Button disabled={readingLatest} busy={readingLatest} onClick={() => void compareLatest()}>違いを比べる</Button>}>別の画面でこのウェビナーが更新されました。申込フォームの入力は残しています。最新版を確認してから保存してください。</Notice>
        {latestEditor ? <div className="border-hairline mt-3 rounded-control border p-3 text-sm"><p>保存されている申込フォーム：{latestEditor.publicPage.form?.name ?? (latestEditor.registrationFormId ? publishedForms.find((form) => form.id === latestEditor.registrationFormId)?.name ?? '選択済みのフォーム' : '未設定')}</p><p className="mt-2">この画面の入力：{publishedForms.find((form) => form.id === selectedRegistrationFormId)?.name ?? (selectedRegistrationFormId ? '選択済みのフォーム' : '未設定')}</p><Button className="mt-3" onClick={() => setReplaceConfirm(true)}>最新を読み込んで続ける</Button></div> : null}
      </div> : null}

    <div className="min-w-0" data-webinar-pane="cta" data-design-node="Q0Jrk">
      <fieldset className="min-w-0 space-y-3" disabled={saving || savingRegistrationForm}>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="CTAカード">
          <h2 className="text-ink text-base font-bold">
            CTAカード {ctas === null ? '' : `${ctas.length}枚`}
          </h2>
          <p className="text-ink-faint mt-1 text-xs">動画の途中で出す申し込みボタンです。出す時刻は分:秒で入れます。</p>
          {message ? <Notice tone="error" title="CTAカード" action={ctas === null ? <Button onClick={() => void loadCtas()}>もう一度読み込む</Button> : undefined}>{message}</Notice> : null}
          {ctas === null ? (
            <>{message ? null : <ListState kind="loading" />}<Button disabled>CTAカードを保存する</Button></>
          ) : (
            <>
              <ul className="divide-hairline mt-3 divide-y rounded-control border border-hairline">
                {ctas.map((card, index) => (
                  <li key={index} className="flex items-center gap-3 px-3 py-3">
                    <button type="button" aria-current={index === currentIndex} onClick={() => setSelected(index)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="text-ink w-12 shrink-0 text-sm font-semibold tabular-nums">{times[index] ?? fmtMinSec(card.atSeconds)}</span>
                      <span className="text-ink min-w-0 flex-1 truncate text-sm" title={card.title}>{card.title || '（見出しなし）'}</span>
                      <StatusBadge tone={card.kind === 'form' ? 'success' : 'neutral'}>{card.kind === 'form' ? '回答フォーム' : 'URL'}</StatusBadge>
                    </button>
                    <span className="relative"><Button size="compact" aria-label={`カード${index + 1}の操作`} aria-expanded={menuOpen === index} onClick={() => setMenuOpen(menuOpen === index ? null : index)}>…</Button><ActionMenu open={menuOpen === index} onClose={() => setMenuOpen(null)} ariaLabel={`カード${index + 1}の操作`} items={[
                      { id: 'copy', label: '複製する', onSelect: () => { setCtas((prev) => prev ? [...prev.slice(0, index + 1), { ...prev[index] }, ...prev.slice(index + 1)] : prev); setTimes((prev) => [...prev.slice(0, index + 1), prev[index], ...prev.slice(index + 1)]) } },
                      { id: 'delete', label: '消す', tone: 'danger', onSelect: () => { setCtas((prev) => prev ? prev.filter((_, j) => j !== index) : prev); setTimes((prev) => prev.filter((_, j) => j !== index)); setSelected(0) } },
                    ]} /></span>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCtas((prev) => [...(prev ?? []), EMPTY_CARD(0)])
                    setTimes((prev) => [...prev, '0:00'])
                    setSelected((ctas ?? []).length)
                  }}
                >
                  ＋ CTAカードを足す
                </Button>
              </div>
              {current ? (
                <div className="bg-canvas-sunken mt-3 space-y-3 rounded-control p-3">
                  <p className="text-ink text-sm font-semibold">
                    選んでいるカード：{fmtMinSec(current.atSeconds)}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-ink-secondary mb-1 block text-xs font-medium">見出し</span>
                      <input
                        value={current.title}
                        onChange={(e) => update(currentIndex, { title: e.target.value })}
                        className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-ink-secondary mb-1 block text-xs font-medium">出す時刻（分:秒）</span>
                      <input
                        value={times[currentIndex] ?? ''}
                        onChange={(e) =>
                          setTimes((prev) => prev.map((t, j) => (j === currentIndex ? e.target.value : t)))
                        }
                        inputMode="numeric"
                        placeholder="12:00"
                        className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm tabular-nums"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-ink-secondary mb-1 block text-xs font-medium">ボタンの言葉</span>
                    <input
                      value={current.buttonLabel}
                      onChange={(e) => update(currentIndex, { buttonLabel: e.target.value })}
                      className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Select
                      label="リンクの種類"
                      aria-label="リンクの種類"
                      value={current.kind}
                      onChange={(value) => update(currentIndex, { kind: value as 'form' | 'url' })}
                      options={[
                        { value: 'form', label: '回答フォーム' },
                        { value: 'url', label: 'URL' },
                      ]}
                    />
                    {current.kind === 'form' ? (
                      <Select
                        label="使うフォーム"
                        aria-label="使うフォーム"
                        value={current.formId ?? ''}
                        onChange={(value) => update(currentIndex, { formId: value || null })}
                        options={[
                          { value: '', label: 'フォームを選ぶ' },
                          ...publishedForms.map((form) => ({ value: form.id, label: form.name })),
                        ]}
                      />
                    ) : (
                      <label className="block">
                        <span className="text-ink-secondary mb-1 block text-xs font-medium">開くURL</span>
                        <input
                          value={current.url ?? ''}
                          onChange={(e) => update(currentIndex, { url: e.target.value })}
                          inputMode="url"
                          placeholder="https://"
                          className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm"
                        />
                      </label>
                    )}
                  </div>
                  <Checkbox
                    checked={current.autoOpen}
                    onCheckedChange={(checked) => update(currentIndex, { autoOpen: checked })}
                  >
                    ボタンを押したら、フォームを自動で開く
                  </Checkbox>
                </div>
              ) : null}
              <div className="mt-3">
                <Button disabled={saving || ctas === null} busy={saving} busyLabel="保存しています…" onClick={save}>
                  CTAカードを保存する
                </Button>
              </div>
            </>
          )}
        </section>

        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="申込に使う回答フォーム">
          <h2 className="text-ink text-base font-bold">申込に使う回答フォーム</h2>
          <p className="text-ink-faint mt-1 text-xs">申し込みのときに答えてもらうフォームです。公開中のフォームから1つ選びます。</p>
          <p className="text-ink-faint mt-2 text-xs">CTAボタンで使うフォームとは別です。保存済み：{editor.publicPage?.form?.name ?? '未設定'}</p>
          {formCandidates.state === 'loading' ? <p className="text-ink-faint mt-3 text-sm">回答フォームを読み込んでいます。</p> : null}
          {formCandidates.state === 'error' ? <p className="text-ink-secondary mt-3 text-sm" role="alert">回答フォームを読み込めませんでした。候補が取れない間は種類をURLに切り替えて保存できます。 <Button onClick={loadForms}>もう一度読み込む</Button></p> : null}
          {formCandidates.state === 'forbidden' ? <p className="text-ink-secondary mt-3 text-sm">回答フォームを見る権限がありません。管理者に権限の確認を依頼してください。</p> : null}
          {formCandidates.state === 'ready' && publishedForms.length === 0 ? <p className="text-ink-faint mt-3 text-sm">公開中の回答フォームがありません。</p> : null}
          {formCandidates.state === 'ready' && publishedForms.length > 0 ? <div className="mt-3"><Select label="申込フォーム" aria-label="申込に使う回答フォーム" value={selectedRegistrationFormId} onChange={setSelectedRegistrationFormId} options={[{ value: '', label: '申込フォームを選ぶ' }, ...publishedForms.map((form) => ({ value: form.id, label: form.name }))]} /></div> : null}
          {formCandidates.state === 'ready' && selectedRegistrationFormId && !publishedForms.some((form) => form.id === selectedRegistrationFormId) ? <p role="alert" className="text-warning mt-2 text-sm">前に選んだフォームは使えなくなりました。公開中のフォームを選び直してください。</p> : null}
          {formCandidates.state === 'ready' && editor.registrationFormId && !publishedForms.some((form) => form.id === editor.registrationFormId) ? <p className="text-warning mt-2 text-sm">保存済みの申込フォームは公開中ではありません。</p> : null}
          {registrationError ? <p className="text-danger mt-2 text-xs" role="alert">{registrationError}</p> : null}
          {registrationNotice ? <p className="text-ink-secondary mt-2 text-xs">{registrationNotice}</p> : null}
          <div className="mt-3">
            <Button
              variant="secondary"
              disabled={conflict || readingLatest || savingRegistrationForm || formCandidates.state !== 'ready' || !accountId}
              busy={savingRegistrationForm}
              busyLabel="保存しています…"
              onClick={saveRegistrationForm}
            >
              申込フォームを保存する
            </Button>
          </div>
        </section>
      </fieldset>

      <aside className="min-w-0" aria-label="カードの見え方">
        <div className="border-hairline bg-canvas rounded-card border p-4 shadow-card xl:sticky xl:top-4">
          <h2 className="text-ink text-base font-bold">カードの見え方</h2>
          <span className="bg-ink mt-2 flex aspect-video w-full items-center justify-center rounded-control" aria-hidden="true">
            <span className="text-canvas text-2xl">▶</span>
          </span>
          <div className="border-hairline mt-2 rounded-control border p-3">
            <p className="text-ink text-sm font-semibold">{current?.title || '（見出しなし）'}</p>
            {current?.body ? <p className="text-ink-secondary mt-1 text-xs">{current.body}</p> : null}
            <p className="bg-accent-deep text-on-accent mt-2 rounded-control py-2 text-center text-sm font-semibold">
              {current?.buttonLabel || 'ボタン'}
            </p>
          </div>
        </div>
      </aside>
    </div>
    <ConfirmDialog open={replaceConfirm} title="最新の申込フォームを読み込みますか？" description="この画面で選んだ申込フォームを、保存されている最新版に置き換えます。CTAカードの入力は残します。" confirmLabel="最新を読み込んで続ける" onCancel={() => setReplaceConfirm(false)} onConfirm={acceptLatest} />
    </>
  )
}
