/*
 * #643 SQL のオフ判定式と TS の判定が同じ答えを返すことを確かめる。
 *
 * 取り出しの LIMIT より前でオフの行を外すため、判定を SQL でも書いている。
 * 二重に書いている以上、食い違えば「オフなのに動く」か「オンなのに
 * 永久に動かない」のどちらかになる。本物の SQLite に当てて突き合わせる。
 */
import { describe, expect, it } from 'vitest';
import {
  accountFeatureOffExclusionSql,
  isAccountFeatureEnabled,
  saveVersionedAccountSetting,
  setAccountSetting,
} from '@line-crm/db';
import { FEATURE_IDS } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const BUNDLE_KEY = 'feature.settings_bundle_v1';

async function saveBundle(db: SqliteD1, overrides: Record<string, boolean>, base: boolean) {
  const features = Object.fromEntries(FEATURE_IDS.map((key) => [key, base]));
  Object.assign(features, overrides);
  const result = await saveVersionedAccountSetting(db.db, {
    accountId: 'account-1',
    key: BUNDLE_KEY,
    expectedVersion: 0,
    data: { features },
  });
  expect(result.status).toBe('saved');
}

const CASES: Array<{ label: string; feature: string; seed: (db: SqliteD1) => Promise<void> }> = [
  { label: '設定なし(既定ON)', feature: 'booking', seed: async () => {} },
  {
    label: '一括設定でオフ',
    feature: 'booking',
    seed: (db) => saveBundle(db, { booking: false }, true),
  },
  {
    // 一括設定が先に決まる。古い個別設定のオフでは止めない。
    label: '一括設定はON・古い個別設定がオフ',
    feature: 'booking',
    seed: async (db) => {
      await saveBundle(db, {}, true);
      await setAccountSetting(db.db, 'account-1', 'feature.booking', 'false');
    },
  },
  {
    label: '個別設定だけがオフ(真偽値)',
    feature: 'booking',
    seed: (db) => setAccountSetting(db.db, 'account-1', 'feature.booking', 'false'),
  },
  {
    label: '個別設定だけがオフ(enabled形式)',
    feature: 'booking',
    seed: (db) => setAccountSetting(db.db, 'account-1', 'feature.booking', JSON.stringify({ enabled: false })),
  },
  {
    // 壊れた値はカタログの既定値へ戻す。設定画面の読取と同じ扱い。
    label: '個別設定が壊れている',
    feature: 'booking',
    seed: (db) => setAccountSetting(db.db, 'account-1', 'feature.booking', 'not-json'),
  },
  { label: '既定OFFの機能・設定なし', feature: 'webinars', seed: async () => {} },
  {
    label: '既定OFFの機能・一括設定でオン',
    feature: 'webinars',
    seed: (db) => saveBundle(db, { webinars: true }, false),
  },
];

describe('機能オフのSQL条件式は isAccountFeatureEnabled と一致する', () => {
  for (const testCase of CASES) {
    it(testCase.label, async () => {
      const testDb = createTestD1();
      try {
        testDb.raw.exec(`
          INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
          VALUES ('account-1', 'ch-1', 'A1', 'tok', 'sec');
        `);
        await testCase.seed(testDb);
        const sql = accountFeatureOffExclusionSql('a.id', testCase.feature);
        const row = testDb.raw
          .prepare(`SELECT ${sql} AS off FROM line_accounts a WHERE a.id = 'account-1'`)
          .get() as { off: number };
        const enabled = await isAccountFeatureEnabled(testDb.db, 'account-1', testCase.feature);
        expect(row.off === 1).toBe(!enabled);
      } finally {
        testDb.raw.close();
      }
    });
  }

  it('修飾していない列名は組み立ての時点で弾く', () => {
    // 無修飾だと内側の account_settings 側の同名列として解釈され、
    // 全アカウントがオフ扱いになる。取り違えをここで止める。
    expect(() => accountFeatureOffExclusionSql('line_account_id', 'booking')).toThrow(
      /qualified column/,
    );
  });
});
