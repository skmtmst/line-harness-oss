'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/header'
import StepTrail from '@/components/shared/step-trail'
import StickyBar from '@/components/shared/sticky-bar'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import {
  TEMPLATES,
  SIZE_DIMENSIONS,
  templateToAreas,
  type RichMenuTemplate,
} from '@/lib/rich-menu-templates'
import { usePageTitle } from '@/components/shell/page-chrome'

const SIZE_TABS: { value: 'large' | 'compact'; label: string; dims: string; hint: string }[] = [
  {
    value: 'large',
    label: '大きい',
    dims: '2500 × 1686',
    hint: '画面をしっかり使う。ボタンを6つまで置ける',
  },
  {
    value: 'compact',
    label: '小さい',
    dims: '2500 × 843',
    hint: 'トークが隠れにくい。横に並べる形',
  },
]

/**
 * 面の分けかたを図で見せる。
 *
 * テンプレートごとに絵を用意せず、areas からそのまま描く。
 * テンプレートを足したときに絵を描き忘れることがない。
 */
function TemplatePreview({ template }: { template: RichMenuTemplate }) {
  const dims = SIZE_DIMENSIONS[template.size]
  // 枠線の分だけ内側に寄せる。隣り合う区画がくっついて見えないように。
  const inset = dims.width * 0.006
  return (
    <svg
      viewBox={`0 0 ${dims.width} ${dims.height}`}
      className="border-hairline bg-canvas-sunken w-full rounded border"
      role="img"
      aria-label={`${template.label} の面の分けかた`}
    >
      {template.areas.length === 0 ? (
        <text
          x={dims.width / 2}
          y={dims.height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={dims.height / 7}
          style={{ fill: 'var(--color-ink-faint)' }}
        >
          自由に配置
        </text>
      ) : (
        template.areas.map((a, i) => (
          <rect
            key={i}
            x={a.x + inset}
            y={a.y + inset}
            width={Math.max(0, a.w - inset * 2)}
            height={Math.max(0, a.h - inset * 2)}
            rx={dims.width * 0.008}
            strokeWidth={dims.width * 0.004}
            style={{ fill: 'var(--color-accent-soft)', stroke: 'var(--color-accent)' }}
          />
        ))
      )}
    </svg>
  )
}

export default function NewRichMenuPage() {
  usePageTitle('リッチメニューを作る')
  const router = useRouter()
  const { selectedAccount } = useAccount()
  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('メニュー')
  const [size, setSize] = useState<'large' | 'compact'>('large')
  const [templateKey, setTemplateKey] = useState(TEMPLATES[0].key)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shownTemplates = useMemo(() => TEMPLATES.filter((t) => t.size === size), [size])
  const tmpl = shownTemplates.find((t) => t.key === templateKey) ?? shownTemplates[0]

  function changeSize(next: 'large' | 'compact') {
    setSize(next)
    // 大きさを変えると選べる形も変わる。先頭を選び直す。
    const first = TEMPLATES.find((t) => t.size === next)
    if (first) setTemplateKey(first.key)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAccount) {
      setError('アカウントを選択してください')
      return
    }
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.create({
        accountId: selectedAccount.id,
        name: name.trim(),
        chatBarText: chatBarText.trim(),
        size: tmpl.size,
        pages: [{ name: 'ページ 1', orderIndex: 0, areas: templateToAreas(tmpl) }],
      })
      if (!res.success) throw new Error(res.error ?? '作成失敗')
      router.push(`/rich-menus/edit?id=${res.data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <main data-design-node="XtfO3" className="mx-auto max-w-4xl p-6">
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/rich-menus" className="hover:underline">
          リッチメニュー
        </Link>
        <span className="mx-1.5">/</span>
        <span>新規作成</span>
      </nav>

      <div data-design="Head">
        <Header
          description="名前と土台のレイアウトを決めます。画像とタップ領域は、作成後の編集画面で設定します。"
        />
      </div>

      {/*
        **段を出す。**この画面で全部決めるのか、まだ続きがあるのかが
        本文の断りだけでは伝わらない。設計 12-1 は 形とボタン → 誰に出すか →
        公開のしかた の3段。ここは1段目。
      */}
      <StepTrail
        label="リッチメニュー作成の進み方"
        items={[
          { label: '形を決める', state: 'current' },
          { label: 'ボタンと出し分け', state: 'todo' },
          { label: '公開のしかた', state: 'todo' },
        ]}
      />

      <form
        onSubmit={handleSubmit}
        className="border-hairline bg-canvas rounded-card mt-4 space-y-6 border p-6 shadow-sm"
      >
        <div>
          <label className="text-ink-secondary mb-1 block text-sm font-medium">
            名前{' '}
            <span className="bg-danger-bg text-danger rounded-pill ml-1 px-1.5 py-0.5 text-[10px]">
              必須
            </span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="border-hairline rounded-control focus:ring-accent block w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            placeholder="例：メインメニュー"
          />
          <p className="text-ink-faint mt-1 text-xs">
            管理画面での識別用です。友だちには表示されません。
          </p>
        </div>

        <div>
          <label className="text-ink-secondary mb-1 block text-sm font-medium">
            トーク画面下の文言
          </label>
          <input
            value={chatBarText}
            onChange={(e) => setChatBarText(e.target.value)}
            maxLength={14}
            required
            className="border-hairline rounded-control focus:ring-accent block w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
          <p className="text-ink-faint mt-1 text-xs">
            14文字以内。メニューを開く前にトーク画面下に表示されます。
          </p>
        </div>

        <div>
          <span className="text-ink-secondary mb-2 block text-sm font-medium">画像の大きさ</span>
          <div className="flex flex-wrap gap-2">
            {SIZE_TABS.map((s) => {
              const active = size === s.value
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => changeSize(s.value)}
                  aria-pressed={active}
                  className={`rounded-control border px-4 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'border-accent bg-accent-soft text-ink'
                      : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
                  }`}
                >
                  <span className="font-medium whitespace-nowrap">{s.label}</span>
                  <span className="text-ink-faint ml-2 text-xs whitespace-nowrap">{s.dims}</span>
                  <span className="text-ink-faint mt-0.5 block text-[11px]">{s.hint}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <span className="text-ink-secondary mb-2 block text-sm font-medium">
            土台のレイアウト
          </span>
          <p className="text-ink-faint mb-3 text-xs">
            あとから編集画面で区切り直せます。迷ったら6面で始めてください。
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shownTemplates.map((t) => {
              const active = templateKey === t.key
              return (
                <label
                  key={t.key}
                  className={`rounded-card cursor-pointer border p-3 transition-colors ${
                    active
                      ? 'border-accent bg-accent-soft'
                      : 'border-hairline hover:bg-canvas-sunken'
                  }`}
                >
                  <input
                    type="radio"
                    name="template"
                    value={t.key}
                    checked={active}
                    onChange={(e) => setTemplateKey(e.target.value)}
                    className="sr-only"
                  />
                  <TemplatePreview template={t} />
                  <div className="text-ink mt-2 text-xs font-medium">{t.label}</div>
                  {t.description && (
                    <p className="text-ink-faint mt-0.5 text-[11px] leading-snug">
                      {t.description}
                    </p>
                  )}
                </label>
              )
            })}
          </div>
        </div>

        {error && (
          <div className="bg-danger-bg text-danger rounded-control border border-red-200 p-3 text-sm">
            {error}
          </div>
        )}

        <StickyBar
          actions={(
            <>
              <Link
                href="/rich-menus"
                className="border-hairline rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium transition-colors"
              >
                キャンセル
              </Link>
              <button
                type="submit"
                disabled={submitting || !selectedAccount}
                className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
              >
                {submitting ? '作成中...' : '作成して編集へ'}
              </button>
            </>
          )}
        />
      </form>
    </main>
  )
}
