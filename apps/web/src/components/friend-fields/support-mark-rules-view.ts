import type { SupportMarkAutomationEvent, SupportMarkAutomationRule } from '@/lib/api'

/**
 * 対応マークの自動変更ルール（設計 `GMvBd` 4-3-A）。
 *
 * ここは画面に出す言葉と、送る前の確かめだけを持つ。**Workerの検査を
 * 置き換えない。** 押してから断られるより、打っている最中に気づけるだけ。
 */

/** きっかけ。Workerの `SUPPORT_MARK_RULE_EVENTS` と同じ5つ。 */
export const EVENT_LABELS: ReadonlyArray<{ value: SupportMarkAutomationEvent; label: string; note: string }> = [
  { value: 'message_received', label: 'メッセージを受け取ったとき', note: '友だちから届いた時点で見ます' },
  { value: 'manual_reply_sent', label: '担当者が返信したとき', note: '手で送った返信だけを見ます' },
  { value: 'staff_assigned', label: '担当者が決まったとき', note: '割り当てが変わった時点で見ます' },
  { value: 'response_overdue', label: '返信の期限を過ぎたとき', note: '期限を過ぎた会話を見ます' },
  { value: 'condition_matched', label: '条件に合ったとき', note: '上の4つのどの出来事でも、条件を見直します' },
]

export function eventLabel(event: SupportMarkAutomationEvent | string): string {
  return EVENT_LABELS.find((item) => item.value === event)?.label ?? '—'
}

/*
  Workerの受け入れる範囲。**画面で勝手に決めない。**
  `support-mark-automation.ts` の `validateInput` と同じ値にしている。
*/
export const PRIORITY_MIN = -1000
export const PRIORITY_MAX = 1000
/** 分。7日ぶん。 */
export const PROTECTION_MAX = 10080

export const NOT_AVAILABLE = '—'

/**
 * 実行順。**Workerの `ORDER BY d.priority DESC, d.created_at ASC` と同じ。**
 * 画面の並びが実行順と違うと、「上のほうが先に効く」という説明が嘘になる。
 */
export function inExecutionOrder(rules: SupportMarkAutomationRule[]): SupportMarkAutomationRule[] {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return a.updatedAt.localeCompare(b.updatedAt)
  })
}

/** 手動変更の保護時間。0は「保護しない」で、未取得ではない。 */
export function protectionText(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return NOT_AVAILABLE
  if (minutes === 0) return '保護しない'
  if (minutes % 1440 === 0) return `${minutes / 1440}日`
  if (minutes % 60 === 0) return `${minutes / 60}時間`
  return `${minutes}分`
}

/** 動いているか。止めているルールは実行順から外れて見えるべき。 */
export function activeText(isActive: boolean): string {
  return isActive ? '動いています' : '止めています'
}

export type FieldError = { field: 'name' | 'priority' | 'manualProtectionMinutes'; message: string }

export function validateRule(input: {
  name: string
  priority: number
  manualProtectionMinutes: number
}): FieldError[] {
  const errors: FieldError[] = []
  if (!input.name.trim()) {
    errors.push({ field: 'name', message: 'ルールの名前を入れてください。' })
  }
  if (!Number.isInteger(input.priority) || input.priority < PRIORITY_MIN || input.priority > PRIORITY_MAX) {
    errors.push({ field: 'priority', message: `優先順位は${PRIORITY_MIN}〜${PRIORITY_MAX}の整数で入れてください。` })
  }
  if (!Number.isInteger(input.manualProtectionMinutes)
    || input.manualProtectionMinutes < 0
    || input.manualProtectionMinutes > PROTECTION_MAX) {
    errors.push({
      field: 'manualProtectionMinutes',
      message: `手動変更の保護時間は0〜${PROTECTION_MAX}分（7日）で入れてください。`,
    })
  }
  return errors
}

export type Failure = {
  /** 読込中・0件・取得失敗・権限不足・版競合を混ぜない。次にすることが違う。 */
  kind: 'forbidden' | 'conflict' | 'input' | 'failure'
  message: string
  /** 版競合のときだけ、読み直す押し口を出す。 */
  canReload: boolean
}

