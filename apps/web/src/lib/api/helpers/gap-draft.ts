import { bookingAdvancedApi } from './booking-advanced'

/** Worker の実契約を共有する旧読込口。画面の移行まで公開名は保つ。 */
export type { DepositRule, CancellationOptions, BookingGroupView as BookingGroup } from '@line-crm/shared'
export type BookingCard = NonNullable<Awaited<ReturnType<typeof bookingAdvancedApi.card>>['data']>

export const gapDraftApi = {
  depositRule: bookingAdvancedApi.depositRule,
  saveDepositRule: bookingAdvancedApi.saveDepositRule,
  menuDeposit: bookingAdvancedApi.menuDeposit,
  saveMenuDeposit: bookingAdvancedApi.saveMenuDeposit,
  cancellationOptions: bookingAdvancedApi.cancellationOptions,
  saveCancellationOptions: bookingAdvancedApi.saveCancellationOptions,
  bookingCard: bookingAdvancedApi.card,
  bookingGroup: bookingAdvancedApi.group,
  cancelGroup: bookingAdvancedApi.cancelBookingGroup,
}
