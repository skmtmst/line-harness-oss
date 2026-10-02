'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import StickyBar from '@/components/shared/sticky-bar'
import ValidationSummary from '@/components/shared/validation-summary'
import { describeSaveFailure } from '@/lib/api'
import type { FormErrors } from '@/lib/use-form-errors'

/*
 * D005: `ApiError.message` は安全と判定されない応答では `API error: <番号>` の
 * 内部文になる。そのまま出すと運用者に意味が伝わらない。保存の失敗文は
 * `describeSaveFailure`（状態別の立て直し文）に寄せ、作る画面でそろえる。
 */
export function createPageErrorMessage(error: unknown): string {
  return describeSaveFailure(error)
}

/**
 * 保存後の戻り先に `highlight` を足す。
 *
 * 親URLは `/mileage?tab=earning-rules` のように既にクエリを持つことがある。
 * `${url}?highlight=` と文字で連結すると `?tab=…?highlight=…` のように
 * `?` が2つ並ぶ壊れたURLになり、タブ指定ごと読めなくなる（MILEAGE-09）。
 * 既存のクエリとハッシュはそのまま保ち、`highlight` だけを書き換える。
 */
export function createPageReturnHref(parentHref: string, id: string | void): string {
  if (!id) return parentHref
  const url = new URL(parentHref, 'https://create-page.invalid')
  url.searchParams.set('highlight', String(id))
  return `${url.pathname}${url.search}${url.hash}`
}

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
   * 保存の失敗文。省略時は `createPageErrorMessage`（`describeSaveFailure`）。
   * M030: 発行の失敗を原文のまま出さないよう、画面はここに
   * `describeApiFailure(err, action, { forbidden })` を渡す
   * （403は権限の案内・429は待ち案内・400は直し方つき）。
   */
  describeError?: (error: unknown) => string
  /**
   * 欄ごとの検査（★V7 sTJsh §6）。渡すと保存時に全欄を検査し、落ちた欄は
   * 欄の下に理由・上にまとめを出して1つ目へフォーカスを移す。
   * 欄は離れた時点でも1回だけ検査される（`useFormErrors` 参照）。
   */
  fields?: FormErrors
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
  describeError,
  fields,
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
  /*
   * エラーが入力の検証文か、保存の失敗文かを分ける。
   * 検証文は入力を直した時点で古くなるので、直したら消す（R610）。
   * 保存の失敗文（重複・権限・通信）は送り直すまで直ったか分からないので、
   * 次の保存操作まで残す。
   */
  const [errorKind, setErrorKind] = useState<'validate' | 'save' | null>(null)

  /*
   * R610: 不正な入力で保存を押した後、正しく直しても古い検証文が残ると、
   * まだ不正なのか判断できない。検証文だけは今の入力と突き合わせ、
   * 直っていれば消す。理由が変わっていれば今の文に寄せる。
   */
  useEffect(() => {
    if (!error || errorKind !== 'validate') return
    let current: string | null = null
    try {
      current = validate?.() ?? null
    } catch {
      return
    }
    if (current == null) {
      setError('')
      setErrorKind(null)
    } else if (current !== error) {
      setError(current)
    }
  }, [error, errorKind, validate])

  const run = async (andAnother: boolean) => {
    if (saving) return
    const validationError = validate?.()
    /*
     * 欄ごとの検査がある画面では、保存時に全欄をもう一度見て、落ちた欄は
     * 欄の下に理由・上にまとめを出す（★V7 sTJsh §6）。直し方が分かる文なので
     * 「保存できませんでした」だけの帯にはしない。画面全体の条件
     * （アカウント未選択など）とは両方出す。
     */
    const fieldProblems = fields?.submit() ?? []
    if (validationError) {
      setError(validationError)
      setErrorKind('validate')
      return
    }
    if (fieldProblems.length > 0) {
      setError('')
      return
    }
    setSaving(true)
    setError('')
    setErrorKind(null)
    setNotice('')
    try {
      const id = await onSave()
      if (andAnother) {
        onReset?.()
        setNotice('保存しました。続けて作れます。')
        return
      }
      // 作った行を一覧で目立たせる。どこに増えたのか探させない。
      router.push(successHref ? successHref(id) : createPageReturnHref(parent[1], id))
    } catch (e) {
      setError(describeError ? describeError(e) : createPageErrorMessage(e))
      setErrorKind('save')
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
      <Button variant="primary" onClick={() => run(false)} disabled={saving} busy={saving} busyLabel="保存中...">
        {(saveLabel ?? '保存する')}
      </Button>
    </>
  ) : (
    <>
      <Button variant="primary" className="px-4 py-2 font-medium border-0 h-auto whitespace-normal" onClick={() => run(false)} disabled={saving}>
        {saving ? '保存中...' : (saveLabel ?? '保存する')}
      </Button>
      {onReset && (
        <Button variant="secondary" className="text-ink-secondary px-4 py-2 font-medium h-auto whitespace-normal" onClick={() => run(true)} disabled={saving}>
          保存して続けて作る
        </Button>
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
            v6 ? 'rounded-card space-y-3 p-[18px]' : 'rounded-card space-y-5 p-6'
          } ${aside ? 'min-w-0 flex-1' : 'max-w-2xl'}`}
        >
          {/* 保存時に落ちた欄のまとめ（★V7 sTJsh §6）。欄の上の方に出す。 */}
          {fields ? (
            <ValidationSummary problems={fields.listProblems()} onFocusFirst={fields.focusFirst} />
          ) : null}
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
  help,
  children,
}: {
  step: number
  label: string
  note?: string
  /**
   * 節の言葉の意味・仕様。見出しのすぐ右の「？」へ入れる
   * （★V7・§2-1b）。警告・直し方は note のまま残す。
   */
  help?: ReactNode
  children: ReactNode
}) {
  const v6 = useContext(VariantContext) === 'v6'
  const hasHelp = help !== undefined && help !== null
  return (
    <section
      className={`border-hairline border-b last:border-b-0 last:pb-0 ${v6 ? 'pb-3' : 'pb-5'}`}
    >
      <div className="mb-3 flex items-start gap-2">
        <span
          className={`bg-accent text-on-accent mt-0.5 flex shrink-0 items-center justify-center rounded-pill font-semibold ${
            v6 ? 'h-6 w-6 text-[13px]' : 'h-5 w-5 text-xs'
          }`}
        >
          {step}
        </span>
        <div>
          <h2 className={v6 ? 'text-ink text-lead font-bold' : 'text-ink text-sm font-semibold'}>
            {label}
            {hasHelp ? <HelpTip label={`${label}の説明`}>{help}</HelpTip> : null}
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
