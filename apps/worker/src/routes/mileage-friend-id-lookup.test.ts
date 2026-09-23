import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { getMileageAdminHistory, getMileageFriendsV6 } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/*
 * V6R-CX-e: マイルの友だち詳細は、名前ではなく友だちIDで1人を取る（実SQLite）。
 *
 * 以前は表示名で探して100件まで取り、その中から友だちIDで拾っていた。
 * 同じ名前の友だちが100人を超えると、本人の行と履歴がこぼれて出なかった。
 * また履歴は「代表の友だちID」と一致するものしか残さなかったため、
 * 名寄せした人を副アカウントから開くと履歴が空になっていた。
 */
let fixture: SqliteD1;

function friend(id: string, name: string, userId: string | null = null) {
  fixture.raw.prepare(`INSERT INTO friends(id,line_user_id,display_name,line_account_id,user_id,is_following,created_at,updated_at)
    VALUES(?,?,?,'acc',?,1,'2026-01-01','2026-01-01')`).run(id, `U-${id}`, name, userId);
}
function grant(id: string, friendId: string | null, userId: string | null, amount: number) {
  fixture.raw.prepare(`INSERT INTO mileage_ledger(id,program_id,beneficiary_user_id,beneficiary_friend_id,entry_type,status,amount,reason,source,idempotency_key,occurred_at,created_at)
    VALUES(?, 'default', ?, ?, 'grant', 'available', ?, '購入', 'purchase', ?, '2026-09-01T10:00:00', '2026-09-01T10:00:00')`).run(id, userId, friendId, amount, `key-${id}`);
}

beforeEach(async () => {
  fixture = createTestD1({ foreignKeys: true });
  fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id,created_at,updated_at)
    VALUES('acc','A店','ch','s','t',?,'2026-01-01','2026-01-01')`).run(DEFAULT_TENANT_ID);
  // 既定のプログラムを作らせる（履歴の関数が最初に用意する）。
  await getMileageAdminHistory(fixture.db, { accountId: 'acc', limit: 1 });
});
afterEach(() => fixture.raw.close());

describe('マイルの友だち詳細を友だちIDで取る（V6R-CX-e）', () => {
  it('同じ名前が101人いても、友だちIDで本人の1行を返す', async () => {
    for (let i = 0; i < 101; i += 1) friend(`f-${String(i).padStart(3, '0')}`, '佐藤');
    // 本人は残高が一番少ない（名前で探した100件の枠からこぼれる並び）
    for (let i = 0; i < 100; i += 1) grant(`g-${i}`, `f-${String(i).padStart(3, '0')}`, null, 100 + i);
    grant('g-me', 'f-100', null, 1);

    const byName = await getMileageFriendsV6(fixture.db, { lineAccountId: 'acc', visibleAccountIds: ['acc'], search: '佐藤', limit: 100, offset: 0 });
    expect(byName.items.some((item) => item.friendId === 'f-100')).toBe(false);

    const byId = await getMileageFriendsV6(fixture.db, { lineAccountId: 'acc', visibleAccountIds: ['acc'], search: '', friendId: 'f-100', limit: 1, offset: 0 });
    expect(byId.items.map((item) => item.friendId)).toEqual(['f-100']);
  });

  it('履歴は、その人（名寄せした複数アカウント）の分だけを返す。副アカウントから開いても出る', async () => {
    fixture.raw.prepare(`INSERT INTO users(id,display_name) VALUES('u1','山田')`).run();
    friend('a-main', '山田', 'u1');
    friend('b-sub', '山田', 'u1');
    friend('c-other', '山田');
    grant('h1', 'a-main', 'u1', 10);
    grant('h2', 'b-sub', 'u1', 20);
    grant('h3', 'c-other', null, 30);

    const fromSub = await getMileageAdminHistory(fixture.db, { accountId: 'acc', visibleAccountIds: ['acc'], friendId: 'b-sub', limit: 100 });
    expect(fromSub.items.map((item) => item.id).sort()).toEqual(['h1', 'h2']);
    const other = await getMileageAdminHistory(fixture.db, { accountId: 'acc', visibleAccountIds: ['acc'], friendId: 'c-other', limit: 100 });
    expect(other.items.map((item) => item.id)).toEqual(['h3']);
  });
});
