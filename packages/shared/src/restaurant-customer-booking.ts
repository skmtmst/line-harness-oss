export type RestaurantUnavailableReason =
  | 'temporary_closed' | 'private_event' | 'regular_closed' | 'full';
export interface RestaurantLateArrivalPolicy {
  cancelAfterMinutes: number;
  message: string;
}
export interface RestaurantCustomerDetails {
  note?: string | null;
  customerPhone?: string | null;
}
export interface RestaurantCustomerConfirmInput extends RestaurantCustomerDetails {
  expectedVersion: number;
}

export interface RestaurantCustomerSlot {
  startsAt: string;
  endsAt: string;
  available: boolean;
  remainingTables: number;
  seatTypes: string[];
  unavailableReason?: RestaurantUnavailableReason;
}
export interface RestaurantCustomerAvailability {
  storeId: string;
  date: string;
  guestCount: number;
  slots: RestaurantCustomerSlot[];
  unavailableReason?: RestaurantUnavailableReason;
  lateArrivalPolicy?: RestaurantLateArrivalPolicy;
  cancelDeadlineMinutesBefore: number;
  cutoffMinutesBefore: number;
}
export interface RestaurantCustomerHoldInput extends RestaurantCustomerDetails {
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
  note: string | null;
  customerPhone: string | null;
  seatType: string | null;
}
