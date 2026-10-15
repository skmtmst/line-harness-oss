import type { SecurityAlertsResponse, SecurityAlertReviewResponse } from '@line-crm/shared';
import { fetchApi } from './api';

function base(accountId?: string) {
  return accountId === undefined ? '/api/ops/security-alerts' : '/api/operations/security-alerts';
}
function query(accountId?: string) {
  return accountId === undefined ? '' : `?account_id=${encodeURIComponent(accountId)}`;
}

/** Omit accountId only in the platform console; the server enforces platform membership. */
export const securityMonitorApi = {
  list: (accountId?: string, offset = 0) => fetchApi<SecurityAlertsResponse>(`${base(accountId)}${query(accountId)}${accountId === undefined ? '?' : '&'}offset=${offset}`),
  acknowledge: (id: string, expectedVersion: number, accountId?: string) =>
    fetchApi<SecurityAlertReviewResponse>(`${base(accountId)}/${encodeURIComponent(id)}/acknowledge${query(accountId)}`,
      { method: 'POST', body: JSON.stringify({ expectedVersion }) }),
  resolve: (id: string, expectedVersion: number, accountId?: string) =>
    fetchApi<SecurityAlertReviewResponse>(`${base(accountId)}/${encodeURIComponent(id)}/resolve${query(accountId)}`,
      { method: 'POST', body: JSON.stringify({ expectedVersion }) }),
};
