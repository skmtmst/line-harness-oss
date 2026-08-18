'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { DeliveryMode, Scenario, ScenarioTriggerType, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'

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
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<ScenarioTriggerType>('friend_add')
  const [triggerTagId, setTriggerTagId] = useState('')
  const [body, setBody] = useState('')
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
      setName(res.data.name)
      setTriggerType(res.data.triggerType)
      setTriggerTagId(res.data.triggerTagId ?? '')
    })
    void api.tags.list().then(res => {
      if (res.success) setTags(res.data)
    })
  }, [id])

  const mode: DeliveryMode = scenario?.deliveryMode ?? 'absolute_time'

  /** 名前と開始のきっかけだけ保存する。1通目を飛ばすときもここは通す。 */
  const saveScenario = async () => {
    if (!name.trim()) {
      setError('シナリオ名を入力してください')
      return false
    }
    if (triggerType === 'tag_added' && !triggerTagId) {
      setError('タグを選んでください')
      return false
    }
    const res = await api.scenarios.update(id, {
      name: name.trim(),
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
    if (body.trim()) {
      // 予定の欄は方式ごとに違う。余計な欄を送ると worker が弾く。
      const schedule =
        mode === 'relative'
          ? { delayMinutes: offsetDays * 1440 + offsetHours * 60 }
          : mode === 'elapsed'
            ? { offsetDays, offsetMinutes: offsetHours * 60 }
            : { offsetDays, deliveryTime }
      const res = await api.scenarios.addStep(id, {
        stepOrder: 1,
        messageType: 'text',
        messageContent: body.trim(),
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

      <ol data-design="Steps" className="mt-4 mb-4 flex flex-wrap items-center gap-3 text-sm">
        <StepMark n={1} label="シナリオ情報" state="done" />
        <StepLine />
        <StepMark n={2} label="配信方式の選択" state="done" />
        <StepLine />
        <StepMark n={3} label="ステップの作成" state="current" />
      </ol>

      <div data-design="Form" className="space-y-4">
        <section className="bg-canvas rounded-card border-hairline border p-5">
          <h2 className="text-ink text-base font-bold">シナリオ情報</h2>
          <p className="text-ink-secondary mt-0.5 text-xs leading-relaxed">
            一覧に出る名前です。あとから変えられます。
          </p>
          <label className="mt-4 block">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">
              シナリオ名 <span className="text-danger">*</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例: 友だち追加ウェルカム"
              className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full max-w-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </label>

          <div className="mt-4">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">いつ開始する？</span>
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
