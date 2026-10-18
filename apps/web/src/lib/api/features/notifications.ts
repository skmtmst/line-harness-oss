import { fetchApi } from '../transport/request'
import type { ApiResponse, NotificationRule, NotificationCenterData, Notification } from '@line-crm/shared'
import type {
  LineNotificationDefinition,
  LineNotificationMetrics,
  LineNotificationSendCounts,
  OperatorNotificationRule,
  OperatorRecipientPreview,
  OperatorDeliveryResult,
} from '../types/notifications'
import type { EcNotificationRunList } from '../types/commerce'
import { fetchApiBlob } from '../transport/download'

export const notificationsMethods = {
  lineNotifications: {
    definitions: (lineAccountId: string) => fetchApi<ApiResponse<LineNotificationDefinition[]>>(
      `/api/line-notifications/customer-definitions?lineAccountId=${encodeURIComponent(lineAccountId)}`,
    ),
    createDefinition: (data: {
      lineAccountId: string
      key: string
      name: string
      category: string
      sourceEventType: string
      draft: Record<string, unknown>
    }) => fetchApi<ApiResponse<LineNotificationDefinition>>(
      '/api/line-notifications/customer-definitions',
      { method: 'POST', body: JSON.stringify(data) },
    ),
    updateDraft: (id: string, data: {
      lineAccountId: string
      expectedVersion: number
      name: string
      category: string
      sourceEventType: string
      draft: Record<string, unknown>
    }) => fetchApi<ApiResponse<LineNotificationDefinition>>(
      `/api/line-notifications/customer-definitions/${encodeURIComponent(id)}/draft`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),
    publishDefinition: (id: string, data: { lineAccountId: string; expectedVersion: number }) =>
      fetchApi<ApiResponse<LineNotificationDefinition>>(
        `/api/line-notifications/customer-definitions/${encodeURIComponent(id)}/publish`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    stopDefinition: (id: string, data: { lineAccountId: string; expectedVersion: number }) =>
      fetchApi<ApiResponse<LineNotificationDefinition>>(
        `/api/line-notifications/customer-definitions/${encodeURIComponent(id)}/stop`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    deliveries: (params: { lineAccountId: string; view?: 'all' | 'failures'; limit?: number; offset?: number }) => {
      const query = new URLSearchParams({ lineAccountId: params.lineAccountId })
      if (params.view) query.set('view', params.view)
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.offset !== undefined) query.set('offset', String(params.offset))
      return fetchApi<ApiResponse<EcNotificationRunList> & { pagination: { total: number; limit: number; offset: number } }>(
        `/api/line-notifications/deliveries?${query}`,
      )
    },
    metrics: (lineAccountId: string) => fetchApi<ApiResponse<LineNotificationMetrics>>(
      `/api/line-notifications/metrics?lineAccountId=${encodeURIComponent(lineAccountId)}`,
    ),
    sendCounts: (lineAccountId: string) => fetchApi<ApiResponse<LineNotificationSendCounts>>(
      `/api/line-notifications/send-counts?lineAccountId=${encodeURIComponent(lineAccountId)}`,
    ),
    retryDelivery: (id: string, data: { lineAccountId: string; expectedVersion: number }) => fetchApi<ApiResponse<{
      id: string
      status: 'accepted'
      attemptCount: number
      version: number
    }>>(`/api/line-notifications/deliveries/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    // N-342 (#943): 運用者通知の正本API。要件の名前(/api/line-notifications)で置く。
    operatorRules: {
      list: (lineAccountId: string) =>
        fetchApi<ApiResponse<{
          items: OperatorNotificationRule[]
          summary: { total: number; published: number; stopped: number; missingRecipients: number; recipients: number; acceptedToday: number; excludedToday: number }
        }>>(
          `/api/line-notifications/operator-rules?lineAccountId=${encodeURIComponent(lineAccountId)}`,
        ),
      get: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<NotificationRule & { version?: number }>>(
          `/api/line-notifications/operator-rules/${encodeURIComponent(id)}?lineAccountId=${encodeURIComponent(lineAccountId)}`,
        ),
      create: (data: { lineAccountId: string; name: string; eventType: string; conditions?: Record<string, unknown>; channels?: string[] }) =>
        fetchApi<ApiResponse<NotificationRule & { version?: number }>>('/api/line-notifications/operator-rules', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      updateDraft: (id: string, lineAccountId: string, data: { expectedVersion: number; name?: string; eventType?: string; conditions?: Record<string, unknown>; channels?: string[] }) =>
        fetchApi<ApiResponse<NotificationRule & { version?: number }>>(`/api/line-notifications/operator-rules/${encodeURIComponent(id)}/draft`, {
          method: 'PATCH',
          body: JSON.stringify({ ...data, lineAccountId }),
        }),
      previewRecipients: (data: {
        lineAccountId: string
        recipientIds?: string[]
        channels: string[]
      }) => fetchApi<ApiResponse<OperatorRecipientPreview>>(
        '/api/line-notifications/operator-rules/recipients-preview',
        { method: 'POST', body: JSON.stringify(data) },
      ),
      publish: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<NotificationRule>>(
          `/api/line-notifications/operator-rules/${encodeURIComponent(id)}/publish`,
          { method: 'POST', body: JSON.stringify({ lineAccountId }) },
        ),
      stop: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<NotificationRule>>(
          `/api/line-notifications/operator-rules/${encodeURIComponent(id)}/stop`,
          { method: 'POST', body: JSON.stringify({ lineAccountId }) },
        ),
      test: (id: string, lineAccountId: string, message?: string) =>
        fetchApi<ApiResponse<OperatorDeliveryResult>>(
          `/api/line-notifications/operator-rules/${encodeURIComponent(id)}/test`,
          { method: 'POST', body: JSON.stringify({ lineAccountId, message }) },
        ),
      exportCsv: (lineAccountId: string, reason: string) =>
        fetchApiBlob(`/api/line-notifications/operator-deliveries.csv?${new URLSearchParams({ lineAccountId, reason })}`),
    },
  },
  notifications: {
    teams: {
      list: (lineAccountId: string) => fetchApi<ApiResponse<import('@line-crm/shared').OperatorNotificationTeam[]>>(`/api/notifications/teams?lineAccountId=${encodeURIComponent(lineAccountId)}`),
      create: (data: { lineAccountId: string; name: string; staffIds: string[] }) => fetchApi<ApiResponse<import('@line-crm/shared').OperatorNotificationTeam>>('/api/notifications/teams', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: { lineAccountId: string; name: string; staffIds: string[]; expectedVersion: number }) => fetchApi<ApiResponse<import('@line-crm/shared').OperatorNotificationTeam>>(`/api/notifications/teams/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
      archive: (id: string, lineAccountId: string, expectedVersion: number) => fetchApi<ApiResponse<null>>(`/api/notifications/teams/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ lineAccountId, expectedVersion }) }),
    },
    operatorRules: {
      list: (lineAccountId: string) =>
        fetchApi<ApiResponse<{
          items: OperatorNotificationRule[]
          summary: { total: number; published: number; stopped: number; missingRecipients: number; recipients: number; acceptedToday: number; excludedToday: number }
        }>>(
          `/api/notifications/operator-rules?lineAccountId=${encodeURIComponent(lineAccountId)}`,
        ),
      previewRecipients: (data: {
        lineAccountId: string
        recipientIds?: string[]
        channels: string[]
      }) => fetchApi<ApiResponse<OperatorRecipientPreview>>(
        '/api/notifications/operator-rules/recipients-preview',
        { method: 'POST', body: JSON.stringify(data) },
      ),
      publish: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<NotificationRule>>(
          `/api/notifications/operator-rules/${encodeURIComponent(id)}/publish`,
          { method: 'POST', body: JSON.stringify({ lineAccountId }) },
        ),
      test: (id: string, lineAccountId: string, message?: string) =>
        fetchApi<ApiResponse<OperatorDeliveryResult>>(
          `/api/notifications/operator-rules/${encodeURIComponent(id)}/test`,
          { method: 'POST', body: JSON.stringify({ lineAccountId, message }) },
        ),
      exportCsv: (lineAccountId: string, reason: string) =>
        fetchApiBlob(`/api/notifications/operator-deliveries.csv?${new URLSearchParams({ lineAccountId, reason })}`),
    },
    center: {
      list: (lineAccountId: string, params?: { category?: 'all' | 'error' | 'update'; limit?: number; offset?: number }) => {
        const query = new URLSearchParams({ lineAccountId });
        if (params?.category) query.set('category', params.category);
        if (params?.limit !== undefined) query.set('limit', String(params.limit));
        if (params?.offset !== undefined) query.set('offset', String(params.offset));
        return fetchApi<ApiResponse<NotificationCenterData>>(`/api/notifications/center?${query}`);
      },
      markRead: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<null>>(`/api/notifications/center/${id}/read`, {
          method: 'POST',
          body: JSON.stringify({ lineAccountId }),
        }),
      markAllRead: (lineAccountId: string, category?: 'all' | 'error' | 'update') =>
        fetchApi<ApiResponse<{ updated: number }>>('/api/notifications/center/read-all', {
          method: 'POST',
          body: JSON.stringify({ lineAccountId, category }),
        }),
    },
    rules: {
      list: (lineAccountId: string) =>
        fetchApi<ApiResponse<NotificationRule[]>>(
          `/api/notifications/rules?lineAccountId=${encodeURIComponent(lineAccountId)}`,
        ),
      get: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<NotificationRule>>(
          `/api/notifications/rules/${id}?lineAccountId=${encodeURIComponent(lineAccountId)}`,
        ),
      create: (data: { lineAccountId: string; name: string; eventType: string; conditions?: Record<string, unknown>; channels?: string[] }) =>
        fetchApi<ApiResponse<NotificationRule>>('/api/notifications/rules', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, lineAccountId: string, data: Partial<Pick<NotificationRule, 'name' | 'eventType' | 'conditions' | 'channels' | 'isActive'>>) =>
        fetchApi<ApiResponse<NotificationRule>>(`/api/notifications/rules/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...data, lineAccountId }),
        }),
      delete: (id: string, lineAccountId: string) =>
        fetchApi<ApiResponse<null>>(
          `/api/notifications/rules/${id}?lineAccountId=${encodeURIComponent(lineAccountId)}`,
          { method: 'DELETE' },
        ),
    },
    list: (lineAccountId: string, params?: { status?: string; limit?: string }) =>
      fetchApi<ApiResponse<Notification[]>>(
        '/api/notifications?' + new URLSearchParams({ lineAccountId, ...params }),
      ),
  },
}
