'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  countTemplateTextCharacters,
  type DeliveryMode,
  type Scenario,
  type Tag,
  type Template,
} from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import ImageUploader, { type ImageUploaderValue } from '@/components/shared/image-uploader'
import MessageTypeTabs, { type StepMessageKind } from '@/components/scenarios/message-type-tabs'
import MessageKindFields, {
  emptyMessageKindState,
  serializeMessageKind,
  type MessageKind,
  type MessageKindState,
} from '@/components/scenarios/message-kind-fields'
import QuestionEditor, {
  emptyQuestion,
  type ScenarioQuestion,
} from '@/components/scenarios/question-editor'
import { ConditionDialog, describeCondition } from '@/components/scenarios/scenario-dialogs'
import CarouselPicker from '@/components/scenarios/carousel-picker'
import InsertToolbar from '@/components/scenarios/insert-toolbar'
import StepPreview from '@/components/scenarios/step-preview'
import CharCounter, { LINE_TEXT_LIMIT, isOverCharLimit } from '@/components/scenarios/char-counter'
import styles from './first-step.module.css'
import type { SegmentCondition } from '@/components/shared/condition-builder'
import SelectField from '@/components/shared/select-field'

/**
 * ステップの作成（設計の3段目）。
 *
 * 配信方式の選択の絵に「シナリオ情報 → 配信方式の選択 → ステップの作成」と
 * 3段が描かれている。3段目の絵は無いので、案Aとして起こした
 * （`docs/scenario-create-flow-proposal.md`）。
 *
 * ここで名前を決めるのが要点。1段目の画面が無いぶん、名前を聞く場所が
 * どこにも無く、一覧に「新しいシナリオ」が並んでしまう。
 *
 * 1通目は飛ばせる。書かせないと進めない形にすると、あとで考えたい人が
 * 適当な本文を入れて先へ進む。
 */
export default function ScenarioFirstStepPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint py-12 text-center text-sm">読み込み中…</div>}>
      <FirstStepContent />
    </Suspense>
  )
}

const modeLabel: Record<DeliveryMode, string> = {
  absolute_time: '時刻で指定',
  elapsed: '経過時間で指定',
  relative: '経過時間で指定（旧）',
}

