import type { ParserInput, ParsedReservationEmail, ReservationEmailKind } from './types.js';

const JST_OFFSET = '+09:00';

export function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':');
}

export function cleanValue(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/^[\s　]+|[\s　]+$/g, '');
  return cleaned || undefined;
}

export function digitsOnly(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, '');
  return digits || undefined;
}

export function lineValue(body: string, label: string): string | undefined {
  const match = body.match(new RegExp(`${label}[\\s　]*[:：]?[\\s　]*([^\\n]*)`, 'i'));
  return cleanValue(match?.[1]);
}

export function numberFrom(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = normalizeText(value).match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

export function toJstDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string | undefined {
  const value = new Date(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${JST_OFFSET}`);
  if (Number.isNaN(value.getTime())) return undefined;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
  if (Number(parts.year) !== year || Number(parts.month) !== month || Number(parts.day) !== day
    || Number(parts.hour) !== hour || Number(parts.minute) !== minute) return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${JST_OFFSET}`;
}

export function parseJapaneseDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeText(value);
  const match = normalized.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\([^)]*\))?\s*(\d{1,2})(?:\s*時|:)\s*(\d{1,2})/);
  if (!match) return undefined;
  return toJstDateTime(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]));
}

export function parseDateHeader(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function dateInJst(value: string | null): { year: number; month: number; day: number } | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export function isoDate(year: number, month: number, day: number): string | undefined {
  const dateTime = toJstDateTime(year, month, day, 0, 0);
  return dateTime?.slice(0, 10);
}

export function baseResult(kind: ReservationEmailKind, input: ParserInput): ParsedReservationEmail {
  return { kind, sourceUpdatedAt: parseDateHeader(input.dateHeader) };
}

export function multilineField(body: string, label: string): string | undefined {
  const match = body.match(new RegExp(`${label}[\\s　]*[:：]?[\\s　]*([^\\n]*(?:\\n(?!■)[^\\n]*)*)`, 'i'));
  return cleanValue(match?.[1]?.replace(/\n[\s　]*/g, '\n'));
}
