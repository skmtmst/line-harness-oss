import type { SqliteD1 } from '../test-utils/d1-sqlite.js';

export function seedNoticeFriend(testDb: SqliteD1, seed: () => void, lineUid: string, following: number, accountId: string): void {
  seed();
  testDb.raw.exec(`INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token)
    VALUES ('account-2', '試験店舗', 'fixture-channel', 'unused', 'unused-token');`);
  testDb.raw.prepare('INSERT INTO friends (id, line_user_id, line_account_id, is_following) VALUES (?, ?, ?, ?)')
    .run('friend-fixture', lineUid, accountId, following);
}
