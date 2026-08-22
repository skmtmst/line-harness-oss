import {
  baseResult, cleanValue, dateInJst, digitsOnly, isoDate, lineValue, normalizeText,
  numberFrom, parseJapaneseDateTime,
} from './common.js';
import type { ParsedReservationEmail, ParserInput, ReservationEmailParser, ReservationEmailKind } from './types.js';

const NOTICE_SUBJECTS = [
  'ネット予約の「確定」または「キャンセル」をお願いします',
  '来店実績の確認はお済みでしょうか',
];

function kindOf(subject: string, body: string): ReservationEmailKind {
  if (NOTICE_SUBJECTS.some((notice) => subject.includes(notice))) return 'notice';
  if (/本日（?\d{1,2}月\d{1,2}日）?来店予定のご予約情報/.test(subject)) return 'digest';
  const state = lineValue(body, '［状態］');
  if (state === '未確定') return 'request';
  if (state === '確定済') return 'confirmed';
  if (state === 'キャンセル') return 'cancelled';
  return 'unknown';
}

function digestDate(subject: string, dateHeader: string | null): string | undefined {
  const md = subject.match(/本日（?(\d{1,2})月(\d{1,2})日/);
  const received = dateInJst(dateHeader);
  if (!md || !received) return undefined;
  return isoDate(received.year, Number(md[1]), Number(md[2]));
}

export const gurunaviParser: ReservationEmailParser = {
  key: 'gurunavi',
  version: '1',
  parse(input: ParserInput): ParsedReservationEmail {
    const subject = normalizeText(input.subject);
    const body = normalizeText(input.body);
    const kind = kindOf(subject, body);
    const result = baseResult(kind, input);
    if (kind === 'notice' || kind === 'unknown') return result;
    if (kind === 'digest') {
      return {
        ...result,
        targetDate: digestDate(subject, input.dateHeader),
        reportedCount: body.match(/［予約番号］/g)?.length ?? 0,
      };
    }
    const firstLine = body.split('\n')[0] ?? '';
    return {
      ...result,
      externalId: lineValue(body, '［予約番号］'),
      customerName: cleanValue(lineValue(body, '［予約者名］')?.replace(/様$/, '')),
      customerPhone: digitsOnly(lineValue(body, '［電話番号］')),
      startsAt: parseJapaneseDateTime(lineValue(body, '［来店日時］')),
      guestCount: numberFrom(lineValue(body, '［来店人数］')),
      tableLabel: lineValue(body, '［テーブル］'),
      courseName: lineValue(body, '［コース］'),
      mediaStoreCode: firstLine.match(/様\s*\(([^)]+)\)/)?.[1],
      cancelReason: lineValue(body, '［キャンセル理由］'),
    };
  },
};
