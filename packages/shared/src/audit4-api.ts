/** 予約売上：売上は予約開始日時、入金は paid_at の期間で集計する。 */
export interface BookingSalesMenu {
  menu_id: string;
  menu_name: string;
  bookings: number;
  confirmed: number;
  revenue: number;
  paidRevenue: number;
  cancelRate: number;
  noshowRate: number;
}

export interface BookingSalesWeekday {
  /** 店舗の timeZone での予約開始日の曜日。日曜=0。 */
  weekday: number;
  bookings: number;
  confirmed: number;
  revenue: number;
  paidRevenue: number;
}

export interface BookingSalesTotal {
  bookings: number;
  confirmed: number;
  /** 予約時の料金×確定数（決済設定によらず同じ数え方）。 */
  revenue: number;
  /** 期間内のオンライン入金。返金済みの支払いは除外する。 */
  paidRevenue: number;
  cancelRate: number;
  noshowRate: number;
  cancelled: number;
  noshow: number;
}

export interface BookingSalesSummary {
  from: string;
  to: string;
  timeZone: string;
  total: BookingSalesTotal;
  menus: BookingSalesMenu[];
  weekdays: BookingSalesWeekday[];
  previous: Pick<BookingSalesTotal, 'revenue' | 'paidRevenue' | 'bookings' | 'cancelRate' | 'noshowRate'>;
  revenueSource: 'menu';
}
