import { fetchApi } from '../../api';
import type { ApiResponse } from '@line-crm/shared';

import type { StagingQaRole, StagingQaJob, StagingQaRun, StagingQaSafety, StagingQaSession, StagingQaCronReceipt } from '@line-crm/shared';
export type { StagingQaRole, StagingQaJob, StagingQaRun } from '@line-crm/shared';
const base = '/api/ops/staging-qa';
const runPath = (id: string) => `${base}/runs/${encodeURIComponent(id)}`;
/** QA control API requires the operator's existing authenticated session. */
export const stagingQaApi = {
  safety: () => fetchApi<ApiResponse<StagingQaSafety>>(`${base}/safety`),
  list: (after?: string) => fetchApi<ApiResponse<{ runs: StagingQaRun[]; nextCursor: string | null }>>(`${base}/runs${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  create: (passwords: Record<StagingQaRole, string>) => fetchApi<ApiResponse<StagingQaRun>>(`${base}/runs`, { method: 'POST', body: JSON.stringify({ passwords }) }),
  detail: (id: string) => fetchApi<ApiResponse<StagingQaRun>>(runPath(id)),
  friends: (id: string, count: number) => fetchApi<ApiResponse<{ runId: string; accountId: string; friends: Array<{ id: string; lineUserId: string }> }>>(`${runPath(id)}/friends`, { method: 'POST', body: JSON.stringify({ count }) }),
  session: (id: string, role: StagingQaRole) => fetchApi<ApiResponse<StagingQaSession>>(`${runPath(id)}/session`, { method: 'POST', body: JSON.stringify({ role }) }),
  remove: (id: string) => fetchApi<ApiResponse<{ id: string; status: 'archived' }>>(runPath(id), { method: 'DELETE' }),
  cron: (id: string, job: StagingQaJob, requestId: string) => fetchApi<ApiResponse<StagingQaCronReceipt>>(`${runPath(id)}/cron`, { method: 'POST', body: JSON.stringify({ job, requestId }) }),
};
