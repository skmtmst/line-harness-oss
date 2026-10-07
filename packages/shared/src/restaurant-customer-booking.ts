export interface RestaurantCustomerSlot {
  startsAt: string;
  endsAt: string;
  available: boolean;
  remainingTables: number;
}
export interface RestaurantCustomerAvailability {
  storeId: string;
  date: string;
  guestCount: number;
  slots: RestaurantCustomerSlot[];
  cancelDeadlineMinutesBefore: number;
  cutoffMinutesBefore: number;
}
export interface RestaurantCustomerHoldInput {
  storeId: string;
  startsAt: string;
  guestCount: number;
  requestId: string;
}
export interface RestaurantCustomerBooking {
  id: string;
  storeId: string;
  startsAt: string;
  endsAt: string;
  guestCount: number;
  status: string;
  version: number;
  holdExpiresAt: string | null;
}
