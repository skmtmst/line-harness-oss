'use client'

/*
 * ★V8 CTA・フォーム（`Q0Jrk`）。
 * v7 の見た目は 1画素も変えない。編集画面で data-theme="v8" のときだけ、
 * CTA の段をこの部品で描く（V7 の CtaDesignStep は触らない）。
 *
 * 同時編集の競合（`pvimJ`）は保存の口に版が無いので作らない。
 * カードの保存は CtasTab と同じく全置換で、読めていない間は送らない。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
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
}: {
  webinarId: string
  accountId: string | null
  durationSeconds: number
  editor: WebinarEditor
  onEditorChange: (editor: WebinarEditor) => void
  onCtasReport?: (ctas: WebinarCtaCard[] | null) => void
}) {
  const [ctas, setCtas] = useState<WebinarCtaCard[] | null>(null)
  const [times, setTimes] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [formCandidates, setFormCandidates] = useState<FormCandidates>(() => emptyFormCandidates(accountId))
  const [selectedRegistrationFormId, setSelectedRegistrationFormId] = useState(editor.registrationFormId ?? '')
  const [savingRegistrationForm, setSavingRegistrationForm] = useState(false)
  const [registrationNotice, setRegistrationNotice] = useState('')
  const [registrationError, setRegistrationError] = useState('')
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
        const items = Array.isArray(response.data) ? response.data : []
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

  const save = async () => {
    if (ctas === null) return
    const problems = ctaCardProblems(ctas, times, durationSeconds, parseMinSec)
    if (problems.length > 0) {
      setMessage(problems[0])
      return
    }
    const parsed = times.map((t) => parseMinSec(t))
    const next = ctas.map((c, i) => ({ ...c, atSeconds: (parsed[i] as number) ?? 0 }))
    setSaving(true)
    setMessage(null)
    try {
      await webinarApi.saveCtas(webinarId, next)
      setCtas(next)
      setMessage(null)
      onCtasReport?.(next)
    } catch {
      setMessage('CTAカードを保存できませんでした。開き直して試してください。')
    } finally {
      setSaving(false)
    }
  }

  const saveRegistrationForm = async () => {
    if (formCandidates.state !== 'ready') {
      setRegistrationError('回答フォームの候補を読み込んでから保存してください。')
      return
    }
    setSavingRegistrationForm(true)
    setRegistrationNotice('')
    setRegistrationError('')
    try {
      const response = await webinarApi.saveEditor(webinarId, {
        expectedVersion: editor.version,
        registrationFormId: selectedRegistrationFormId || null,
      })
      onEditorChange(response.data)
      setRegistrationNotice('申込フォームを保存しました。')
    } catch (cause) {
      setRegistrationError(
        cause instanceof Error ? cause.message : '申込フォームを保存できませんでした。開き直して試してください。',
      )
    } finally {
      setSavingRegistrationForm(false)
    }
  }

  const publishedForms = formCandidates.items.filter((form) => form.isActive)
  const current = ctas === null ? null : (ctas[Math.min(selected, ctas.length - 1)] ?? null)
  const currentIndex = ctas === null ? 0 : Math.min(selected, Math.max(ctas.length - 1, 0))

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="Q0Jrk">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="CTAカード">
          <h2 className="text-ink text-base font-bold">
            CTAカード {ctas === null ? '' : `${ctas.length}枚`}
          </h2>
          <p className="text-ink-faint mt-1 text-xs">動画の途中で出す申し込みボタンです。出す時刻は分:秒で入れます。</p>
          {message ? <Notice tone="error" title="CTAカード">{message}</Notice> : null}
          {ctas === null ? (
            <p className="text-ink-faint py-6 text-center text-sm">CTAカードを読み込んでいます。</p>
          ) : (
            <>
              <ul className="divide-hairline mt-3 divide-y rounded-control border border-hairline">
                {ctas.map((card, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      aria-current={index === currentIndex}
                      onClick={() => {
                        setSelected(index)
                        setMenuOpen(null)
                      }}
                      className={
                        index === currentIndex
                          ? 'bg-accent-soft flex w-full items-center gap-3 px-4 py-3 text-left'
                          : 'hover:bg-canvas-sunken flex w-full items-center gap-3 px-4 py-3 text-left'
                      }
                    >
                      <span className="text-ink w-12 shrink-0 text-sm font-semibold tabular-nums">
                        {fmtMinSec(card.atSeconds)}
                      </span>
                      <span className="text-ink min-w-0 flex-1 truncate text-sm">
                        {card.title || '（見出しなし）'}
                      </span>
                      <span
                        className={
                          card.kind === 'form'
                            ? 'bg-accent-soft text-accent-deep inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-semibold'
                            : 'bg-canvas-sunken text-ink-secondary inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-semibold'
                        }
                      >
                        <span aria-hidden="true">●</span>
                        {card.kind === 'form' ? '回答フォーム' : 'URL'}
                      </span>
                      <span className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="secondary"
                          size="compact"
                          aria-label={`カード${index + 1}の操作`}
                          aria-expanded={menuOpen === index}
                          onClick={() => setMenuOpen(menuOpen === index ? null : index)}
                        >
                          …
                        </Button>
                        {menuOpen === index ? (
                          <span className="border-hairline bg-canvas absolute right-0 z-10 mt-1 flex w-28 flex-col rounded-control border py-1 shadow-card">
                            <button
                              type="button"
                              onClick={() => {
                                setMenuOpen(null)
                                setCtas((prev) =>
                                  prev ? [...prev.slice(0, index + 1), { ...prev[index] }, ...prev.slice(index + 1)] : prev,
                                )
                                setTimes((prev) => [...prev.slice(0, index + 1), prev[index], ...prev.slice(index + 1)])
                              }}
                              className="text-ink px-3 py-2 text-left text-xs hover:bg-canvas-sunken"
                            >
                              複製する
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMenuOpen(null)
                                setCtas((prev) => (prev ? prev.filter((_, j) => j !== index) : prev))
                                setTimes((prev) => prev.filter((_, j) => j !== index))
                                setSelected(0)
                              }}
                              className="text-danger px-3 py-2 text-left text-xs hover:bg-canvas-sunken"
                            >
                              消す
                            </button>
                          </span>
                        ) : null}
                      </span>
                    </button>
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
                <Button busy={saving} busyLabel="保存しています…" onClick={save}>
                  CTAカードを保存する
                </Button>
              </div>
            </>
          )}
        </section>

        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="申込に使う回答フォーム">
          <h2 className="text-ink text-base font-bold">申込に使う回答フォーム</h2>
          <p className="text-ink-faint mt-1 text-xs">申し込みのときに答えてもらうフォームです。公開中のフォームから1つ選びます。</p>
          <div className="mt-3 max-w-md">
            <Select
              label="申込フォーム"
              aria-label="申込フォーム"
              value={selectedRegistrationFormId}
              onChange={(value) => setSelectedRegistrationFormId(value)}
              options={[
                { value: '', label: '申込フォームを選ぶ' },
                ...publishedForms.map((form) => ({ value: form.id, label: form.name })),
              ]}
            />
          </div>
          {registrationError ? <p className="text-danger mt-2 text-xs" role="alert">{registrationError}</p> : null}
          {registrationNotice ? <p className="text-ink-secondary mt-2 text-xs">{registrationNotice}</p> : null}
          <div className="mt-3">
            <Button
              variant="secondary"
              busy={savingRegistrationForm}
              busyLabel="保存しています…"
              onClick={saveRegistrationForm}
            >
              申込フォームを保存する
            </Button>
          </div>
        </section>
      </div>

      <aside className="w-full shrink-0 xl:w-95" aria-label="カードの見え方">
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
  )
}
