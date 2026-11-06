import { fetchApi } from '../transport/request'
import type { ApiResponse, User } from '@line-crm/shared'
import type {
  AccessUserStatus,
  AccessRoleBundle,
  AccessUserItem,
  AccessUserSummary,
  AccessRoleItem,
  AuditEventItem,
  AuditEventSummary,
} from '../types/access'

export const accessMethods = {
/**
   * ログイン履歴。オーナーと管理者だけが見られる。
   * IPは末尾を伏せて返る。
   */
  loginAudit: {
    list: (params?: { userId?: string; action?: string; limit?: number }) => {
      const q = new URLSearchParams()
      if (params?.userId) q.set('userId', params.userId)
      if (params?.action) q.set('action', params.action)
      if (params?.limit) q.set('limit', String(params.limit))
      const query = q.toString()
      return fetchApi<
        ApiResponse<
          Array<{
            id: string
            adminUserId: string | null
            userName: string
            role: 'admin' | 'staff' | 'viewer' | null
            lineLinked: boolean
            isActive: boolean
            action: string
            screen: string | null
            ip: string | null
            connectionSource: string | null
            result: string
            createdAt: string
          }>
        >
      >(`/api/login-audit${query ? `?${query}` : ''}`)
    },
  },
/** ログインユーザーの利用状況と権限bundle。 */
  access: {
    users: (params?: {
      lineAccountId?: string
      status?: AccessUserStatus
      roleBundle?: AccessRoleBundle
      query?: string
      limit?: number
      offset?: number
    }) => {
      const q = new URLSearchParams()
      if (params?.lineAccountId) q.set('lineAccountId', params.lineAccountId)
      if (params?.status) q.set('status', params.status)
      if (params?.roleBundle) q.set('roleBundle', params.roleBundle)
      if (params?.query) q.set('query', params.query)
      if (params?.limit !== undefined) q.set('limit', String(params.limit))
      if (params?.offset !== undefined) q.set('offset', String(params.offset))
      const query = q.toString()
      return fetchApi<ApiResponse<{
        items: AccessUserItem[]
        summary: AccessUserSummary
        pagination: { total: number; limit: number; offset: number }
      }>>(`/api/access/users${query ? `?${query}` : ''}`)
    },
    roles: (lineAccountId?: string) => {
      const query = lineAccountId
        ? `?lineAccountId=${encodeURIComponent(lineAccountId)}`
        : ''
      return fetchApi<ApiResponse<{
        items: AccessRoleItem[]
        totalBundles: number
        totalAssignedUsers: number
      }>>(`/api/access/roles${query}`)
    },
  },
/** 認証と業務操作をまとめた共通監査。 */
  audit: {
    events: (params?: {
      lineAccountId?: string
      category?: 'auth' | 'business'
      result?: 'success' | 'denied' | 'failed'
      attention?: boolean
      /** 集計タブと同じ分類での絞り込み（監査 R69）。 */
      group?: 'deleted' | 'sent' | 'changed' | 'login' | 'attention'
      /** ページ分割もこの順序で行う（監査 R68）。 */
      sort?: 'asc' | 'desc'
      actorId?: string
      action?: string
      query?: string
      from?: string
      to?: string
      limit?: number
      offset?: number
    }) => {
      const q = new URLSearchParams()
      if (params?.lineAccountId) q.set('lineAccountId', params.lineAccountId)
      if (params?.category) q.set('category', params.category)
      if (params?.result) q.set('result', params.result)
      if (params?.attention !== undefined) q.set('attention', String(params.attention))
      if (params?.group) q.set('group', params.group)
      if (params?.sort) q.set('sort', params.sort)
      if (params?.actorId) q.set('actorId', params.actorId)
      if (params?.action) q.set('action', params.action)
      if (params?.query) q.set('query', params.query)
      if (params?.from) q.set('from', params.from)
      if (params?.to) q.set('to', params.to)
      if (params?.limit !== undefined) q.set('limit', String(params.limit))
      if (params?.offset !== undefined) q.set('offset', String(params.offset))
      const query = q.toString()
      return fetchApi<ApiResponse<{
        items: AuditEventItem[]
        summary: AuditEventSummary
        pagination: { total: number; limit: number; offset: number }
      }>>(`/api/audit/events${query ? `?${query}` : ''}`)
    },
  },
// ── Round 2 APIs ─────────────────────────────────────────────────────────
  users: {
    list: () =>
      fetchApi<ApiResponse<User[]>>('/api/users'),
    get: (id: string) =>
      fetchApi<ApiResponse<User>>(`/api/users/${id}`),
    create: (data: { email?: string | null; phone?: string | null; externalId?: string | null; displayName?: string | null }) =>
      fetchApi<ApiResponse<User>>('/api/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<User, 'email' | 'phone' | 'externalId' | 'displayName'>>) =>
      fetchApi<ApiResponse<User>>(`/api/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/users/${id}`, { method: 'DELETE' }),
    link: (userId: string, friendId: string) =>
      fetchApi<ApiResponse<null>>(`/api/users/${userId}/link`, {
        method: 'POST',
        body: JSON.stringify({ friendId }),
      }),
    accounts: (userId: string) =>
      fetchApi<ApiResponse<{ id: string; lineUserId: string; displayName: string | null; isFollowing: boolean }[]>>(
        `/api/users/${userId}/accounts`,
      ),
  },
/** 本人のログイン中セッション（N-427）。一覧・個別失効・他端末一括失効。 */
  sessions: {
    list: () =>
      fetchApi<ApiResponse<{
        sessions: Array<{
          id: string
          current: boolean
          createdAt: string
          expiresAt: string
          userAgent: string | null
          ipPrefix: string | null
        }>
      }>>('/api/auth/sessions'),
    /** 今使っている端末を消すときは confirmCurrent: true が必須。 */
    revoke: (tokenHash: string, options: { confirmCurrent?: boolean } = {}) =>
      fetchApi<ApiResponse<{ revoked: number; current: boolean }>>(
        `/api/auth/sessions/${encodeURIComponent(tokenHash)}${options.confirmCurrent ? '?confirmCurrent=1' : ''}`,
        { method: 'DELETE' },
      ),
    revokeOthers: () =>
      fetchApi<ApiResponse<{ revoked: number }>>('/api/auth/sessions/revoke-others', { method: 'POST' }),
  },
}
