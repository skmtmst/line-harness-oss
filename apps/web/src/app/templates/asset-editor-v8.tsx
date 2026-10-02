'use client'

/*
 * ★V8 資産テンプレートの作る画面（Pencil EFV8l・S6FEuB・EsYo4）。
 *
 * - リッチメッセージ: 1枚の画像を面に分けて、押した面ごとに動く
 * - クーポン: 期間・回数・抽選を決めて配る
 * - リサーチ: LINEの中で答える短い質問
 *
 * 保存値の組み立て・入力の断り方・メディア選択は v7（template-asset-editor.tsx）
 * と同じ関数・同じ口を使う。資産APIには「公開」が無いので、下書きを保存は
 * 保存してこの画面に留まり、保存して公開は保存して一覧へ戻る（API待ちの
 * 件は DEVIN-QUESTIONS.md に記録）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Folder, MediaItem } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Toggle from '@/components/shared/toggle'
import LinePreview from '@/components/shared/line-preview'
import Combobox from '@/components/shared/combobox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import { Field, inputClass, TextArea } from '@/components/shared/form-controls'
import DateTimeField from '@/components/shared/date-time-field'
import InlineActionList, { useActionOptions } from '@/components/auto-replies/inline-action-list'
import { toActionPayload, type InlineAction } from '@/components/auto-replies/draft-fields'
import { useAccount } from '@/contexts/account-context'
import MediaPickerDialog from '@/app/contents/media-picker-dialog'
import EditorV8, { EditorCard } from './editor-v8'
import styles from './editor-v8.module.css'
import {
  MAX_CHOICES,
  MAX_QUESTIONS,
  META,
  RICH_SHAPES,
  areaDraftConfigured,
  areaSummary,
  displayDateTime,
  emptyAreaDraft,
  newQuestion,
  visualQuestions,
  type AreaActionKind,
  type AreaDraft,
  type AssetKind,
  type ResearchFormat,
  type ResearchQuestion,
} from './template-asset-editor'

/** 画面ごとの見出しと説明（Pencil の絵のまま）。 */
const V8_META: Record<AssetKind, { title: string; lead: string; designNode: string }> = {
  rich_message: {
    title: 'リッチメッセージを作る',
    lead: '1枚の画像を面に分けて、押した面ごとに動く',
    designNode: 'EFV8l',
  },
  coupon: {
    title: 'クーポンを作る',
    lead: '期間・回数・抽選を決めて配る',
    designNode: 'S6FEuB',
  },
  research: {
    title: 'リサーチを作る',
    lead: 'LINEの中で答える短い質問。住所や画像も聞くなら回答フォーム',
    designNode: 'EsYo4',
  },
}

const FORMAT_OPTIONS: Array<{ value: ResearchFormat; label: string }> = [
  { value: 'single', label: '1つだけ選ぶ' },
  { value: 'multiple', label: 'いくつでも選ぶ' },
  { value: 'free', label: '自由に書く' },
]

