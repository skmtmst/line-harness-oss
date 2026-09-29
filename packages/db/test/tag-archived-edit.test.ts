import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  archiveTag,
  getScopedTagDeleteImpact,
  getTagDefinition,
  TagDefinitionError,
  updateTagDefinition,
} from '../src/tag-definitions.js';
import { asD1 } from './d1-test-helper.js';

/*
 * Issue #710: 保管済み(archived)タグの編集を止める。
 *
 * 司令塔裁定: タグには archived を active へ戻す口が無い（git grep で確認
 * 済み）。戻せないので、表示名の訂正（name / description）だけは許し、
 * 挙動を決める設定（フォルダ・スター・手動付与可否・再付与方針・連動の
 * 有効無効・マイル・連動アクション）は変えられないようにする。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function freshDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
    INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
    VALUES ('default', 'default', '標準', datetime('now'), datetime('now'));
    INSERT INTO folders (id, kind, name) VALUES ('folder-1', 'tag', '会員フォルダ');
    INSERT INTO tags (id, name, line_account_id, description, is_starred,
                        manual_assignment_allowed, reapply_policy, linked_enabled,
                        mileage_reward, referral_mileage_reward, mileage_multiplier_bps,
                        mileage_multiplier_priority)
    VALUES ('tag-1', '会員', 'account-1', '説明前', 0, 1, 'first_only', 0, 0, 0, NULL, 0);
  `);
  return asD1(sqlite);
}

async function archiveTag1(db: D1Database) {
  const before = (await getTagDefinition(db, 'tag-1', 'account-1'))!;
  const impact = await getScopedTagDeleteImpact(db, 'tag-1', 'account-1');
  await archiveTag(db, {
    tagId: 'tag-1',
    lineAccountId: 'account-1',
    expectedVersion: before.tag.version,
    impactRevision: impact!.revision,
  });
  return (await getTagDefinition(db, 'tag-1', 'account-1', { includeArchived: true }))!;
}

describe('archived タグは表示名の訂正だけ許す（Issue #710）', () => {
  let db: D1Database;

  beforeEach(async () => {
    db = freshDb();
  });

  it('name は変更できる', async () => {
    const archived = await archiveTag1(db);
    const result = await updateTagDefinition(db, {
      tagId: 'tag-1', lineAccountId: 'account-1', expectedVersion: archived.tag.version,
      name: '会員(改名)',
    });
    expect(result.tag.name).toBe('会員(改名)');
    expect(result.tag.status).toBe('archived');
  });

  it('description は変更できる', async () => {
    const archived = await archiveTag1(db);
    const result = await updateTagDefinition(db, {
      tagId: 'tag-1', lineAccountId: 'account-1', expectedVersion: archived.tag.version,
      description: '説明改訂',
    });
    expect(result.tag.description).toBe('説明改訂');
  });

  it.each([
    ['groupId(folder_id)', { groupId: 'folder-1' }],
    ['isStarred', { isStarred: true }],
    ['manualAssignmentAllowed', { manualAssignmentAllowed: false }],
    ['reapplyPolicy', { reapplyPolicy: 'every_time' as const }],
    ['linkedEnabled', { linkedEnabled: true }],
    ['mileage', { mileage: { self: 100, referrer: 50, multiplier: 15000, priority: 1 } }],
    ['actions', { actions: [] }],
  ])('%s への実質的な変更は拒否する', async (_label, patch) => {
    const archived = await archiveTag1(db);
    await expect(updateTagDefinition(db, {
      tagId: 'tag-1', lineAccountId: 'account-1', expectedVersion: archived.tag.version,
      ...patch,
    })).rejects.toMatchObject({ code: 'archived_readonly' });

    // 拒否されたら実際に何も変わっていないことも確かめる。
    const after = (await getTagDefinition(db, 'tag-1', 'account-1', { includeArchived: true }))!;
    expect(after.tag.version).toBe(archived.tag.version);
  });

  it('現在値と同じ値を送る分には拒否しない（差分が無い）', async () => {
    const archived = await archiveTag1(db);
    const result = await updateTagDefinition(db, {
      tagId: 'tag-1', lineAccountId: 'account-1', expectedVersion: archived.tag.version,
      isStarred: false, // 現在値と同じ
      reapplyPolicy: 'first_only', // 現在値と同じ
      name: '会員(名前だけ改訂)',
    });
    expect(result.tag.name).toBe('会員(名前だけ改訂)');
  });

  it('active なタグは今までどおり全列を変更できる（対照）', async () => {
    const result = await updateTagDefinition(db, {
      tagId: 'tag-1', lineAccountId: 'account-1', expectedVersion: 1,
      isStarred: true, reapplyPolicy: 'every_time', linkedEnabled: true,
      mileage: { self: 10, referrer: 5, multiplier: null, priority: 0 },
    });
    expect(result.tag.is_starred).toBe(1);
    expect(result.tag.reapply_policy).toBe('every_time');
  });

  it('拒否のエラーは TagDefinitionError で code=archived_readonly', async () => {
    const archived = await archiveTag1(db);
    try {
      await updateTagDefinition(db, {
        tagId: 'tag-1', lineAccountId: 'account-1', expectedVersion: archived.tag.version,
        isStarred: true,
      });
      throw new Error('拒否されるはずが成功した');
    } catch (error) {
      expect(error).toBeInstanceOf(TagDefinitionError);
      expect((error as TagDefinitionError).code).toBe('archived_readonly');
    }
  });

  it('getTagDefinition は既定で archived を除外し、includeArchived で読める', async () => {
    await archiveTag1(db);
    expect(await getTagDefinition(db, 'tag-1', 'account-1')).toBeNull();
    expect(await getTagDefinition(db, 'tag-1', 'account-1', { includeArchived: true })).not.toBeNull();
  });

  it('getScopedTagDeleteImpact は archived タグでも includeArchived で削除影響を確認できる', async () => {
    await archiveTag1(db);
    expect(await getScopedTagDeleteImpact(db, 'tag-1', 'account-1')).toBeNull();
    const impact = await getScopedTagDeleteImpact(db, 'tag-1', 'account-1', { includeArchived: true });
    expect(impact).not.toBeNull();
    expect(impact!.tag.id).toBe('tag-1');
  });
});
