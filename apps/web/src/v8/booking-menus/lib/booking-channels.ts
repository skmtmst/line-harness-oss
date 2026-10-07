import { fetchApi } from '@/lib/api'
import type { ApiResponse } from '@line-crm/shared'

/**
 * 予約の経路の連携と重なり（★V8-B ZyDd6・DFl3Q）。
 * Worker `apps/worker/src/routes/booking.ts`。
 */

export interface BookingChannelStaff {
  staffId: string
  displayName: string
  status: 'connected' | 'not_connected' | 'expired'
  externalEventsThisWeek: number | null
  lastReadAt: string | null
  readError: string | null
}

export interface BookingChannel {
  key: string
  status: string
  todayCount: number | null
}

export interface BookingChannelsData {
  timeZone: string
  staff: BookingChannelStaff[]
  autoAssign: boolean
  channels: BookingChannel[]
}

export interface BookingConflict {
  staffId: string
  staffName: string
  bookingId: string
  otherBookingId: string
  startsAt: string
  endsAt: string
  otherStartsAt: string
  otherEndsAt: string
  version: number
  otherVersion: number
}

export interface BookingCalendarConnection {
  id: string
  calendar_id: string
  auth_type: string
  is_active: number
  last_verified_at: string | null
  last_error: string | null
}

export const bookingChannelsApi = {
  calendarDetail: (accountId: string, staffId: string) =>
    fetchApi<{ connection: BookingCalendarConnection | null; service_account: { configured: boolean; email: string | null } }>(
      `/api/booking/admin/staff/${encodeURIComponent(staffId)}/google-calendar?account_id=${encodeURIComponent(accountId)}`,
    ),
  connectCalendar: (accountId: string, staffId: string, calendarId: string) =>
    fetchApi<{ ok: boolean; calendar_id: string; last_verified_at: string }>(
      `/api/booking/admin/staff/${encodeURIComponent(staffId)}/google-calendar?account_id=${encodeURIComponent(accountId)}`,
      { method: 'PUT', body: JSON.stringify({ calendar_id: calendarId }) },
    ),
  channels: (accountId: string) =>
    fetchApi<ApiResponse<BookingChannelsData>>(`/api/booking/admin/channels?account_id=${encodeURIComponent(accountId)}`),
  conflicts: (accountId: string) =>
    fetchApi<ApiResponse<{ conflicts: BookingConflict[] }>>(`/api/booking/admin/conflicts?account_id=${encodeURIComponent(accountId)}`),
  reassign: (accountId: string, bookingId: string, body: { staffId: string; notifyCustomer: boolean }) =>
    fetchApi<{ booking_id: string; lock_version: number; status: string }>(
      `/api/booking/admin/bookings/${encodeURIComponent(bookingId)}/reassign?account_id=${encodeURIComponent(accountId)}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
}
