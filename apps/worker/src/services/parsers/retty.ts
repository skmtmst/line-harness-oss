import {
  baseResult, cleanValue, digitsOnly, lineValue, normalizeText, numberFrom,
  parseJapaneseDateTime,
} from './common.js';
import type { ParsedReservationEmail, ParserInput, ReservationEmailParser, ReservationEmailKind } from './types.js';

function kindOf(text: string): ReservationEmailKind {
  if (text.includes('キャンセル理由:')) return 'cancelled';
  if (text.includes('【予約1】')) return 'digest';
  if (text.includes('リクエスト予約の承認ページ')) return 'request';
  if (text.includes('予約番号:')) return 'confirmed';
  return 'unknown';
}

function visitDateTime(body: string): string | undefined {
  const date = lineValue(body, 'ご来店日');
  const time = lineValue(body, 'ご来店時間');
  return parseJapaneseDateTime(`${date ?? ''} ${time ?? ''}`);
}

export const rettyParser: ReservationEmailParser = {
  key: 'retty',
  version: '1',
  parse(input: ParserInput): ParsedReservationEmail {
    const subject = normalizeText(input.subject);
    const body = normalizeText(input.body);
    const text = `${subject}\n${body}`;
    const kind = kindOf(text);
    const result = baseResult(kind, input);
    if (kind === 'unknown') return result;
    if (kind === 'digest') {
      const count = text.match(/【予約件数\s*(\d+)件】/)?.[1];
      const date = body.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})/)?.slice(1, 4);
      return {
        ...result,
        reportedCount: count ? Number(count) : (body.match(/【予約\d+】/g)?.length ?? 0),
        targetDate: date ? `${date[0]}-${date[1].padStart(2, '0')}-${date[2].padStart(2, '0')}` : undefined,
      };
    }
    return {
      ...result,
      externalId: lineValue(body, '予約番号'),
      customerName: cleanValue(lineValue(body, '予約者氏名')?.replace(/様$/, '')),
      customerPhone: digitsOnly(lineValue(body, '電話番号')),
      startsAt: visitDateTime(body),
      guestCount: numberFrom(lineValue(body, 'ご予約人数')),
      courseName: lineValue(body, 'コース'),
      tableLabel: lineValue(body, '席種'),
      cancelReason: lineValue(body, 'キャンセル理由'),
    };
  },
};
