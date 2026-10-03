'use client'

/*
 * ★V8-B ウェビナー編集③CTA（板 `Q0Jrk`）。
 *
 * v7 の編集画面（`page.tsx` の `CtaDesignStep`・`CtasTab`）と同じ中身。
 * v7 側は触らず、こちらの段から使う。CTAカードの一覧・追加・保存と、
 * 申込に使う回答フォームの選択を持つ。保存は段の登録式に載せない
 * （カードの保存は枠の中の「保存する」で行う。今の作りのまま）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import { ApiError, fetchApi, webinarApi, type Webinar, type WebinarCtaCard, type WebinarEditor } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { ctaCardProblems } from './cta-card-validation'
import { EditorDetails, SummaryAside } from './edit-v8-shared'
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

type FormCandidates = { accountId: string | null; state: FormCandidateState; items: RegistrationFormOption[] }

function emptyFormCandidates(accountId: string | null): FormCandidates {
  return { accountId, state: accountId ? 'loading' : 'idle', items: [] }
}

type CtaEditing = { webinarId: string; loaded: boolean; ctas: WebinarCtaCard[]; times: string[]; message: string | null }

function emptyCtaEditing(webinarId: string): CtaEditing {
  return { webinarId, loaded: false, ctas: [], times: [], message: null }
}

function CtasTab({ webinarId, durationSeconds, forms, formsState, onRetryForms, onCtasLoaded }: { webinarId: string; durationSeconds: number; forms: Array<{ id: string; name: string }>; formsState: FormCandidateState; onRetryForms: () => void; onCtasLoaded?: (ctas: WebinarCtaCard[] | null) => void }) {
  const [editing, setEditing] = useState<CtaEditing>(() => emptyCtaEditing(webinarId))
  const [saving, setSaving] = useState(false)
  /* 取得の世代印。切替後に遅れて届いた前のウェビナーの応答はここで捨てる。 */
  const ctaRequestId = useRef(0)

  /* 描くのは今のウェビナーの分だけ。印が違えば「まだ何も無い」として描く。 */
  const current = editing.webinarId === webinarId ? editing : emptyCtaEditing(webinarId)
  const { ctas, times, message, loaded } = current
  /* 編集も今のウェビナーの分にだけ効かせる。 */
  const editCurrent = useCallback((update: (prev: CtaEditing) => CtaEditing) => {
    setEditing((prev) => (prev.webinarId === webinarId ? update(prev) : prev))
  }, [webinarId])
  const setMessage = useCallback((next: string | null) => {
    editCurrent((prev) => ({ ...prev, message: next }))
  }, [editCurrent])

  /*
    CTA の取得はここに一本化し、親の概要段は報告を受けて件数だけ描く。
    同じ口を親子で2回叩かない。
  */
  const loadCtas = useCallback(async () => {
    // ロード失敗時に空の状態で保存すると all-or-nothing 置換で既存 CTA を消して
    // しまうため、初回 GET が成功するまで保存を無効化する
    const requestId = ++ctaRequestId.current
    /* 取得を始めた時点で前の中身を捨てる。読み込み中に旧 CTA を触らせない。 */
    setEditing(emptyCtaEditing(webinarId))
    try {
      const res = await webinarApi.ctas(webinarId)
      /* 先に世代印を見る。切替後に届いた前の応答はここで終わり。 */
      if (requestId !== ctaRequestId.current) return
      /*
        **配列で来なかったら、読めなかったこととして扱う。**
        そのまま保存に進むと、置き換えで既存のCTAを消してしまう。
      */
      if (!Array.isArray(res.data)) throw new Error('cta_list_not_array')
      setEditing({ webinarId, loaded: true, ctas: res.data, times: res.data.map((c) => fmtMinSec(c.atSeconds)), message: null })
      onCtasLoaded?.(res.data)
    } catch {
      if (requestId !== ctaRequestId.current) return
      setEditing({ webinarId, loaded: false, ctas: [], times: [], message: 'CTAカードを読み込めませんでした。もう一度読み込んでください。読み込めるまで保存はできません。' })
      onCtasLoaded?.(null)
    }
  }, [webinarId, onCtasLoaded])

  useEffect(() => {
    void loadCtas()
    return () => { ctaRequestId.current += 1 }
  }, [loadCtas])

  const update = (i: number, patch: Partial<WebinarCtaCard>) =>
    editCurrent((prev) => ({ ...prev, ctas: prev.ctas.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))

  const save = async () => {
    /* 読めていない間は保存しない（空で全置換して既存 CTA を消さない）。 */
    if (!loaded) return
    setMessage(null)
    /*
      保存前に「どのカードの何が足りないか」を枚数で示す。公開前検証で
      止まる前に、ここで直し方まで伝える。1件でもあれば保存しない。
    */
    const problems = ctaCardProblems(ctas, times, durationSeconds, parseMinSec)
    if (problems.length > 0) {
      setMessage(problems.join('\n'))
      return
    }
    const merged: WebinarCtaCard[] = ctas.map((card, i) => ({
      ...card,
      atSeconds: parseMinSec(times[i] ?? '') as number,
    }))
    setSaving(true)
    try {
      const sorted = [...merged].sort((a, b) => a.atSeconds - b.atSeconds)
      await webinarApi.saveCtas(webinarId, sorted)
      editCurrent((prev) => ({ ...prev, ctas: sorted, times: sorted.map((c) => fmtMinSec(c.atSeconds)) }))
      /* 保存した中身を親の概要段へ流す。取り直しの GET は要らない。 */
      onCtasLoaded?.(sorted)
      setMessage(`${sorted.length}件保存しました`)
    } catch (err) {
      setMessage(`保存に失敗しました: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-faint">
        指定時間にチャット欄へ CTA カードが流れます。「フォーム」はウェビナー内でそのまま回答でき、
        フォーム機能のタグ付与・シナリオ発火が自動で動きます。「URL」は外部ページを開きます。
      </p>
      {message && (
        <Notice
          tone="info"
          action={!loaded ? (
            <button type="button" onClick={() => void loadCtas()} className="font-medium underline">もう一度読み込む</button>
          ) : undefined}
        >
          {message}
        </Notice>
      )}
      {ctas.map((c, i) => (
        <div key={i} className="space-y-2 rounded-mini border border-hairline p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              表示時間
              <input
                value={times[i] ?? ''}
                onChange={(e) =>
                  editCurrent((prev) => ({ ...prev, times: prev.times.map((t, j) => (j === i ? e.target.value : t)) }))
                }
                placeholder="45:00"
                className="w-20 rounded-mini border px-2 py-1"
              />
            </label>
            <Select aria-label="リンクの種類" value={c.kind} onChange={(value) => update(i, { kind: value as 'form' | 'url' })} options={[{ value: "form", label: "フォーム" }, { value: "url", label: "URL" }]} />
            {c.kind === 'form' ? (
              <>
                <Select
                  aria-label="使うフォーム"
                  value={c.formId ?? ''}
                  onChange={(value) => update(i, { formId: value || null })}
                  options={[{ value: '', label: 'フォームを選択...' }, ...forms.map((f) => ({ value: f.id, label: f.name }))]}
                />
                {(formsState === 'error' || formsState === 'forbidden') && (
                  <p className="text-danger w-full text-xs" role="alert">
                    {formsState === 'forbidden' ? 'フォーム候補を見る権限がありません。アカウントの権限を確認してください。' : 'フォーム候補を読み込めませんでした。'}
                    <button type="button" onClick={onRetryForms} className="ml-2 font-medium underline">もう一度読み込む</button>
                    <span className="text-ink-faint ml-2">候補が取れない間は種類をURLに切り替えて保存できます。</span>
                  </p>
                )}
              </>
            ) : (
              <input
                value={c.url ?? ''}
                onChange={(e) => update(i, { url: e.target.value || null })}
                placeholder="https://..."
                className="min-w-60 flex-1 rounded-mini border px-2 py-1"
              />
            )}
            {c.kind === 'form' && (
              <Checkbox
                checked={c.autoOpen}
                onCheckedChange={(checked) => update(i, { autoOpen: checked })}
              >自動でフォームを開く</Checkbox>
            )}
            <button
              onClick={() => {
                editCurrent((prev) => ({ ...prev, ctas: prev.ctas.filter((_, j) => j !== i), times: prev.times.filter((_, j) => j !== i) }))
              }}
              className="ml-auto text-danger"
            >
              削除
            </button>
          </div>
          <input
            value={c.title}
            onChange={(e) => update(i, { title: e.target.value })}
            placeholder="カード見出し（例: 個別導入診断、受付中です）"
            className="w-full rounded-mini border px-2 py-1 text-sm font-bold"
          />
          <input
            value={c.body ?? ''}
            onChange={(e) => update(i, { body: e.target.value || null })}
            placeholder="補足文（任意。例: この配信を見ている方限定・枠が少なめです）"
            className="w-full rounded-mini border px-2 py-1 text-sm"
          />
          <input
            value={c.buttonLabel}
            onChange={(e) => update(i, { buttonLabel: e.target.value })}
            placeholder="ボタン文言（例: 無料で診断を受ける）"
            className="w-full rounded-mini border px-2 py-1 text-sm"
          />
        </div>
      ))}
      <StickyBar actions={(
        <>
        <button
          onClick={() => {
            editCurrent((prev) => ({
              ...prev,
              ctas: [...prev.ctas, {
                atSeconds: 0, kind: 'form', title: '', body: null,
                buttonLabel: '', autoOpen: false, formId: null, url: null,
              }],
              times: [...prev.times, '0:00'],
            }))
          }}
          className="rounded-mini border px-3 py-1 text-sm"
        >
          + CTAカード追加
        </button>
        <button
          onClick={() => void save()}
          disabled={saving || !loaded}
          className="rounded-mini bg-action px-4 py-1 text-sm text-on-action disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存する'}
        </button>
        </>
      )} />
    </div>
  )
}

export default function CtaStepV8({ webinar, editor, accountId, registrations, publicUrl, canOpenPublicPage, publicPageReason, onEditorChange, onCtasReport }: {
  webinar: Webinar
  editor: WebinarEditor
  accountId: string | null
  registrations: number | null
  publicUrl: string | null
  canOpenPublicPage: boolean
  publicPageReason: string
  onEditorChange: (editor: WebinarEditor) => void
  onCtasReport?: (ctas: WebinarCtaCard[] | null) => void
}) {
  const webinarId = webinar.id
  const durationSeconds = webinar.durationSeconds
  /* 子から受け取った CTA も「どのウェビナーの分か」を一緒に持つ。 */
  const [reportedCtas, setReportedCtas] = useState<{ webinarId: string; items: WebinarCtaCard[] }>(() => ({ webinarId, items: [] }))
  const ctas = reportedCtas.webinarId === webinarId ? reportedCtas.items : []
  /*
    申込フォームの候補。CTA内で使うフォームとは別の選択肢。
    公開中のものだけを候補にし、停止・削除・別アカウントは選ばせない。
  */
  const [formCandidates, setFormCandidates] = useState<FormCandidates>(() => emptyFormCandidates(accountId))
  const [selectedRegistrationFormId, setSelectedRegistrationFormId] = useState<string>(editor.registrationFormId ?? '')
  const [savingRegistrationForm, setSavingRegistrationForm] = useState(false)
  const [registrationNotice, setRegistrationNotice] = useState('')
  const [registrationError, setRegistrationError] = useState('')
  /* 取得の世代印。切替後に遅れて届いた前の account の応答はここで捨てる。 */
  const formRequestId = useRef(0)

  /* 描くのは今の account の分だけ。印が違えば「これから読む」として描く。 */
  const currentFormCandidates = formCandidates.accountId === accountId ? formCandidates : emptyFormCandidates(accountId)
  const registrationForms = currentFormCandidates.items
  const registrationFormState = currentFormCandidates.state

  /*
    CTA の取得は子の編集タブ(`CtasTab`)に一本化し、親は報告を受けて
    件数だけ描く。同じ口を親子で2回叩かない。
  */
  const handleCtasLoaded = useCallback((next: WebinarCtaCard[] | null) => {
    setReportedCtas({ webinarId, items: next ?? [] })
    /* 段の印と最終確認もカード件数で決めるため、親へも届ける。 */
    onCtasReport?.(next)
  }, [webinarId, onCtasReport])

  const loadRegistrationForms = useCallback(() => {
    const requestId = ++formRequestId.current
    if (!accountId) {
      setFormCandidates({ accountId, state: 'idle', items: [] })
      return
    }
    /* 取得を始めた時点で前の候補を捨てる。読み込み中に旧候補を出さない。 */
    setFormCandidates({ accountId, state: 'loading', items: [] })
    fetchApi<{ success: boolean; data: Array<{ id: string; name: string; isActive?: boolean }> }>(`/api/forms?account_id=${encodeURIComponent(accountId)}`)
      .then((response) => {
        if (requestId !== formRequestId.current) return
        const items = Array.isArray(response.data) ? response.data : []
        setFormCandidates({ accountId, state: 'ready', items: items.map((form) => ({ id: form.id, name: form.name, isActive: form.isActive === true })) })
      })
      .catch((cause) => {
        if (requestId !== formRequestId.current) return
        /* 口自体は同一アカウントに絞っている。403・404 は権限不足、それ以外は取得失敗。 */
        setFormCandidates({ accountId, state: cause instanceof ApiError && (cause.status === 403 || cause.status === 404) ? 'forbidden' : 'error', items: [] })
      })
  }, [accountId])

  useEffect(() => {
    loadRegistrationForms()
    return () => { formRequestId.current += 1 }
  }, [loadRegistrationForms])

  /* 候補は公開中だけ。停止中は一覧に混ぜない。 */
  const publishedRegistrationForms = registrationForms.filter((form) => form.isActive)

  const saveRegistrationForm = async () => {
    /* 今の account の候補が揃うまで保存しない。切替直後に旧候補のIDを書き込ませない。 */
    if (registrationFormState !== 'ready') {
      setRegistrationNotice('')
      setRegistrationError('回答フォームの候補を読み込んでから保存してください。')
      return
    }
    /* 選択が今の候補に無いなら送らない。前の account の選択を新しい相手に保存させない。 */
    if (selectedRegistrationFormId && !publishedRegistrationForms.some((form) => form.id === selectedRegistrationFormId)) {
      setRegistrationNotice('')
      setRegistrationError('選んだ申込フォームは今の候補にありません。公開中のフォームを選び直してください。')
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
      setRegistrationNotice('申込フォームを保存しました。公開前確認で申込フォームが公開中か確認してください。')
    } catch (cause) {
      if (cause instanceof ApiError && (cause.code === 'form_inactive_or_missing' || cause.code === 'form_account_mismatch')) {
        /* 停止・削除・別アカウントはサーバーが拒否する。候補を取り直して選び直しを促す。 */
        loadRegistrationForms()
      }
      setRegistrationError(webinarErrorText(cause, '申込フォームを保存できませんでした。開き直して試してください。'))
    } finally {
      setSavingRegistrationForm(false)
    }
  }

  const primary = ctas[0]
  const forms = registrationForms.map(({ id, name }) => ({ id, name }))
  const selectedForm = forms.find((form) => form.id === primary?.formId)
  /* 保存済みだが候補に無い = 停止・削除・別アカウント。拒否理由と選び直しを出す。 */
  const savedRegistrationFormMissing = Boolean(
    editor.registrationFormId && !publishedRegistrationForms.some((form) => form.id === editor.registrationFormId),
  )

  return (
    <div className={styles.body}>
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-semibold">CTA設定</h2><p className="text-ink-faint mt-1 text-xs">動画内に表示するボタンとタイミングを設定します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">表示タイミング</dt><dd className="text-ink text-sm font-semibold">{primary ? `動画の${Math.floor(primary.atSeconds / 60)}分${String(primary.atSeconds % 60).padStart(2, '0')}秒` : '—（未設定）'}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">ボタン文言</dt><dd className="text-ink text-sm font-semibold">{primary?.buttonLabel || '—（未設定）'}</dd></div></dl>{(registrationFormState === 'error' || registrationFormState === 'forbidden') && (<p className="text-danger mt-3 text-xs" role="alert">{registrationFormState === 'forbidden' ? 'フォーム候補を見る権限がありません。' : 'フォーム候補を読み込めませんでした。'}<button type="button" onClick={loadRegistrationForms} className="ml-2 font-semibold underline">もう一度読み込む</button></p>)}</section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-semibold">申込フォーム</h2><p className="text-ink-faint mt-1 text-xs">申込情報の保存先と完了アクションを設定します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">入力項目</dt><dd className="text-ink max-w-2xl text-right text-sm font-semibold">{editor.publicPage.form?.fields.join('・') || selectedForm?.name || '—（未設定）'}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">完了アクション</dt><dd className="text-ink max-w-2xl text-right text-sm font-semibold">{editor.publicPage.form?.completionActions.join('・') || '設定なし'}</dd></div></dl></section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">申込フォームの選択</h2>
          <p className="text-ink-faint mt-1 text-xs">公開前の確認で使う申込フォームを選びます。動画内のCTAボタンで使うフォームとは別です。同じLINE公式アカウントの公開中の回答フォームだけが候補に出ます。</p>
          <dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">保存済み</dt><dd className="text-ink max-w-2xl text-right text-sm font-semibold">{editor.publicPage.form ? `${editor.publicPage.form.name}（${editor.publicPage.form.fields.length}項目）` : '—（未設定）'}</dd></div></dl>
          <div className="mt-4 space-y-3">
            {!accountId ? <p className="text-ink-faint text-sm">このウェビナーのLINE公式アカウントを確認できません。</p> : null}
            {accountId && registrationFormState === 'loading' ? <p className="text-ink-faint text-sm">回答フォームを読み込んでいます。</p> : null}
            {accountId && registrationFormState === 'forbidden' ? (
              <div className="space-y-2"><p className="text-danger text-sm">回答フォームを見る権限がありません。アカウントの権限を確認してください。</p><Button onClick={loadRegistrationForms}>もう一度読み込む</Button></div>
            ) : null}
            {accountId && registrationFormState === 'error' ? (
              <div className="space-y-2"><p className="text-danger text-sm">回答フォームを読み込めませんでした。</p><Button onClick={loadRegistrationForms}>もう一度読み込む</Button></div>
            ) : null}
            {accountId && registrationFormState === 'ready' && publishedRegistrationForms.length === 0 ? (
              <p className="text-ink-faint text-sm">公開中の回答フォームがありません。フォーム機能で公開中のフォームを作ってください。</p>
            ) : null}
            {accountId && registrationFormState === 'ready' && publishedRegistrationForms.length > 0 ? (
              <div className="max-w-md">
                <Select
                  value={selectedRegistrationFormId}
                  onChange={(value) => setSelectedRegistrationFormId(value)}
                  aria-label="申込に使う回答フォーム"
                  options={[{ value: '', label: '申込フォームを選ぶ' }, ...publishedRegistrationForms.map((form) => ({ value: form.id, label: form.name }))]}
                />
              </div>
            ) : null}
            {registrationFormState === 'ready' && selectedRegistrationFormId && !publishedRegistrationForms.some((form) => form.id === selectedRegistrationFormId) ? (
              <p className="text-warning text-sm">前に選んだフォームは使えなくなりました（停止・削除・別アカウント）。公開中のフォームを選び直して保存してください。</p>
            ) : null}
            {savedRegistrationFormMissing && registrationFormState === 'ready' ? (
              <p className="text-warning text-sm">保存済みの申込フォームは公開中ではありません（停止・削除・別アカウント）。このままでは公開前確認を通りません。</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void saveRegistrationForm()} disabled={savingRegistrationForm || registrationFormState !== 'ready' || !accountId} busy={savingRegistrationForm}>申込フォームを保存する</Button>
            </div>
            {registrationNotice ? <p className="text-ink-secondary text-sm">{registrationNotice}</p> : null}
            {registrationError ? <p className="text-danger text-sm" role="alert">{registrationError}</p> : null}
          </div>
        </section>
        <EditorDetails label="CTAカードとフォームの詳細を編集する"><CtasTab webinarId={webinarId} durationSeconds={durationSeconds} forms={forms} formsState={registrationFormState} onRetryForms={loadRegistrationForms} onCtasLoaded={handleCtasLoaded} /></EditorDetails>
      </div>
      <SummaryAside rows={[
        ['CTA', `${formatNumber(ctas.length)}件`],
        ['フォーム', primary?.formId ? '公開中' : '未設定'],
        ['申込', registrations === null ? '—（未取得）' : `${formatNumber(registrations)}人`],
      ]} previewBody={primary?.body || 'CTAの説明文はまだ設定されていません。'} previewButton={primary?.buttonLabel || null}>
        <div className="flex gap-2"><Button disabled title="確認の段で実行します">テストを送る</Button>{canOpenPublicPage && publicUrl ? <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : <Button disabled title={publicPageReason}>公開ページを見る</Button>}</div>
        {!(canOpenPublicPage && publicUrl) && publicPageReason ? <p className="text-ink-faint text-xs">{publicPageReason}</p> : null}
      </SummaryAside>
    </div>
  )
}
