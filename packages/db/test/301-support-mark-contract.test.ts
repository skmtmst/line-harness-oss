import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asD1 } from './d1-test-helper.js';
import {
  archiveSupportMarkWithReplacement,
  createSupportMark,
  createSupportMarkWithAutomationRules,
  getDefaultSupportMark,
  getSupportMarkArchiveImpact,
  setFriendSupportMarkBulk,
} from '../src/support-marks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  lineAccountId: 'account-1',
};

let raw: Database.Database;
let db: D1Database;

function insertFriend(id: string): void {
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, line_account_id, display_name, created_at, updated_at)
     VALUES (?, ?, 'account-1', 'テスト', '2026-09-07', '2026-09-07')`,
  ).run(id, `U${id.padEnd(32, '0').slice(0, 32)}`);
}

beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES ('account-1', 'channel-1', '店舗1', 'token', 'secret', ?)`,
  ).run(SCOPE.tenantId);
  db = asD1(raw);
});

describe('301 対応マーク契約', () => {
  test('マークと複数の自動変更ルールを同じバッチで作る', async () => {
    const mark = await createSupportMarkWithAutomationRules(db, SCOPE, {
      name: '要確認', color: '#EF4B55', displayOrder: 2,
    }, 'staff-1', [{
      name: '期限超過', event: 'response_overdue', condition: null,
      priority: 100, manualProtectionMinutes: 60, isActive: true,
    }, {
      name: '担当割当', event: 'staff_assigned', condition: null,
      priority: 50, manualProtectionMinutes: 0, isActive: false,
    }]);

    expect(mark).toMatchObject({ name: '要確認', version: 1, created_by: 'staff-1' });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM automation_definitions WHERE line_account_id = 'account-1'`,
    ).get()).toEqual({ count: 2 });
    const action = raw.prepare(
      `SELECT v.action_config FROM automation_versions v
       JOIN automation_definitions d ON d.id = v.automation_id
       WHERE d.name = '期限超過'`,
    ).get() as { action_config: string };
    expect(JSON.parse(action.action_config)[0].params.markId).toBe(mark.id);
  });

  test('保管前の人数と確認版を実データから作る', async () => {
    const mark = await createSupportMark(db, SCOPE, { name: '要確認' });
    insertFriend('friend-1');
    await setFriendSupportMarkBulk(db, ['friend-1'], mark.id, SCOPE);

    const impact = await getSupportMarkArchiveImpact(db, SCOPE, mark.id);
    expect(impact).toMatchObject({
      canArchive: true,
      mark: { friend_count: 1, version: 1 },
    });
    expect(impact?.revision).toContain(`${mark.id}:1:1:`);
  });

  test('確認版が同じなら置換と保管を行い、同じキーの再送は同じ結果を返す', async () => {
    const replacement = await getDefaultSupportMark(db, SCOPE);
    const mark = await createSupportMark(db, SCOPE, { name: '要確認' });
    insertFriend('friend-1');
    insertFriend('friend-2');
    await setFriendSupportMarkBulk(db, ['friend-1', 'friend-2'], mark.id, SCOPE);
    const impact = await getSupportMarkArchiveImpact(db, SCOPE, mark.id);

    const input = {
      markId: mark.id,
      replacementMarkId: replacement!.id,
      expectedVersion: 1,
      impactRevision: impact!.revision,
      idempotencyKey: 'archive-1',
      actorId: 'staff-1',
    };
    const first = await archiveSupportMarkWithReplacement(db, SCOPE, input);
    const retried = await archiveSupportMarkWithReplacement(db, SCOPE, input);

    expect(first).toEqual(retried);
    expect(first).toMatchObject({ replacedFriendCount: 2, version: 2 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM support_mark_archive_requests`,
    ).get()).toEqual({ count: 1 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM friends WHERE support_mark_id = ?`,
    ).get(replacement!.id)).toEqual({ count: 2 });
  });

  test('確認後に人数が変われば保管せず409相当の競合にする', async () => {
    const replacement = await getDefaultSupportMark(db, SCOPE);
    const mark = await createSupportMark(db, SCOPE, { name: '要確認' });
    const impact = await getSupportMarkArchiveImpact(db, SCOPE, mark.id);
    insertFriend('friend-late');
    await setFriendSupportMarkBulk(db, ['friend-late'], mark.id, SCOPE);

    await expect(archiveSupportMarkWithReplacement(db, SCOPE, {
      markId: mark.id,
      replacementMarkId: replacement!.id,
      expectedVersion: 1,
      impactRevision: impact!.revision,
      idempotencyKey: 'archive-stale',
      actorId: 'staff-1',
    })).rejects.toMatchObject({ code: 'impact_changed' });
    expect(raw.prepare(
      `SELECT archived_at FROM support_marks WHERE id = ?`,
    ).get(mark.id)).toEqual({ archived_at: null });
  });
});
