import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeCommonVarValidityAt, resolveCommonVarValuesAt } from '../src/common-vars.js';
import { asD1 } from './d1-test-helper.js';

describe('N-188 共通情報の実行時有効期間', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-a', 'channel-a', '本店', 'token-a', 'secret-a'),
             ('account-b', 'channel-b', '支店', 'token-b', 'secret-b');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('管理画面の日時をJSTとして固定し、存在しない境界日時は拒否する', () => {
    expect(normalizeCommonVarValidityAt('2026-09-16T10:00')).toBe('2026-09-16T01:00:00.000Z');
    expect(normalizeCommonVarValidityAt('2026-02-30T10:00')).toBeNull();
    expect(normalizeCommonVarValidityAt('2026-09-16T24:00')).toBeNull();
  });

  function insertVar(input: {
    id: string;
    accountId?: string;
    key: string;
    value: string;
    fallbackValue?: string | null;
    validFrom?: string | null;
    validUntil?: string | null;
    expiryBehavior?: 'stop' | 'fallback';
    version?: number;
  }): void {
    sqlite.prepare(`
      INSERT INTO common_vars
        (id, line_account_id, name, var_key, type, value, fallback_value,
         valid_from, valid_until, expiry_behavior, version)
      VALUES (?, ?, ?, ?, 'text', ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.accountId ?? 'account-a',
      input.key,
      input.key,
      input.value,
      input.fallbackValue ?? null,
      input.validFrom ?? null,
      input.validUntil ?? null,
      input.expiryBehavior ?? 'stop',
      input.version ?? 1,
    );
  }

  it('開始前・開始境界・期間内・終了境界・終了後を半開区間で判定する', async () => {
    insertVar({
      id: 'var-window',
      key: 'campaign_name',
      value: '開催中',
      fallbackValue: '受付期間外',
      validFrom: '2026-09-16T01:00:00.000Z',
      validUntil: '2026-09-16T03:00:00.000Z',
      expiryBehavior: 'fallback',
    });

    const cases = [
      ['2026-09-16T00:59:59.999Z', '受付期間外', 'fallback'],
      ['2026-09-16T01:00:00.000Z', '開催中', 'primary'],
      ['2026-09-16T02:00:00.000Z', '開催中', 'primary'],
      ['2026-09-16T03:00:00.000Z', '受付期間外', 'fallback'],
      ['2026-09-16T03:00:00.001Z', '受付期間外', 'fallback'],
    ] as const;

    for (const [at, expectedValue, expectedSource] of cases) {
      const resolved = await resolveCommonVarValuesAt(db, 'account-a', ['campaign_name'], at);
      expect(resolved).toMatchObject({
        ok: true,
        values: { campaign_name: expectedValue },
        entries: [{ id: 'var-window', varKey: 'campaign_name', version: 1, source: expectedSource }],
      });
    }
  });

  it('期限外で停止契約、または代替値なしなら失敗として値を返さない', async () => {
    insertVar({
      id: 'var-stop',
      key: 'closed_notice',
      value: '営業中',
      validUntil: '2026-09-16T03:00:00.000Z',
      expiryBehavior: 'stop',
    });
    insertVar({
      id: 'var-no-fallback',
      key: 'missing_fallback',
      value: '期間中',
      validUntil: '2026-09-16T03:00:00.000Z',
      expiryBehavior: 'fallback',
    });

    await expect(resolveCommonVarValuesAt(
      db,
      'account-a',
      ['closed_notice', 'missing_fallback'],
      '2026-09-16T03:00:00.000Z',
    )).resolves.toEqual({
      ok: false,
      failures: [
        { varKey: 'closed_notice', reason: 'expired' },
        { varKey: 'missing_fallback', reason: 'fallback_missing' },
      ],
    });
  });

  it('同名キーでも指定accountの値・版だけをsnapshot候補にする', async () => {
    insertVar({ id: 'var-a', accountId: 'account-a', key: 'shop_name', value: '本店', version: 4 });
    insertVar({ id: 'var-b', accountId: 'account-b', key: 'shop_name', value: '支店', version: 9 });

    await expect(resolveCommonVarValuesAt(
      db,
      'account-a',
      ['shop_name'],
      '2026-09-16T02:00:00.000Z',
    )).resolves.toMatchObject({
      ok: true,
      values: { shop_name: '本店' },
      entries: [{ id: 'var-a', version: 4 }],
    });
  });
});
