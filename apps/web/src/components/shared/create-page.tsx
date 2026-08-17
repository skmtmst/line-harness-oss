'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/header'
import { ApiError } from '@/lib/api'

/**
 * 作成画面の骨組み。
 *
 * 一覧 → 作る → 保存したら一覧へ戻る、という流れが全部の作成画面で同じなので、
 * 見た目と操作をここにまとめる。画面ごとに書くと、パンくずの有無や
 * 「保存して続けて作る」の有無が画面ごとに違ってしまう。
 *
 * 中身（入力欄）は children で受ける。項目は画面ごとに全く違うので、
 * そこまで共通化しようとすると、かえって読みにくくなる。
 */
export interface CreatePageProps {
  title: string
  description?: string
  /** パンくずの親。[表示名, ルート] */
  parent: [string, string]
  /** 保存する。作ったもののIDを返すと、一覧で目立たせる */
  onSave: () => Promise<string | void>
  /** 「保存して続けて作る」で入力を空に戻す。省略するとボタンを出さない */
  onReset?: () => void
  /** 保存前の確認。文字列を返すとその内容をエラーとして出し、保存しない */
  validate?: () => string | null
  /**
   * 右の列。設計では作成画面の多くが「入力の左」と「見え方・注意の右」に
   * 分かれている。入力しながら、お客様側にどう出るかを見られるようにする。
   */
  aside?: ReactNode
  /** 保存ボタンの文言。設計は画面ごとに「メニューを追加」などと書き分けている */
  saveLabel?: string
  children: ReactNode
}

export default function CreatePage({
  title,
  description,
  parent,
  onSave,
  onReset,
  validate,
  aside,
  saveLabel,
  children,
}: CreatePageProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const run = async (andAnother: boolean) => {
    if (saving) return
    const validationError = validate?.()
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const id = await onSave()
      if (andAnother) {
        onReset?.()
        setNotice('保存しました。続けて作れます。')
        return
      }
      // 作った行を一覧で目立たせる。どこに増えたのか探させない。
      router.push(id ? `${parent[1]}?highlight=${id}` : parent[1])
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message)
      } else {
        setError(e instanceof Error ? e.message : '保存に失敗しました')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href={parent[1]} className="hover:underline">
          {parent[0]}
        </Link>
        <span className="mx-1.5">/</span>
        <span>{title}</span>
      </nav>

      <div data-design="Head">
        <Header title={title} description={description} />
      </div>

      <div data-design="Body" className={aside ? 'flex flex-col gap-4 xl:flex-row' : undefined}>
        <div
          data-design="Left"
          className={`bg-canvas rounded-card border-hairline space-y-5 border p-6 ${
            aside ? 'min-w-0 flex-1' : 'max-w-2xl'
          }`}
        >
          {children}

          {error && <p className="text-danger text-sm">{error}</p>}
          {notice && <p className="text-success text-sm">{notice}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => run(false)}
              disabled={saving}
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
            >
              {saving ? '保存中...' : (saveLabel ?? '保存')}
            </button>
            {onReset && (
              <button
                onClick={() => run(true)}
                disabled={saving}
                className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                保存して続けて作る
              </button>
            )}
            <Link
              href={parent[1]}
              className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium"
            >
              キャンセル
            </Link>
          </div>
        </div>

        {aside && (
          <div data-design="Right" className="w-full shrink-0 space-y-4 xl:w-80">
            {aside}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 番号つきの節。
 *
 * 設計の作成画面は、入力を「① お客様に見える情報」「② 予約の受け方」の
 * ように区切っている。上から順に埋めれば終わる、と分かるための番号なので、
 * 見出しだけ並べるのとは意味が違う。
 */
export function FormSection({
  step,
  label,
  note,
  children,
}: {
  step: number
  label: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="border-hairline border-b pb-5 last:border-b-0 last:pb-0">
      <div className="mb-3 flex items-start gap-2">
        <span className="bg-accent text-on-accent mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
          {step}
        </span>
        <div>
          <h2 className="text-ink text-sm font-semibold">{label}</h2>
          {note && <p className="text-ink-faint mt-0.5 text-xs">{note}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** 右の列に置く囲み。「予約画面での見え方」「気をつけること」に使う。 */
export function AsideCard({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="bg-canvas rounded-card border-hairline border p-4">
      <h2 className="text-ink text-sm font-semibold">{title}</h2>
      {note && <p className="text-ink-faint mt-0.5 text-xs">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** 1行の入力欄。ラベルと説明の付け方を全画面でそろえる。 */
export function Field({
  label,
  htmlFor,
  required,
  note,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-ink-secondary mb-1 block text-sm font-medium">
        {label}
        {/* 設計は「必須」と字で書いている。* だけだと、色が見えない人には
            何も伝わらない。 */}
        {required && (
          <span className="bg-danger-bg text-danger rounded-pill ml-1.5 px-1.5 py-0.5 text-[10px]">
            必須
          </span>
        )}
      </label>
      {children}
      {note && <p className="text-ink-faint mt-1 text-xs leading-relaxed">{note}</p>}
    </div>
  )
}

/** 入力欄の見た目。画面ごとに枠線の色が変わらないようにする。 */
export const inputClass =
  'border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none'
