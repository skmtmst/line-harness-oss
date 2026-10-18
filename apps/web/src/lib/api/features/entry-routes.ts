import { fetchApi } from '../transport/request'
import type {
  ApiResponse,
  EntryRoute,
  CreateEntryRouteInput,
  EntryRouteFunnel,
  EntryRouteGenre,
} from '@line-crm/shared'
import { fetchApiBlob } from '../transport/download'

export const entryRoutesMethods = {
  entryRoutes: {
    /*
     * accountId を渡すと Worker がそのアカウント所属の経路だけを返す。
     * 省略時は可視範囲の全経路（複数アカウント分を含み得る）。
     * アカウント単位で選ぶ画面は必ず渡す（DASH-09）。
     */
    list: (accountId?: string) =>
      fetchApi<ApiResponse<EntryRoute[]>>(
        `/api/entry-routes${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`,
      ),
    get: (id: string) => fetchApi<ApiResponse<EntryRoute>>(`/api/entry-routes/${id}`),
    create: (data: CreateEntryRouteInput) =>
      fetchApi<ApiResponse<EntryRoute>>('/api/entry-routes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<CreateEntryRouteInput> & { expectedUpdatedAt?: string }) =>
      fetchApi<ApiResponse<EntryRoute>>(`/api/entry-routes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/entry-routes/${id}`, { method: 'DELETE' }),
    /** M (止めた経路のQR): 印刷用PDFをサーバーで作る。止めた経路は409。 */
    qrPdf: (id: string, paper: 'A4' | 'A5' = 'A4'): Promise<Blob> =>
      fetchApiBlob(`/api/entry-routes/${encodeURIComponent(id)}/qr-pdf`, { method: 'POST', body: JSON.stringify({ paper }) }),
    qrImage: (id: string, format: 'png' | 'svg', size: 'small' | 'medium' | 'large'): Promise<Blob> =>
      fetchApiBlob(`/api/entry-routes/${encodeURIComponent(id)}/qr-image`, { method: 'POST', body: JSON.stringify({ format, size }) }),
    funnel: (id: string) =>
      fetchApi<ApiResponse<EntryRouteFunnel>>(`/api/entry-routes/${id}/funnel`),
    /** クリックがどこから来ているか。utm_source > 参照元のホスト > 直接アクセス */
    sources: (id: string) =>
      fetchApi<ApiResponse<Array<{ label: string; count: number }>>>(
        `/api/entry-routes/${id}/sources`,
      ),
  },
  entryRouteGenres: {
    list: () => fetchApi<ApiResponse<EntryRouteGenre[]>>('/api/entry-route-genres'),
    create: (name: string) =>
      fetchApi<ApiResponse<EntryRouteGenre>>('/api/entry-route-genres', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    update: (id: string, name: string) =>
      fetchApi<ApiResponse<EntryRouteGenre>>(`/api/entry-route-genres/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
  },
}
