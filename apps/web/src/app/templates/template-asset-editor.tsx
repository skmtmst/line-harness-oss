'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { MediaItem } from '@line-crm/shared'
import { api, type BroadcastAssetKind } from '@/lib/api'
import Button from '@/components/shared/button'
import Combobox from '@/components/shared/combobox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import StickyBar from '@/components/shared/sticky-bar'
import { TextField } from '@/components/shared/text-field'
import { RequiredBadge } from '@/components/shared/form-controls'
import InlineActionList, { useActionOptions } from '@/components/auto-replies/inline-action-list'
import { toActionPayload, type InlineAction } from '@/components/auto-replies/draft-fields'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import MediaPickerDialog from '@/app/contents/media-picker-dialog'

type AssetKind = Extract<BroadcastAssetKind, 'rich_message' | 'coupon' | 'research'>

const META: Record<AssetKind, { title: string; folder: string }> = {
  rich_message: { title: 'リッチメッセージ', folder: '03_販促・クーポン' },
  coupon: { title: 'クーポン', folder: '03_販促・クーポン' },
  research: { title: 'リサーチ', folder: '02_健康フォロー' },
}

function Field({ label, children, note, required }: { label: string; children: React.ReactNode; note?: string; required?: boolean }) {
  return (
    <label className="text-label block font-semibold text-ink-secondary">
      {label}
      {/* #976 U086: 「必須」はラベル文に埋めず、共通の札を使う */}
      {required ? <RequiredBadge /> : null}
      {children}
      {note ? <span className="text-caption mt-1 block font-normal text-ink-faint">{note}</span> : null}
    </label>
  )
}

/*
 * NEXT-18: 面の分け方はこの1つの定義から展開する。
 * 形状を選ぶと、プレビューの枠・面ごとの設定欄・保存データ（座標つき
 * tapAreas）がすべて同じ面数になる。面の定義を3か所に写すと、
 * 「6面を選んだのに2面しか保存されない」ような食い違いがまた起きる。
 */
interface RichArea {
  label: string
  /** 画像の左上を 0,0 とした百分率。 */
  x: number
  y: number
  width: number
  height: number
}

interface RichShape {
  value: string
  label: string
  /** 形状ボタンの中に出す見取り図。 */
  glyph: string
  areas: RichArea[]
}

function buildAreas(rows: string[][]): RichArea[] {
  const height = 100 / rows.length
  return rows.flatMap((labels, rowIndex) => {
    const width = 100 / labels.length
    return labels.map((label, colIndex) => ({
      label,
      x: Math.round(colIndex * width * 100) / 100,
      y: Math.round(rowIndex * height * 100) / 100,
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
    }))
  })
}

const RICH_SHAPES: RichShape[] = [
  { value: '1', label: '1面', glyph: 'A', areas: buildAreas([['A']]) },
  { value: '2v', label: '上下2面', glyph: 'A\nB', areas: buildAreas([['A'], ['B']]) },
  { value: '2h', label: '左右2面', glyph: 'A B', areas: buildAreas([['A', 'B']]) },
  { value: '3', label: '上1・下2', glyph: 'A\nB C', areas: buildAreas([['A'], ['B', 'C']]) },
  { value: '4', label: '4面', glyph: 'A B\nC D', areas: buildAreas([['A', 'B'], ['C', 'D']]) },
  { value: '6', label: '6面', glyph: 'A B C\nD E F', areas: buildAreas([['A', 'B', 'C'], ['D', 'E', 'F']]) },
]

type AreaActionKind = 'none' | 'uri' | 'actions'

/** 面1つぶんの設定。`kind` が動きの種類。 */
interface AreaDraft {
  kind: AreaActionKind
  uri: string
  actions: InlineAction[]
}

function emptyAreaDraft(): AreaDraft {
  return { kind: 'none', uri: '', actions: [] }
}

