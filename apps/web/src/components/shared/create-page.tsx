'use client'

import { useId, useEffect, useState, type ReactNode } from 'react'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { CreatePage as CreateTemplate } from '@/components/templates/create-page'
import FormSectionView from './form-section'
import Card, { CardHeader } from './card'
import Button from '@/components/shared/button'
import { notifySaved } from '@/components/shared/toast'
import HelpTip from '@/components/shared/help-tip'
import ValidationSummary from '@/components/shared/validation-summary'
import { describeSaveFailure } from '@/lib/api'
import { SaveErrorScope, useSaveFormErrors } from './save-form-errors'
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
  help?: ReactNode
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
   * 欄ごとの検査。渡すと保存時に全欄を検査し、落ちた欄は
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
  children: ReactNode
}

export default function CreatePage({
  title,
  help,
  parent,
  onSave,
  successHref,
  onReset,
  validate,
  describeError,
  fields,
  aside,
  saveLabel,
  children,
}: CreatePageProps) {
  const saveErrors = useSaveFormErrors()

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
     * 欄の下に理由・上にまとめを出す。直し方が分かる文なので
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
      if (!andAnother) notifySaved()
      if (andAnother) {
        onReset?.()
        notifySaved('保存しました。続けて作れます。')
        return
      }
      // 作った行を一覧で目立たせる。どこに増えたのか探させない。
      router.push(successHref ? successHref(id) : createPageReturnHref(parent[1], id))
    } catch (e) {
      if (!(saveErrors.capture(e, fields))) setError(describeError ? describeError(e) : createPageErrorMessage(e))
      setErrorKind('save')
    } finally {
      setSaving(false)
    }
  }

  return <SaveErrorScope errors={saveErrors}>
    <CreateTemplate
      title={title}
      help={help}
      busy={saving}
      preview={aside}
      hidePreviewWhenNarrow
      footerActions={<>
        <Button href={parent[1]}>キャンセル</Button>
        {onReset ? <Button onClick={() => run(true)} disabled={saving} busy={saving}>保存して続けて作る</Button> : null}
        <Button variant="primary" onClick={() => run(false)} disabled={saving} busy={saving}>
          {saveLabel ?? "保存する"}
        </Button>
      </>}
    >
      {fields ? <ValidationSummary problems={fields.listProblems()} onFocusFirst={fields.focusFirst} /> : null}
      {children}
      {error ? <p className="text-danger text-sm" role="alert">{error}</p> : null}
      {notice ? <p className="text-success text-sm" role="status">{notice}</p> : null}
    </CreateTemplate>
  </SaveErrorScope>
}

/**
 * 設定フォームの節。段の順は呼び出し側が保持し、見た目は共通部品へ渡す。
 */
export function FormSection({
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
   * 警告・直し方は note のまま残す。
   */
  help?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return <FormSectionView id={id} title={label} description={note}
    action={help ? <HelpTip label={label}>{help}</HelpTip> : undefined}>
    {children}
  </FormSectionView>
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
  return <Card spacing="normal">
    <CardHeader title={title} meta={note} />
    {children}
  </Card>
}

// Field と inputClass は form-controls.tsx に移した。入力欄だけ使いたい画面が
// この骨組みごと読み込んでしまうため。読み込み側を変えずに済むよう再輸出する。
export { Field, inputClass } from './form-controls'
