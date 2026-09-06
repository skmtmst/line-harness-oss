'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'
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
import type { Folder } from '@line-crm/shared'

const SIZE_TABS: { value: 'large' | 'compact'; label: string; dims: string; hint: string }[] = [
  {
    value: 'large',
    label: '大',
    dims: '2500 × 1686px',
    hint: '画面をしっかり使う。ボタンを6つまで置ける',
  },
  {
    value: 'compact',
    label: '小',
    dims: '2500 × 843px',
    hint: 'トークが隠れにくい。横に並べる形',
  },
]

const LARGE_TEMPLATE_ORDER = [
  'large-full',
  'large-1x2-v',
  'large-1x2-h',
  'large-1plus2',
  'large-2x2',
  'large-2plus1',
  'large-2x3',
] as const

const TEMPLATE_LABELS: Record<string, string> = {
  'large-full': '1面',
  'large-1x2-v': '上下2面',
  'large-1x2-h': '左右2面',
  'large-1plus2': '上1・下2',
  'large-2x2': '4面',
  'large-2plus1': '上2・下1',
  'large-2x3': '6面',
}

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
          <g key={i}>
            <rect
              x={a.x + inset}
              y={a.y + inset}
              width={Math.max(0, a.w - inset * 2)}
              height={Math.max(0, a.h - inset * 2)}
              rx={dims.width * 0.008}
              strokeWidth={dims.width * 0.004}
              style={{ fill: 'var(--color-accent-soft)', stroke: 'var(--color-accent)' }}
            />
            <text
              x={a.x + a.w / 2}
              y={a.y + a.h / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={dims.height / 8}
              style={{ fill: 'var(--color-ink-secondary)', fontWeight: 700 }}
            >
              {String.fromCharCode(65 + i)}
            </text>
          </g>
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
  const [tabCount, setTabCount] = useState(0)
  const [templateKey, setTemplateKey] = useState(TEMPLATES[0].key)
  const [folderId, setFolderId] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shownTemplates = useMemo(() => {
    const bySize = TEMPLATES.filter((template) => template.size === size)
    if (size === 'compact') return bySize
    return LARGE_TEMPLATE_ORDER
      .map((key) => bySize.find((template) => template.key === key))
      .filter((template): template is RichMenuTemplate => Boolean(template))
  }, [size])
  const tmpl = shownTemplates.find((t) => t.key === templateKey) ?? shownTemplates[0]

  useEffect(() => {
    void api.folders.list('rich_menu').then((response) => {
      if (response.success) setFolders(response.data)
    })
  }, [])

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
        pages: Array.from({ length: tabCount + 1 }, (_, index) => ({
          name: index === 0 ? 'トップ' : `タブ ${String.fromCharCode(65 + index - 1)}`,
          orderIndex: index,
          areas: templateToAreas(tmpl),
        })),
      })
      if (!res.success) throw new Error(res.error ?? '作成失敗')
      if (folderId) await api.richMenuGroups.update(res.data.id, { folderId })
      router.push(`/rich-menus/edit?id=${res.data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <main data-design-node="XtfO3" className="mx-auto max-w-[1584px] p-6">
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/rich-menus" className="hover:underline">
          リッチメニュー
        </Link>
        <span className="mx-1.5">/</span>
        <span>新規作成</span>
      </nav>

      {/*
        **段を出す。**この画面で全部決めるのか、まだ続きがあるのかが
        本文の断りだけでは伝わらない。設計 12-1 は 形とボタン → 誰に出すか →
        公開のしかた の3段。ここは1段目。
      */}
      <StepTrail
        label="リッチメニュー作成の進み方"
        items={[
          { label: '形とボタン', state: 'current' },
          { label: '誰に出すか', state: 'todo' },
          { label: '公開のしかた', state: 'todo' },
        ]}
      />

      <form
        onSubmit={handleSubmit}
        className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_390px]"
      >
        <div className="border-hairline bg-canvas rounded-card min-w-0 space-y-4 border p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_260px]">
        <div>
          <label className="text-ink-secondary mb-1 block text-sm font-medium">
            メニュー名{' '}
            <span className="bg-danger-bg text-danger rounded-pill ml-1 px-1.5 py-0.5 text-[10px]">
              必須
            </span>
          </label>
          <input
            value={name}
            aria-label="メニュー名"
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
          <label className="text-ink-secondary mb-1 block text-sm font-medium" htmlFor="rich-menu-folder">フォルダ</label>
          <SelectField
            id="rich-menu-folder"
            aria-label="フォルダ"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
          />
        </div>

        <div>
          <label className="text-ink-secondary mb-1 block text-sm font-medium">
            メニューを開くボタンの文字
          </label>
          <input
            value={chatBarText}
            aria-label="メニューを開くボタンの文字"
            onChange={(e) => setChatBarText(e.target.value)}
            maxLength={14}
            required
            className="border-hairline rounded-control focus:ring-accent block w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
          <p className="text-ink-faint mt-1 text-xs">
            トークの下に出る文字。14字まで
          </p>
        </div>
        </div>

        <div>
          <span className="text-ink-secondary mb-2 block text-sm font-medium">メニューの形</span>
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
          <span className="text-ink-secondary mb-1 block text-sm font-medium">切替タブの数</span>
          <p className="text-ink-faint mb-2 text-xs">タブでほかのメニューへ移れます。切り替えが要らないときは「なし」。</p>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((count) => (
              <button
                key={count}
                type="button"
                aria-pressed={tabCount === count}
                onClick={() => setTabCount(count)}
                className={`rounded-control border px-4 py-2 text-xs font-semibold ${tabCount === count ? 'border-accent bg-accent-soft text-accent' : 'border-hairline bg-canvas text-ink-secondary'}`}
              >
                {count === 0 ? 'なし' : `${count}つ`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-ink-secondary mb-2 block text-sm font-medium">
            面の分けかた
          </span>
          <p className="text-ink-faint mb-3 text-xs">
            押せるところをいくつに分けるか。あとから編集画面で区切り直せます。
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {shownTemplates.map((t) => {
              const active = templateKey === t.key
              return (
                <label
                  key={t.key}
                  className={`rounded-control cursor-pointer border p-2 transition-colors ${
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
                  <div className="text-ink mt-1 text-center text-xs font-medium">{TEMPLATE_LABELS[t.key] ?? t.label}</div>
                </label>
              )
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <h2 className="text-ink-secondary text-sm font-medium">トークを開いたとき</h2>
            <p className="text-ink-faint mt-2 text-xs leading-5">
              メニューを開いた状態・閉じた状態の指定は、下書き保存後の編集画面で設定します。
            </p>
          </section>
          <section>
            <h2 className="text-ink-secondary text-sm font-medium">画像</h2>
            <Button href="/contents" className="mt-2">登録メディアから選ぶ</Button>
            <p className="text-ink-faint mt-2 text-xs">2500 × 1686px ／ 1MBまで・JPG・PNG</p>
            <p className="text-ink-faint mt-1 text-micro">選んだ画像は下書き保存後の編集画面で登録します。</p>
          </section>
        </div>

          <section className="border-hairline bg-canvas-sunken rounded-card border p-4">
            <h2 className="text-ink mb-3 text-sm font-bold">押した面ごとの動き</h2>
            <div className="space-y-2">
              {tmpl.areas.map((_, index) => (
                <div key={index} className="border-hairline bg-canvas flex items-center gap-3 rounded-control border px-3 py-2 text-xs">
                  <strong className="text-ink flex h-6 w-6 items-center justify-center rounded-control border border-hairline">{String.fromCharCode(65 + index)}</strong>
                  <span className="text-ink-secondary">アクションを実行</span>
                  <span className="text-danger ml-auto font-semibold">アクションを設定する</span>
                </div>
              ))}
            </div>
            <p className="text-danger mt-3 text-xs font-semibold">
              {tmpl.areas.length > 0
                ? `面 ${String.fromCharCode(64 + tmpl.areas.length)} のアクションが未設定です。公開すると、その場所を押しても何も起きません。`
                : '面を追加し、公開前にそれぞれのアクションを設定してください。'}
            </p>
          </section>
        </div>

          <aside className="sticky top-20 space-y-3">
            <section className="bg-info rounded-card p-4 text-on-accent">
              <h2 className="mb-3 text-center text-sm font-bold">LINEプレビュー</h2>
              <p className="bg-canvas text-ink mb-1 rounded-t-control py-2 text-center text-xs">{chatBarText || 'メニュー'}</p>
              <TemplatePreview template={tmpl} />
            </section>
            <section className="bg-warning-bg text-warning rounded-card p-4 text-xs leading-6">
              <h2 className="font-bold">公開前に見ておくところ</h2>
              <p>・アクションが未設定の面が {tmpl.areas.length}つあります</p>
              <p>・画像は1MBまで。超えると登録できません</p>
              <p>・切替メニューの移動先は、公開してからでないと動きません</p>
            </section>
          </aside>

        {error && (
          <div className="bg-danger-bg text-danger rounded-control border border-red-200 p-3 text-sm lg:col-span-2">
            {error}
          </div>
        )}

        <div className="lg:col-span-2">
          <StickyBar
            actions={(
              <>
                <Button href="/rich-menus">キャンセル</Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={submitting || !selectedAccount}
                >
                  {submitting ? '作成中...' : '下書きに保存して次へ'}
                </Button>
              </>
            )}
          />
        </div>
      </form>
    </main>
  )
}
