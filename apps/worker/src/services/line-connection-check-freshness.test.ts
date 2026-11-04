import { expect, it } from 'vitest';
import { isConnectionCheckFresh } from './line-connection-check-freshness.js';

it('確認時刻と版が有効な結果だけを再利用する', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const check = { checked_at: '2026-11-04 11:00:00', account_revision: 2 };
  expect(isConnectionCheckFresh([check], 2, now)).toBe(true);
  expect(isConnectionCheckFresh([check], 3, now)).toBe(false);
  expect(isConnectionCheckFresh([check], 2, now + 23 * 60 * 60_000)).toBe(false);
  expect(isConnectionCheckFresh([{ ...check, checked_at: 'invalid' }], 2, now)).toBe(false);
  expect(isConnectionCheckFresh([{ ...check, checked_at: '2026-11-05T00:00:00Z' }], 2, now)).toBe(false);
});
