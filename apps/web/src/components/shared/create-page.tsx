'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import { ApiError } from '@/lib/api'

/**
 * 作成画面の寸法の版。
 *
 * V6の設計は、作成画面のカードを r10・余白18・行間12、節の見出しを16/700 と
 * 描き、保存はカードの中ではなく下部追従バーに置いている。既存の作成画面は
 * V5の寸法（r12・余白24・見出し14/600・カード内ボタン）で並んでいる。
 *
 * 既定を変えると作成画面が全部いっぺんに動く。1画面ずつ設計と突き合わせて
 * 移すため、`variant="v6"` を渡した画面だけV6の寸法にする。
 */
export type CreatePageVariant = 'default' | 'v6'

const VariantContext = createContext<CreatePageVariant>('default')

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
  /** 一覧以外へ続く作成フロー。IDを受けて次の画面を決める。 */
  successHref?: (id: string | void) => string
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
  /** 共通トップバーだけに画面名を置くV6画面では、本文の重複見出しを出さない。 */
  showHeader?: boolean
  /** Pencilの実ノードと、作成フロー全体を結び付ける。 */
  designNode?: string
  /** 寸法の版。既定はV5。V6へ移した画面だけ 'v6' を渡す。 */
  variant?: CreatePageVariant
  /** 下部追従バーの左に出す状態。V6のときだけ使う。 */
  statusLabel?: ReactNode
  children: ReactNode
}

export default function CreatePage({
  title,
  description,
  parent,
  onSave,
  successHref,
  onReset,
  validate,
  aside,
  saveLabel,
  showHeader = true,
  designNode,
  variant = 'default',
  statusLabel,
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
      router.push(successHref ? successHref(id) : id ? `${parent[1]}?highlight=${id}` : parent[1])
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

  const v6 = variant === 'v6'

  // V6は共通ボタンで組む。V5の並びは既存の作成画面がそのまま使っているので、
  // 触らずに残す。
  const actions = v6 ? (
    <>
      <Button href={parent[1]}>キャンセル</Button>
      {onReset && (
        <Button onClick={() => run(true)} disabled={saving}>
          保存して続けて作る
        </Button>
      )}
      <Button variant="primary" onClick={() => run(false)} disabled={saving}>
        {saving ? '保存中...' : (saveLabel ?? '保存')}
      </Button>
    </>
  ) : (
    <>
      <button
        onClick={() => run(false)}
        disabled={saving}
        className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
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
    </>
  )

  return (
    <VariantContext.Provider value={variant}>
    <div data-design-node={designNode} data-create-variant={variant}>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href={parent[1]} className="hover:underline">
          {parent[0]}
        </Link>
        <span className="mx-1.5">/</span>
        <span>{title}</span>
      </nav>

      {showHeader ? (
        <div data-design="Head">
          <Header title={title} description={description} />
        </div>
      ) : null}

      <div data-design="Body" className={aside ? 'flex flex-col gap-4 xl:flex-row' : undefined}>
        <div
          data-design="Left"
          className={`bg-canvas border-hairline border ${
            v6 ? 'rounded-tile space-y-3 p-[18px]' : 'rounded-card space-y-5 p-6'
          } ${aside ? 'min-w-0 flex-1' : 'max-w-2xl'}`}
        >
          {children}

          {error && <p className="text-danger text-sm">{error}</p>}
          {notice && <p className="text-success text-sm">{notice}</p>}

          {/* V6は保存を下部追従バーへ出す。カードの中とバーの両方に置くと、
              どちらを押せばよいか分からなくなる。 */}
          {v6 ? null : <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>

        {aside && (
          <div
            data-design="Right"
            className={`w-full shrink-0 space-y-4 ${v6 ? 'xl:w-[390px]' : 'xl:w-80'}`}
          >
            {aside}
          </div>
        )}
      </div>

      {v6 && (
        <div className="mt-4">
          <StickyBar
            status={statusLabel ?? (saving ? '保存しています' : 'まだ保存していません')}
            actions={actions}
          />
        </div>
      )}
    </div>
    </VariantContext.Provider>
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
  const v6 = useContext(VariantContext) === 'v6'
  return (
    <section
      className={`border-hairline border-b last:border-b-0 last:pb-0 ${v6 ? 'pb-3' : 'pb-5'}`}
    >
      <div className="mb-3 flex items-start gap-2">
        <span
          className={`bg-accent text-on-accent mt-0.5 flex shrink-0 items-center justify-center rounded-full font-semibold ${
            v6 ? 'h-6 w-6 text-[13px]' : 'h-5 w-5 text-xs'
          }`}
        >
          {step}
        </span>
        <div>
          <h2 className={v6 ? 'text-ink text-lead font-bold' : 'text-ink text-sm font-semibold'}>
            {label}
          </h2>
          {note && (
            <p className={v6 ? 'text-ink-faint text-micro mt-0.5 font-medium' : 'text-ink-faint mt-0.5 text-xs'}>
              {note}
            </p>
          )}
        </div>
      </div>
      <div className={v6 ? 'space-y-3' : 'space-y-4'}>{children}</div>
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

/**
 * 択一の選択肢を、説明つきの札で出す。
 *
 * 設計の作成画面は「先着順で自動確定 / 承認制」のように、選択肢そのものより
 * 「それを選ぶと何が起きるか」を並べて選ばせる。プルダウンにすると説明が
 * 消えるので、選ぶ前に読める形で置く。
 */
export function ChoiceCard({
  selected,
  title,
  note,
  onClick,
}: {
  selected: boolean
  title: string
  note: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-card border p-3 text-left transition-colors ${
        selected ? 'border-accent bg-accent-soft' : 'border-hairline hover:bg-canvas-sunken'
      }`}
    >
      <div className="text-ink text-sm font-semibold">{title}</div>
      <div className="text-ink-faint text-xs">{note}</div>
    </button>
  )
}

// Field と inputClass は form-controls.tsx に移した。入力欄だけ使いたい画面が
// この骨組みごと読み込んでしまうため。読み込み側を変えずに済むよう再輸出する。
export { Field, inputClass } from './form-controls'
