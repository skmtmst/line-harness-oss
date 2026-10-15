import { fetchApi } from './api'

/*
 * はじめの質問・スタイルの初期セット・対応が要るもの（B-311〜B-313）の口の形。
 *
 * 本物の口は Codex の組4（枝 codex/kenta-api4-1015 の `apps/web/src/lib/api-styles.ts`・
 * `apps/worker/src/routes/styles.ts`）が作っている途中。画面を先に作るため、同じ道・同じ形の
 * 関数だけをここに置く（撮影は scripts/visual-qa/mock-api.mjs の見本が返す）。
 * 組4が入ったら、この file は api-styles.ts の `styleApi`・`hqStyleApi` に置き換えて消す。
 */

export const ACCOUNT_STYLES = ['restaurant', 'salon', 'consult', 'lesson', 'ec', 'standard'] as const
export type AccountStyle = (typeof ACCOUNT_STYLES)[number]

export type SetupAnswer = {
  mode: 'configured' | 'later' | 'manual'
  value?: string | boolean
  resourceId?: string
}

export type StarterSetItem = {
  key: string
  kind: 'template' | 'rich_menu' | 'automation' | 'booking_menu' | 'dashboard' | 'coupon'
  name: string
  feature?: string
  text?: string
  buttons?: Array<{ label: string; feature: string }>
}

type Result<T> = { success: true; data: T }

const root = '/api/dashboard/style'
const url = (path: string, accountId: string, query: Record<string, string | undefined> = {}) =>
  `${path}?${new URLSearchParams({ account_id: accountId, ...Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined)) })}`
const write = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) })

export type StyleState = {
  style: AccountStyle
  styleSelected: boolean
  version: number
  answers: Record<string, SetupAnswer>
}

export type StyleWarning = {
  feature: string
  areaId: string
  groupId: string
  href: string
  customerState: 'preparing'
}

export type StarterItemState = {
  target_id: string
  kind: string
  key?: string
  name?: string
  is_sample: number
  status: string | null
  draftRevision: string | null
}

export const styleSetupApi = {
  get: (accountId: string) => fetchApi<Result<StyleState>>(url(root, accountId)),
  save: (accountId: string, body: { expectedVersion: number; style?: AccountStyle; answers?: Record<string, SetupAnswer>; choices?: Record<string, { mode: 'sample' | 'existing' | 'configured'; resourceId?: string }> }) =>
    fetchApi<Result<{ style: AccountStyle; version: number; inserted: Array<{ key: string; kind: string; id: string; isSample: boolean; requiresActivation: boolean }> }>>(url(root, accountId), write('PUT', body)),
  warnings: (accountId: string) =>
    fetchApi<Result<{ count: number; items: StyleWarning[]; pending: Array<{ key: string; href: string; mode: string }>; manual: Array<{ key: string; href: string }> }>>(url(`${root}/warnings`, accountId)),
  starterSet: (accountId: string, style: AccountStyle) =>
    fetchApi<Result<{ id: string; version: number; definition: { items: StarterSetItem[] } }>>(url(`${root}/starter-set`, accountId, { style })),
  starterItems: (accountId: string) =>
    fetchApi<Result<{ items: StarterItemState[] }>>(url(`${root}/starter-items`, accountId)),
  activate: (accountId: string, items: Array<{ id: string; kind: 'automation' | 'booking_menu' }>) =>
    fetchApi<Result<{ complete: boolean; items: Array<{ id: string; success: boolean; status?: string; code?: string }> }>>(url(`${root}/activate`, accountId), write('POST', { confirmed: true, items })),
}

export type HqStarterSet = {
  id: string
  style: AccountStyle
  name: string
  version: number
  definition: { items: StarterSetItem[] }
  /** 見本だけが返す補足（組4の口に無ければ出さない）。 */
  accountCount?: number
  autoInsert?: boolean
  updates?: Record<string, { at: string; by: string }>
}

export type HqAttentionKind = 'unhandledChats' | 'pendingBookings' | 'unpaid' | 'connections' | 'stoppedDeliveries'

export type HqAttentionItem = {
  accountId: string
  name: string
  /** 見本だけが返す補足（組4の口に無ければ出さない）。 */
  style?: AccountStyle
  counts: Partial<Record<HqAttentionKind, number>>
  details: Partial<Record<HqAttentionKind, Array<{ id: string; href: string }>>>
}

export const hqStyleSetupApi = {
  listStarterSets: () => fetchApi<Result<HqStarterSet[]>>('/api/hq/style-starter-sets'),
  attention: () => fetchApi<Result<{ asOf: string; items: HqAttentionItem[] }>>('/api/hq/style-attention'),
}
