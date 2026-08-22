import {
  baseResult, cleanValue, dateInJst, digitsOnly, isoDate, lineValue, normalizeText,
  numberFrom, toJstDateTime,
} from './common.js';
import type { ParsedReservationEmail, ParserInput, ReservationEmailParser, ReservationEmailKind } from './types.js';

const BOOKING_URL = /https:\/\/owner\.tabelog\.com\/tn\/time-schedule\/(\d{4})-(\d{2})-(\d{2})\?bookingId=([^\s&]+)/;

function kindOf(subject: string): ReservationEmailKind {
  if (subject.includes('【新規予約】')) return 'confirmed';
  if (subject.includes('【予約キャンセル】')) return 'cancelled';
  if (subject.includes('【本日のご来店一覧】')) return 'digest';
  return 'unknown';
}

export const tabelogParser: ReservationEmailParser = {
  key: 'tabelog',
  version: '1',
  parse(input: ParserInput): ParsedReservationEmail {
    const subject = normalizeText(input.subject);
    const body = normalizeText(input.body);
    const kind = kindOf(subject);
    const result = baseResult(kind, input);
    if (kind === 'unknown') return result;
    if (kind === 'digest') {
      const received = dateInJst(input.dateHeader);
      return {
        ...result,
        targetDate: received ? isoDate(received.year, received.month, received.day) : undefined,
        reportedCount: body.match(/bookingId=/g)?.length ?? body.match(/お名前\s*:/g)?.length ?? 0,
      };
    }

    const url = body.match(BOOKING_URL);
    const bodyDate = lineValue(body, '日付')?.match(/(\d{1,2})\/(\d{1,2})/);
    if (!url) return { ...result, validationError: 'tabelog_booking_url_missing' };
    if (!bodyDate || Number(bodyDate[1]) !== Number(url[2]) || Number(bodyDate[2]) !== Number(url[3])) {
      return { ...result, externalId: url[4], validationError: 'tabelog_date_mismatch' };
    }
    const time = lineValue(body, '来店時刻')?.match(/(\d{1,2}):(\d{2})/);
    const stay = numberFrom(lineValue(body, '滞在可能時間'));
    return {
      ...result,
      externalId: url[4],
      customerName: cleanValue(lineValue(body, 'お名前')?.replace(/様$/, '')),
      customerPhone: digitsOnly(lineValue(body, '電話番号')),
      startsAt: time ? toJstDateTime(Number(url[1]), Number(url[2]), Number(url[3]), Number(time[1]), Number(time[2])) : undefined,
      guestCount: numberFrom(lineValue(body, '人数')),
      courseName: lineValue(body, 'コース'),
      tableLabel: lineValue(body, '卓'),
      stayMinutes: stay ? stay * 60 : undefined,
      cancelReason: lineValue(body, 'キャンセル理由'),
    };
  },
};
