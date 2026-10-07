export type BookingWaitlistStatus = 'waiting' | 'invited' | 'converted' | 'cancelled' | 'finished';
export interface CustomerBookingWaitlist {
  id: string; staff_id: string; menu_id: string; starts_at: string; status: BookingWaitlistStatus;
  hold_minutes: number; hold_expires_at: string | null; created_at: string; ends_at?: string | null; menu_name?: string; staff_name?: string;
}
export interface CustomerSeatWaitlist {
  id: string; store_id: string; store_name: string; starts_at: string; ends_at: string; guest_count: number;
  status: BookingWaitlistStatus; hold_minutes: number; hold_expires_at: string | null; created_at: string;
}
export interface BookingWaitlistSlotSummary { staff_id: string; starts_at: string; waiting: number; invited: number; finished: number; }
export interface SeatWaitlistSlotSummary { store_id: string; starts_at: string; waiting: number; invited: number; finished: number; }
export interface RegisterSeatWaitlistInput { store_id: string; starts_at: string; guest_count: number; }
export interface AcceptBookingWaitlistInput { menu_id: string; staff_id: string; starts_at: string; waitlist_id: string; customer_note?: string; }
