import type { StaffMember } from '@line-crm/shared'

/** 本人APIで確認できた利用者・統括の保存値だけを読む。共通キーは移行しない。 */
export function registrationStorageKey(base: string, identity: Pick<StaffMember, 'id' | 'tenantId'> | null): string | null {
  if (!identity?.id || !identity.tenantId) return null
  return `${base}:${encodeURIComponent(identity.tenantId)}:${encodeURIComponent(identity.id)}`
}
