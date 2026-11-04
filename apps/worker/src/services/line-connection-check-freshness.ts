import type { LineAccountConnectionCheck } from '@line-crm/db';
import { LINE_CONNECTION_CHECK_TTL_MS } from '@line-crm/shared';

type Check = { checked_at: string; account_revision: number };

/** Saved checks can only be replayed while current and tied to this account version. */
export function isConnectionCheckFresh(checks: Check[], revision: number, now = Date.now()): boolean {
  if (!checks.length) return false;
  const value = checks[0].checked_at;
  const at = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  const age = now - at;
  return Number.isFinite(age) && age >= 0 && age < LINE_CONNECTION_CHECK_TTL_MS
    && checks.every(row => row.account_revision === revision);
}

export function serializeConnectionCheck(row: LineAccountConnectionCheck) {
  return {
    kind: row.check_kind,
    result: row.result,
    expectedUrl: row.expected_url,
    registeredUrl: row.registered_url,
    webhookActive: row.webhook_active == null ? null : Boolean(row.webhook_active),
    httpStatus: row.http_status,
  };
}
