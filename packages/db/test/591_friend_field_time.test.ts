import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createFriendField, createFriendFieldIdempotent, getFriendFieldById,
  getFriendFieldsWithValues, getFriendFieldMap,
  setFriendFieldValue, validateFriendFieldValue,
} from '../src/friend-fields.js';
import { asD1 } from './d1-test-helper.js';

let raw: Database.Database;
let db: D1Database;
beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('acc-1', 'channel-1', '本店', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
      VALUES ('friend-1', 'U1', '読者', 'acc-1');
  `);
  db = asD1(raw);
});
afterEach(() => raw.close());

describe('友だち情報欄の時刻', () => {
  test.each(['00:00', '09:05', '23:59', ' 12:34 '])('時刻%sは日付に変換せず保存する', (value) => {
    expect(validateFriendFieldValue({ type: 'time' }, value)).toEqual({ ok: true, value: value.trim() });
  });
  test.each(['24:00', '23:60', '9:05', '09:5', '12:34:56', '2026-10-07T12:34', 930, true])('不正な時刻%jは拒む', (value) => {
    expect(validateFriendFieldValue({ type: 'time' }, value).ok).toBe(false);
  });
  test.each([null, undefined, '', '  '])('空欄%jは値なしとして扱う', (value) => {
    expect(validateFriendFieldValue({ type: 'time' }, value)).toEqual({ ok: true, value: null });
  });

  test('作成・再送・読み直し・差し込みでも時刻のまま扱う', async () => {
    const scope = { tenantId: '00000000-0000-4000-8000-000000000001', lineAccountId: 'acc-1' };
    const input = { name: '来店時刻', fieldKey: 'visit_time', type: 'time' as const, defaultValue: '09:30' };
    const first = await createFriendFieldIdempotent(db, scope, input, 'time-1');
    const replay = await createFriendFieldIdempotent(db, scope, input, 'time-1');
    expect(first.field).toMatchObject({ type: 'time', default_value: '09:30' });
    expect(replay).toMatchObject({ replayed: true, field: { id: first.field.id, type: 'time' } });
    expect(raw.prepare('SELECT type, type_v6, type_v8 FROM friend_fields WHERE id = ?').get(first.field.id))
      .toEqual({ type: 'text', type_v6: 'text', type_v8: 'time' });
    await setFriendFieldValue(db, { friendId: 'friend-1', fieldId: first.field.id, value: ' 23:59 ', updatedBy: 'staff-1', field: first.field });
    expect(await getFriendFieldById(db, first.field.id)).toMatchObject({ type: 'time' });
    expect(await getFriendFieldsWithValues(db, 'friend-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.field.id, type: 'time', value: '23:59' }),
    ]));
    expect(await getFriendFieldMap(db, 'friend-1')).toMatchObject({ visit_time: '23:59' });
    await expect(setFriendFieldValue(db, { friendId: 'friend-1', fieldId: first.field.id, value: '24:00', updatedBy: 'staff-1', field: first.field })).rejects.toThrow('HH:mm');
    expect(raw.prepare('SELECT value FROM friend_field_values WHERE field_id = ?').get(first.field.id)).toEqual({ value: '23:59' });
  });

  test('所属なしの既存の作成関数も時刻を保存する', async () => {
    const field = await createFriendField(db, { name: '時刻', fieldKey: 'clock', type: 'time' });
    expect(field.type).toBe('time');
  });

  test('草稿は既存項目・値・関連を変えず、未知の種類を保存できない', () => {
    const legacy = new Database(':memory:');
    try {
      // 591 の追加列だけ外して、適用前の全スキーマを再現する。
      const bootstrap = readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8');
      legacy.exec(bootstrap.replace(/, type_v8 TEXT\s+CHECK \(type_v8 IS NULL OR type_v8 = 'time'\)/, ''));
      legacy.exec("INSERT INTO friend_fields (id, name, field_key, type, type_v6) VALUES ('old', '日付', 'old_date', 'date', 'date');");
      const before = legacy.prepare('SELECT * FROM friend_fields').get() as object;
      legacy.exec(readFileSync(new URL('../migrations/591_friend_field_time.sql', import.meta.url), 'utf8'));
      expect(legacy.prepare('SELECT * FROM friend_fields').get()).toEqual({ ...before, type_v8: null });
      expect(() => legacy.prepare('UPDATE friend_fields SET type_v8 = ?').run('unknown')).toThrow(/CHECK/);
      expect(legacy.pragma('foreign_key_check')).toEqual([]);
    } finally { legacy.close(); }
  });
});
