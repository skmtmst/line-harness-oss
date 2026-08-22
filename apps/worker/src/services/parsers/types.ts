export type ReservationEmailKind =
  | 'confirmed'
  | 'request'
  | 'cancelled'
  | 'declined'
  | 'digest'
  | 'notice'
  | 'unknown';

export type ParserInput = {
  subject: string;
  body: string;
  dateHeader: string | null;
};

export type ParsedReservationEmail = {
  kind: ReservationEmailKind;
  externalId?: string;
  customerName?: string;
  customerPhone?: string;
  startsAt?: string;
  guestCount?: number;
  courseName?: string;
  tableLabel?: string;
  cancelReason?: string;
  stayMinutes?: number;
  mediaStoreCode?: string;
  sourceUpdatedAt?: string;
  targetDate?: string;
  reportedCount?: number;
  validationError?: string;
};

export type ReservationEmailParser = {
  key: string;
  version: string;
  parse(input: ParserInput): ParsedReservationEmail;
};
