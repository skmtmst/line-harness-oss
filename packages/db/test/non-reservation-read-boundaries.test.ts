import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTag, getTags, getTagsWithCounts, getTagsWithUsage } from '../src/tags/index.js';
import { getReminders } from '../src/reminders/index.js';
import { getFriendScoreHistory } from '../src/scoring.js';
import { getMileageAdminOverview, postMileageEntry, ensureDefaultMileageProgram } from '../src/mileage/index.js';
import { getMileageFriendsV6 } from '../src/mileage/admin-operations.js';
import { asD1 } from './d1-test-helper.js';

let raw: Database.Database;
let db: D1Database;
const scope = { allowedAccountIds: ['a'], canSeeUnassigned: false };
beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('a','a','A','token','secret'), ('b','b','B','token','secret');
    INSERT INTO friends (id,line_user_id,line_account_id,display_name)
      VALUES ('a3','Ua3','a','同名'), ('a1','Ua1','a','同名'), ('a2','Ua2','a','同名'),
             ('b1','Ub1','b','別店');
    INSERT INTO tags (id,name,line_account_id) VALUES ('ta','会員','a'), ('tb','会員','b'), ('tn','共通',NULL);
    INSERT INTO friend_tags (friend_id,tag_id) VALUES ('a1','ta'), ('b1','tb');
    INSERT INTO reminders (id,name,line_account_id,created_at) VALUES
      ('ra2','同名','a','2026-10-01'), ('ra1','同名','a','2026-10-01'),
      ('rb','別店','b','2026-10-01'), ('rn','共通',NULL,'2026-10-01'),
      ('rd','削除済','a','2026-10-01');
    UPDATE reminders SET deleted_at = '2026-10-02' WHERE id = 'rd';
  `);
  db = asD1(raw);
});
afterEach(() => raw.close());

describe('非予約DBの取得範囲とページの境界', () => {
  it('タグを所属で絞り、未所属と空の権限を明示して扱う', async () => {
    expect((await getTags(db, scope)).map(x => x.id)).toEqual(['ta']);
    expect(await getTags(db, { allowedAccountIds: [], canSeeUnassigned: false })).toEqual([]);
    expect((await getTags(db, { allowedAccountIds: [], canSeeUnassigned: true })).map(x => x.id)).toEqual(['tn']);
    expect(await getTagsWithCounts(db, scope)).toMatchObject([{ id: 'ta', friend_count: 1 }]);
    expect(await getTags(db)).toHaveLength(3); // legacy internal callers keep their complete set
  });

  it('使用先と削除保護を残し、見えない店の同名タグを重複候補に混ぜない', async () => {
    raw.exec(`INSERT INTO scenarios (id,name,trigger_type,trigger_tag_id) VALUES ('s','参照中','tag_added','ta')`);
    const [tag] = await getTagsWithUsage(db, scope);
    expect(tag).toMatchObject({ id: 'ta', friend_count: 1, used_in_scenarios: 1 });
    expect(tag.cleanup_reasons).not.toContain('unused');
    expect(tag.cleanup_reasons).not.toContain('duplicate_name');
    expect(await getTagsWithUsage(db, { allowedAccountIds: [], canSeeUnassigned: false })).toEqual([]);
  });

  it('SQLに見えるタグ名や所属IDもSQL本文へ混ぜず値として扱う', async () => {
    const name = "会員'); DROP TABLE friends; --";
    const tag = await createTag(db, { name });
    expect(tag.name).toBe(name);
    expect((await getTags(db, { allowedAccountIds: [], canSeeUnassigned: true })).find(row => row.id === tag.id)?.name).toBe(name);
    expect(await getTags(db, { allowedAccountIds: ["a') OR 1=1 --"], canSeeUnassigned: false })).toEqual([]);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM friends').get()).toEqual({ n: 4 });
  });

  it('100を超える所属IDでもSQLの変数上限を越えない', async () => {
    const many = { ...scope, allowedAccountIds: ['a', ...Array.from({ length: 110 }, (_, i) => `other-${i}`)] };
    expect((await getTagsWithUsage(db, many)).map(x => x.id)).toEqual(['ta']);
    expect((await getReminders(db, many)).map(x => x.id)).toEqual(['ra1', 'ra2']);
  });

  it('リマインダは削除済・別店を除外し、同じ表示順と日時でも順番を固定する', async () => {
    expect((await getReminders(db, scope)).map(x => x.id)).toEqual(['ra1', 'ra2']);
    expect(await getReminders(db, { allowedAccountIds: [], canSeeUnassigned: false })).toEqual([]);
    expect((await getReminders(db, { allowedAccountIds: [], canSeeUnassigned: true })).map(x => x.id)).toEqual(['rn']);
    expect(await getReminders(db)).toHaveLength(4);
  });

  it('スコア履歴は同じ日時をIDで整列し、既存の全履歴応答を途中で切らない', async () => {
    const insert = raw.prepare(`INSERT INTO friend_scores (id,friend_id,score_change,created_at) VALUES (?,'a1',1,'2026-10-01')`);
    for (let i = 0; i < 120; i++) insert.run(`score-${String(i).padStart(3, '0')}`);
    raw.exec(`INSERT INTO friend_scores (id,friend_id,score_change) VALUES ('other','b1',9)`);
    const history = await getFriendScoreHistory(db, 'a1');
    expect(history).toHaveLength(120);
    expect(history[0].id).toBe('score-119');
    expect(history[119].id).toBe('score-000');
  });

  it('マイル一覧は空の後続ページでも検索と所属に合う総件数を残す', async () => {
    const input = { accountId: 'a', limit: 2, offset: 0 };
    const first = await getMileageAdminOverview(db, input);
    const second = await getMileageAdminOverview(db, { ...input, offset: 2 });
    expect([...first.members, ...second.members].map(x => x.primaryFriendId)).toEqual(['a1', 'a2', 'a3']);
    const empty = await getMileageAdminOverview(db, { ...input, offset: 10, search: '同名' });
    expect(empty.members).toEqual([]);
    expect(empty.pagination.total).toBe(3);
    expect(empty.summary.totalMembers).toBe(3);
    expect((await getMileageAdminOverview(db, { ...input, offset: 10, search: '別店' })).pagination.total).toBe(0);
  });

  it('同じ残高の人数を集約しても名寄せした財布を二度足さない', async () => {
    await ensureDefaultMileageProgram(db);
    raw.exec(`
      INSERT INTO users (id,display_name) VALUES ('u','本人');
      UPDATE friends SET user_id = 'u' WHERE id IN ('a1','a2');
      INSERT INTO mileage_rewards (id,line_account_id,name,reward_kind,status)
        VALUES ('rank','a','ランク','rank','published');
      INSERT INTO mileage_reward_versions (id,reward_id,version_number,required_miles,status)
        VALUES ('rv','rank',1,100,'published');
      UPDATE mileage_rewards SET current_published_version_id = 'rv' WHERE id = 'rank';
    `);
    await postMileageEntry(db, { beneficiaryUserId: 'u', beneficiaryFriendId: 'a1', entryType: 'grant',
      amount: 100, reason: '付与', source: 'test', idempotencyKey: 'u' });
    await postMileageEntry(db, { beneficiaryFriendId: 'a3', entryType: 'grant',
      amount: 100, reason: '付与', source: 'test', idempotencyKey: 'a3' });
    const result = await getMileageFriendsV6(db, {
      lineAccountId: 'a', visibleAccountIds: ['a'], search: '', limit: 1, offset: 0,
    });
    expect(result.summary).toMatchObject({ totalMembers: 3, available: 200,
      rankCounts: [{ rewardId: 'rank', friendCount: 2 }] });
    expect(result.pagination.total).toBe(3);
  });

  it('友だち別マイルも検索・本人指定・範囲外ページの件数を保持する', async () => {
    const input = { lineAccountId: 'a', visibleAccountIds: ['a'], search: '同名', limit: 2, offset: 10 };
    const empty = await getMileageFriendsV6(db, input);
    expect(empty.items).toEqual([]);
    expect(empty.pagination.total).toBe(3);
    expect((await getMileageFriendsV6(db, { ...input, friendId: 'a1' })).pagination.total).toBe(1);
    expect((await getMileageFriendsV6(db, { ...input, friendId: 'b1' })).pagination.total).toBe(0);
    expect((await getMileageFriendsV6(db, { ...input, search: '別店' })).pagination.total).toBe(0);
  });
});
