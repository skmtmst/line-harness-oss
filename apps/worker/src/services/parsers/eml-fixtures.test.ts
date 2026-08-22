import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PostalMime from 'postal-mime';
import { describe, expect, it } from 'vitest';
import { validateParsedReservationEmail } from '../restaurant-reservation-email.js';
import { parserFor, type ParsedReservationEmail, type ReservationEmailKind } from './index.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const validationNow = new Date('2026-08-22T00:00:00+09:00');
const fixtureRecipient = 'r-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6@rs.musubo.jp';

type FixtureExpectation = {
  file: string;
  parserKey: 'retty' | 'gurunavi' | 'tabelog' | 'hotpepper';
  kind: ReservationEmailKind;
  expected: Partial<ParsedReservationEmail>;
};

const fixtures: FixtureExpectation[] = [
  { file: 'gurunavi-01-request.eml', parserKey: 'gurunavi', kind: 'request', expected: { externalId: 'PL775955774117517' } },
  { file: 'gurunavi-02-confirmed.eml', parserKey: 'gurunavi', kind: 'confirmed', expected: { externalId: 'PL775199821491d9e' } },
  { file: 'gurunavi-03-cancelled.eml', parserKey: 'gurunavi', kind: 'cancelled', expected: { externalId: 'PL773543483511faa' } },
  { file: 'hotpepper-01-request.eml', parserKey: 'hotpepper', kind: 'request', expected: { externalId: 'RAV351597' } },
  { file: 'hotpepper-02-confirmed.eml', parserKey: 'hotpepper', kind: 'confirmed', expected: { externalId: 'SDH756354' } },
  { file: 'hotpepper-03-cancelled.eml', parserKey: 'hotpepper', kind: 'cancelled', expected: { externalId: 'RAU172757' } },
  { file: 'hotpepper-04-change-to-request.eml', parserKey: 'hotpepper', kind: 'request', expected: { externalId: 'RAS772534' } },
  {
    file: 'hotpepper-05-change-to-cancelled.eml',
    parserKey: 'hotpepper',
    kind: 'cancelled',
    expected: { externalId: 'RAS772534', cancelReason: 'キャンセル[貴店都合]' },
  },
  { file: 'retty-01-confirmed.eml', parserKey: 'retty', kind: 'confirmed', expected: { externalId: '903780522' } },
  { file: 'retty-02-request.eml', parserKey: 'retty', kind: 'request', expected: { externalId: '903788169' } },
  {
    file: 'retty-03-cancelled.eml',
    parserKey: 'retty',
    kind: 'cancelled',
    expected: { externalId: '903783239', cancelReason: 'その他（お客様によるキャンセル）' },
  },
  {
    file: 'retty-04-digest.eml',
    parserKey: 'retty',
    kind: 'digest',
    expected: { targetDate: '2026-08-22', reportedCount: 2 },
  },
  { file: 'tabelog-01-confirmed.eml', parserKey: 'tabelog', kind: 'confirmed', expected: { externalId: 'net:19693630' } },
  {
    file: 'tabelog-02-cancelled.eml',
    parserKey: 'tabelog',
    kind: 'cancelled',
    expected: { externalId: 'net:19281591', cancelReason: '【予約内容の変更のため】' },
  },
];

describe('サニタイズ済み実メールfixture', () => {
  it.each(fixtures)('$fileを$parserKeyとして解析できる', async ({ file, parserKey, kind, expected }) => {
    const raw = readFileSync(join(fixturesDir, file));
    const mail = await PostalMime.parse(raw, {
      attachmentEncoding: 'arraybuffer',
      maxNestingDepth: 20,
      maxHeadersSize: 256 * 1024,
    });
    const parser = parserFor(parserKey);
    if (!parser) throw new Error(`missing parser: ${parserKey}`);

    const subject = mail.subject || '';
    const body = mail.text || '';
    const parsed = parser.parse({ subject, body, dateHeader: mail.date || null });

    expect(mail.to?.map((address) => address.address)).toContain(fixtureRecipient);
    expect(mail.attachments).toHaveLength(0);
    expect(parsed).toMatchObject({ kind, ...expected });
    expect(validateParsedReservationEmail(parsed, `${subject}\n${body}`, validationNow)).toEqual({ valid: true });
  });
});
