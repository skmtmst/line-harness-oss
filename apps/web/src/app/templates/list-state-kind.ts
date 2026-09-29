import { ApiError } from '@/lib/api'

/**
 * テンプレート一覧（設計 `W7LBc` 11-1）の、中身を出せないときの言い分け。
 *
 * **一覧は `filteredTemplates.length === 0` だけを見て
 * 「該当するテンプレートがありません」と出していた。** 読み込みに失敗した
 * ときも、権限が無いときも、まだ1件も作っていないときも同じ文になるので、
 * 運用する人からは「登録したものが消えた」ように見える。
 * ここで4つ（読込中・取得失敗・権限不足・空）を分ける。
 */

export type TemplatesFailureKind = 'forbidden' | 'error'

export interface TemplatesFailure {
  kind: TemplatesFailureKind
  title: string
  description: string
}

/**
 * 失敗の中身を決める。
 *
 * **403 を「読み込めませんでした」に混ぜない。** 混ぜると、権限を足せば
 * 見られるのに、通信の不調だと思って何度も読み直すことになる。
 */
export function failureOf(error: unknown): TemplatesFailure {
  if (error instanceof ApiError && error.status === 403) {
    return {
      kind: 'forbidden',
      title: '見る権限がありません',
      description: '見るには権限が要ります。オーナーか管理者に追加を依頼してください。',
    }
  }
  return {
    kind: 'error',
    title: '読み込めませんでした',
    description: '通信が途切れたか、応答がありませんでした。',
  }
}

/**
 * API が `{ success: false }` を返したときの失敗。
 *
 * `fetchApi` は 403 を例外にするので、ここへ来るのは本文つきの失敗だけ。
 * **本文をそのまま題にしない。** 内部の文言が出ると読めない。
 */
export function failureOfResponse(): TemplatesFailure {
  return {
    kind: 'error',
    title: '読み込めませんでした',
    description: '時間をおいて、もう一度読み直してください。',
  }
}

export type TemplatesListView =
  | 'loading'
  | 'forbidden'
  | 'error'
  /** まだ1件も作っていない。 */
  | 'empty'
  /** 作ってはあるが、いまの絞り込みに合うものが無い。 */
  | 'no-match'
  | 'ready'

/**
 * いま一覧に何を出すか。
 *
 * **「まだ1件も無い」と「絞り込みに合わない」を分ける。** 前者は作る導線を
 * 出すところで、後者は条件を戻すところ。同じ文にすると、絞り込んだことを
 * 忘れた人が「消えた」と読む。
 */
export function listView(input: {
  loading: boolean
  failure: TemplatesFailure | null
  total: number
  matched: number
}): TemplatesListView {
  if (input.loading) return 'loading'
  if (input.failure) return input.failure.kind
  if (input.total === 0) return 'empty'
  if (input.matched === 0) return 'no-match'
  return 'ready'
}

/**
 * 「テンプレートを作る」を押せない理由。
 *
 * **口はある**（`POST /api/templates`）。読めていないあいだと、権限が
 * 無いあいだだけ押させない。押せない理由は本文に出す。
 */
export function createBlockedReason(input: {
  loading: boolean
  failure: TemplatesFailure | null
}): string | null {
  if (input.loading) return '読み込んでいます'
  if (input.failure?.kind === 'forbidden') return '操作する権限がありません'
  if (input.failure) return '読み込めませんでした。読み直してからお試しください。'
  return null
}
