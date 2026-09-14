/**
 * N-053: アクション保存前の参照検証。
 *
 * 幽霊参照・別アカウント参照を保存前に弾く。#644 の既存契約どおり、
 * 資源側の共通（NULL）は tag/template/scenario の3種だけ通し、
 * それ以外へは広げない。書き込みは一切しない。
 */
import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateScenarioActionReferences } from '../src/scenarios.js';
import { asD1 } from './d1-test-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

describe('アクション保存前の参照検証（N-053）', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);

    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('acc-a', 'ch-a', 'A', 'tok-a', 'sec-a'),
              ('acc-b', 'ch-b', 'B', 'tok-b', 'sec-b')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tags (id, name, created_at, line_account_id) VALUES
         ('tag-a', 'Aのタグ', '2026-08-16', 'acc-a'),
         ('tag-b', 'Bのタグ', '2026-08-16', 'acc-b'),
         ('tag-common', '共通タグ', '2026-08-16', NULL)`,
    ).run();
    sqlite.prepare(`INSERT INTO tag_groups (id, name, created_at, updated_at)
                    VALUES ('grp-1', 'まとめ', '2026-08-16', '2026-08-16')`).run();
    sqlite.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active, delivery_mode, created_at, updated_at, line_account_id) VALUES
         ('scn-a', 'Aの案内', 'manual', 1, 'relative', '2026-08-16', '2026-08-16', 'acc-a'),
         ('scn-b', 'Bの案内', 'manual', 1, 'relative', '2026-08-16', '2026-08-16', 'acc-b'),
         ('scn-common', '共通の案内', 'manual', 1, 'relative', '2026-08-16', '2026-08-16', NULL)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO templates (id, name, message_type, message_content, created_at, updated_at, line_account_id) VALUES
         ('tpl-a', 'Aの文', 'text', 'A', '2026-08-16', '2026-08-16', 'acc-a'),
         ('tpl-b', 'Bの文', 'text', 'B', '2026-08-16', '2026-08-16', 'acc-b'),
         ('tpl-common', '共通の文', 'text', 'C', '2026-08-16', '2026-08-16', NULL)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO common_vars (id, name, var_key, line_account_id, archived_at) VALUES
         ('var-a', 'Aの変数', 'shop_hours', 'acc-a', NULL),
         ('var-b', 'Bの変数', 'shop_hours', 'acc-b', NULL),
         ('var-archived', '捨てた変数', 'old_key', 'acc-a', '2026-08-01'),
         ('var-common', '共通の変数', 'common_key', NULL, NULL)`,
    ).run();
    // 既定統括の行は bootstrap 済み。統括1・2だけ足す。
    sqlite.prepare(
      `INSERT INTO tenants (id, name) VALUES ('ten-1', '統括1'), ('ten-2', '統括2')`,
    ).run();
    sqlite.prepare(`UPDATE line_accounts SET tenant_id = 'ten-1' WHERE id IN ('acc-a', 'acc-b')`).run();
    sqlite.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
                 VALUES ('acc-c', 'channel-c', '公式C', 'token', 'secret', 'ten-2')`);
    sqlite.prepare(
      `INSERT INTO reminders (id, name, line_account_id, deleted_at) VALUES
         ('rem-1', '誕生日', 'acc-a', NULL),
         ('rem-b', 'Bの記念日', 'acc-b', NULL),
         ('rem-common', '共通の記念日', NULL, NULL),
         ('rem-deleted', '消した記念日', 'acc-a', '2026-08-01')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO support_marks (id, name, archived_at) VALUES
         ('mark-1', '要対応', NULL),
         ('mark-a', 'Aの要対応', NULL),
         ('mark-b', 'Bの要対応', NULL),
         ('mark-tenant2', '統括2の要対応', NULL),
         ('mark-legacy', '昔の要対応', NULL),
         ('mark-archived', '捨てた要対応', '2026-08-01')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at) VALUES
         ('mark-a', 'ten-1', 'acc-a', '2026-08-16'),
         ('mark-b', 'ten-1', 'acc-b', '2026-08-16'),
         ('mark-tenant2', 'ten-2', 'acc-c', '2026-08-16')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO friend_fields (id, name, field_key, type, status) VALUES
         ('fld-1', '項目', 'pet_name', 'text', 'active'),
         ('fld-b', 'Bの項目', 'b_code', 'text', 'active'),
         ('fld-archived', '捨てた項目', 'old_code', 'text', 'archived')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO friend_field_scopes (field_id, tenant_id, line_account_id, created_at) VALUES
         ('fld-1', 'ten-1', 'acc-a', '2026-08-16'),
         ('fld-b', 'ten-1', 'acc-b', '2026-08-16')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO events (id, line_account_id, name, deleted_at) VALUES
         ('ev-a', 'acc-a', 'Aの会', NULL),
         ('ev-b', 'acc-b', 'Bの会', NULL),
         ('ev-deleted', 'acc-a', '消した会', '2026-08-01')`,
    ).run();
  });

  test('正常な同一アカウント参照と参照なしを通す', async () => {
    expect(await validateScenarioActionReferences(db, 'acc-a', 'tag', { tagIds: ['tag-a'], folderId: 'grp-1' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'friend_field', { fieldId: 'fld-1', op: 'set' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'support_mark', { markId: null }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'support_mark', { markId: 'mark-a' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'scenario', { op: 'start', scenarioId: 'scn-a' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'scenario', { op: 'stop' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'common_var', { varKey: 'shop_hours', op: 'add' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'send_message', { content: 'こんにちは' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'send_template', { templateId: 'tpl-a' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'reminder', { reminderId: 'rem-1' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'event_booking', { eventId: 'ev-a' }))
      .toEqual({ ok: true });
  });

  test('共通シナリオは何も確かめない', async () => {
    expect(await validateScenarioActionReferences(db, null, 'tag', { tagIds: ['tag-ghost'] }))
      .toEqual({ ok: true });
  });

  test('幽霊参照を missing で弾く（#779 の再現）', async () => {
    expect(await validateScenarioActionReferences(db, 'acc-a', 'tag', { tagIds: ['tag-ghost'] }))
      .toEqual({ ok: false, issue: { field: 'tagIds[0]', reason: 'missing', message: 'タグが見つかりません。選び直してください。' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'tag', { tagIds: ['tag-a', 'tag-ghost'] }))
      .toMatchObject({ ok: false, issue: { field: 'tagIds[1]', reason: 'missing' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'friend_field', { fieldId: 'fld-ghost', op: 'set' }))
      .toMatchObject({ ok: false, issue: { field: 'fieldId', reason: 'missing' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'support_mark', { markId: 'mark-ghost' }))
      .toMatchObject({ ok: false, issue: { field: 'markId', reason: 'missing' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'tag', { folderId: 'grp-ghost' }))
      .toMatchObject({ ok: false, issue: { field: 'folderId', reason: 'missing' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'scenario', { op: 'start', scenarioId: 'scn-ghost' }))
      .toMatchObject({ ok: false, issue: { field: 'scenarioId', reason: 'missing' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'common_var', { varKey: 'no_key', op: 'add' }))
      .toMatchObject({ ok: false, issue: { field: 'varKey', reason: 'missing' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'send_template', { templateId: 'tpl-ghost' }))
      .toMatchObject({ ok: false, issue: { field: 'templateId', reason: 'missing' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'reminder', { reminderId: 'rem-ghost' }))
      .toMatchObject({ ok: false, issue: { field: 'reminderId', reason: 'missing' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'event_booking', { eventId: 'ev-ghost' }))
      .toMatchObject({ ok: false, issue: { field: 'eventId', reason: 'missing' } });
    // 捨てた共通情報・消したイベントは幽霊扱い。
    expect(await validateScenarioActionReferences(db, 'acc-a', 'common_var', { varKey: 'old_key', op: 'add' }))
      .toMatchObject({ ok: false, issue: { field: 'varKey', reason: 'missing' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'event_booking', { eventId: 'ev-deleted' }))
      .toMatchObject({ ok: false, issue: { field: 'eventId', reason: 'missing' } });
  });

  test('別アカウント参照を cross-account で弾く', async () => {
    expect(await validateScenarioActionReferences(db, 'acc-a', 'tag', { tagIds: ['tag-b'] }))
      .toMatchObject({ ok: false, issue: { field: 'tagIds[0]', reason: 'cross-account' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'scenario', { op: 'start', scenarioId: 'scn-b' }))
      .toMatchObject({ ok: false, issue: { field: 'scenarioId', reason: 'cross-account' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'common_var', { varKey: 'shop_hours', op: 'add' }) )
      .toEqual({ ok: true });
    // 同じ var_key が別アカウントにもあるが、自アカウントの行があるので通る。
    // 別アカウントにしか無いキーは cross-account。
    sqlite.prepare(`DELETE FROM common_vars WHERE id = 'var-a'`).run();
    expect(await validateScenarioActionReferences(db, 'acc-a', 'common_var', { varKey: 'shop_hours', op: 'add' }))
      .toMatchObject({ ok: false, issue: { field: 'varKey', reason: 'cross-account' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'send_template', { templateId: 'tpl-b' }))
      .toMatchObject({ ok: false, issue: { field: 'templateId', reason: 'cross-account' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'event_booking', { eventId: 'ev-b' }))
      .toMatchObject({ ok: false, issue: { field: 'eventId', reason: 'cross-account' } });
  });

  test('資源側の共通は tag/template/scenario だけ通し、共通情報には広げない', async () => {
    expect(await validateScenarioActionReferences(db, 'acc-a', 'tag', { tagIds: ['tag-common'] }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'send_template', { templateId: 'tpl-common' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'scenario', { op: 'start', scenarioId: 'scn-common' }))
      .toEqual({ ok: true });
    // 共通の変数に既存契約は無い。実行でも拾われないので通さない。
    expect(await validateScenarioActionReferences(db, 'acc-a', 'common_var', { varKey: 'common_key', op: 'add' }))
      .toMatchObject({ ok: false, issue: { field: 'varKey', reason: 'cross-account' } });
  });

  test('別アカウントのリマインダを cross-account で弾く（R1）', async () => {
    expect(await validateScenarioActionReferences(db, 'acc-a', 'reminder', { reminderId: 'rem-b' }))
      .toMatchObject({ ok: false, issue: { field: 'reminderId', reason: 'cross-account' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'reminder', { reminderId: 'rem-common' }))
      .toEqual({ ok: true });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'reminder', { reminderId: 'rem-deleted' }))
      .toMatchObject({ ok: false, issue: { field: 'reminderId', reason: 'missing' } });
  });

  test('対応マークは統括とアカウントの所有境界で弾く（R2）', async () => {
    // 自分の統括・自分のアカウントは通る。
    expect(await validateScenarioActionReferences(db, 'acc-a', 'support_mark', { markId: 'mark-a' }))
      .toEqual({ ok: true });
    // 同じ統括の別アカウントは cross-account。
    expect(await validateScenarioActionReferences(db, 'acc-a', 'support_mark', { markId: 'mark-b' }))
      .toMatchObject({ ok: false, issue: { field: 'markId', reason: 'cross-account' } });
    // 別統括は cross-tenant。範囲表が無く既定統括の共通扱いの昔の行も、統括が違えば通さない。
    expect(await validateScenarioActionReferences(db, 'acc-a', 'support_mark', { markId: 'mark-tenant2' }))
      .toMatchObject({ ok: false, issue: { field: 'markId', reason: 'cross-tenant' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'support_mark', { markId: 'mark-legacy' }))
      .toMatchObject({ ok: false, issue: { field: 'markId', reason: 'cross-tenant' } });
    // 捨てた行は幽霊扱い。
    expect(await validateScenarioActionReferences(db, 'acc-a', 'support_mark', { markId: 'mark-archived' }))
      .toMatchObject({ ok: false, issue: { field: 'markId', reason: 'missing' } });
  });

  test('友だち情報欄も同じ所有境界で弾く', async () => {
    expect(await validateScenarioActionReferences(db, 'acc-a', 'friend_field', { fieldId: 'fld-b', op: 'set' }))
      .toMatchObject({ ok: false, issue: { field: 'fieldId', reason: 'cross-account' } });
    expect(await validateScenarioActionReferences(db, 'acc-a', 'friend_field', { fieldId: 'fld-archived', op: 'set' }))
      .toMatchObject({ ok: false, issue: { field: 'fieldId', reason: 'missing' } });
  });

  test('検証は書き込まない', async () => {
    const before = (sqlite.prepare(`SELECT COUNT(*) AS c FROM scenario_actions`).get() as { c: number }).c;
    await validateScenarioActionReferences(db, 'acc-a', 'tag', { tagIds: ['tag-ghost'] });
    await validateScenarioActionReferences(db, 'acc-a', 'tag', { tagIds: ['tag-a'] });
    expect((sqlite.prepare(`SELECT COUNT(*) AS c FROM scenario_actions`).get() as { c: number }).c).toBe(before);
  });
});
