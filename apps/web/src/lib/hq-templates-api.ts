import { fetchApi } from './api'

export const TEMPLATE_TYPES = ['tag', 'template', 'rich_menu', 'form'] as const
export type TemplateType = typeof TEMPLATE_TYPES[number]
export type DistributionMode = 'create' | 'overwrite' | 'alias'
export interface HqTemplate {
  id: string; name: string; description: string | null; template_type: TemplateType
  revision: number; updated_at: string; reference_summary?: string; distributed_account_count?: number
}
export interface TagDefinition {
  schemaVersion: 1
  tag: { name: string; color?: string; description?: string; folderId?: string }
  folders: { id: string; name: string; parentId?: string; color?: string }[]
}
export interface TemplateInput { type: 'tag'; name: string; description?: string; definition: TagDefinition }
export interface TemplateDetail { template: HqTemplate; definition: TagDefinition }
export interface HqAccount { id: string; name: string }
export interface PreflightItem {
  sourceId: string; itemKind: string; name: string; targetId?: string | null
  expectedRevision?: string | number | null; duplicate: boolean; allowedModes: DistributionMode[]
}
export interface Preflight {
  preflightId: string; expiresAt: string
  stores: { accountId: string; accountName: string; items: PreflightItem[] }[]
}
export interface Resolution { accountId: string; sourceId: string; mode: DistributionMode }
export interface DistributionResult {
  runId: string; status: 'running' | 'completed' | 'partial' | 'failed'
  stores: {
    accountId: string; accountName?: string
    status: 'pending' | 'staged' | 'succeeded' | 'failed' | 'version_conflict' | 'unsupported'
    reason?: string | null; counts: { created: number; overwritten: number; aliased: number }
  }[]
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
  const result = await fetchApi<{ success: true; data: T } | { success: false; error: string; code?: string }>(
    `/api/hq/templates${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
  )
  if (!result.success) throw { code: result.code }
  return result.data
  } catch (error) {
    const detail = error && typeof error === 'object' ? error as { status?: number; code?: string } : {}
    const message = detail.code === 'UNSUPPORTED' ? 'この種類のひな形は未対応です（UNSUPPORTED）。'
      : detail.status === 401 ? 'ログインし直してから再確認してください。'
      : detail.status === 403 ? 'ひな形を操作する権限がありません。管理者に確認してください。'
      : detail.status === 409 || detail.code === 'VERSION_CONFLICT' ? '内容が更新されました。もう一度確認してください。'
      : '処理できませんでした。接続と入力内容を確認し、もう一度お試しください。'
    throw new Error(message)
  }
}
const idPath = (id: string) => `/${encodeURIComponent(id)}`
export const hqTemplatesApi = {
  list: (type: TemplateType) => request<HqTemplate[]>(`?type=${type}`),
  accounts: () => request<HqAccount[]>('/accounts'),
  get: (id: string) => request<TemplateDetail>(idPath(id)),
  create: (input: TemplateInput) => request<TemplateDetail>('', 'POST', input),
  update: (id: string, input: TemplateInput & { expectedRevision: number }) => request<TemplateDetail>(idPath(id), 'PATCH', input),
  remove: (id: string, expectedRevision: number) => request<unknown>(idPath(id), 'DELETE', { expectedRevision }),
  preflight: (id: string, accountIds: string[]) => request<Preflight>(`${idPath(id)}/preflight`, 'POST', { accountIds }),
  distribute: (id: string, preflightId: string, resolutions: Resolution[]) => request<DistributionResult>(`${idPath(id)}/distribute`, 'POST', { preflightId, resolutions }),
  result: (id: string, runId: string) => request<DistributionResult>(`${idPath(id)}/distributions/${encodeURIComponent(runId)}`),
}
