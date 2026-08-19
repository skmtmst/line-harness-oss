import type { AccountHealthLog, LineAccount } from '@line-crm/shared'

export type OperationSeverity = 'normal' | 'warning' | 'danger' | 'unknown'

export interface MonthlyQuotaStatus {
  severity: Exclude<OperationSeverity, 'unknown'>
  remaining: number | null
  remainingPercent: number | null
}

/**
 * 月間配信枠は、残り0通だけをエラー、残り15%未満を注意として扱う。
 * 上限なし・取得不能は、それ自体を異常とは決めつけない。
 */
export function monthlyQuotaStatus(limit: number | null, used: number | null): MonthlyQuotaStatus {
  if (limit == null || used == null) {
    return { severity: 'normal', remaining: null, remainingPercent: null }
  }

  const safeLimit = Math.max(limit, 0)
  const remaining = Math.max(safeLimit - Math.max(used, 0), 0)
  const remainingPercent = safeLimit === 0 ? 0 : (remaining / safeLimit) * 100

  if (remaining === 0) return { severity: 'danger', remaining, remainingPercent }
  if (remainingPercent < 15) return { severity: 'warning', remaining, remainingPercent }
  return { severity: 'normal', remaining, remainingPercent }
}

export const HEALTH_CRITERIA = [
  {
    severity: 'danger' as const,
    label: '異常',
    condition: 'LINE API が 403 を返したとき',
    action: '配信を止め、認証状態とアカウント状態を確認します',
  },
  {
    severity: 'warning' as const,
    label: '注意',
    condition: 'LINE API が 429 を返したとき、または直近1時間の送信が5,000通を超えたとき',
    action: '送信量を確認し、必要に応じて配信を止めます',
  },
  {
    severity: 'normal' as const,
    label: '正常',
    condition: '403・429がなく、直近1時間の送信が5,000通以下のとき',
    action: 'そのまま運用できます',
  },
] as const

export interface OperationHealthRow {
  accountId: string
  accountName: string
  severity: OperationSeverity
  checkedAt: string | null
  errorCode: number | null
  errorCount: number
  checkPeriod: string | null
}

export function latestHealthLog(logs: AccountHealthLog[]): AccountHealthLog | null {
  return [...logs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null
}

export function buildHealthRows(
  accounts: Pick<LineAccount, 'id' | 'name'>[],
  logsByAccount: Record<string, AccountHealthLog[]>,
  risksByAccount: Record<string, string>,
): OperationHealthRow[] {
  return accounts.map((account) => {
    const latest = latestHealthLog(logsByAccount[account.id] ?? [])
    const rawRisk = risksByAccount[account.id] ?? latest?.riskLevel ?? 'unknown'
    const severity: OperationSeverity =
      rawRisk === 'danger' || rawRisk === 'warning' || rawRisk === 'normal'
        ? rawRisk
        : 'unknown'

    return {
      accountId: account.id,
      accountName: account.name,
      severity,
      checkedAt: latest?.createdAt ?? null,
      errorCode: latest?.errorCode ?? null,
      errorCount: latest?.errorCount ?? 0,
      checkPeriod: latest?.checkPeriod ?? null,
    }
  })
}

export function overallSeverity(rows: OperationHealthRow[]): OperationSeverity {
  if (rows.some((row) => row.severity === 'danger')) return 'danger'
  if (rows.some((row) => row.severity === 'warning')) return 'warning'
  if (rows.length === 0 || rows.some((row) => row.severity === 'unknown')) return 'unknown'
  return 'normal'
}

export function formatOperationDate(value: string | null): string {
  if (!value) return 'まだありません'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時不明'
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function buildResearchReport(input: {
  generatedAt: string
  overall: OperationSeverity
  rows: OperationHealthRow[]
  quotaLimit: number | null
  quotaUsed: number | null
}): string {
  const abnormal = input.rows.filter((row) => row.severity === 'danger' || row.severity === 'warning')
  const remaining =
    input.quotaLimit == null || input.quotaUsed == null
      ? '取得できません'
      : Math.max(input.quotaLimit - input.quotaUsed, 0).toLocaleString('ja-JP')

  const lines = [
    '# 運用状態 調査レポート',
    '',
    `- 出力日時: ${formatOperationDate(input.generatedAt)}`,
    `- 全体状態: ${input.overall}`,
    `- 確認アカウント数: ${input.rows.length}`,
    `- 異常・注意: ${abnormal.length}件`,
    `- 今月の配信残数: ${remaining}`,
    '',
    '## 異常・注意の内容',
    '',
  ]

  if (abnormal.length === 0) {
    lines.push('異常・注意はありません。')
  } else {
    for (const row of abnormal) {
      lines.push(`### ${row.accountName}`)
      lines.push(`- 判定: ${row.severity}`)
      lines.push(`- エラーコード: ${row.errorCode ?? 'なし'}`)
      lines.push(`- エラー回数: ${row.errorCount}`)
      lines.push(`- 確認日時: ${formatOperationDate(row.checkedAt)}`)
      lines.push('')
    }
  }

  lines.push('## 異常判定基準', '')
  for (const criterion of HEALTH_CRITERIA) {
    lines.push(`- ${criterion.label}: ${criterion.condition}。${criterion.action}。`)
  }
  lines.push('', '## 取り扱い', '', 'パスワード、APIトークン、秘密鍵、Cookie、顧客情報、メッセージ本文は含めていません。')

  return lines.join('\n')
}
