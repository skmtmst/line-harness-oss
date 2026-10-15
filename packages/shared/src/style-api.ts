export const ACCOUNT_STYLES = [
  'standard',
  'ec',
  'restaurant',
  'salon',
  'consult',
  'lesson',
] as const;
export type AccountStyle = (typeof ACCOUNT_STYLES)[number];
export type IndustryStyle = Exclude<AccountStyle, 'standard' | 'ec'>;
export type SetupAnswer = {
  mode: 'configured' | 'later' | 'manual';
  value?: string | boolean;
  resourceId?: string;
};
export type StyleCard = { id: string; visible: boolean };
export type StyleMetric = {
  value: number | null;
  numerator?: number;
  denominator?: number;
  status: 'available' | 'insufficient_sample' | 'unconfigured';
  formula: string;
  unit: string;
};
export type StyleBooking = {
  id: string;
  version: number | null;
  updatedAt: string | null;
  kind: 'booking' | 'restaurant' | 'meet' | 'event';
  friendId: string | null;
  personKey: string;
  name: string;
  startsAt: string;
  endsAt: string;
  requestedAt: string;
  status: string;
  staffId: string | null;
  menuId: string | null;
  storeId: string | null;
  slotId: string | null;
  partySize: number;
  price: number;
  visited: boolean;
  attendance: string | null;
  held: boolean;
  meetingMode: string | null;
  meetingUrl: string | null;
  location: string | null;
  outcome: string | null;
  source: string;
  entryPoint: string | null;
  refCode: string | null;
  designation: string | null;
  cancelledAt: string | null;
  confirmedResponse: string | null;
  participationMode: string | null;
};
export type StyleSnapshot = {
  style: IndustryStyle;
  asOf: string;
  timeZone: string;
  from: string;
  to: string;
  dateBasis: 'visit';
  metrics: Record<string, StyleMetric>;
  previous: Record<string, StyleMetric>;
  items: StyleBooking[];
  newBookings: StyleBooking[];
  resultId: string;
};
