/*
 * 「押したら」の共通の決まり（オーナー採用 B-129・Pen YPzmo・2026-10-09）。
 *
 * 選べるのは6つ：URLを開く・テキストを送る・予約・回答フォーム・予約履歴・来店スタンプ。
 * 予約・回答フォーム・予約履歴・来店スタンプは、そのアカウントの LIFF のページを開く URL になる
 * （LINE には uri のボタンとして送る。保存する値の形は今までと同じ「URL の文字」）。
 *
 * 種類の定数・「動き→LIFF の URL」・「URL→動き（読み戻し）」はこのファイルだけに置く。
 * 画面と部品（components/shared/tap-action-field.tsx）はここを読む。
 *
 * ★差し替える所：Codex が packages/shared に同じ関数（回答フォームの URL の形を1通りにそろえる・
 * 来店スタンプの入口を足す）を作っている。できたら `tapActionLiffUrl` と `tapActionFromUri` の
 * 中身だけをその関数の呼び出しに替える（ほかの所は替えなくてよい）。
 * 今の形：予約 `?page=salon-book`（メニュー指定は仮に `&menu=ID`）・予約履歴 `?page=salon-book&view=history`・
 * 回答フォーム `?page=form&id=ID`・来店スタンプ `?page=visit-stamps`（カード指定は仮に `&card=ID`）。
 */

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

const LIFF_ORIGIN = 'https://liff.line.me/'

/**
 * 動き→LIFF の URL。refId は回答フォーム・予約メニュー・スタンプカードの ID（任意のものは空でよい）。
 * ★Codex の packages/shared の関数ができたら中身を差し替える（上の説明）。
 */
export function tapActionLiffUrl(liffId: string, kind: LiffTapActionKind, refId = ''): string {
  const base = `${LIFF_ORIGIN}${liffId}/`
  const id = refId.trim()
  if (kind === 'form') return `${base}?page=form&id=${encodeURIComponent(id)}`
  if (kind === 'booking_history') return `${base}?page=salon-book&view=history`
  if (kind === 'visit_stamp') return `${base}?page=visit-stamps${id ? `&card=${encodeURIComponent(id)}` : ''}`
  return `${base}?page=salon-book${id ? `&menu=${encodeURIComponent(id)}` : ''}`
}

/**
 * URL→動き（保存してある URL を読み戻す）。LIFF のページに当たらなければ 'uri'。
 * ★Codex の packages/shared の関数ができたら中身を差し替える（上の説明）。
 */
export function tapActionFromUri(uri: string): { kind: TapActionKind; refId: string } {
  const match = /^https:\/\/liff\.line\.me\/[^/?#]+\/?\?([^#]*)$/.exec(uri.trim())
  if (!match) return { kind: 'uri', refId: '' }
  const query = new URLSearchParams(match[1])
  const page = query.get('page')
  if (page === 'form' && query.get('id')) return { kind: 'form', refId: query.get('id') ?? '' }
  if (page === 'salon-book') {
    if (query.get('view') === 'history') return { kind: 'booking_history', refId: '' }
    return { kind: 'booking', refId: query.get('menu') ?? '' }
  }
  if (page === 'visit-stamps') return { kind: 'visit_stamp', refId: query.get('card') ?? '' }
  return { kind: 'uri', refId: '' }
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