/** その面に設定が入っているか。面を減らす確認に使う。 */
function areaDraftConfigured(draft: AreaDraft | undefined): boolean {
  return Boolean(draft && draft.kind !== 'none')
}

function areaSummary(draft: AreaDraft | undefined): string {
  if (!draft || draft.kind === 'none') return '未設定'
  if (draft.kind === 'uri') return 'URLを開く'
  return draft.actions.length > 0 ? `動きを ${draft.actions.length} 件` : '動きなし'
}

/* NEXT-19: リサーチの質問は配列で持ち、順序・形式・必須・選択肢まで保存する。 */
const MAX_QUESTIONS = 10
/** LINEのクイックリプライは13件まで。 */
const MAX_CHOICES = 13

type ResearchFormat = 'single' | 'multiple' | 'free'

const FORMAT_LABEL: Record<ResearchFormat, string> = {
  single: '1つだけ選ぶ',
  multiple: 'いくつでも選ぶ',
  free: '自由に書く',
}

interface ResearchQuestion {
  /** 並び替え・選択のための画面内の印。保存しない。 */
  key: string
  text: string
  format: ResearchFormat
  required: boolean
  choices: string[]
}

function newQuestion(): ResearchQuestion {
  return { key: crypto.randomUUID(), text: '', format: 'single', required: true, choices: ['', ''] }
}

function visualQuestions(): ResearchQuestion[] {
  return [
    { key: 'vq-1', text: '来月も定期便を続けたいと思いますか？', format: 'single', required: true, choices: ['続けたい', 'どちらともいえない', '止めたい'] },
    { key: 'vq-2', text: 'よく使っている商品を教えてください', format: 'multiple', required: false, choices: ['フード', 'おやつ', 'ケア用品'] },
    { key: 'vq-3', text: '改善してほしいところがあれば教えてください', format: 'free', required: false, choices: [] },
  ]
}

/** datetime-local の値を画面表示用に整える（`2026-09-30T23:59` → `2026/09/30 23:59`）。 */
function displayDateTime(value: string): string {
  return value ? value.replace('T', ' ').replaceAll('-', '/') : '未設定'
}

/*
 * NEXT-24: テンプレート素材のテスト送信口はまだ無い。
 * 押せる見た目のボタンを置くと「送れた」と誤解するので、押せない形にして
 * 理由と代替の手順を添える。
 */
const TEST_SEND_UNAVAILABLE_NOTE =
  'この形式は、いまの画面から自分へのテスト送信ができません。保存して一斉配信に組み込むと、配信の画面からテスト送信できます。'

