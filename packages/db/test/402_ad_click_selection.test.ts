import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { recordRefTracking, selectAdClickForPlatform } from '../src/entry-routes.js';
import { asD1 } from './d1-test-helper.js';

const bootstrap = readFileSync(join(import.meta.dirname, '../bootstrap.sql'), 'utf8');
const NOW = new Date('2026-09-16T00:00:00.000Z');

function setup(): { raw: Database.Database; db: D1Database } {
  const raw = new Database(':memory:');
  raw.exec(bootstrap);
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('a1', 'c1', 'A1', 'token', 'secret'), ('a2', 'c2', 'A2', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, created_at, updated_at)
    VALUES ('f1', 'Uf1', 'F1', 'a1', '2026-01-01', '2026-01-01');
  `);
  return { raw, db: asD1(raw) };
}

function insertRef(
  raw: Database.Database,
  input: {
    id: string;
    accountId?: string;
    createdAt: string;
    consentAt?: string | null;
    gclid?: string | null;
    twclid?: string | null;
  },
): void {
  raw.prepare(`
    INSERT INTO ref_tracking
      (id, ref_code, friend_id, line_account_id, gclid, twclid,
       ad_conversion_consent_at, created_at)
    VALUES (?, 'ref', 'f1', ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.accountId ?? 'a1',
    input.gclid ?? null,
    input.twclid ?? null,
    input.consentAt === undefined ? input.createdAt : input.consentAt,
    input.createdAt,
  );
}

describe('402 媒体別広告クリック選択', () => {
  it('検証済みLINE経路の記録時にaccountと同意時刻を固定する', async () => {
    const { raw, db } = setup();

    const recorded = await recordRefTracking(db, {
      refCode: 'ref', friendId: 'f1', fbclid: 'fb-recorded',
    });

    expect(recorded).toMatchObject({
      line_account_id: 'a1',
      fbclid: 'fb-recorded',
    });
    expect(recorded.ad_conversion_consent_at).toBeTruthy();
    const stored = raw.prepare(`
      SELECT line_account_id, ad_conversion_consent_at FROM ref_tracking WHERE id = ?
    `).get(recorded.id) as { line_account_id: string | null; ad_conversion_consent_at: string | null };
    expect(stored.line_account_id).toBe('a1');
    expect(stored.ad_conversion_consent_at).toBeTruthy();
  });

  it('新しいGoogle行があってもXは直近の有効twclidを選ぶ', async () => {
    const { raw, db } = setup();
    insertRef(raw, { id: 'x-old', twclid: 'tw-valid', createdAt: '2026-09-15T00:00:00.000Z' });
    insertRef(raw, { id: 'google-new', gclid: 'g-new', createdAt: '2026-09-15T12:00:00.000Z' });

    const selected = await selectAdClickForPlatform(db, {
      friendId: 'f1', lineAccountId: 'a1', platformName: 'x', validityDays: 30, now: NOW,
    });

    expect(selected).toMatchObject({
      status: 'eligible', refTrackingId: 'x-old', clickId: 'tw-valid', clickIdType: 'twclid',
    });
  });

  it.each([
    ['直前', '2026-08-17T00:00:00.001Z', 'eligible'],
    ['同時刻', '2026-08-17T00:00:00.000Z', 'expired'],
    ['直後', '2026-08-16T23:59:59.999Z', 'expired'],
  ] as const)('30日期限の%sを固定時計で判定する', async (_label, createdAt, expected) => {
    const { raw, db } = setup();
    insertRef(raw, { id: 'x-boundary', twclid: 'tw-boundary', createdAt });

    const selected = await selectAdClickForPlatform(db, {
      friendId: 'f1', lineAccountId: 'a1', platformName: 'x', validityDays: 30, now: NOW,
    });

    expect(selected.status).toBe(expected);
  });

  it('同意なしと媒体IDなしを区別する', async () => {
    const noConsent = setup();
    insertRef(noConsent.raw, {
      id: 'x-no-consent', twclid: 'tw-no-consent', createdAt: '2026-09-15T00:00:00.000Z', consentAt: null,
    });
    expect(await selectAdClickForPlatform(noConsent.db, {
      friendId: 'f1', lineAccountId: 'a1', platformName: 'x', validityDays: 30, now: NOW,
    })).toMatchObject({ status: 'missing_consent', refTrackingId: 'x-no-consent' });

    const noId = setup();
    insertRef(noId.raw, { id: 'google-only', gclid: 'g-only', createdAt: '2026-09-15T00:00:00.000Z' });
    expect(await selectAdClickForPlatform(noId.db, {
      friendId: 'f1', lineAccountId: 'a1', platformName: 'x', validityDays: 30, now: NOW,
    })).toEqual({ status: 'missing_click_id', clickIdType: 'twclid' });
  });

  it('別accountの新しいIDを選ばない', async () => {
    const { raw, db } = setup();
    insertRef(raw, { id: 'own-old', accountId: 'a1', twclid: 'tw-own', createdAt: '2026-09-14T00:00:00.000Z' });
    insertRef(raw, { id: 'other-new', accountId: 'a2', twclid: 'tw-other', createdAt: '2026-09-15T00:00:00.000Z' });

    expect(await selectAdClickForPlatform(db, {
      friendId: 'f1', lineAccountId: 'a1', platformName: 'x', validityDays: 30, now: NOW,
    })).toMatchObject({ status: 'eligible', refTrackingId: 'own-old', clickId: 'tw-own' });
  });
});
