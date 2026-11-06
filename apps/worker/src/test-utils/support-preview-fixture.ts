import { createTestD1 } from './d1-sqlite.js';

/** 同じ形式の受信を、閲覧できる店と範囲外の店へ分けて保存する。 */
export function createSupportPreviewFixture(type: string, content: string) {
  const fixture = createTestD1();
  fixture.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
    VALUES('visible','visible','本店','token','secret'),('hidden','hidden','別の店','token','secret');`);
  for (const account of ['visible', 'hidden']) {
    fixture.raw.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following) VALUES(?,?,?,?,1)')
      .run(account, 'U-' + account, account === 'visible' ? '受信 花子' : '範囲外 太郎', account);
    fixture.raw.prepare(`INSERT INTO chats(id,friend_id,status,last_message_at,last_customer_message_at,created_at,updated_at)
      VALUES(?,?,'unread',?,?,?,?)`).run('chat-' + account, account, '2026-10-31T23:00:00Z', '2026-10-31T23:00:00Z', '2026-10-31T23:00:00Z', '2026-10-31T23:00:00Z');
    fixture.raw.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,source,created_at)
      VALUES(?,?,'incoming',?,?,'user',?)`).run('message-' + account, account, type, content, '2026-10-31T23:00:00Z');
  }
  return fixture;
}
