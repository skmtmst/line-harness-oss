import { fetchApi } from './api';
import type { ApiResponse } from '@line-crm/shared';

export type StagingQaRole = 'hq' | 'store' | 'viewer' | 'impersonation';
export type StagingQaJob = 'booking_waitlists' | 'restaurant_holds' | 'restaurant_menu_prices';
export type StagingQaRun = {
  id: string; tenantId: string; accountId: string; status: 'active' | 'archived';
  organizationId: string; storeId: string;
  users: Array<{ id: string; role: StagingQaRole; email: string }>; friendIds: string[];
};
const base = '/api/ops/staging-qa';
const runPath = (id: string) => `${base}/runs/${encodeURIComponent(id)}`;
/** QA control API requires the operator's existing authenticated session. */
export const stagingQaApi = {
  safety: () => fetchApi<ApiResponse<{ environment: 'staging'; outboundStopped: true; simulatedLineOnly: true; jobs: StagingQaJob[] }>>(`${base}/safety`),
  list: (after?: string) => fetchApi<ApiResponse<{ runs: StagingQaRun[]; nextCursor: string | null }>>(`${base}/runs${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  create: (passwords: Record<StagingQaRole, string>) => fetchApi<ApiResponse<StagingQaRun>>(`${base}/runs`, { method: 'POST', body: JSON.stringify({ passwords }) }),
  detail: (id: string) => fetchApi<ApiResponse<StagingQaRun>>(runPath(id)),
  friends: (id: string, count: number) => fetchApi<ApiResponse<{ runId: string; accountId: string; friends: Array<{ id: string; lineUserId: string }> }>>(`${runPath(id)}/friends`, { method: 'POST', body: JSON.stringify({ count }) }),
  session: (id: string, role: StagingQaRole) => fetchApi<ApiResponse<{ id: string; role: StagingQaRole; tenantId: string }>>(`${runPath(id)}/session`, { method: 'POST', body: JSON.stringify({ role }) }),
  remove: (id: string) => fetchApi<ApiResponse<{ id: string; status: 'archived' }>>(runPath(id), { method: 'DELETE' }),
  cron: (id: string, job: StagingQaJob, requestId: string) => fetchApi<ApiResponse<{ job: StagingQaJob; status: 'completed' | 'running' | 'failed'; accountId?: string; outboundStopped?: true; completedAt?: string }>>(`${runPath(id)}/cron`, { method: 'POST', body: JSON.stringify({ job, requestId }) }),
};
