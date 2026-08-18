'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { DeliveryMode, Scenario } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'

/**
 * 配信方式の選択（設計）。
 *
 * 「＋ シナリオを作成」で名前を決めたあと、ここへ来る。**この時点で
 * シナリオは作られている**（緑の帯がそう言っている）ので、ここでは
 * 方式を選んで保存するだけ。
 *
 * 以前はモーダルの中で方式と名前をまとめて決めていた。並べた具体例が
 * 入りきらず、どちらを選ぶと何が変わるのかを読まずに押していた。
 */
export default function ScenarioModePage() {
  return (
    <Suspense fallback={<div className="text-ink-faint py-12 text-center text-sm">読み込み中…</div>}>
      <ScenarioModeContent />
    </Suspense>
  )
}

function ScenarioModeContent() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [saving, setSaving] = useState<DeliveryMode | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')

  /** 名前だけ先に保存する。方式を選ぶ前に閉じても、名前は残る。 */
  const saveName = async () => {
    const trimmed = name.trim()
    if (!id || !trimmed || trimmed === scenario?.name) return
    const res = await api.scenarios.update(id, { name: trimmed })
    if (!res.success) setError(res.error)
  }

  useEffect(() => {
    if (!id) return
    void api.scenarios.get(id).then(res => {
      if (res.success) {
        setScenario(res.data)
        setName(res.data.name)
      } else {
        setError(res.error)
      }
    })
  }, [id])

  const choose = async (mode: DeliveryMode) => {
    if (!id || saving) return
    setSaving(mode)
    setError('')
    const trimmed = name.trim()
    if (!trimmed) {
      setError('シナリオ名を入力してください')
      setSaving(null)
      return
    }
    // 名前と方式は同じ受け口で一度に保存する。
    const res = await api.scenarios.update(id, { name: trimmed, deliveryMode: mode })
    if (!res.success) {
      setError(res.error)
      setSaving(null)
      return
    }
    // 3段目へ。設計の帯が3段なので、2段で編集画面へ放り出さない。
    router.push(`/scenarios/first-step?id=${encodeURIComponent(id)}`)
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
        <span>配信方式の選択</span>
      </nav>

      <div data-design="Head">
        <Header
          title="配信方式の選択"
          description="このシナリオでステップを並べる基準を選びます。あとから変更できますが、設定済みのステップは作り直しになります。"
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
          シナリオ「{scenario?.name ?? '…'}」を作成しました。続けて配信方式を選んでください。
          {/* シナリオにフォルダを持たせる列が無いので、いまは必ず未分類。 */}
          <span className="text-ink-faint ml-3 text-xs">フォルダ：未分類</span>
        </p>
        {error && <p className="bg-danger-bg text-danger rounded-card px-4 py-3 text-sm">{error}</p>}
      </div>

      {/*
        3段の帯はやめた。段の名前を並べても、いまどこに居るかは
        画面の見出しで分かる。空いた場所に、いちばん必要なもの
        （シナリオの名前）を置く。
      */}
      <div data-design="Name" className="bg-canvas rounded-card border-hairline mt-4 mb-4 border p-4">
        <label className="block">
          <span className="text-ink-secondary mb-1 block text-xs font-medium">
            シナリオ名 <span className="text-danger">*</span>
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void saveName()}
            placeholder="例: 友だち追加ウェルカム"
            className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full max-w-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
          <span className="text-ink-faint mt-1 block text-xs">
            一覧に出る名前です。あとから変えられます。
          </span>
        </label>
      </div>

      <div data-design="Choices" className="grid gap-4 xl:grid-cols-2">
        <ModeCard
          mode="absolute_time"
          title="時刻で指定"
          recommended
          lead="配信時刻がそろうため、開封されやすい時間帯に寄せられます。"
          body="配信のタイミングを「購読開始から〇日後の〇時」と指定できます。メルマガのような決まった時間の定期配信ができます。"
          uses={['メルマガ配信', '定期リマインド', '朝夜の固定配信']}
          result="2人とも同じ時刻に届く（1通目 15:00 ／ 2通目 20:00）"
          note="購読開始時刻が最初の配信時刻を過ぎている場合、翌日の配信時刻から配信が開始されます。"
          rows={[
            { who: '友だち A', start: '4/1 12:00 に購読開始', first: '4/1 15:00', second: '4/2 20:00' },
            { who: '友だち B', start: '4/1 14:00 に購読開始', first: '4/1 15:00', second: '4/2 20:00' },
          ]}
          heads={['当日 15:00', '翌日 20:00']}
          saving={saving}
          onChoose={choose}
          cta="時刻で作成"
        />
        <ModeCard
          mode="elapsed"
          title="経過時間で指定"
          lead="友だち追加の時刻を起点にするため、一人ひとりに同じ体験を届けられます。"
          body="配信のタイミングを「購読開始から〇日と〇時間後」と指定できます。「友だち追加から5時間限定」のような期間限定の配信ができます。"
          uses={['期間限定オファー', '初回フォロー', 'カウントダウン']}
          result="経過時間は2人とも同じ。購読開始が2時間遅い分、配信時刻も2時間うしろにズレる"
          note="購読開始時刻によっては夜間の配信となる場合があります。"
          rows={[
            { who: '友だち A', start: '4/1 12:00 に購読開始', first: '4/1 15:00', second: '4/2 20:00', gaps: ['+3時間', '+1日と8時間'] },
            { who: '友だち B', start: '4/1 14:00 に購読開始', first: '4/1 17:00', second: '4/2 22:00', gaps: ['+3時間', '+1日と8時間'] },
          ]}
          saving={saving}
          onChoose={choose}
          cta="経過時間で作成"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-ink-faint text-xs">
          ⓘ どちらを選んでも、作成後にステップの追加・並べ替えができます。
          {/* 1通だけ試しに送る受け口が無いので、テスト送信とは書かない。 */}
        </p>
        <Link
          href={`/scenarios/first-step?id=${encodeURIComponent(id)}`}
          className="text-accent ml-auto text-sm font-medium hover:underline"
        >
          あとで決める（下書きとして保存）
        </Link>
      </div>
    </div>
  )
}

