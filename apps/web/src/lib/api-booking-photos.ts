import type { BookingPhotoCatalog, BookingPhotoWrite, BookingStorePhotosWrite } from '@line-crm/shared'
import { fetchApi } from './api'

type Result<T> = { success: true; data: T }
const path = (route: string, accountId: string) => `/api/booking/admin/${route}?account_id=${encodeURIComponent(accountId)}`
const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) })

export const bookingPhotosApi = {
  list: (accountId: string) => fetchApi<Result<BookingPhotoCatalog>>(path('menus/photos', accountId)),
  saveMenu: (accountId: string, id: string, body: BookingPhotoWrite) => fetchApi<Result<{ version: number }>>(path(`menus/${encodeURIComponent(id)}/photo`, accountId), put(body)),
  saveStaff: (accountId: string, id: string, body: BookingPhotoWrite) => fetchApi<Result<{ version: number }>>(path(`staff/${encodeURIComponent(id)}/photo`, accountId), put(body)),
  saveStore: (accountId: string, body: BookingStorePhotosWrite) => fetchApi<Result<{ version: number }>>(path('store-photos', accountId), put(body)),
}
