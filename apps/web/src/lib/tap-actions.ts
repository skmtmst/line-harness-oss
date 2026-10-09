/*
 * 「押したら」の共通の決まり（オーナー採用 B-129・Pen YPzmo・2026-10-09）。
 *
 * 選べるのは6つ：URLを開く・テキストを送る・予約・回答フォーム・予約履歴・来店スタンプ。
 * 予約・回答フォーム・予約履歴・来店スタンプは、そのアカウントの LIFF のページを開く URL になる
 * （LINE には uri のボタンとして送る。保存する値の形は今までと同じ「URL の文字」）。
 *
 * 種類の定数はここに置き、URL の作成と読み戻しは packages/shared の共通関数を使う。
 * 画面と部品（components/shared/tap-action-field.tsx）はここを読む。
 */

import { liffActionUrl, liffActionFromUrl, type LiffAction } from '@line-crm/shared'

export type TapActionKind = 'uri' | 'message' | 'booking' | 'form' | 'booking_history' | 'visit_stamp'

/** LIFF のページを開く動き（アカウントに LIFF が無いと開けない）。 */
export type LiffTapActionKind = 'booking' | 'form' | 'booking_history' | 'visit_stamp'

export interface TapActionDef {
  kind: TapActionKind
  /** 開いた一覧・閉じたボタンの名前。 */
  label: string
  /** 開いた一覧の1行の説明。 */
  description: string
  /** LIFF のページを開くか。 */
  needsLiff: boolean
  /** 中身で作ってあるものを選ぶとき、その名前（予約メニュー・回答フォーム・スタンプカード）。 */
  target?: { noun: string; required: boolean }
}

/** 絵 YPzmo の順。 */
export const TAP_ACTION_DEFS: readonly TapActionDef[] = [
  { kind: 'uri', label: 'URLを開く', description: 'ホームページや外のページを開く', needsLiff: false },
  { kind: 'message', label: 'テキストを送る', description: '決めた言葉をお客さまから送ったことにする', needsLiff: false },
  { kind: 'booking', label: '予約', description: '予約ページを開く（メニューを決めて開くこともできる）', needsLiff: true, target: { noun: '予約メニュー', required: false } },
  { kind: 'form', label: '回答フォーム', description: '作ってある回答フォームを開く', needsLiff: true, target: { noun: '回答フォーム', required: true } },
  { kind: 'booking_history', label: '予約履歴', description: 'お客さまの予約の一覧を開く（変更・取り消し）', needsLiff: true },
  { kind: 'visit_stamp', label: '来店スタンプ', description: 'お客さまのスタンプカードを開く', needsLiff: true, target: { noun: 'スタンプカード', required: false } },
]

/** 6つ全部（店の既定）。 */
export const TAP_ACTION_KINDS: readonly TapActionKind[] = TAP_ACTION_DEFS.map((def) => def.kind)

export function tapActionDef(kind: string): TapActionDef | undefined {
  return TAP_ACTION_DEFS.find((def) => def.kind === kind)
}

export function isTapActionKind(kind: string): kind is TapActionKind {
  return TAP_ACTION_DEFS.some((def) => def.kind === kind)
}

export function tapActionNeedsLiff(kind: string): kind is LiffTapActionKind {
  return Boolean(tapActionDef(kind)?.needsLiff)
}

/** 動き→LIFF の URL。保存する先は共通の受け取り側とそろえる。 */
export function tapActionLiffUrl(liffId: string, kind: LiffTapActionKind, refId = ''): string {
  const id = refId.trim()
  const action: LiffAction = kind === 'form' ? { kind, formId: id }
    : kind === 'booking' ? { kind, menuId: id }
      : kind === 'visit_stamp' ? { kind, cardId: id } : { kind }
  // 未設定の店の編集用の仮URLは残す。保存前の検査では送信を止める。
  const placeholder = liffId === '{{liff_id}}'
  const url = liffActionUrl({ liffId: placeholder ? 'unconfigured' : liffId, allowEmptyForm: true, ...action })
  return placeholder ? url.replace('/unconfigured/', '/{{liff_id}}/') : url
}

/** URL→動き（保存してある URL を読み戻す）。LIFF のページに当たらなければ 'uri'。 */
export function tapActionFromUri(uri: string): { kind: TapActionKind; refId: string } {
  const action = liffActionFromUrl(uri.replace('/{{liff_id}}/', '/unconfigured/'), { allowEmptyForm: true })
  if (!action) return { kind: 'uri', refId: '' }
  return { kind: action.kind, refId: action.kind === 'form' ? action.formId
    : action.kind === 'booking' ? action.menuId ?? ''
      : action.kind === 'visit_stamp' ? action.cardId ?? '' : '' }
}

/** 押したら1つぶんの値（画面の間で持ち回る形）。保存の形は画面ごとに今のまま組み立てる。 */
export interface TapActionValue {
  /** 6つのどれか、または画面が足した種類（リッチメニューの「テンプレートを送る」など）。 */
  kind: string
  uri: string
  text: string
  /** 回答フォーム・予約メニュー・スタンプカードの ID。 */
  refId: string
}

export function emptyTapAction(kind: string = 'uri'): TapActionValue {
  return { kind, uri: '', text: '', refId: '' }
}

/**
 * URL だけを保存する所（回答フォームのリンクのカード・LINE 通知のボタンなど）で、値を URL にする。
 * LIFF の動きで LIFF ID が無ければ null（保存の前に止める）。
 */
export function tapActionToUri(value: TapActionValue, liffId: string | null): string | null {
  if (tapActionNeedsLiff(value.kind)) return liffId ? tapActionLiffUrl(liffId, value.kind, value.refId) : null
  return value.uri.trim()
}

/** URL だけを保存する所で、保存してある URL を値に戻す。 */
export function tapActionFromSavedUri(uri: string): TapActionValue {
  const parsed = tapActionFromUri(uri)
  return parsed.kind === 'uri' ? { kind: 'uri', uri, text: '', refId: '' } : { kind: parsed.kind, uri: '', text: '', refId: parsed.refId }
}

/** 保存の前に止める問題（無ければ null）。where は「カード1のボタン1」など。 */
export function tapActionProblem(value: TapActionValue, opts: { where: string; hasLiff: boolean; textMax?: number }): string | null {
  const def = tapActionDef(value.kind)
  if (!def) return null
  if (def.kind === 'uri' && !value.uri.trim()) return `${opts.where}のURLを入力してください`
  if (def.kind === 'message') {
    if (!value.text.trim()) return `${opts.where}の送る文を入力してください`
    if (opts.textMax && [...value.text.trim()].length > opts.textMax) return `${opts.where}の送る文は${opts.textMax}文字までです`
  }
  if (def.target?.required && !value.refId) return `${opts.where}の${def.target.noun}を選んでください`
  if (def.needsLiff && !opts.hasLiff) return `${opts.where}：このアカウントに LIFF が設定されていないため、「${def.label}」は開けません`
  return null
}