// ── 部品 ────────────────────────────────────────────────────────────────────

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

function ModeCard({
  mode,
  title,
  recommended,
  lead,
  body,
  uses,
  rows,
  heads,
  result,
  note,
  cta,
  saving,
  onChoose,
}: {
  mode: DeliveryMode
  title: string
  recommended?: boolean
  lead: string
  body: string
  uses: string[]
  rows: Array<{ who: string; start: string; first: string; second: string; gaps?: string[] }>
  heads?: string[]
  result: string
  note: string
  cta: string
  saving: DeliveryMode | null
  onChoose: (mode: DeliveryMode) => void
}) {
  return (
    // h-full と mt-auto の組み合わせで、2枚のカードの高さと下のボタンの位置が
    // そろう。中身の長さが違うと、ボタンだけ上下にずれる。
    <section className="bg-canvas rounded-card border-hairline flex h-full flex-col border p-5">
      <div className="flex items-start gap-3">
        <span className="bg-accent-soft text-accent rounded-card flex h-9 w-9 shrink-0 items-center justify-center text-lg">
          {mode === 'absolute_time' ? '🕐' : '⏱'}
        </span>
        <div className="min-w-0">
          <h2 className="text-ink flex flex-wrap items-center gap-2 text-lg font-bold">
            {title}
            {recommended && (
              <span className="bg-accent-soft text-accent rounded-pill px-2 py-0.5 text-xs font-bold">
                おすすめ
              </span>
            )}
          </h2>
          <p className="text-ink-secondary mt-0.5 text-xs leading-relaxed">{lead}</p>
        </div>
      </div>

      <p className="text-ink mt-4 text-sm leading-relaxed">{body}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {uses.map(u => (
          <span key={u} className="bg-canvas-sunken text-ink-secondary rounded-control px-2 py-1 text-xs">
            {u}
          </span>
        ))}
      </div>

      {/*
        具体例。どちらを選ぶと何が変わるかは、言葉より並べた時刻のほうが早い。
        同じ日の違う時刻に始めた2人で、届く時刻がそろうか・ズレるかを見せる。
      */}
      <div className="border-hairline rounded-card mt-4 border p-4">
        <p className="text-ink-secondary text-xs">具体例：同じ日の違う時刻に購読開始した2人</p>
        {heads && (
          <div className="mt-3 flex gap-2 pl-[9.5rem]">
            {heads.map(h => (
              <span
                key={h}
                className="bg-accent text-on-accent rounded-control flex-1 px-2 py-1 text-center text-xs font-bold"
              >
                {h}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 space-y-2">
          {rows.map(r => (
            <div key={r.who} className="flex items-center gap-2">
              <div className="w-36 shrink-0">
                <p className="text-ink text-xs font-bold">{r.who}</p>
                <p className="text-ink-faint text-[11px]">{r.start}</p>
              </div>
              <Slot order="1通目" at={r.first} gap={r.gaps?.[0]} />
              <Slot order="2通目" at={r.second} gap={r.gaps?.[1]} />
            </div>
          ))}
        </div>
        <p className="border-hairline text-ink-secondary rounded-control mt-3 border px-3 py-2 text-xs leading-relaxed">
          {result}
        </p>
        <p className="text-ink-faint mt-2 text-[11px] leading-relaxed">※ {note}</p>
      </div>

      <button
        type="button"
        onClick={() => onChoose(mode)}
        disabled={saving !== null}
        className="bg-accent hover:bg-accent-hover text-on-accent rounded-control mt-auto w-full px-4 py-3 text-sm font-bold transition-colors disabled:opacity-50"
      >
        {saving === mode ? '作成中…' : `${cta} →`}
      </button>
    </section>
  )
}

function Slot({ order, at, gap }: { order: string; at: string; gap?: string }) {
  return (
    <div className="min-w-0 flex-1">
      {gap && (
        <p className="bg-info-bg text-info rounded-pill mb-1 px-2 py-0.5 text-center text-[10px]">
          {gap}
        </p>
      )}
      <div className="border-hairline rounded-control bg-canvas border px-2 py-1.5 text-center">
        <p className="text-ink-faint text-[10px]">{order}</p>
        <p className="text-ink text-xs font-bold">{at}</p>
      </div>
    </div>
  )
}
