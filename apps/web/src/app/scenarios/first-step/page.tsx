'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { DeliveryMode, Scenario, ScenarioTriggerType, Tag, Template } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import ImageUploader, { type ImageUploaderValue } from '@/components/shared/image-uploader'

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

const triggerOptions: Array<{ value: ScenarioTriggerType; label: string; description: string }> = [
  { value: 'friend_add', label: '友だち追加時', description: '新しく友だちになった人に自動で流れます' },
  { value: 'tag_added', label: 'タグ付与時', description: '決めたタグが付いた人に自動で流れます' },
  { value: 'manual', label: '手動', description: '管理画面やAPIから開始したときだけ流れます' },
]

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
  const [triggerType, setTriggerType] = useState<ScenarioTriggerType>('friend_add')
  const [triggerTagId, setTriggerTagId] = useState('')
  const [body, setBody] = useState('')
  /**
   * 1通目の種別。
   *
   *   text      直に書く
   *   template  テンプレートから選ぶ（scenario_steps.template_id）
   *   image     画像を送る（中身は {originalContentUrl, previewImageUrl} のJSON）
   *
   * カルーセルとFlexは、ここで組み立てる画面がまだ無い。編集画面で足す。
   */
  const [kind, setKind] = useState<'text' | 'template' | 'image'>('text')
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
      setTriggerType(res.data.triggerType)
      setTriggerTagId(res.data.triggerTagId ?? '')
    })
    void api.tags.list().then(res => {
      if (res.success) setTags(res.data)
    })
    void api.templates.list().then(res => {
      if (res.success) setTemplates(res.data as unknown as Template[])
    })
  }, [id])

  const mode: DeliveryMode = scenario?.deliveryMode ?? 'absolute_time'

  /** 名前と開始のきっかけだけ保存する。1通目を飛ばすときもここは通す。 */
  const saveScenario = async () => {
    if (triggerType === 'tag_added' && !triggerTagId) {
      setError('タグを選んでください')
      return false
    }
    const res = await api.scenarios.update(id, {
      triggerType,
      triggerTagId: triggerType === 'tag_added' ? triggerTagId : null,
    })
    if (!res.success) {
      setError(res.error)
      return false
    }
    return true
  }

  const goDetail = () => router.push(`/scenarios/detail?id=${encodeURIComponent(id)}`)

  const submit = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    if (!(await saveScenario())) {
      setSaving(false)
      return
    }
    const hasContent =
      kind === 'text' ? body.trim() !== '' : kind === 'template' ? templateId !== '' : image !== null
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
      const payload =
        kind === 'template'
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
            : { messageType: 'text' as const, messageContent: body.trim() }

      const res = await api.scenarios.addStep(id, {
        stepOrder: 1,
        ...payload,
        ...schedule,
      })
      if (!res.success) {
        setError(res.error)
        setSaving(false)
        return
      }
    }
    goDetail()
  }

  const skip = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    if (!(await saveScenario())) {
      setSaving(false)
      return
    }
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
    <div>
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


      <div data-design="Form" className="space-y-4">
        <section className="bg-canvas rounded-card border-hairline border p-5">
          {/* 名前は前の画面（配信方式の選択）で決める。同じものを2か所で
              聞くと、どちらが効くのか分からなくなる。 */}
          <h2 className="text-ink text-base font-bold">いつ開始する？</h2>
          <p className="text-ink-secondary mt-0.5 text-xs leading-relaxed">
            このシナリオが自動で流れるきっかけを決めます。
          </p>

          <div className="mt-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {triggerOptions.map(opt => (
                <label
                  key={opt.value}
                  className={`rounded-control flex cursor-pointer items-start gap-2 border p-3 transition-colors ${
                    triggerType === opt.value
                      ? 'border-accent bg-accent-soft'
                      : 'border-hairline hover:bg-canvas-sunken'
                  }`}
                >
                  <input
                    type="radio"
                    name="triggerType"
                    checked={triggerType === opt.value}
                    onChange={() => setTriggerType(opt.value)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="text-ink block text-sm font-bold">{opt.label}</span>
                    <span className="text-ink-faint block text-xs leading-relaxed">
                      {opt.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {triggerType === 'tag_added' && (
            <label className="mt-3 block">
              <span className="text-ink-secondary mb-1 block text-xs font-medium">
                きっかけになるタグ <span className="text-danger">*</span>
              </span>
              <select
                value={triggerTagId}
                onChange={e => setTriggerTagId(e.target.value)}
                className="border-hairline rounded-control bg-canvas text-ink w-full max-w-md border px-3 py-2 text-sm"
              >
                <option value="">-- 選んでください --</option>
                {tags.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <section className="bg-canvas rounded-card border-hairline border p-5">
          <h2 className="text-ink text-base font-bold">1通目</h2>
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
                  className="border-hairline rounded-control bg-canvas text-ink w-20 border px-3 py-2 text-sm"
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
                  className="border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm"
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
                    className="border-hairline rounded-control bg-canvas text-ink w-20 border px-3 py-2 text-sm"
                  />
                  <span className="text-ink-secondary text-sm">時間後</span>
                </div>
              </label>
            )}
          </div>

          <div className="mt-4">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">何を送る？</span>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: 'text', label: '文字を書く' },
                  { value: 'template', label: 'テンプレートから選ぶ' },
                  { value: 'image', label: '画像を送る' },
                ] as const
              ).map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setKind(o.value)}
                  aria-pressed={kind === o.value}
                  className={`rounded-control border px-3 py-1.5 text-xs ${
                    kind === o.value
                      ? 'border-accent bg-accent-soft text-accent font-bold'
                      : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {kind === 'text' && (
            <label className="mt-4 block">
              <span className="text-ink-secondary mb-1 block text-xs font-medium">本文</span>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={4}
                placeholder="はじめまして。友だち追加ありがとうございます。"
                className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full resize-none border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </label>
          )}

          {kind === 'template' && (
            <div className="mt-4">
              <label className="block">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">テンプレート</span>
                <select
                  value={templateId}
                  onChange={e => setTemplateId(e.target.value)}
                  className="border-hairline rounded-control bg-canvas text-ink w-full max-w-md border px-3 py-2 text-sm"
                >
                  <option value="">選んでください</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}（{
                        { text: 'テキスト', image: 'リッチメッセージ', flex: 'カードタイプ', carousel: 'カルーセル' }[
                          t.messageType as 'text' | 'image' | 'flex' | 'carousel'
                        ] ?? t.messageType
                      }）
                    </option>
                  ))}
                </select>
              </label>
              {/* テンプレートを指す形にしておくと、テンプレート側を直したときに
                  この通の中身も一緒に変わる。 */}
              <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                テンプレートを直すと、この通の中身も一緒に変わります。
              </p>
            </div>
          )}

          {kind === 'image' && (
            <div className="mt-4 max-w-md">
              <ImageUploader
                mode="line-image"
                value={image}
                onChange={setImage}
                label="送る画像"
              />
            </div>
          )}
        </section>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="bg-accent hover:bg-accent-hover text-on-accent rounded-control px-5 py-3 text-sm font-bold transition-colors disabled:opacity-50"
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
            ? 'bg-accent text-on-accent'
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
