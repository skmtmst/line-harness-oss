import { gurunaviParser } from './gurunavi.js';
import { hotpepperParser } from './hotpepper.js';
import { rettyParser } from './retty.js';
import { tabelogParser } from './tabelog.js';
import type { ReservationEmailParser } from './types.js';

const parsers: Record<string, ReservationEmailParser> = {
  [rettyParser.key]: rettyParser,
  [gurunaviParser.key]: gurunaviParser,
  [tabelogParser.key]: tabelogParser,
  [hotpepperParser.key]: hotpepperParser,
};

export function parserFor(key: string): ReservationEmailParser | undefined {
  return parsers[key];
}

export type { ParsedReservationEmail, ParserInput, ReservationEmailKind } from './types.js';
