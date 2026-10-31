import type { LineAccount } from '@line-crm/shared'

export function uidAccountHint(account: LineAccount): string {
  const state = account.archivedAt ? '保管済み' : account.isActive === false ? '停止中' : '現役'
  return `${state} · ID: ${account.id}`
}
export function uidAccountCandidates(accounts: LineAccount[]): LineAccount[] {
  const inactive = (account: LineAccount) => Number(Boolean(account.archivedAt) || account.isActive === false)
  return [...accounts].sort((a, b) => inactive(a) - inactive(b))
}
export function uidDryRunBlockedReason(input: { fromAccountId: string; toAccountId: string; purpose: string; file: File | null; mappingsFile: File | null; mappings: readonly unknown[] }): string | null {
  if (!input.fromAccountId) return '移行元アカウントを選んでください。'
  if (!input.toAccountId) return '移行先アカウントを選んでください。'
  if (input.fromAccountId === input.toAccountId) return '移行元と違うアカウントを移行先に選んでください。'
  if (!input.purpose.trim()) return '利用目的を入力してください。'
  if (!input.file) return '対応表のCSVを選んでください。'
  if (input.mappingsFile !== input.file) return '対応表のCSVを読み込んでいます。'
  if (!input.mappings.length) return 'old_uid・new_uid列がある対応表のCSVを選んでください。'
  return null
}
