import {
  baseResult, cleanValue, lineValue, multilineField, normalizeText, numberFrom,
  parseJapaneseDateTime,
} from './common.js';
import type { ParsedReservationEmail, ParserInput, ReservationEmailParser, ReservationEmailKind } from './types.js';

function changeBlock(body: string): string | undefined {
  const after = body.split('【変更後】')[1];
  return after?.split('【変更前】')[0];
}

function isChangeCompleted(subject: string, body: string): boolean {
  return subject.includes('変更処理完了') || body.includes('変更処理完了');
}

function kindOf(subject: string, body: string): ReservationEmailKind {
  if (isChangeCompleted(subject, body)) {
    const status = lineValue(changeBlock(body) ?? '', '■ステータス');
    if (status === '未対応' || status === '相談中') return 'request';
    if (status?.startsWith('キャンセル')) return 'cancelled';
    return 'unknown';
  }
  if (subject.includes('のキャンセル')) return 'cancelled';
  if (subject.includes('【即予約】') && subject.includes('の申し込み')) return 'confirmed';
  if (subject.includes('【リクエスト予約】') && subject.includes('の申し込み')) return 'request';
  return 'unknown';
}

export const hotpepperParser: ReservationEmailParser = {
  key: 'hotpepper',
  version: '1',
  parse(input: ParserInput): ParsedReservationEmail {
    const subject = normalizeText(input.subject);
    const body = normalizeText(input.body);
    const kind = kindOf(subject, body);
    const result = baseResult(kind, input);
    if (kind === 'unknown') return result;
    const details = isChangeCompleted(subject, body) ? (changeBlock(body) ?? '') : body;
    const status = lineValue(details, '■ステータス');
    return {
      ...result,
      externalId: lineValue(body, '■予約依頼番号'),
      customerName: cleanValue(lineValue(body, '■代表者')?.replace(/様$/, '')),
      startsAt: parseJapaneseDateTime(lineValue(details, '■来店日時')),
      guestCount: numberFrom(lineValue(details, '■人数')),
      courseName: lineValue(details, '■コース'),
      tableLabel: multilineField(details, '■席情報'),
      cancelReason: kind === 'cancelled' ? (status || lineValue(details, '■キャンセル理由') || 'キャンセル') : undefined,
    };
  },
};
