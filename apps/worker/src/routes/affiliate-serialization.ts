


export function serializeAffiliate(row: {
  id: string;
  tenant_id?: string;
  folder_id?: string | null;
  line_account_id?: string | null;
  name: string;
  code: string;
  commission_rate: number;
  reward_mode?: 'none' | 'fixed' | 'rate' | null;
  is_active: number;
  created_at: string;
  friend_id?: string | null;
  email?: string | null;
  hold_days?: number | null;
  payout_cycle?: string | null;
  notify_on_conversion?: number;
}) {
  return {
    id: row.id,
    folderId: row.folder_id ?? null,
    tenantId: row.tenant_id ?? null,
    lineAccountId: row.line_account_id ?? null,
    name: row.name,
    code: row.code,
    commissionRate: row.commission_rate,
    rewardMode: row.reward_mode ?? (row.commission_rate > 0 ? 'rate' : 'fixed'),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    friendId: row.friend_id ?? null,
    email: row.email ?? null,
    holdDays: row.hold_days ?? null,
    payoutCycle: row.payout_cycle ?? null,
    notifyOnConversion: Boolean(row.notify_on_conversion),
  };
}
