export interface BookingPaymentAdminConfig {
  mode: 'none' | 'onsite' | 'online' | 'customer_choice';
  provider: string;
  holdMinutes: number;
  keyConfigured: boolean;
  testMode: boolean;
}

export interface BookingNoshowSettings {
  enabled: boolean;
  threshold: number;
  windowMonths: number;
  noPaymentMode: 'notice' | 'notice_call';
}

/** 前払いのみの印を付け外しした記録（理由は店だけが見る）。 */
export interface BookingNoshowFlagEvent {
  action: 'manual_on' | 'manual_off';
  reason: string | null;
  staffId: string | null;
  staffName: string | null;
  at: string;
}

/** 友だちの無断キャンセルから決めた前払いのみの判定。 */
export interface BookingPrepayDecision {
  noshowCount: number;
  threshold: number;
  enabled: boolean;
  windowMonths: number;
  noPaymentMode: 'notice' | 'notice_call';
  prepayOnly: boolean;
  manual: boolean;
  recentDates: string[];
  lastEvent: BookingNoshowFlagEvent | null;
}

export interface BookingSalesSummaryMenu {
  menu_id: string;
  menu_name: string;
  bookings: number;
  confirmed: number;
  revenue: number;
  cancelRate: number;
  noshowRate: number;
}

export interface BookingSalesSummaryWeekday {
  weekday: number;
  bookings: number;
  confirmed: number;
  revenue: number;
}

export interface BookingSalesSummary {
  from: string;
  to: string;
  total: { bookings: number; confirmed: number; revenue: number; cancelRate: number; noshowRate: number; cancelled: number; noshow: number };
  menus: BookingSalesSummaryMenu[];
  weekdays: BookingSalesSummaryWeekday[];
  previous: { revenue: number; bookings: number; cancelRate: number; noshowRate: number };
  revenueSource: 'menu' | 'paid';
}
