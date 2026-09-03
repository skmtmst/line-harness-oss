import type { LineAccount } from '@line-crm/shared'

/**
 * LINEアカウントの詳細・編集（設計 ★V6 33-3 `T9rA9`）。
 *
 * 表示の言葉を画面から切り離し、**描かずに確かめられる**ようにする。
 */

/** 設計のタブ。`?tab=` で切り替える（共有・再読込・戻るに強い）。 */
export const DETAIL_TABS = [
  { value: 'overview', label: '概要' },
  { value: 'connection', label: '接続の確認' },
  { value: 'credentials', label: '資格情報' },
  { value: 'handover', label: '乗り換え' },
] as const

export type DetailTab = (typeof DETAIL_TABS)[number]['value']

export function toTab(value: string | null): DetailTab {
  return DETAIL_TABS.some((t) => t.value === value) ? (value as DetailTab) : 'overview'
}

/**
 * 資格情報の出し方。
 *
 * **値そのものは出さない。** 出るのは「入っているかどうか」だけ。
 * 設計は末尾4文字と更新日も出すが、**API がまだ返さない**（台帳 #132）。
 * 作れないものを作らず、「まだ出せません」と書く。
 */
export function credentialLabel(configured: boolean | undefined): string {
  if (!configured) return '入っていません'
  return '入っています（末尾と更新日はまだ出せません）'
}

/**
 * 親アカウントの言い方。
 * **「なし」ではなく「このアカウントが親」**——設計の言葉。
 * 「なし」だと、決め忘れなのか意図なのかが分からない。
 */
export function parentLabel(account: LineAccount, all: LineAccount[]): string {
  if (!account.parentLineAccountId) return 'なし（このアカウントが親）'
  return all.find((a) => a.id === account.parentLineAccountId)?.name ?? '—'
}

/**
 * 友だち数の上限。
 * **取れない数を 0 と書かない。** 未設定なら、そのまま「未設定」。
 */
export function capacityLabel(account: LineAccount): string {
  const cap = account.friendCapacity
  const warn = account.capacityWarnAt
  if (cap === null || cap === undefined) return '上限は未設定'
  const warnText = warn === null || warn === undefined ? '警告なし' : `警告 ${warn.toLocaleString('ja-JP')}`
  return `上限 ${cap.toLocaleString('ja-JP')}／${warnText}`
}

/**
 * このアカウントでできること（設計の 4 つ）。
 *
 * **できないものは押し口を出さず、理由を書く**（`v6-common-rules.md` §7-10）。
 */
export interface AccountAction {
  key: 'stop' | 'copy' | 'handover' | 'archive'
  title: string
  description: string
  actionLabel: string
  /** 押せない理由。null なら押せる。 */
  blockedReason: string | null
}

export function accountActions(account: LineAccount): AccountAction[] {
  return [
    {
      key: 'stop',
      title: account.isActive ? '送受信を止める' : '送受信を再開する',
      description: account.isActive
        ? '止めているあいだ、配信も受信もしません。友だちと履歴はそのまま残ります。いつでも戻せます。'
        : '再開すると、配信と受信が動き始めます。止めているあいだに予約していた配信は、自動で送り直しません。',
      actionLabel: account.isActive ? '送受信を止める' : '送受信を再開する',
      blockedReason: null,
    },
    {
      key: 'copy',
      title: '設定をほかのアカウントへ写す',
      description: 'タグ・テンプレート・自動応答の設定を、選んだアカウントへ写します。友だちと履歴は写しません。',
      actionLabel: '写す先を選ぶ',
      // 写せるのは登録のときだけ（`copyFromAccountId`）。あとから写す口が無い。
      blockedReason: '登録済みのアカウントへあとから写す操作は、まだ繋がっていません。',
    },
    {
      key: 'handover',
      title: '乗り換えを始める',
      description: '別のLINEアカウントへ、友だちと設定を引き継ぎます。事前確認をしてから本実行します。',
      actionLabel: '乗り換えを始める',
      blockedReason: null,
    },
    {
      key: 'archive',
      title: 'アーカイブする',
      description: '一覧から外します。送受信は止まり、記録は残ります。あとから戻せます。',
      actionLabel: 'アーカイブする',
      // `archived_at` がまだ無い（台帳 #128）。いまの DELETE は物理削除。
      blockedReason: 'アーカイブは、まだ繋がっていません。いまの削除は取り消せないため、押し口を出していません。',
    },
  ]
}
