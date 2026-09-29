import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  getVersionedAccountSetting,
  saveVersionedAccountSetting,
} from '../src/account-settings.js';
import { asD1 } from './d1-test-helper.js';

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE account_settings (
      id TEXT PRIMARY KEY,
      line_account_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(line_account_id, key)
    );
  `);
  return { sqlite, db: asD1(sqlite) };
}

describe('versioned account settings', () => {
  it('saves one bundle row and advances its version', async () => {
    const { sqlite, db } = setup();
    const first = await saveVersionedAccountSetting(db, {
      accountId: 'account-1',
      key: 'feature.settings_bundle_v1',
      expectedVersion: 0,
      data: { features: { scenarios: true } },
    });
    expect(first).toMatchObject({ status: 'saved', setting: { version: 1 } });

    const second = await saveVersionedAccountSetting(db, {
      accountId: 'account-1',
      key: 'feature.settings_bundle_v1',
      expectedVersion: 1,
      data: { features: { scenarios: false } },
    });
    expect(second).toMatchObject({ status: 'saved', setting: { version: 2 } });
    expect(await getVersionedAccountSetting(db, 'account-1', 'feature.settings_bundle_v1'))
      .toMatchObject({ version: 2, data: { features: { scenarios: false } } });
    expect(sqlite.prepare(
      "SELECT COUNT(*) AS count FROM account_settings WHERE line_account_id = 'account-1'",
    ).get()).toEqual({ count: 1 });
    sqlite.close();
  });

  it('does not overwrite a newer value from a stale version', async () => {
    const { sqlite, db } = setup();
    await saveVersionedAccountSetting(db, {
      accountId: 'account-1',
      key: 'feature.settings_bundle_v1',
      expectedVersion: 0,
      data: { features: { scenarios: true } },
    });
    const conflict = await saveVersionedAccountSetting(db, {
      accountId: 'account-1',
      key: 'feature.settings_bundle_v1',
      expectedVersion: 0,
      data: { features: { scenarios: false } },
    });

    expect(conflict).toMatchObject({ status: 'conflict', current: { version: 1 } });
    expect(await getVersionedAccountSetting(db, 'account-1', 'feature.settings_bundle_v1'))
      .toMatchObject({ version: 1, data: { features: { scenarios: true } } });
    sqlite.close();
  });
});