/**
 * Workerの返事を画面の言葉にする。
 *
 * **`code` では見分けられない。** `extractApiErrorCode` は本文の `code` が
 * 英小文字のsnake_caseのときだけ拾う。Workerは
 * `SUPPORT_MARK_RULE_VERSION_CONFLICT` と大文字で返すので、
 * `ApiError.code` は `undefined` になる。**status で見る。**
 */
export function failureOf(input: { status?: number }): Failure {
  if (input.status === 403) {
    return {
      kind: 'forbidden',
      message: 'このLINEアカウントで自動変更ルールを扱う権限がありません。管理者にご確認ください。',
      canReload: false,
    }
  }
  if (input.status === 409) {
    return {
      kind: 'conflict',
      message: 'ほかの担当者が先に変更しました。最新の内容を読み直してから、もう一度保存してください。',
      canReload: true,
    }
  }
  if (input.status === 400 || input.status === 422) {
    return { kind: 'input', message: '入力を確認してください。保存していません。', canReload: false }
  }
  if (input.status === 404) {
    return { kind: 'failure', message: 'この自動変更ルールは見つかりませんでした。一覧を読み直してください。', canReload: true }
  }
  return { kind: 'failure', message: '自動変更ルールを保存できませんでした。時間をおいて、もう一度お試しください。', canReload: false }
}

/** 一覧の取得失敗。**0件と同じ顔にしない。** */
export const LIST_ERROR = {
  title: '自動変更ルールを読み込めませんでした',
  description: '登録したルールは消えていません。読み直しても直らない場合は、管理者にご連絡ください。',
} as const

export const LIST_EMPTY = {
  title: 'このマークに自動変更ルールはありません',
  description: '受信・返信・担当割当・期限超過などをきっかけに、このマークへ自動で変えられます。',
} as const

/** 複数一致したときの決めごと。画面で先に言う。 */
export const MULTI_MATCH_NOTE =
  '同時にいくつも当てはまったときは、上から順に見て最初に合った1本だけが動きます。'

export type RuleDraft = {
  name: string
  event: SupportMarkAutomationEvent
  priority: string
  manualProtectionMinutes: string
  isActive: boolean
}

export type RuleBody = {
  name: string
  event: SupportMarkAutomationEvent
  condition: null
  priority: number
  manualProtectionMinutes: number
  isActive: boolean
}

/**
 * 送る本文。**Workerの `supportMarkRuleInput` が読む形と同じ6項目だけ。**
 *
 * 数は数で送る。入れ物は文字列を返すので、そのまま渡すと
 * `Number.isInteger` を通らず 400 になる。
 * `expectedVersion` は本文に混ぜない（更新はURLと別引数で渡す）。
 */
export function toRuleBody(draft: RuleDraft): RuleBody {
  return {
    name: draft.name.trim(),
    event: draft.event,
    condition: null,
    priority: Number(draft.priority),
    manualProtectionMinutes: Number(draft.manualProtectionMinutes),
    isActive: draft.isActive,
  }
}

export type SaveCall =
  | { kind: 'create' }
  | { kind: 'update'; ruleId: string; expectedVersion: number }

/**
 * 作るのか、直すのか。**直すときは、そのルール自身の版を送る。**
 *
 * 一覧の先頭の版や、画面が覚えている別の版を送ると、
 * 競合していないのに409になったり、**古い内容で上書きできてしまう。**
 */
export function saveCallOf(
  editingId: string | null,
  rules: ReadonlyArray<{ id: string; version: number }>,
): SaveCall | null {
  if (editingId === null) return null
  if (editingId === 'new') return { kind: 'create' }
  const target = rules.find((rule) => rule.id === editingId)
  /* 一覧に無いものは直せない。読み直しが要る。 */
  if (!target) return null
  return { kind: 'update', ruleId: target.id, expectedVersion: target.version }
}

export type RequestAt = { accountId: string | null; markId: string | null; generation: number }

/**
 * 遅い返事を受け取ってよいか。**アカウント・マーク・世代の3つが一致したときだけ。**
 * マークを続けて押すと前の返事があとから届く。世代だけで見ると、
 * アカウントを切り替えた直後に別アカウントの中身を映してしまう。
 */
export function isCurrentResponse(now: RequestAt, at: RequestAt): boolean {
  return now.accountId === at.accountId
    && now.markId === at.markId
    && now.generation === at.generation
}