function FirstStepContent() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''

  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [body, setBody] = useState('')
  /** 差し込みをカーソルの位置に入れるために、入力欄そのものを持つ。 */
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  /*
   * 1通目の配信対象。Lステップの「配信対象の絞り込み」と同じ3つ。
   *
   *   all      … シナリオ購読中の全員に配信する（条件なし）
   *   tag      … タグで絞り込んで配信する
   *   advanced … 詳細条件で絞り込んで配信する（条件ビルダー）
   *
   * どれを選んでも、保存するのは scenario_steps.target_condition_json。
   * タグ絞り込みは「タグが1つだけの詳細条件」なので、別の持ち方はしない。
   */
  const [targetMode, setTargetMode] = useState<'all' | 'tag' | 'advanced'>('all')
  const [targetTagId, setTargetTagId] = useState('')
  const [targetCondition, setTargetCondition] = useState<SegmentCondition | null>(null)
  const [conditionOpen, setConditionOpen] = useState(false)
  /**
   * 1通目の中身の作り方。
   *   compose  … この画面で作る（種別はタブで選ぶ）
   *   template … テンプレートから選ぶ（scenario_steps.template_id）
   */
  const [contentMode, setContentMode] = useState<'compose' | 'template'>('compose')
  /** 送るものの種別。作れないものはタブ側で押せなくしてある。 */
  const [kind, setKind] = useState<StepMessageKind>('text')
  const [question, setQuestion] = useState<ScenarioQuestion>(() => emptyQuestion())
  /** 位置情報・動画・音声・スタンプの入力。種別ごとに別々に覚えておく。 */
  const [kindState, setKindState] = useState<MessageKindState>(() => emptyMessageKindState())
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState('')
  const [image, setImage] = useState<ImageUploaderValue | null>(null)
  // 予定。配信方式ごとに使う欄が違う（worker の validateStepSchedule）。
  const [offsetDays, setOffsetDays] = useState(0)
  const [deliveryTime, setDeliveryTime] = useState('10:00')
  const [offsetHours, setOffsetHours] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    void api.scenarios.get(id).then(res => {
      if (!res.success) {
        setError(res.error)
        return
      }
      setScenario(res.data)
    })
    void api.tags.list().then(res => {
      if (res.success) setTags(res.data)
    })
    void api.templates.list().then(res => {
      if (res.success) setTemplates(res.data as unknown as Template[])
    })
  }, [id])

  const mode: DeliveryMode = scenario?.deliveryMode ?? 'absolute_time'

  /**
   * 1通目に付ける配信対象。
   *
   * タグを選ぶだけの場合も、詳細条件と同じ形（SegmentCondition）で持つ。
   * 持ち方を分けると、あとから「タグ＋もう1条件」にしたいときに作り直しになる。
   */
  const stepTargetCondition = (): SegmentCondition | null => {
    if (targetMode === 'all') return null
    if (targetMode === 'tag') {
      return targetTagId
        ? { operator: 'AND', rules: [{ type: 'tag_exists', value: targetTagId }] }
        : null
    }
    return targetCondition
  }

  const goDetail = () => router.push(`/scenarios/detail?id=${encodeURIComponent(id)}`)

  /*
   * 本文が上限を超えているか。
   *
   * 超えたまま保存を押せると、LINEに渡してから弾かれる。押せない形にして、
   * 理由を操作のそばに出す（`docs/v6-common-rules.md` §1 の言葉の決まり）。
   */
  const bodyLength = countTemplateTextCharacters(body)
  const bodyOverLimit =
    contentMode === 'compose' && kind === 'text' && isOverCharLimit(bodyLength, LINE_TEXT_LIMIT)

  const submit = async () => {
    // ボタンの disabled だけに頼らない。別の呼び出し経路が増えても、
    // 上限を超えた本文を保存処理へ渡さない。
    if (saving || bodyOverLimit) return
    setSaving(true)
    setError('')
    if (targetMode === 'tag' && !targetTagId) {
      setError('絞り込むタグを選んでください')
      setSaving(false)
      return
    }
    const hasContent =
      contentMode === 'template'
        ? templateId !== ''
        : kind === 'text'
          ? body.trim() !== ''
          : kind === 'image'
            ? image !== null
            : kind === 'question'
              ? question.text.trim() !== ''
              : kind === 'carousel'
                ? templateId !== ''
                : serializeMessageKind(kind as MessageKind, kindState) !== null
    if (hasContent) {
      // 予定の欄は方式ごとに違う。余計な欄を送ると worker が弾く。
      const schedule =
        mode === 'relative'
          ? { delayMinutes: offsetDays * 1440 + offsetHours * 60 }
          : mode === 'elapsed'
            ? { offsetDays, offsetMinutes: offsetHours * 60 }
            : { offsetDays, deliveryTime }
      // 種別ごとに、送る中身の作りが違う。
      //   テンプレート … templateId を渡す。本文は参照先が持つ
      //   画像         … LINE が要る2つのURLをJSONで入れる
      const picked = templates.find((t) => t.id === templateId)
      const carouselTpl = kind === 'carousel' ? templates.find((t) => t.id === templateId) : undefined
      const payload =
        kind === 'carousel' && contentMode === 'compose'
          ? {
              messageType: 'carousel' as const,
              messageContent: carouselTpl?.messageContent ?? '[]',
              templateId,
            }
          : contentMode === 'template'
          ? {
              messageType: (picked?.messageType ?? 'text') as 'text' | 'image' | 'flex',
              messageContent: picked?.messageContent ?? '',
              templateId,
            }
          : kind === 'image' && image?.mode === 'line-image'
            ? {
                messageType: 'image' as const,
                messageContent: JSON.stringify({
                  originalContentUrl: image.originalContentUrl,
                  previewImageUrl: image.previewImageUrl,
                }),
              }
            : kind === 'question'
              // 質問は本文を持たない。中身は question に入る。
              ? { messageType: 'text' as const, messageContent: '' }
              : kind === 'text'
                ? { messageType: 'text' as const, messageContent: body.trim() }
                : {
                    // 位置情報・動画・音声・スタンプ。中身は JSON 1つ。
                    messageType: kind as 'location' | 'video' | 'audio' | 'sticker',
                    messageContent: serializeMessageKind(kind as MessageKind, kindState) ?? '',
                  }

      const res = await api.scenarios.addStep(id, {
        stepOrder: 1,
        ...payload,
        ...schedule,
        targetCondition: stepTargetCondition(),
        question: contentMode === 'compose' && kind === 'question' ? question : null,
      })
      if (!res.success) {
        setError(res.error)
        setSaving(false)
        return
      }
    }
    goDetail()
  }

  const skip = () => {
    // 1通目を書かずに編集画面へ。ここで保存するものは無い。
    goDetail()
  }

  if (!id) {
    return (
      <div className="text-ink-faint py-12 text-center text-sm">
        シナリオが指定されていません。
        <Link href="/scenarios" className="text-accent ml-2 underline">
          シナリオ一覧へ
        </Link>
      </div>
    )
  }

  return (
    <div data-design-node="kk8dz">
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/scenarios" className="hover:underline">
          シナリオ配信
        </Link>
        <span className="mx-1.5">/</span>
        <span>ステップの作成</span>
      </nav>

      <div data-design="Head">
        <Header
          title="ステップの作成"
          description="シナリオの名前と、いつ流すかを決めます。1通目はここで書いても、あとで書いてもかまいません。"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled
                title="マニュアルは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
              >
                マニュアル
              </button>
              <Link
                href="/scenarios"
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control inline-flex items-center border px-3 py-2 text-sm font-medium"
              >
                ✕ キャンセル
              </Link>
            </div>
          }
        />
      </div>

      <div data-design="Notice" className="space-y-2">
        <p className="bg-success-bg text-success rounded-card px-4 py-3 text-sm">
          配信方式を「{modeLabel[mode]}」にしました。続けて名前と1通目を決めてください。
        </p>
        {error && <p className="bg-danger-bg text-danger rounded-card px-4 py-3 text-sm">{error}</p>}
      </div>


      {/*
        左に入力、右にプレビュー。プレビューは付いてくる（sticky）ので、
        下の選択肢を書いているあいだも、届く形と時刻が視界に残る。
        狭い画面では縦に積む。
      */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_500px] xl:items-start">
      <div data-design="Form" className="space-y-4">
        {/*
          配信対象の絞り込み。Lステップの「配信対象の絞り込み」と同じ3つ。

          ここで決めるのは**この1通目を誰に送るか**であって、シナリオが
          いつ始まるかではない。開始のきっかけ（友だち追加時など）は
          シナリオ編集の「シナリオ情報」と、「友だち追加時の配信」で決める。
          2か所で同じことを聞くと、どちらが効くのか分からなくなる。
        */}
        <section className="bg-canvas rounded-card border-hairline border p-5">
          <h2 className="text-ink text-base font-bold">この1通目を誰に送るか</h2>
          <p className="text-ink-secondary mt-0.5 text-xs leading-relaxed">
            この1通目を誰に送るかを決めます。開始のきっかけは、このあとの編集画面で決められます。
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            {(
              [
                { value: 'all', label: 'シナリオ購読中の全員に配信する' },
                { value: 'tag', label: 'タグで絞り込んで配信する' },
                { value: 'advanced', label: '詳細条件で絞り込んで配信する' },
              ] as const
            ).map(opt => (
              <label key={opt.value} className="text-ink flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="targetMode"
                  checked={targetMode === opt.value}
                  onChange={() => setTargetMode(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>

          {targetMode === 'tag' && (
            <label className="mt-4 block">
              <span className="text-ink-secondary mb-1 block text-xs font-medium">
                タグで絞り込み <span className="text-danger">*</span>
              </span>
              <SelectField
                value={targetTagId}
                onChange={e => setTargetTagId(e.target.value)}
                aria-label="絞り込みに使うタグ"
                className="border-hairline rounded-control bg-canvas text-ink w-full max-w-md border px-3 py-2 text-sm"
                options={[
                  { value: '', label: '-- 選んでください --' },
                  ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
                ]}
              />
            </label>
          )}

          {targetMode === 'advanced' && (
            <div className="mt-4">
              <span className="text-ink-secondary mb-1 block text-xs font-medium">詳細条件で絞り込み</span>
              <button
                type="button"
                onClick={() => setConditionOpen(true)}
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 border px-4 text-sm"
              >
                {targetCondition ? describeCondition(targetCondition) : '絞り込み'}
              </button>
            </div>
          )}
        </section>

        <section className="bg-canvas rounded-card border-hairline border p-5">
          <h2 className="text-ink text-base font-bold">1通目の内容</h2>
          <p className="text-ink-secondary mt-0.5 text-xs leading-relaxed">
            空のままでも進めます。テンプレートや画像は、このあとの編集画面で選べます。
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-ink-secondary mb-1 block text-xs font-medium">
                購読開始から
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  value={offsetDays}
                  onChange={e => setOffsetDays(Math.max(0, Number(e.target.value)))}
                  className={`${styles.smallField} border-hairline rounded-control bg-canvas text-ink border px-3 text-caption font-semibold`}
                />
                <span className="text-ink-secondary text-sm">日後</span>
              </div>
            </label>
            {mode === 'absolute_time' ? (
              <label className="block">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">配信する時刻</span>
                <input
                  type="time"
                  value={deliveryTime}
                  onChange={e => setDeliveryTime(e.target.value)}
                  className={`${styles.timeField} border-hairline rounded-control bg-canvas text-ink border px-3 text-caption font-semibold`}
                />
              </label>
            ) : (
              <label className="block">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">さらに</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={offsetHours}
                    onChange={e =>
                      setOffsetHours(Math.min(23, Math.max(0, Number(e.target.value))))
                    }
                    className={`${styles.smallField} border-hairline rounded-control bg-canvas text-ink border px-3 text-caption font-semibold`}
                  />
                  <span className="text-ink-secondary text-sm">時間後</span>
                </div>
              </label>
            )}
          </div>

          {/*
            配信内容の設定。種別はLステップの並びに合わせてタブで出す。
            作れないものも並べたうえで押せなくしてある（並びごと消すと、
            この管理画面で送れないことが分からない）。
          */}
          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-center gap-4">
              {(
                [
                  { value: 'compose', label: 'この画面で作る' },
                  { value: 'template', label: 'テンプレートから選ぶ' },
                ] as const
              ).map(o => (
                <label key={o.value} className="text-ink flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="contentMode"
                    checked={contentMode === o.value}
                    onChange={() => setContentMode(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </div>

            {contentMode === 'compose' ? (
              <MessageTypeTabs value={kind} onChange={setKind}>
                {kind === 'text' && (
                  <div>
                    <span className="text-ink-secondary mb-1 block text-xs font-medium">本文</span>
                    <div className="mb-2">
                      <InsertToolbar targetRef={bodyRef} value={body} onChange={setBody} />
                    </div>
                    <textarea
                      ref={bodyRef}
                      value={body}
                      onChange={e => setBody(e.target.value)}
                      placeholder="はじめまして。友だち追加ありがとうございます。"
                      className={`${styles.bodyField} border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full resize-none border px-3 py-2 text-sm focus:ring-2 focus:outline-none`}
                    />
                    <CharCounter length={bodyLength} />
                  </div>
                )}

                {kind === 'image' && (
                  <div className="max-w-md">
                    <ImageUploader
                      mode="line-image"
                      value={image}
                      onChange={setImage}
                      label="送る画像"
                    />
                  </div>
                )}

                {kind === 'question' && (
                  <QuestionEditor value={question} onChange={setQuestion} />
                )}

                {(kind === 'location' || kind === 'video' || kind === 'audio' || kind === 'sticker') && (
                  <MessageKindFields kind={kind} value={kindState} onChange={setKindState} />
                )}

                {/*
                  カルーセルはテンプレートを指す形で持つ。この画面では作らない
                  （組み立てが重く、編集画面を2つ持つと片方だけ直して食い違う）。
                */}
                {kind === 'carousel' && (
                  <CarouselPicker value={templateId} onChange={(id) => setTemplateId(id)} />
                )}
              </MessageTypeTabs>
            ) : (
              <div>
                <label className="block">
                  <span className="text-ink-secondary mb-1 block text-xs font-medium">テンプレート</span>
                  <SelectField
                    value={templateId}
                    onChange={e => setTemplateId(e.target.value)}
                    aria-label="配信するテンプレート"
                    className="border-hairline rounded-control bg-canvas text-ink w-full max-w-md border px-3 py-2 text-sm"
                    options={[
                      { value: '', label: '選んでください' },
                      ...templates.map((template) => ({
                        value: template.id,
                        label: `${template.name}（${
                          { text: 'テキスト', image: 'リッチメッセージ', flex: 'カードタイプ', carousel: 'カルーセル' }[
                            template.messageType as 'text' | 'image' | 'flex' | 'carousel'
                          ] ?? template.messageType
                        }）`,
                      })),
                    ]}
                  />
                </label>
                {/* テンプレートを指す形にしておくと、テンプレート側を直したときに
                    この通の中身も一緒に変わる。 */}
                <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                  テンプレートを直すと、この通の中身も一緒に変わります。
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

        <div className="xl:sticky xl:top-4">
          <StepPreview
            deliveryMode={mode}
            offsetDays={offsetDays}
            deliveryTime={deliveryTime}
            offsetHours={offsetHours}
            kind={contentMode === 'template' ? 'text' : kind}
            templateName={
              // テンプレート参照（テンプレートから選ぶ／カルーセル）のときだけ名前を出す。
              contentMode === 'template' || kind === 'carousel'
                ? (templates.find(t => t.id === templateId)?.name ?? null)
                : null
            }
            body={body}
            imageUrl={image?.mode === 'line-image' ? image.previewImageUrl : null}
            question={contentMode === 'compose' && kind === 'question' ? question : null}
            kindState={kindState}
            audienceLabel={
              targetMode === 'all'
                ? 'シナリオ購読中の全員'
                : targetMode === 'tag'
                  ? (tags.find(t => t.id === targetTagId)?.name
                      ? `タグ「${tags.find(t => t.id === targetTagId)!.name}」がある人`
                      : 'タグで絞り込む（未選択）')
                  : targetCondition
                    ? describeCondition(targetCondition)
                    : '詳細条件で絞り込む（未設定）'
            }
          />
        </div>
      </div>

      {/*
        上限を超えたまま押せると、LINEに渡してから弾かれる。押せない形にして、
        理由を操作のそばに置く。「押したのに何も起きない」を作らない。
      */}
      {bodyOverLimit && (
        <p className="bg-danger-bg text-danger rounded-card mt-4 px-4 py-3 text-sm">
          本文が {LINE_TEXT_LIMIT.toLocaleString('en-US')} 字を超えています。
          LINEが受け付けないため、この状態では保存できません。
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || bodyOverLimit}
          className="bg-accent-deep hover:brightness-92 text-on-accent rounded-control px-5 py-3 text-sm font-bold transition-colors disabled:opacity-50"
        >
          {saving ? '保存中…' : '作成して編集へ →'}
        </button>
        <button
          type="button"
          onClick={() => void skip()}
          disabled={saving}
          className="text-ink-secondary hover:text-ink text-sm disabled:opacity-50"
        >
          1通目はあとで書く
        </button>
      </div>

      {/* 詳細条件。中身はシナリオ編集と同じ部品を使う。 */}
      {conditionOpen && (
        <ConditionDialog
          title="この通の配信対象"
          description="条件に合わない人には、この通だけ送りません。次の通へはそのまま進みます。"
          value={targetCondition}
          onSave={async next => {
            setTargetCondition(next)
          }}
          onClose={() => setConditionOpen(false)}
        />
      )}
    </div>
  )
}

function StepMark({
  n,
  label,
  state,
}: {
  n: number
  label: string
  state: 'done' | 'current' | 'todo'
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`rounded-pill flex h-6 w-6 items-center justify-center text-xs font-bold ${
          state === 'done'
            ? 'bg-accent-deep text-on-accent'
            : state === 'current'
              ? 'border-accent text-accent border-2'
              : 'border-hairline text-ink-faint border'
        }`}
      >
        {state === 'done' ? '✓' : n}
      </span>
      <span className={state === 'todo' ? 'text-ink-faint' : 'text-ink font-bold'}>{label}</span>
    </li>
  )
}

function StepLine() {
  return <li aria-hidden className="border-hairline w-10 border-t" />
}
