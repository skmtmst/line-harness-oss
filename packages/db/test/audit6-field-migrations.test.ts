import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFieldMigrationPreview, executeFieldMigration, queueFieldMigration } from '../src/field-migrations.js';
import type { FriendFieldUsageTarget } from '../src/friend-fields.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = ON');
  db = asD1(sqlite); // 各SQLの100 bind制限と、batchの巻き戻しを実行する。
  sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('tenant', 'テスト');
    INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret)
      VALUES ('account', '本店', 'channel', 'token', 'secret'),
             ('other', '別店舗', 'other-channel', 'token', 'secret');
    INSERT INTO friend_fields (id, name, field_key, type)
      VALUES ('source', '元項目', 'source', 'text'), ('target', '新項目', 'target', 'text');
    INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('friend', 'U-test', 'account');
    INSERT INTO friend_field_values (friend_id, field_id, value) VALUES ('friend', 'source', '元値');
  `);
});
afterEach(() => sqlite.close());

async function preview(reminderCount: number, formCount = 0, includeOther = false) {
  const targets: FriendFieldUsageTarget[] = [];
  const reminder = sqlite.prepare(`INSERT INTO reminders
    (id, name, line_account_id, trigger_type, trigger_field_id)
    VALUES (?, ?, 'account', 'friend_field', 'source')`);
  for (let i = 0; i < reminderCount; i++) {
    const id = `rem-${i}`;
    reminder.run(id, id);
    targets.push({ fieldId: 'source', id, name: id, kind: 'reminder', switchable: true });
  }
  sqlite.exec(`INSERT INTO reminders (id, name, line_account_id, trigger_type, trigger_field_id)
    VALUES ('other-rem', '別店舗', 'other', 'friend_field', 'source'),
           ('manual-rem', '手動切替', 'account', 'friend_field', 'source');`);
  if (includeOther) targets.push({ fieldId: 'source', id: 'other-rem', name: '別店舗', kind: 'reminder', switchable: true });
  targets.push({ fieldId: 'source', id: 'manual-rem', name: '手動切替', kind: 'reminder', switchable: false });
  const form = sqlite.prepare(`INSERT INTO forms (id, name, fields) VALUES (?, ?, ?)`);
  for (let i = 0; i < formCount; i++) {
    const id = `form-${i}`;
    form.run(id, id, JSON.stringify([{ name: '項目', type: 'text', friendFieldId: 'source' }]));
    targets.push({ fieldId: 'source', id, name: id, kind: 'form', switchable: true });
  }
  await createFieldMigrationPreview(db, {
    runId: 'run', scope: { tenantId: 'tenant', lineAccountId: 'account' },
    sourceFieldId: 'source', targetFieldId: 'target', sourceVersion: 1, targetVersion: 1,
    previewTokenHash: 'token-hash', snapshotHash: 'snapshot', expiresAt: '2099-01-01',
    usageTargets: targets, createdBy: 'staff',
    items: [{ friendId: 'friend', sourceValue: '元値', convertedValue: '新値', status: 'convertible', reason: null }],
  });
  expect(await queueFieldMigration(db, 'run', 'stable-intent-key')).toBe(true);
}

function verify(reminderCount: number) {
  expect(sqlite.prepare(`SELECT status, processed_count, succeeded_count FROM field_migration_runs WHERE id = 'run'`).get())
    .toEqual({ status: 'succeeded', processed_count: 1, succeeded_count: 1 });
  expect(sqlite.prepare(`SELECT status, version FROM friend_fields WHERE id = 'source'`).get())
    .toEqual({ status: 'read_only', version: 2 });
  expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM reminders WHERE trigger_field_id = 'target'`).get())
    .toEqual({ n: reminderCount });
  expect(sqlite.prepare(`SELECT trigger_field_id FROM reminders WHERE id IN ('other-rem', 'manual-rem')`).all())
    .toEqual([{ trigger_field_id: 'source' }, { trigger_field_id: 'source' }]);
  expect(sqlite.prepare(`SELECT value FROM friend_field_values WHERE field_id = 'source'`).get())
    .toEqual({ value: '元値' });
  expect(sqlite.prepare(`SELECT value, version FROM friend_field_values WHERE field_id = 'target'`).get())
    .toEqual({ value: '新値', version: 1 });
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
}

describe('PKG66: 項目移行の参照切替を100 bind以内で確定する', () => {
  it.each([96, 97, 197])('%i件のリマインダを全件切り替える', async (count) => {
    await preview(count);
    await executeFieldMigration(db, 'run', 'text', 'staff');
    verify(count);
  });

  it('101件のフォームも切り替え、公開版は保持する', async () => {
    await preview(0, 101);
    const published = sqlite.prepare('SELECT id, fields FROM form_versions ORDER BY id').all();
    await executeFieldMigration(db, 'run', 'text', 'staff');
    verify(0);
    const forms = sqlite.prepare('SELECT fields FROM forms').all() as Array<{ fields: string }>;
    expect(forms).toHaveLength(101);
    expect(forms.every((f) => JSON.parse(f.fields)[0].friendFieldId === 'target')).toBe(true);
    expect(sqlite.prepare('SELECT id, fields FROM form_versions ORDER BY id').all()).toEqual(published);
  });

  it('後半の切替失敗では最終化全部を戻し、再開で完了済み値を二重移行しない', async () => {
    await preview(197, 0, true);
    sqlite.exec(`CREATE TRIGGER fail_later_chunk BEFORE UPDATE ON reminders
      WHEN OLD.id = 'rem-150' BEGIN SELECT RAISE(ABORT, 'injected later chunk failure'); END;`);
    await expect(executeFieldMigration(db, 'run', 'text', 'staff')).rejects.toThrow('injected later chunk failure');
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM reminders WHERE trigger_field_id = 'target'`).get()).toEqual({ n: 0 });
    expect(sqlite.prepare(`SELECT status, version FROM friend_fields WHERE id = 'source'`).get()).toEqual({ status: 'active', version: 1 });
    expect(sqlite.prepare(`SELECT status FROM field_migration_runs WHERE id = 'run'`).get()).toEqual({ status: 'running' });
    expect(sqlite.prepare(`SELECT status FROM field_migration_items WHERE run_id = 'run'`).get()).toEqual({ status: 'succeeded' });
    sqlite.exec('DROP TRIGGER fail_later_chunk');
    await executeFieldMigration(db, 'run', 'text', 'staff');
    verify(197);
  });
});
