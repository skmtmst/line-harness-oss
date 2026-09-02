'use client'

/*
 * カルーセルを選ぶ。
 *
 * この画面では作らない。テンプレート側に作成画面（/templates/carousel）が
 * あるので、そこで作ったものから選ぶ。同じ編集画面を2つ持つと、片方だけ
 * 直して食い違う。10枚のパネルとボタンを組み立てる画面なので、なおさら。
 *
 * 1枚も無いときに選択欄だけ出しても進めないので、作りに行く導線を出す。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

export interface CarouselTemplate {
  id: string
  name: string
  /** パネルの枚数。選ぶときの目印。 */
  panels: number
  /** 1枚目の題。同じ名前が並んだときの手がかり。 */
  firstTitle: string
  /**
   * 中身そのもの。
   *
   * 通の控え（message_content）に入れる。テンプレートを消したときは
   * これが使われるので、枚数などの要約ではなく**実物**でないといけない。
   */
  messageContent: string
}

export interface CarouselPickerProps {
  /** 選んでいるテンプレートID。 */
  value: string
  onChange: (templateId: string, template: CarouselTemplate | null) => void
}

/** テンプレートの中身から、枚数と1枚目の題を読む。 */
function summarize(content: string): { panels: number; firstTitle: string } {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!Array.isArray(parsed)) return { panels: 0, firstTitle: '' }
    const first = parsed[0] as { title?: unknown; text?: unknown } | undefined
    const title =
      typeof first?.title === 'string' && first.title
        ? first.title
        : typeof first?.text === 'string'
          ? first.text
          : ''
    return { panels: parsed.length, firstTitle: title }
  } catch {
    return { panels: 0, firstTitle: '' }
  }
}

export default function CarouselPicker({ value, onChange }: CarouselPickerProps) {
  const [items, setItems] = useState<CarouselTemplate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void api.templates.list().then((res) => {
      if (res.success) {
        setItems(
          res.data
            .filter((t) => t.messageType === 'carousel')
            .map((t) => ({
              id: t.id,
              name: t.name,
              messageContent: t.messageContent,
              ...summarize(t.messageContent),
            })),
        )
      }
      setLoading(false)
    })
  }, [])

  if (loading) {
    return <p className="text-ink-faint py-6 text-center text-sm">読み込み中…</p>
  }

  if (items.length === 0) {
    return (
      <div className="border-hairline rounded-card border border-dashed px-4 py-6 text-center">
        <p className="text-ink text-sm font-bold">カルーセルがまだありません</p>
        <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
          パネルを並べて作る画面が別にあります。そこで作ると、ここから選べるようになります。
        </p>
        <Link
          href="/templates/carousel"
          className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control mt-3 inline-flex h-10 items-center border px-4 text-sm"
        >
          カルーセルを作りに行く
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-ink-secondary mb-1 block text-xs font-medium">
          カルーセル <span className="text-danger">*</span>
        </span>
        <select
          value={value}
          onChange={(e) => {
            const picked = items.find((t) => t.id === e.target.value) ?? null
            onChange(e.target.value, picked)
          }}
          className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
        >
          <option value="">選んでください</option>
          {items.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}（{t.panels}枚{t.firstTitle ? `／${t.firstTitle}` : ''}）
            </option>
          ))}
        </select>
      </label>
      <p className="text-ink-faint text-xs leading-relaxed">
        カルーセルを直すと、この通の中身も一緒に変わります。
      </p>
      <Link href="/templates/carousel" className="text-info inline-block text-xs hover:underline">
        新しいカルーセルを作る
      </Link>
    </div>
  )
}
