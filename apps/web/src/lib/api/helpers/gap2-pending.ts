import { bookingAdvancedApi } from './booking-advanced'
import type { BookingGroupView } from '@line-crm/shared'

/** Worker 接続済みの旧読込口。UIの公開名と呼出し方を保持する。 */
export type BookingParty = BookingGroupView
export type PartyMember = BookingGroupView['members'][number]
export type SeriesImpactItem = Awaited<ReturnType<typeof bookingAdvancedApi.impact>>['data']['items'][number]
export const bookingPartyApi = { get: bookingAdvancedApi.group }
export const seriesImpactApi = { impact: bookingAdvancedApi.impact }
