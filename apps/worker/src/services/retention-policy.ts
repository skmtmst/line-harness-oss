export const RETENTION_POLICY_KEY = 'security.personalDataRetention.v1';
export const RETENTION_PROPOSAL = { enabled: false, hold: false, responseDays: 365, blockedFriendDays: 365 } as const;
export type RetentionPolicy = { enabled: boolean; hold: boolean; responseDays: number; blockedFriendDays: number };
/** Reject invalid settings: a typo must never turn into immediate deletion. */
export function parseRetentionPolicy(raw: string | null): RetentionPolicy {
  if (!raw) return { ...RETENTION_PROPOSAL };
  const parsed: unknown = JSON.parse(raw);
  return retentionPolicyFromValue(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function retentionPolicyFromValue(value: unknown): RetentionPolicy {
  const p = isRecord(value) && 'version' in value ? value.data : value;
  if (!isRecord(p) || typeof p.enabled !== 'boolean' || typeof p.hold !== 'boolean'
    || !isRetentionDays(p.responseDays) || !isRetentionDays(p.blockedFriendDays)) throw new Error('invalid_retention_policy');
  return { enabled: p.enabled, hold: p.hold, responseDays: p.responseDays, blockedFriendDays: p.blockedFriendDays };
}
function isRetentionDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3650;
}

export function retentionCutoff(now: Date, days: number): string {
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(days) || days < 1 || days > 3650) throw new Error('invalid_retention_cutoff');
  return new Date(now.getTime() - days * 86400000).toISOString();
}
