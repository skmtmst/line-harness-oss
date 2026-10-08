import type { HqFriendAttributeType, HqFriendAttributeMode, HqFriendAttributeInput, HqFriendAttributeDetail, HqFriendAttributeTemplate, HqAttributeKindCounts, HqTemplatePreflightDisplay, HqTemplateResultDisplay, HqFriendAttributeListStats } from '@line-crm/shared';
import { requestHqTemplate, hqTemplatesApi, fetchHqTemplateVersions, compareHqTemplateVersions, fetchHqTemplateReceivedVersions } from './hq-templates-api';
import { fetchApi } from './api';
export interface HqAttributePreflightItem {
  sourceId: string; itemKind: string; name: string; targetId: string | null; expectedRevision: string | null;
  duplicate: boolean; allowedModes: HqFriendAttributeMode[]; reason?: string | null;
}
export interface HqAttributePreflight {
  preflightId: string; expiresAt: string;
  stores: ({ accountId: string; accountName: string; items: HqAttributePreflightItem[] } & HqTemplatePreflightDisplay)[];
}
export interface HqAttributeResolution { accountId: string; sourceId: string; mode: HqFriendAttributeMode }
export interface HqAttributeDistributionResult {
  runId: string; status: 'running'|'completed'|'partial'|'failed';
  stores: ({ accountId: string; status: 'pending'|'staged'|'succeeded'|'failed'|'version_conflict'|'unsupported'; reason: string|null;
    counts: { created: number; overwritten: number; aliased: number; skipped?: number } } & HqTemplateResultDisplay)[];
}
const path = (id: string) => `/${encodeURIComponent(id)}`;
/** 統括の友だち情報欄・対応マーク。既存の5種類の画面の入力型は保つ。 */
export const hqFriendAttributesApi = {
  list: (type: HqFriendAttributeType) => requestHqTemplate<HqFriendAttributeTemplate[]>(`?type=${type}`),
  kindCounts: () => requestHqTemplate<HqAttributeKindCounts>('/attribute-kind-counts'),
  listStats: async (type: HqFriendAttributeType): Promise<HqFriendAttributeListStats> => {
    const result = await fetchApi<{success: true; stats: HqFriendAttributeListStats}>(`/api/hq/templates?type=${type}`);
    return result.stats;
  },
  get: (id: string) => requestHqTemplate<HqFriendAttributeDetail>(path(id)),
  create: (input: HqFriendAttributeInput, requestId: string) => requestHqTemplate<HqFriendAttributeDetail>('', 'POST', {...input,requestId}, {'Idempotency-Key':requestId}),
  update: (id: string, input: HqFriendAttributeInput & {expectedRevision: number}) => requestHqTemplate<HqFriendAttributeDetail>(path(id), 'PATCH', input),
  remove: (id: string, expectedRevision: number) => requestHqTemplate<{id: string; archived: true}>(path(id), 'DELETE', {expectedRevision}),
  duplicate: (id: string, name: string, expectedRevision: number, requestId: string) => requestHqTemplate<HqFriendAttributeDetail>(`${path(id)}/duplicate`, 'POST', {name,expectedRevision,requestId}),
  folders: hqTemplatesApi.folders,
  accounts: hqTemplatesApi.accounts,
  versions: fetchHqTemplateVersions,
  compareVersions: compareHqTemplateVersions,
  restoreVersion: (id: string, version: number, expectedRevision: number) => requestHqTemplate<HqFriendAttributeDetail>(`${path(id)}/versions/${version}/restore`, 'POST', {expectedRevision}),
  receivedVersions: fetchHqTemplateReceivedVersions,
  preflight: (id: string, accountIds: string[]) => requestHqTemplate<HqAttributePreflight>(`${path(id)}/preflight`, 'POST', {accountIds}),
  distribute: (id: string, preflightId: string, resolutions: HqAttributeResolution[]) => requestHqTemplate<HqAttributeDistributionResult>(`${path(id)}/distribute`, 'POST', {preflightId,resolutions}),
  result: (id: string, runId: string) => requestHqTemplate<HqAttributeDistributionResult>(`${path(id)}/distributions/${encodeURIComponent(runId)}`),
};