export default function TemplateAssetEditor({ kind, visual = false }: { kind: AssetKind; visual?: boolean }) {
  const meta = META[kind]
  usePageTitle(`${meta.title}を作る`)
  const { selectedAccountId } = useAccount()
  const [name, setName] = useState(visual ? ({ rich_message: '夏のキャンペーン告知', coupon: '夏の20%オフ', research: '定期便のご満足度' }[kind]) : '')
  const [folder, setFolder] = useState(visual ? meta.folder : '未分類')
  const [description, setDescription] = useState(visual ? (kind === 'coupon' ? '会計時にこの画面をご提示ください。他の割引との併用はできません。' : kind === 'research' ? 'いつもありがとうございます。3問だけ聞かせてください。' : '') : '')
  const [imageUrl, setImageUrl] = useState('')
  /** 登録メディアから選んだ1件。IDと種別も保存値へ残す（N-193）。 */
  const [pickedMedia, setPickedMedia] = useState<MediaItem | null>(null)
  /** メディア選択窓を開いている対象。null なら閉じている。 */
  const [pickerFor, setPickerFor] = useState<'rich_message' | 'coupon' | null>(null)
  const [shape, setShape] = useState('3')
  /** 面を減らす変更の保留中の行き先。確認窓が開いている間だけ値を持つ。 */
  const [pendingShape, setPendingShape] = useState<string | null>(null)
  /** 面ごとの動きの下書き。キーは面のラベル（A〜F）。 */
  const [areaDrafts, setAreaDrafts] = useState<Record<string, AreaDraft>>({})
  // クーポン（NEXT-17: 全部stateを持ち、保存値へそのまま入れる）
  const [couponOnce, setCouponOnce] = useState<'once' | 'unlimited'>('once')
  const [couponVisibility, setCouponVisibility] = useState<'friends' | 'link'>('friends')
  const [lottery, setLottery] = useState<'on' | 'off'>('on')
  const [lotteryRate, setLotteryRate] = useState('20')
  const [winnerLimit, setWinnerLimit] = useState('500')
  const [couponStartsAt, setCouponStartsAt] = useState(visual ? '2026-08-25T00:00' : '')
  const [couponEndsAt, setCouponEndsAt] = useState(visual ? '2026-09-30T23:59' : '')
  const [couponUseActions, setCouponUseActions] = useState<InlineAction[]>([])
  // リサーチ（NEXT-19）
  const [researchStartsAt, setResearchStartsAt] = useState(visual ? '2026-08-25T10:00' : '')
  const [researchEndsAt, setResearchEndsAt] = useState(visual ? '2026-09-07T23:59' : '')
  const [targetTagId, setTargetTagId] = useState('')
  const [questions, setQuestions] = useState<ResearchQuestion[]>(() => (visual ? visualQuestions() : [newQuestion()]))
  const [selectedQuestion, setSelectedQuestion] = useState(0)
  const [answerActions, setAnswerActions] = useState<InlineAction[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const actionOptions = useActionOptions()

  const shapeDef = RICH_SHAPES.find((candidate) => candidate.value === shape) ?? RICH_SHAPES[3]
  const pendingShapeDef = pendingShape ? RICH_SHAPES.find((candidate) => candidate.value === pendingShape) : undefined
  /** 確認窓に出す「設定が消える面」のラベル。 */
  const droppingAreaLabels = pendingShapeDef
    ? shapeDef.areas
        .filter((area) => !pendingShapeDef.areas.some((next) => next.label === area.label))
        .filter((area) => areaDraftConfigured(areaDrafts[area.label]))
        .map((area) => area.label)
    : []

  /*
   * アカウントを切り替えたら、前のアカウントで選んだ候補は捨てる。
   * そのままにすると、切替後のアカウントの保存へ別アカウントの
   * imageMediaId が紛れ込み、「選択中」の表示も残ったままになる。
   * URL欄もピックした値を持つため、整合のため一緒に初期化する。
   */
  useEffect(() => {
    setPickedMedia(null)
    setImageUrl('')
  }, [selectedAccountId])

  const pickMedia = (item: MediaItem) => {
    // 配信用の公開URLを保存値へ入れる（管理画面の表示用URLではない）。
    setImageUrl(item.url)
    setPickedMedia(item)
    setPickerFor(null)
  }

  const updateArea = (label: string, patch: Partial<AreaDraft>) =>
    setAreaDrafts((prev) => ({ ...prev, [label]: { ...(prev[label] ?? emptyAreaDraft()), ...patch } }))

  /*
   * 面を減らすときは、消える面に設定があれば確認を挟む。
   * 確認なしに消すと「設定したはずの動き」が黙って捨てられる。
   */
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

  const moveQuestion = (index: number, delta: -1 | 1) => {
    const to = index + delta
    if (to < 0 || to >= questions.length) return
    // 編集中の質問は動いた先でも選んだままにする。
    setSelectedQuestion((current) => (current === index ? to : current === to ? index : current))
    setQuestions((prev) => {
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  }

  const addQuestion = () => {
    if (questions.length >= MAX_QUESTIONS) return
    setSelectedQuestion(questions.length)
    setQuestions((prev) => [...prev, newQuestion()])
  }

  const removeQuestion = (index: number) => {
    if (questions.length <= 1) return
    setQuestions((prev) => prev.filter((_, i) => i !== index))
    setSelectedQuestion((current) =>
      Math.min(current === index ? index : current > index ? current - 1 : current, questions.length - 2))
  }

  /** 保存値を組み立てる。入力が足りないときはエラーメッセージを返す。 */
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
          // 選んだ登録メディアのID・種別も保存値へ残す（N-193）。
          imageMediaId: pickedMedia?.id ?? null,
          imageMediaKind: pickedMedia?.kind ?? null,
          shape,
          // NEXT-18: 選んだ形状の面だけを、座標と動きつきで保存する。
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
      if (lottery === 'on') {
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
          lottery: lottery === 'on',
          // NEXT-17: 抽選なしのときは確率・当選上限を保存値へ入れない。
          ...(lottery === 'on' ? { lotteryRate: Number(lotteryRate), winnerLimit: Number(winnerLimit) } : {}),
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

  const save = async () => {
    if (!selectedAccountId) return setError('上のバーでLINE公式アカウントを選んでください。')
    if (!name.trim()) return setError(`${meta.title}名を入力してください。`)
    const built = buildPayload()
    if ('error' in built) return setError(built.error)
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
        return
      }
      // 保存後は押せなくする。二度押しで同じものが2つできるのを防ぐ。
      setSaved(true)
    } catch {
      setError('保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const unsetAreas = shapeDef.areas.filter((area) => !areaDraftConfigured(areaDrafts[area.label]))
  const previewQuestion = questions[Math.min(selectedQuestion, questions.length - 1)]
  const previewQuestionIndex = Math.min(selectedQuestion, questions.length - 1)

  return (
    <div className="pb-24" data-design-node={kind === 'rich_message' ? 'j9ixI' : kind === 'coupon' ? 'hsBtl' : 'J3GxEZ'}>
      <nav className="text-caption mb-4 text-ink-faint" aria-label="現在地">
        <Link href="/templates" className="text-action hover:underline">テンプレート</Link>
        <span className="mx-2">›</span><span className="text-ink">{meta.title}</span>
        <span className="mx-2">›</span><span>新しく作る</span>
      </nav>

      {error ? <p role="alert" className="bg-danger-bg text-danger rounded-control mb-4 px-4 py-3 text-sm">{error}</p> : null}
      {saved ? <p role="status" className="bg-success-bg text-success rounded-control mb-4 px-4 py-3 text-sm">保存しました。<Link href="/templates" className="font-semibold underline">一覧へ戻る</Link></p> : null}

      <div className="flex min-w-0 flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <section className="bg-canvas border-hairline rounded-card shadow-card grid gap-4 border p-4 md:grid-cols-3">
            <div className="md:col-span-2"><Field label={`${meta.title}名`} required><TextField className="mt-2" value={name} onChange={(event) => setName(event.target.value)} /></Field></div>
            <Field label="フォルダ"><TextField className="mt-2" value={folder} onChange={(event) => setFolder(event.target.value)} /></Field>
          </section>

          {kind === 'rich_message' ? (
            <>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
                <h2 className="font-bold text-ink">面の分け方</h2>
                <p className="text-caption mt-1 text-ink-faint">選んだ形に合わせて、下の設定が増えます</p>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                  {RICH_SHAPES.map((candidate) => (
                    <Button key={candidate.value} type="button" variant={shape === candidate.value ? 'primary' : 'secondary'} onClick={() => requestShape(candidate.value)}>
                      <span className="mb-2 block whitespace-pre-line text-lg tracking-widest">{candidate.glyph}</span>{candidate.label}
                    </Button>
                  ))}
                </div>
              </section>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
                <Field label="画像" required note="1040 × 1040px 推奨。上下に分けるときは 1040 × 520px も選べます。">
                  <div className="border-hairline rounded-control mt-2 border border-dashed p-5 text-center">
                    <Button type="button" onClick={() => setPickerFor('rich_message')}>登録メディアから選ぶ</Button>
                    {pickedMedia ? <p className="text-success mt-2 text-xs">選択中: {pickedMedia.filename}</p> : null}
                    <input className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-3 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={imageUrl} onChange={(event) => { setImageUrl(event.target.value); setPickedMedia(null) }} placeholder="画像URL" />
                  </div>
                </Field>
              </section>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
                <h2 className="font-bold text-ink">押した面ごとの動き</h2>
                <p className="text-caption mt-1 text-ink-faint">面ごとに「URLを開く」か「動きを実行する」を選べます</p>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {shapeDef.areas.map((area) => {
                    const draft = areaDrafts[area.label] ?? emptyAreaDraft()
                    return (
                      <div key={area.label} className="border-hairline rounded-control border p-3 text-sm">
                        <p className="font-bold">面 {area.label}</p>
                        <select
                          className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                          value={draft.kind}
                          onChange={(event) => updateArea(area.label, { kind: event.target.value as AreaActionKind })}
                          aria-label={`面 ${area.label} の動き`}
                        >
                          <option value="none">未設定（押しても何も起きません）</option>
                          <option value="uri">URLを開く</option>
                          <option value="actions">動きを実行する</option>
                        </select>
                        {draft.kind === 'uri' ? (
                          <input
                            type="url"
                            className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                            value={draft.uri}
                            onChange={(event) => updateArea(area.label, { uri: event.target.value })}
                            placeholder="https://example.com"
                            aria-label={`面 ${area.label} のURL`}
                          />
                        ) : null}
                        {draft.kind === 'actions' ? (
                          <div className="mt-2">
                            <InlineActionList
                              actions={draft.actions}
                              onChange={(next) => updateArea(area.label, { actions: next })}
                              tags={actionOptions.tags}
                              fields={actionOptions.fields}
                              marks={actionOptions.marks}
                              scenarios={actionOptions.scenarios}
                              vars={actionOptions.vars}
                            />
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                {unsetAreas.length > 0 ? (
                  <p className="text-warning mt-3 text-xs">
                    {unsetAreas.map((area) => `面 ${area.label}`).join('・')}のアクションが未設定です。そのまま送ると、押しても何も起きません。
                  </p>
                ) : null}
              </section>
            </>
          ) : kind === 'coupon' ? (
            <>
              <section className="bg-canvas border-hairline rounded-card shadow-card grid gap-4 border p-4 md:grid-cols-2">
                <Field label="画像">
                  <Button type="button" className="mt-2 w-full" onClick={() => setPickerFor('coupon')}>登録メディアから選ぶ</Button>
                  {pickedMedia ? <span className="text-success mt-1 block text-xs">選択中: {pickedMedia.filename}</span> : null}
                  <span className="text-caption mt-1 block font-normal text-ink-faint">1029 × 1029px 推奨</span>
                </Field>
                <Field label="使える期間" required note="この管理画面の時刻（日本時間）で入ります。">
                  <div className="mt-2 flex items-center gap-2">
                    <input type="datetime-local" className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={couponStartsAt} onChange={(event) => setCouponStartsAt(event.target.value)} aria-label="使える期間の開始" />
                    <span>から</span>
                    <input type="datetime-local" className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={couponEndsAt} onChange={(event) => setCouponEndsAt(event.target.value)} aria-label="使える期間の終了" />
                  </div>
                </Field>
                <Field label="使い方のご案内（お客さまに見えます）"><textarea className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full resize-y border px-3 py-2 text-sm focus:ring-2 focus:outline-none" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
                <div className="grid gap-3 text-sm">
                  <Field label="使える回数">
                    <select aria-label="使える回数" className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={couponOnce} onChange={(event) => setCouponOnce(event.target.value as 'once' | 'unlimited')}>
                      <option value="once">1人1回だけ</option>
                      <option value="unlimited">期間中なら何回でも</option>
                    </select>
                  </Field>
                  <Field label="だれに見えるか">
                    <select aria-label="だれに見えるか" className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={couponVisibility} onChange={(event) => setCouponVisibility(event.target.value as 'friends' | 'link')}>
                      <option value="friends">友だちだけ</option>
                      <option value="link">リンクを知っている人</option>
                    </select>
                  </Field>
                </div>
              </section>
              <section className="bg-canvas border-hairline rounded-card shadow-card grid gap-4 border p-4 md:grid-cols-3">
                <Field label="抽選にする">
                  <select aria-label="抽選にする" className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={lottery} onChange={(event) => setLottery(event.target.value as 'on' | 'off')}>
                    <option value="on">する</option>
                    <option value="off">しない</option>
                  </select>
                </Field>
                {lottery === 'on' ? (
                  <>
                    <Field label="当たる確率">
                      <span className="mt-2 flex items-center gap-2">
                        <input type="number" min={1} max={100} className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={lotteryRate} onChange={(event) => setLotteryRate(event.target.value)} aria-label="当たる確率" />
                        <span className="font-normal">%</span>
                      </span>
                    </Field>
                    <Field label="当選人数の上限">
                      <span className="mt-2 flex items-center gap-2">
                        <input type="number" min={1} className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={winnerLimit} onChange={(event) => setWinnerLimit(event.target.value)} aria-label="当選人数の上限" />
                        <span className="font-normal">人</span>
                      </span>
                    </Field>
                  </>
                ) : (
                  <p className="text-caption self-end pb-2 font-normal text-ink-faint">抽選なしで配ります。当たる確率・当選人数の上限は保存されません。</p>
                )}
              </section>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
                <h2 className="font-bold">クーポンが使われたときに実行すること</h2>
                <div className="mt-3">
                  <InlineActionList
                    actions={couponUseActions}
                    onChange={setCouponUseActions}
                    tags={actionOptions.tags}
                    fields={actionOptions.fields}
                    marks={actionOptions.marks}
                    scenarios={actionOptions.scenarios}
                    vars={actionOptions.vars}
                  />
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="bg-canvas border-hairline rounded-card shadow-card grid gap-4 border p-4 md:grid-cols-3">
                <Field label="受付の開始"><input type="datetime-local" className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={researchStartsAt} onChange={(event) => setResearchStartsAt(event.target.value)} /></Field>
                <Field label="受付の終了"><input type="datetime-local" className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={researchEndsAt} onChange={(event) => setResearchEndsAt(event.target.value)} /></Field>
                <Field label="答えてもらう人" note="タグで絞れます。選ばなければ全員が対象です。">
                  <Combobox
                    aria-label="答えてもらう人"
                    placeholder="友だち全員"
                    value={targetTagId}
                    onChange={setTargetTagId}
                    options={actionOptions.tags.map((tag) => ({ value: tag.id, label: tag.name }))}
                    className="mt-2 w-full"
                  />
                </Field>
                <div className="md:col-span-3">
                  <Field label="説明（お客さまに見えます）"><textarea className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full resize-y border px-3 py-2 text-sm focus:ring-2 focus:outline-none" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
                </div>
              </section>
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
                <div className="flex items-center justify-between">
                  <div><h2 className="font-bold">質問（上から順に出ます）</h2><p className="text-caption mt-1 text-ink-faint">{questions.length} / {MAX_QUESTIONS} 問</p></div>
                  <Button type="button" disabled={questions.length >= MAX_QUESTIONS} title={questions.length >= MAX_QUESTIONS ? `質問は${MAX_QUESTIONS}問までです` : undefined} onClick={addQuestion}>
                    質問を追加（あと{MAX_QUESTIONS - questions.length}問）
                  </Button>
                </div>
                <div className="mt-3 grid gap-2">
                  {questions.map((question, index) => (
                    <div key={question.key} className="flex items-center gap-1">
                      <Button type="button" variant={index === selectedQuestion ? 'primary' : 'secondary'} className="min-w-0 flex-1 justify-start truncate" onClick={() => setSelectedQuestion(index)}>
                        {index + 1}　{FORMAT_LABEL[question.format]}　{question.text || '（未入力）'}
                      </Button>
                      <button type="button" aria-label={`質問 ${index + 1} を上へ`} title="上へ" disabled={index === 0} onClick={() => moveQuestion(index, -1)} className="text-ink-secondary hover:bg-canvas-sunken rounded px-2 py-1 text-xs disabled:opacity-40">↑</button>
                      <button type="button" aria-label={`質問 ${index + 1} を下へ`} title="下へ" disabled={index === questions.length - 1} onClick={() => moveQuestion(index, 1)} className="text-ink-secondary hover:bg-canvas-sunken rounded px-2 py-1 text-xs disabled:opacity-40">↓</button>
                      <button type="button" aria-label={`質問 ${index + 1} を消す`} title={questions.length <= 1 ? '質問は1つ必要です' : 'この質問を消す'} disabled={questions.length <= 1} onClick={() => removeQuestion(index)} className="text-danger hover:bg-danger-bg rounded px-2 py-1 text-xs disabled:opacity-40">消す</button>
                    </div>
                  ))}
                </div>
              </section>
              {previewQuestion ? (
                <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
                  <h2 className="font-bold">質問 {previewQuestionIndex + 1} の中身</h2>
                  <Field label="質問文" required>
                    <textarea aria-label="質問文" className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full resize-y border px-3 py-2 text-sm focus:ring-2 focus:outline-none" rows={3} value={previewQuestion.text} onChange={(event) => updateQuestion(previewQuestionIndex, { text: event.target.value })} />
                  </Field>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Field label="答え方">
                      <select aria-label="答え方" className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent mt-2 w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={previewQuestion.format} onChange={(event) => updateQuestion(previewQuestionIndex, { format: event.target.value as ResearchFormat })}>
                        <option value="single">1つだけ選ぶ</option>
                        <option value="multiple">いくつでも選ぶ</option>
                        <option value="free">自由に書く</option>
                      </select>
                    </Field>
                    <label className="mt-2 flex items-start gap-2 text-sm font-normal md:mt-8">
                      <input type="checkbox" aria-label="必ず答えてもらう" checked={previewQuestion.required} onChange={(event) => updateQuestion(previewQuestionIndex, { required: event.target.checked })} className="accent-accent mt-0.5" />
                      <span><strong className="block">必ず答えてもらう</strong><span className="text-ink-faint text-xs">外すと、この質問は飛ばせます。</span></span>
                    </label>
                  </div>
                  {previewQuestion.format !== 'free' ? (
                    <div className="mt-3">
                      <p className="text-label font-semibold text-ink-secondary">選択肢</p>
                      <div className="mt-2 space-y-2">
                        {previewQuestion.choices.map((choice, choiceIndex) => (
                          <div key={choiceIndex} className="flex items-center gap-2">
                            <input
                              className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                              value={choice}
                              onChange={(event) => updateQuestion(previewQuestionIndex, { choices: previewQuestion.choices.map((c, i) => (i === choiceIndex ? event.target.value : c)) })}
                              placeholder={`選択肢 ${choiceIndex + 1}`}
                            />
                            <button
                              type="button"
                              aria-label={`選択肢 ${choiceIndex + 1} を消す`}
                              disabled={previewQuestion.choices.length <= 1}
                              title={previewQuestion.choices.length <= 1 ? '選択肢は1つ必要です' : 'この選択肢を消す'}
                              onClick={() => updateQuestion(previewQuestionIndex, { choices: previewQuestion.choices.filter((_, i) => i !== choiceIndex) })}
                              className="text-danger hover:bg-danger-bg shrink-0 rounded px-2 py-1 text-xs disabled:opacity-40"
                            >消す</button>
                          </div>
                        ))}
                      </div>
                      {previewQuestion.choices.length < MAX_CHOICES ? (
                        <Button type="button" className="mt-2" onClick={() => updateQuestion(previewQuestionIndex, { choices: [...previewQuestion.choices, ''] })}>＋ 選択肢を追加</Button>
                      ) : (
                        <p className="text-caption mt-2 text-ink-faint">選択肢は{MAX_CHOICES}つまでです（LINEの決まり）。</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-caption mt-3 font-normal text-ink-faint">自由に書く形式では選択肢は使いません。入力した選択肢は保存されません。</p>
                  )}
                </section>
              ) : null}
              <section className="bg-canvas border-hairline rounded-card shadow-card border p-4">
                <h2 className="font-bold">答え終わったときに実行すること</h2>
                <div className="mt-3">
                  <InlineActionList
                    actions={answerActions}
                    onChange={setAnswerActions}
                    tags={actionOptions.tags}
                    fields={actionOptions.fields}
                    marks={actionOptions.marks}
                    scenarios={actionOptions.scenarios}
                    vars={actionOptions.vars}
                  />
                </div>
              </section>
            </>
          )}
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:w-96 xl:shrink-0 xl:self-start">
          <section className="rounded-card bg-line-preview p-4 text-on-accent">
            <h2 className="text-center font-bold">LINEプレビュー</h2>
            <p className="mx-auto mt-2 w-fit rounded-pill bg-line-preview-label px-3 py-1 text-xs">{meta.title}の見え方</p>
            <div className="rounded-card mt-4 bg-canvas p-4 text-ink">
              <p className="font-bold">{name || `${meta.title}名`}</p>
              {kind === 'rich_message' ? (
                <div className="bg-canvas-sunken relative mt-3 aspect-square w-full overflow-hidden rounded-lg">
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
                  <p className="mt-2 text-xs">質問 {previewQuestionIndex + 1} / {questions.length}</p>
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
            <Button type="button" className="mt-4 w-full" disabled title={TEST_SEND_UNAVAILABLE_NOTE}>自分に送って確かめる</Button>
            <p className="text-on-accent mt-2 text-xs leading-relaxed">{TEST_SEND_UNAVAILABLE_NOTE}</p>
          </section>
          <section className="bg-canvas border-hairline rounded-card shadow-card border p-4 text-sm">
            <h2 className="font-bold">{kind === 'rich_message' ? 'リッチメニューとの違い' : kind === 'coupon' ? '公開したあとに見られる数' : '回答フォームとの使い分け'}</h2>
            <p className="mt-2 leading-relaxed text-ink-secondary">{kind === 'rich_message' ? 'リッチメッセージはトークに1回流れて、過去のやり取りに残ります。リッチメニューは画面の下に常に出ます。' : kind === 'coupon' ? '配った数 ／ 開いた数 ／ 使われた数 ／ 当選した数。使われた数は成果とアフィリエイトにも送れます。' : 'リサーチはLINEの中で完結する短い質問向けです。住所や画像も聞く場合は回答フォームを使います。'}</p>
          </section>
        </aside>
      </div>

      <StickyBar status={saved ? '保存しました。一覧へ戻れます。' : '下書き（まだ誰にも送られません）'} actions={<><Button href="/templates" variant="secondary">キャンセル</Button><Button type="button" variant="secondary" disabled={saving || saved} onClick={() => void save()}>下書きに保存</Button><Button type="button" variant="primary" disabled={saving || saved} onClick={() => void save()}>{saving ? '保存中…' : saved ? '保存しました' : 'テンプレートを保存'}</Button></>} />

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
        open={pickerFor !== null}
        accountId={selectedAccountId}
        kind="image"
        onClose={() => setPickerFor(null)}
        onSelect={pickMedia}
      />
    </div>
  )
}
