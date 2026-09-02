import type { ApiBroadcast } from '@/lib/api'

/**
 * URLを開いたままLINEアカウントを切り替えたとき、前のアカウントの配信を
 * 新しいアカウントの画面に残さない。アカウント未記録の旧データだけは、
 * 既存の詳細URLを失わないように表示を保つ。
 */
export function broadcastBelongsToSelectedAccount(
  broadcast: ApiBroadcast,
  selectedAccountId: string,
): boolean {
  if (broadcast.targetType === 'multi-account-dedup') {
    return broadcast.accountIds?.includes(selectedAccountId) ?? false
  }
  return broadcast.lineAccountId == null || broadcast.lineAccountId === selectedAccountId
}
