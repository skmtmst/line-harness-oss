import type {
  FriendBulkOperation,
  FriendBulkPreview,
  FriendBulkRunDetail,
  FriendBulkItemStatus,
} from '@line-crm/shared'

/**
 * 友だちの一括操作（設計 `IAf7j` 3-1-C）。
 *
 * **選んだ人数がそのまま対象になるとは限らない。** 対象はサーバーが
 * 数え直す。画面の選択数を実行数として扱うと、除外された人まで
 * 「やった」ことになる。
 */

export const NOT_AVAILABLE = '—'

/** 一括操作を扱えるのはオーナーと管理者だけ（個別操作の権限を越えるため）。 */
export function canRunBulk(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export const OPERATIONS: ReadonlyArray<{
  kind: FriendBulkOperation['kind']
  label: string
  note: string
  /** 取り消せるか。取り消せないものは窓で明記して追加確認する。 */
  reversible: boolean
}> = [
  { kind: 'add_tag', label: 'タグを付ける', note: '選んだタグを付けます', reversible: true },
  { kind: 'remove_tag', label: 'タグを外す', note: '選んだタグを外します', reversible: true },
  { kind: 'assign_operator', label: '担当者を決める', note: '担当者を割り当てます', reversible: true },
  { kind: 'start_scenario', label: 'シナリオを始める', note: '選んだシナリオを開始します', reversible: false },
  { kind: 'send_message', label: 'メッセージを送る', note: '送ったメッセージは取り消せません', reversible: false },
]

export function operationLabel(kind: string): string {
  return OPERATIONS.find((o) => o.kind === kind)?.label ?? NOT_AVAILABLE
}

/** 人数の見え方。**未取得は `—`。実値0は `0`。** */
export function countText(value: number | null | undefined, unit: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NOT_AVAILABLE
  return `${value.toLocaleString('ja-JP')}${unit}`
}

/**
 * 実行してよいか。
 *
 * **未取得のときは実行させない。** 何人に何が起きるか分からないまま
 * 走らせることになる。対象0人でも走らせない（何も起きない）。
 */
export function canExecute(input: {
  preview: FriendBulkPreview | null
  busy: boolean
  irreversibleConfirmed: boolean
  reversible: boolean
}): boolean {
  if (input.busy || !input.preview) return false
  if (input.preview.targetCount <= 0) return false
  /* 取り消せない操作は、追加の確認を通してからでないと実行しない。 */
  if (!input.reversible && !input.irreversibleConfirmed) return false
  return true
}

export function blockedReason(input: {
  preview: FriendBulkPreview | null
  reversible: boolean
  irreversibleConfirmed: boolean
}): string | null {
  if (!input.preview) return '対象を数えられていません。読み直してから実行してください。'
  if (input.preview.targetCount <= 0) return '対象が0人です。選び直してください。'
  if (!input.reversible && !input.irreversibleConfirmed) return '取り消せない操作です。下の確認に印を付けてください。'
  return null
}

export type ItemGroup = {
  key: 'success' | 'skipped' | 'temporary_failure' | 'permanent_failure'
  label: string
  note: string
}

/**
 * 結果の呼び分け。**成功・見送り・一時失敗・恒久失敗を別の言葉にする。**
 * まとめて「失敗」と書くと、もう一度試せばよいのか、直さないと駄目なのかが分からない。
 */
export const ITEM_GROUPS: ReadonlyArray<ItemGroup> = [
  { key: 'success', label: '終わった人', note: '操作が反映されました' },
  { key: 'skipped', label: '見送った人', note: 'すでにその状態だったため何もしていません' },
  { key: 'temporary_failure', label: 'あとでやり直す人', note: '一時的な理由で失敗しました。やり直せます' },
  { key: 'permanent_failure', label: '直さないと進めない人', note: 'やり直しても同じ結果になります' },
]

export function itemStatusLabel(status: FriendBulkItemStatus): string {
  switch (status) {
    case 'success': return '終わった'
    case 'skipped': return '見送った'
    case 'temporary_failure': return 'あとでやり直す'
    case 'permanent_failure': return '直さないと進めない'
    case 'queued': return '順番待ち'
    case 'running': return '実行中'
    case 'waiting': return '待っています'
    default: return NOT_AVAILABLE
  }
}

/** 再試行してよいか。**失敗した対象がいるときだけ。** */
export function canRetry(detail: FriendBulkRunDetail | null): boolean {
  if (!detail) return false
  return detail.temporaryFailureCount > 0
}

/** 取り消してよいか。**取り消せる操作で、成功した人がいるときだけ。** */
export function canUndo(detail: FriendBulkRunDetail | null): boolean {
  if (!detail) return false
  return detail.reversible && detail.successCount > 0
}

export type Failure = {
  kind: 'conflict' | 'forbidden' | 'input' | 'failure'
  message: string
  canReload: boolean
}

/**
 * 失敗の言い換え。
 *
 * **409を一般の失敗と混ぜない。** 同じ鍵で中身が違う実行を送ったときに出る。
 * 「もう一度押す」ではなく「読み直す」が正しい次の行動になる。
 */
export function failureOf(input: { status?: number }): Failure {
  if (input.status === 409) {
    return {
      kind: 'conflict',
      message: '同じ操作がすでに記録されています。最新の状態を読み直してから、もう一度確かめてください。',
      canReload: true,
    }
  }
  if (input.status === 403) {
    return {
      kind: 'forbidden',
      message: 'このLINEアカウントで一括操作を行う権限がありません。管理者にご確認ください。',
      canReload: false,
    }
  }
  if (input.status === 404) {
    return { kind: 'failure', message: 'この実行は見つかりませんでした。一覧を読み直してください。', canReload: true }
  }
  if (input.status === 400 || input.status === 422) {
    return { kind: 'input', message: '入力を確認してください。実行していません。', canReload: false }
  }
  return { kind: 'failure', message: '一括操作を実行できませんでした。時間をおいて、もう一度お試しください。', canReload: false }
}

/**
 * 冪等キー。**操作ごとに新しく作る。**
 * 使い回すと、別の内容を同じ鍵で送って409になる。
 */
export function newIdempotencyKey(seed: string): string {
  return `friend-bulk-${seed}`
}