export default function TemplateAssetEditorV8({ kind, visual = false }: { kind: AssetKind; visual?: boolean }) {
  const meta = META[kind]
  const v8meta = V8_META[kind]
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [name, setName] = useState(visual ? ({ rich_message: '夏のキャンペーン告知', coupon: '夏の20%オフ', research: '定期便のご満足度' }[kind]) : '')
  const [folder, setFolder] = useState(visual ? meta.folder : '')
  const [folders, setFolders] = useState<Folder[]>([])
  const [description, setDescription] = useState(visual ? (kind === 'coupon' ? '会計時にこの画面をご提示ください。他の割引との併用はできません。' : kind === 'research' ? 'いつもありがとうございます。3問だけ聞かせてください。' : '') : '')
  const [imageUrl, setImageUrl] = useState('')
  const [pickedMedia, setPickedMedia] = useState<MediaItem | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [shape, setShape] = useState('3')
  const [pendingShape, setPendingShape] = useState<string | null>(null)
  const [areaDrafts, setAreaDrafts] = useState<Record<string, AreaDraft>>({})
  // クーポン
  const [couponOnce, setCouponOnce] = useState<'once' | 'unlimited'>('once')
  const [couponVisibility, setCouponVisibility] = useState<'friends' | 'link'>('friends')
  const [lottery, setLottery] = useState(false)
  const [lotteryRate, setLotteryRate] = useState('20')
  const [winnerLimit, setWinnerLimit] = useState('500')
  const [couponStartsAt, setCouponStartsAt] = useState(visual ? '2026-08-01T00:00' : '')
  const [couponEndsAt, setCouponEndsAt] = useState(visual ? '2026-08-31T23:59' : '')
  const [couponUseActions, setCouponUseActions] = useState<InlineAction[]>([])
  // リサーチ
  const [researchStartsAt, setResearchStartsAt] = useState(visual ? '2026-10-01T10:00' : '')
  const [researchEndsAt, setResearchEndsAt] = useState(visual ? '2026-10-15T23:59' : '')
  const [targetTagId, setTargetTagId] = useState('')
  const [questions, setQuestions] = useState<ResearchQuestion[]>(() => (visual ? visualQuestions() : [newQuestion()]))
  const [answerActions, setAnswerActions] = useState<InlineAction[]>([])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const actionOptions = useActionOptions()

  const shapeDef = RICH_SHAPES.find((candidate) => candidate.value === shape) ?? RICH_SHAPES[3]
  const pendingShapeDef = pendingShape ? RICH_SHAPES.find((candidate) => candidate.value === pendingShape) : undefined
  const droppingAreaLabels = pendingShapeDef
    ? shapeDef.areas
        .filter((area) => !pendingShapeDef.areas.some((next) => next.label === area.label))
        .filter((area) => areaDraftConfigured(areaDrafts[area.label]))
        .map((area) => area.label)
    : []

  useEffect(() => {
    setPickedMedia(null)
    setImageUrl('')
  }, [selectedAccountId])

  /* フォルダはアカウントの置き場一覧から選ぶ（保存値はフォルダ名のまま）。 */
  useEffect(() => {
    setFolders([])
    if (!selectedAccountId) return
    let cancelled = false
    void api.folders.list('template', selectedAccountId).then((res) => {
      if (!cancelled && res.success) setFolders(res.data)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [selectedAccountId])

  const pickMedia = (item: MediaItem) => {
    setImageUrl(item.url)
    setPickedMedia(item)
    setPickerOpen(false)
  }

  const updateArea = (label: string, patch: Partial<AreaDraft>) =>
    setAreaDrafts((prev) => ({ ...prev, [label]: { ...(prev[label] ?? emptyAreaDraft()), ...patch } }))

  const requestShape = (value: string) => {
    const next = RICH_SHAPES.find((candidate) => candidate.value === value)
    if (!next || value === shape) return
    const removed = shapeDef.areas.filter((area) => !next.areas.some((n) => n.label === area.label))
    if (removed.some((area) => areaDraftConfigured(areaDrafts[area.label]))) {
      setPendingShape(value)
      return
    }
    setShape(value)
  }

  const confirmShapeChange = () => {
    if (!pendingShapeDef) return
    const kept = new Set(pendingShapeDef.areas.map((area) => area.label))
    setAreaDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([label]) => kept.has(label))))
    setShape(pendingShapeDef.value)
    setPendingShape(null)
  }

  const updateQuestion = (index: number, patch: Partial<ResearchQuestion>) =>
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)))

  const moveQuestion = (index: number, delta: -1 | 1) =>
    setQuestions((prev) => {
      const to = index + delta
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })

  const addQuestion = () => {
    if (questions.length >= MAX_QUESTIONS) return
    setQuestions((prev) => [...prev, newQuestion()])
  }

  const removeQuestion = (index: number) => {
    if (questions.length <= 1) return
    setQuestions((prev) => prev.filter((_, i) => i !== index))
  }

  /** 未保存判定：保存へ送る入力全部の姿（v7と同じ値）。 */
  const snapshot = useMemo(() => JSON.stringify({
    name, folder, description, imageUrl, pickedMedia, shape, areaDrafts,
    couponOnce, couponVisibility, lottery, lotteryRate, winnerLimit,
    couponStartsAt, couponEndsAt, couponUseActions,
    researchStartsAt, researchEndsAt, targetTagId, questions, answerActions,
  }), [name, folder, description, imageUrl, pickedMedia, shape, areaDrafts, couponOnce, couponVisibility, lottery, lotteryRate, winnerLimit, couponStartsAt, couponEndsAt, couponUseActions, researchStartsAt, researchEndsAt, targetTagId, questions, answerActions])
  const [cleanSnapshot, setCleanSnapshot] = useState(() => snapshot)
  const dirty = snapshot !== cleanSnapshot

  /** 保存値を組み立てる。入力が足りないときはエラーメッセージを返す（v7と同じ決まり）。 */
  const buildPayload = (): { payload: Record<string, unknown> } | { error: string } => {
    if (kind === 'rich_message') {
      if (!imageUrl.trim()) return { error: '画像を設定してください。' }
      for (const area of shapeDef.areas) {
        const draft = areaDrafts[area.label]
        if (draft?.kind === 'uri' && !draft.uri.trim()) {
          return { error: `面 ${area.label} のURLを入力してください。` }
        }
      }
      return {
        payload: {
          imageUrl: imageUrl.trim(),
          imageMediaId: pickedMedia?.id ?? null,
          imageMediaKind: pickedMedia?.kind ?? null,
          shape,
          tapAreas: shapeDef.areas.map((area) => {
            const draft = areaDrafts[area.label] ?? emptyAreaDraft()
            return {
              label: area.label,
              x: area.x,
              y: area.y,
              width: area.width,
              height: area.height,
              actionType: draft.kind === 'uri' ? 'uri' : draft.kind === 'actions' ? 'postback' : 'none',
              ...(draft.kind === 'uri' ? { uri: draft.uri.trim() } : {}),
              ...(draft.kind === 'actions' ? { actions: draft.actions.map(toActionPayload) } : {}),
            }
          }),
        },
      }
    }
    if (kind === 'coupon') {
      if (!couponStartsAt || !couponEndsAt) return { error: '使える期間の開始と終了を入力してください。' }
      if (couponEndsAt <= couponStartsAt) return { error: '使える期間の終了は開始よりあとにしてください。' }
      if (lottery) {
        const rate = Number(lotteryRate)
        const limit = Number(winnerLimit)
        if (!Number.isInteger(rate) || rate < 1 || rate > 100) return { error: '当たる確率は1〜100の整数で入力してください。' }
        if (!Number.isInteger(limit) || limit < 1) return { error: '当選人数の上限は1以上の整数で入力してください。' }
      }
      return {
        payload: {
          description,
          imageUrl,
          imageMediaId: pickedMedia?.id ?? null,
          imageMediaKind: pickedMedia?.kind ?? null,
          startsAt: couponStartsAt,
          endsAt: couponEndsAt,
          oncePerFriend: couponOnce === 'once',
          visibility: couponVisibility,
          lottery,
          ...(lottery ? { lotteryRate: Number(lotteryRate), winnerLimit: Number(winnerLimit) } : {}),
          useActions: couponUseActions.map(toActionPayload),
        },
      }
    }
    // research
    if (questions.length === 0) return { error: '質問を1つ以上作ってください。' }
    for (const [index, question] of questions.entries()) {
      if (!question.text.trim()) return { error: `質問 ${index + 1} の本文を入力してください。` }
      if (question.format !== 'free' && question.choices.filter((choice) => choice.trim()).length < 1) {
        return { error: `質問 ${index + 1} の選択肢を1つ以上入力してください。` }
      }
    }
    return {
      payload: {
        description,
        startsAt: researchStartsAt || null,
        endsAt: researchEndsAt || null,
        targetTagId: targetTagId || null,
        questions: questions.map((question) => ({
          text: question.text.trim(),
          format: question.format,
          required: question.required,
          choices: question.format === 'free' ? [] : question.choices.map((choice) => choice.trim()).filter(Boolean),
        })),
        questionCount: questions.length,
        answerActions: answerActions.map(toActionPayload),
      },
    }
  }

  /** 保存する。できたら保存済みの姿を更新する。 */
  const save = async (): Promise<boolean> => {
    if (!selectedAccountId) { setError('上のバーでLINE公式アカウントを選んでください。'); return false }
    if (!name.trim()) { setError(`${meta.title}名を入力してください。`); return false }
    const built = buildPayload()
    if ('error' in built) { setError(built.error); return false }
    setSaving(true)
    setError('')
    try {
      const result = await api.broadcastMessageAssets.create({
        lineAccountId: selectedAccountId,
        kind,
        name: name.trim(),
        payload: { ...built.payload, folder },
      })
      if (!result.success) {
        setError(result.error || '保存できませんでした。')
        return false
      }
      setSaved(true)
      setCleanSnapshot(snapshot)
      return true
    } catch {
      setError('保存できませんでした。通信状態を確認して、もう一度お試しください。')
      return false
    } finally {
      setSaving(false)
    }
  }

  const onSaveDraft = async () => { await save() }
  const onPublish = async () => {
    setPublishing(true)
    try {
      const ok = await save()
      if (ok) router.push('/templates')
    } finally {
      setPublishing(false)
    }
  }

  const unsetAreas = shapeDef.areas.filter((area) => !areaDraftConfigured(areaDrafts[area.label]))
  const previewQuestion = questions[0]

  const guideCard = kind === 'rich_message' ? (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>リッチメニューとの違い</h2>
      </div>
      <p className={styles.muted}>リッチメッセージはトークに1回流れて、過去のやり取りに残ります。リッチメニューは画面の下に常に出ます。</p>
    </section>
  ) : kind === 'coupon' ? (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>公開したあとに見られる数</h2>
      </div>
      <div className={styles.statRow}><span className={styles.statTerm}>配った数</span><span className={styles.statValue}>—</span></div>
      <div className={styles.statRow}><span className={styles.statTerm}>使われた数</span><span className={styles.statValue}>—</span></div>
      <div className={styles.statRow}><span className={styles.statTerm}>当選した数</span><span className={styles.statValue}>{lottery ? '—' : '抽選なし'}</span></div>
    </section>
  ) : (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>回答フォームとの使い分け</h2>
      </div>
      <p className={styles.muted}>リサーチはLINEの中で完結する短い質問向けです。住所や画像も聞く場合は回答フォームを使います。</p>
    </section>
  )

  return (
    <>
      <EditorV8
        title={v8meta.title}
        lead={v8meta.lead}
        designNode={v8meta.designNode}
        dirty={dirty && !saved}
        dirtySubject={`${meta.title}の変更`}
        saving={saving}
        publishing={publishing}
        status={saved ? '保存しました。一覧へ戻れます。' : '下書き（まだ誰にも送られません）'}
        saveBlockedReason={saved ? '保存しました。一覧へ戻ってください。' : null}
        onSaveDraft={() => void onSaveDraft()}
        onPublish={() => void onPublish()}
        error={error || undefined}
        guide={(
          <>
            {saved ? <Notice tone="success" message="保存しました。" /> : null}
            {guideCard}
          </>
        )}
        preview={(
          <LinePreview note={`${meta.title}の見え方`} caption="配信日 10:00">
            <div className="rounded-card bg-canvas p-4 text-ink">
              <p className="font-bold">{name || `${meta.title}名`}</p>
              {kind === 'rich_message' ? (
                <div className="bg-canvas-sunken relative mt-3 aspect-square w-full overflow-hidden rounded-control">
                  {/^https?:\/\//.test(imageUrl.trim()) ? (
                    <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${imageUrl.trim()})` }} />
                  ) : null}
                  {shapeDef.areas.map((area) => (
                    <div
                      key={area.label}
                      className="border-ink-faint/70 text-ink absolute flex flex-col items-center justify-center border border-dashed font-bold"
                      style={{ left: `${area.x}%`, top: `${area.y}%`, width: `${area.width}%`, height: `${area.height}%` }}
                    >
                      <span>{area.label}</span>
                      <span className="text-ink-faint text-micro font-normal">{areaSummary(areaDrafts[area.label])}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {kind === 'coupon' ? (
                <>
                  <p className="mt-2 text-sm">{displayDateTime(couponStartsAt)} 〜 {displayDateTime(couponEndsAt)}</p>
                  <p className="mt-3 text-sm leading-relaxed">{description}</p>
                  <Button type="button" className="mt-4 w-full">クーポンを使う</Button>
                </>
              ) : null}
              {kind === 'research' ? (
                <>
                  <p className="mt-2 text-xs">質問 1 / {questions.length}</p>
                  <p className="mt-3 text-sm font-medium">{previewQuestion?.text || '（質問文）'}</p>
                  {previewQuestion?.format === 'free' ? (
                    <p className="border-hairline text-ink-faint mt-2 rounded-control border border-dashed p-2 text-center text-sm">自由記述の回答欄</p>
                  ) : (
                    previewQuestion?.choices.filter((choice) => choice.trim()).map((choice) => (
                      <p key={choice} className="border-hairline mt-2 rounded-control border p-2 text-center text-sm">{choice}</p>
                    ))
                  )}
                </>
              ) : null}
            </div>
          </LinePreview>
        )}
      >
        <EditorCard title="名前とフォルダ" note="一覧に出る名前です。友だちには見えません。">
          <div className={styles.fieldRow}>
            <Field label="テンプレート名" htmlFor={`ta8-${kind}-name`} required>
              <input
                id={`ta8-${kind}-name`}
                type="text"
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="フォルダ" htmlFor={`ta8-${kind}-folder`}>
              <Select
                id={`ta8-${kind}-folder`}
                aria-label="フォルダ"
                value={folder}
                onChange={setFolder}
                options={[{ value: '', label: '未分類' }, ...folders.map((f) => ({ value: f.name, label: f.name }))]}
              />
            </Field>
          </div>
        </EditorCard>

        {kind === 'rich_message' ? (
          <>
            <EditorCard title="面の分け方" note="選んだ形に合わせて、下の設定が増えます">
              <div className={styles.shapeGrid} role="group" aria-label="面の分け方">
                {RICH_SHAPES.map((candidate) => (
                  <button
                    key={candidate.value}
                    type="button"
                    className={styles.shapeButton}
                    data-active={shape === candidate.value}
                    aria-pressed={shape === candidate.value}
                    onClick={() => requestShape(candidate.value)}
                  >
                    <span className={styles.shapeGlyph}>{candidate.glyph}</span>
                    {candidate.label}
                  </button>
                ))}
              </div>
            </EditorCard>
            <EditorCard title="画像" note="1040 × 1040px（正方形）がおすすめ">
              <div className={styles.imagePick}>
                {/^https?:\/\//.test(imageUrl.trim()) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl.trim()} alt="" className={styles.imageThumb} />
                ) : null}
                <Button type="button" onClick={() => setPickerOpen(true)}>登録メディアから選ぶ</Button>
                {pickedMedia ? <p className="text-success text-xs">選択中: {pickedMedia.filename}</p> : null}
                <input
                  className={inputClass}
                  value={imageUrl}
                  onChange={(event) => { setImageUrl(event.target.value); setPickedMedia(null) }}
                  placeholder="画像URL"
                  aria-label="画像のURL"
                />
              </div>
              <p className={styles.muted}>面の線は画像の上に重ねて表示されます。友だちには線は見えません。</p>
            </EditorCard>
            <EditorCard title="押した面ごとの動き" note="面ごとに「URLを開く」か「動きを実行する」を選べます">
              {shapeDef.areas.map((area) => {
                const draft = areaDrafts[area.label] ?? emptyAreaDraft()
                return (
                  <div key={area.label} className={styles.subCard}>
                    <div className={styles.subCardHead}>
                      <p className={styles.subCardTitle}>面 {area.label}</p>
                    </div>
                    <Select
                      value={draft.kind}
                      onChange={(value) => updateArea(area.label, { kind: value as AreaActionKind })}
                      aria-label={`面 ${area.label} の動き`}
                      options={[
                        { value: 'none', label: '未設定（押しても何も起きません）' },
                        { value: 'uri', label: 'URLを開く' },
                        { value: 'actions', label: '動きを実行する' },
                      ]}
                      size="full"
                    />
                    {draft.kind === 'uri' ? (
                      <input
                        type="url"
                        className={inputClass}
                        value={draft.uri}
                        onChange={(event) => updateArea(area.label, { uri: event.target.value })}
                        placeholder="https://example.com"
                        aria-label={`面 ${area.label} のURL`}
                      />
                    ) : null}
                    {draft.kind === 'actions' ? (
                      <InlineActionList
                        actions={draft.actions}
                        onChange={(next) => updateArea(area.label, { actions: next })}
                        tags={actionOptions.tags}
                        fields={actionOptions.fields}
                        marks={actionOptions.marks}
                        scenarios={actionOptions.scenarios}
                        vars={actionOptions.vars}
                      />
                    ) : null}
                  </div>
                )
              })}
              {unsetAreas.length > 0 ? (
                <p className={styles.warn}>
                  {unsetAreas.map((area) => `面 ${area.label}`).join('・')}の動きが未設定です。そのまま送ると、押しても何も起きません。
                </p>
              ) : null}
            </EditorCard>
          </>
        ) : kind === 'coupon' ? (
          <>
            <EditorCard title="中身" note="クーポンの画面にお客さまへ見せる文">
              <Field label="使うときの説明" htmlFor={`ta8-coupon-desc`}>
                <TextArea
                  id="ta8-coupon-desc"
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="例：会計時にこの画面をご提示ください。他の割引との併用はできません。"
                />
              </Field>
              <div className={styles.imagePick}>
                {/^https?:\/\//.test(imageUrl.trim()) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl.trim()} alt="" className={styles.imageThumb} />
                ) : null}
                <Button type="button" onClick={() => setPickerOpen(true)}>登録メディアから選ぶ</Button>
                {pickedMedia ? <p className="text-success text-xs">選択中: {pickedMedia.filename}</p> : null}
                <p className={styles.muted}>クーポンの画像（任意・1029 × 1029px 推奨）</p>
                <input
                  className={inputClass}
                  value={imageUrl}
                  onChange={(event) => { setImageUrl(event.target.value); setPickedMedia(null) }}
                  placeholder="画像URL"
                  aria-label="クーポン画像のURL"
                />
              </div>
            </EditorCard>
            <EditorCard title="使える期間と回数" note="この管理画面の時刻（日本時間）で入ります">
              <div className={styles.fieldRowEven}>
                <Field label="開始" htmlFor="ta8-coupon-start" required>
                  <DateTimeField id="ta8-coupon-start" value={couponStartsAt} onChange={setCouponStartsAt} aria-label="使える期間の開始" />
                </Field>
                <Field label="終了" htmlFor="ta8-coupon-end" required>
                  <DateTimeField id="ta8-coupon-end" value={couponEndsAt} onChange={setCouponEndsAt} aria-label="使える期間の終了" />
                </Field>
              </div>
              <Field label="1人が使える回数">
                <SegmentedControl
                  aria-label="1人が使える回数"
                  options={[
                    { value: 'once' as const, label: '1人1回だけ' },
                    { value: 'unlimited' as const, label: '期間中なら何回でも' },
                  ]}
                  value={couponOnce}
                  onChange={setCouponOnce}
                />
              </Field>
              <Field label="受け取れる人">
                <SegmentedControl
                  aria-label="受け取れる人"
                  options={[
                    { value: 'friends' as const, label: '友だちだけ' },
                    { value: 'link' as const, label: 'リンクを知っている人' },
                  ]}
                  value={couponVisibility}
                  onChange={setCouponVisibility}
                />
              </Field>
              <div className={styles.subCard}>
                <div className={styles.subCardHead}>
                  <p className={styles.subCardTitle}>抽選</p>
                  <Toggle
                    checked={lottery}
                    label="抽選する"
                    onChange={setLottery}
                  />
                </div>
                {lottery ? (
                  <div className={styles.fieldRowEven}>
                    <Field label="当たる確率" htmlFor="ta8-lottery-rate">
                      <span className="flex items-center gap-2">
                        <input id="ta8-lottery-rate" type="number" min={1} max={100} className={inputClass} value={lotteryRate} onChange={(event) => setLotteryRate(event.target.value)} />
                        <span className={styles.muted}>%</span>
                      </span>
                    </Field>
                    <Field label="当選人数の上限" htmlFor="ta8-winner-limit">
                      <span className="flex items-center gap-2">
                        <input id="ta8-winner-limit" type="number" min={1} className={inputClass} value={winnerLimit} onChange={(event) => setWinnerLimit(event.target.value)} />
                        <span className={styles.muted}>人</span>
                      </span>
                    </Field>
                  </div>
                ) : (
                  <p className={styles.muted}>抽選しないときは、受け取った人全員に配ります。</p>
                )}
              </div>
            </EditorCard>
            <EditorCard title="使われたときに行うこと" note="クーポンが使われたときに実行されます">
              <InlineActionList
                actions={couponUseActions}
                onChange={setCouponUseActions}
                tags={actionOptions.tags}
                fields={actionOptions.fields}
                marks={actionOptions.marks}
                scenarios={actionOptions.scenarios}
                vars={actionOptions.vars}
              />
            </EditorCard>
          </>
        ) : (
          <>
            <EditorCard title="受付" note="受付の期間と答えてもらう人">
              <div className={styles.fieldRowEven}>
                <Field label="受付の開始" htmlFor="ta8-research-start">
                  <DateTimeField id="ta8-research-start" value={researchStartsAt} onChange={setResearchStartsAt} aria-label="受付の開始" />
                </Field>
                <Field label="受付の終了" htmlFor="ta8-research-end">
                  <DateTimeField id="ta8-research-end" value={researchEndsAt} onChange={setResearchEndsAt} aria-label="受付の終了" />
                </Field>
              </div>
              <Field label="答えてもらう人" note="タグで絞れます。選ばなければ全員が対象です。">
                <Combobox
                  aria-label="答えてもらう人"
                  placeholder="友だち全員"
                  value={targetTagId}
                  onChange={setTargetTagId}
                  options={actionOptions.tags.map((tag) => ({ value: tag.id, label: tag.name }))}
                />
              </Field>
            </EditorCard>
            <EditorCard title="はじめのあいさつ" note="リサーチの先頭にお客さまへ見せる文">
              <TextArea
                aria-label="はじめのあいさつ"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="例：いつもありがとうございます。3問だけ聞かせてください。"
              />
            </EditorCard>
            <EditorCard title="質問" note={`上から順に出ます。${questions.length} / ${MAX_QUESTIONS} 問`}>
              {questions.map((question, index) => (
                <div key={question.key} className={styles.subCard}>
                  <div className={styles.subCardHead}>
                    <p className={styles.subCardTitle}>問 {index + 1}</p>
                    <div className={styles.subCardTools}>
                      <Checkbox
                        checked={question.required}
                        onCheckedChange={(checked) => updateQuestion(index, { required: checked })}
                        aria-label={`質問 ${index + 1} を必須にする`}
                      >
                        必ず答えてもらう
                      </Checkbox>
                      <button
                        type="button"
                        className={styles.toolButton}
                        aria-label={`質問 ${index + 1} を上へ`}
                        title="上へ"
                        disabled={index === 0}
                        onClick={() => moveQuestion(index, -1)}
                      >↑</button>
                      <button
                        type="button"
                        className={styles.toolButton}
                        aria-label={`質問 ${index + 1} を下へ`}
                        title="下へ"
                        disabled={index === questions.length - 1}
                        onClick={() => moveQuestion(index, 1)}
                      >↓</button>
                      <button
                        type="button"
                        className={`${styles.toolButton} ${styles.toolButtonDanger}`}
                        aria-label={`質問 ${index + 1} を消す`}
                        title={questions.length <= 1 ? '質問は1つ必要です' : 'この質問を消す'}
                        disabled={questions.length <= 1}
                        onClick={() => removeQuestion(index)}
                      >消す</button>
                    </div>
                  </div>
                  <Field label="質問文" htmlFor={`ta8-q-${question.key}`} required>
                    <input
                      id={`ta8-q-${question.key}`}
                      className={inputClass}
                      value={question.text}
                      onChange={(event) => updateQuestion(index, { text: event.target.value })}
                      placeholder="質問文"
                    />
                  </Field>
                  <Field label="答え方">
                    <SegmentedControl
                      aria-label={`質問 ${index + 1} の答え方`}
                      options={FORMAT_OPTIONS}
                      value={question.format}
                      onChange={(value) => updateQuestion(index, { format: value })}
                    />
                  </Field>
                  {question.format !== 'free' ? (
                    <div>
                      <p className={styles.guideTerm}>選択肢</p>
                      <div className="mt-2 space-y-2">
                        {question.choices.map((choice, choiceIndex) => (
                          <div key={choiceIndex} className="flex items-center gap-2">
                            <input
                              className={inputClass}
                              value={choice}
                              onChange={(event) => updateQuestion(index, { choices: question.choices.map((c, i) => (i === choiceIndex ? event.target.value : c)) })}
                              placeholder={`選択肢 ${choiceIndex + 1}`}
                              aria-label={`質問 ${index + 1} の選択肢 ${choiceIndex + 1}`}
                            />
                            <button
                              type="button"
                              className={`${styles.toolButton} ${styles.toolButtonDanger} shrink-0`}
                              aria-label={`質問 ${index + 1} の選択肢 ${choiceIndex + 1} を消す`}
                              disabled={question.choices.length <= 1}
                              title={question.choices.length <= 1 ? '選択肢は1つ必要です' : 'この選択肢を消す'}
                              onClick={() => updateQuestion(index, { choices: question.choices.filter((_, i) => i !== choiceIndex) })}
                            >消す</button>
                          </div>
                        ))}
                      </div>
                      {question.choices.length < MAX_CHOICES ? (
                        <Button type="button" variant="secondary" className="mt-2" onClick={() => updateQuestion(index, { choices: [...question.choices, ''] })}>
                          ＋ 選択肢を足す
                        </Button>
                      ) : (
                        <p className={styles.muted}>選択肢は{MAX_CHOICES}つまでです（LINEの決まり）。</p>
                      )}
                    </div>
                  ) : (
                    <p className={styles.muted}>自由に書く形式では選択肢は使いません。入力した選択肢は保存されません。</p>
                  )}
                </div>
              ))}
              <div className={styles.addRow}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={questions.length >= MAX_QUESTIONS}
                  title={questions.length >= MAX_QUESTIONS ? `質問は${MAX_QUESTIONS}問までです` : undefined}
                  onClick={addQuestion}
                >
                  質問を足す（あと{MAX_QUESTIONS - questions.length}問）
                </Button>
              </div>
            </EditorCard>
            <EditorCard title="答え終わったときに行うこと" note="最後の質問に答え終わったときに実行されます">
              <InlineActionList
                actions={answerActions}
                onChange={setAnswerActions}
                tags={actionOptions.tags}
                fields={actionOptions.fields}
                marks={actionOptions.marks}
                scenarios={actionOptions.scenarios}
                vars={actionOptions.vars}
              />
            </EditorCard>
          </>
        )}
      </EditorV8>

      <ConfirmDialog
        open={pendingShape !== null}
        title="面の数を減らしますか？"
        description={`面 ${droppingAreaLabels.join('・')} に入れた設定が消えます。`}
        confirmLabel="面の数を変える"
        destructive
        onConfirm={confirmShapeChange}
        onCancel={() => setPendingShape(null)}
      />

      <MediaPickerDialog
        open={pickerOpen}
        accountId={selectedAccountId}
        kind="image"
        onClose={() => setPickerOpen(false)}
        onSelect={pickMedia}
      />
    </>
  )
}
