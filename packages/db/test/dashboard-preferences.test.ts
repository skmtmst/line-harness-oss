import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deleteDashboardPreference,
  getDashboardDefaultPreference,
  getDashboardPreference,
  saveDashboardDefaultPreference,
  saveDashboardPreference,
} from '../src/dashboard-preferences.js';

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (sql: string, params: unknown[]) => ({
    async run() {
      const info = sqlite.prepare(sql).run(...params);
      return { results: [], success: true, meta: { changes: info.changes } };
    },
    async first<T>() { return (sqlite.prepare(sql).get(...params) as T) ?? null; },
    async all<T>() { return { results: sqlite.prepare(sql).all(...params) as T[], success: true, meta: {} }; },
  });
  return {
    prepare(sql: string) {
      return { bind: (...params: unknown[]) => wrap(sql, params), ...wrap(sql, []) };
    },
  } as unknown as D1Database;
}

const cards = {
  today: [{ id: 'today-inbox', visible: true }],
  main: [{ id: 'friend-trend', visible: true }],
  right: [{ id: 'send-quota', visible: true }],
};

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.prepare("INSERT INTO staff_members (id, name, role, api_key) VALUES ('staff-1', '担当者', 'staff', 'key')").run();
  sqlite.prepare("INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES ('account-1', 'channel', 'LINE', 'token', 'secret')").run();
  db = asD1(sqlite);
});

describe('dashboard preferences', () => {
  test('stores layouts per staff and account and increments the version', async () => {
    const first = await saveDashboardPreference(db, {
      staffId: 'staff-1', lineAccountId: 'account-1', expectedVersion: 0, cards,
    });
    expect(first).toMatchObject({ status: 'saved', row: { version: 1 } });

    const second = await saveDashboardPreference(db, {
      staffId: 'staff-1', lineAccountId: 'account-1', expectedVersion: 1,
      cards: { ...cards, today: [{ id: 'today-inbox', visible: false }] },
    });
    expect(second).toMatchObject({ status: 'saved', row: { version: 2 } });
    expect(JSON.parse((await getDashboardPreference(db, 'staff-1', 'account-1'))!.cards))
      .toMatchObject({ today: [{ visible: false }] });
  });

  test('returns a conflict instead of overwriting a newer layout', async () => {
    await saveDashboardPreference(db, {
      staffId: 'staff-1', lineAccountId: 'account-1', expectedVersion: 0, cards,
    });
    const conflict = await saveDashboardPreference(db, {
      staffId: 'staff-1', lineAccountId: 'account-1', expectedVersion: 0, cards,
    });
    expect(conflict).toMatchObject({ status: 'conflict', current: { version: 1 } });
  });

  test('deleting a personal layout falls back without deleting the account default', async () => {
    await saveDashboardDefaultPreference(db, { lineAccountId: 'account-1', staffId: 'staff-1', cards });
    await saveDashboardPreference(db, {
      staffId: 'staff-1', lineAccountId: 'account-1', expectedVersion: 0, cards,
    });
    await deleteDashboardPreference(db, 'staff-1', 'account-1');
    expect(await getDashboardPreference(db, 'staff-1', 'account-1')).toBeNull();
    expect(await getDashboardDefaultPreference(db, 'account-1')).toMatchObject({ version: 1 });
  });
});
