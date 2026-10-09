import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { getTemplateSendCounts, getTemplatesWithUsageCount } from '../src/templates.js';
import { asD1 } from './d1-test-helper.js';

let raw: Database.Database;
afterEach(() => raw?.close());
it('PKG22 ranks every visible candidate before paging with fixed bind count', async () => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.pragma('foreign_keys = ON');
  raw.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account', 'channel', '本店', 'token', 'secret'), ('other', 'channel-other', '別店', 'token', 'secret');
    INSERT INTO friends (id, line_user_id) VALUES ('friend', 'Ufriend');`);
  const add = raw.prepare("INSERT INTO templates (id, name, message_type, message_content, line_account_id, published_at) VALUES (?, ?, 'text', '本文', ?, '2026-10-01')");
  const ids = Array.from({ length: 220 }, (_, i) => `template-${String(i).padStart(3, '0')}`);
  raw.transaction(() => ids.forEach((id) => add.run(id, id, 'account')))();
  add.run('hidden', 'hidden', 'other');
  const log = raw.prepare(`INSERT INTO messages_log (id, friend_id, direction, message_type, content,
    template_id_at_send, delivery_type) VALUES (?, 'friend', ?, 'text', '本文', ?, ?)`);
  for (let i = 0; i < 3; i++) log.run(`sent-${i}`, 'outgoing', ids[219], 'push');
  log.run('test', 'outgoing', ids[0], 'test');
  log.run('incoming', 'incoming', ids[0], 'reply');
  const db = asD1(raw);
  const counts = await getTemplateSendCounts(db, ids);
  expect(counts.get(ids[219])).toEqual({ thisMonth: 3, total: 3 });
  expect(counts.has(ids[0])).toBe(false);
  const scope = { accountIds: ['account'], includeUnassigned: false };
  const first = await getTemplatesWithUsageCount(db, undefined, scope, { limit: 20, offset: 0 }, { quick: 'frequent' });
  expect(first.total).toBe(220);
  expect(first.items[0]?.id).toBe(ids[219]);
  const large = await getTemplatesWithUsageCount(db, undefined, scope, { limit: 200, offset: 0 }, { quick: 'frequent' });
  const tail = await getTemplatesWithUsageCount(db, undefined, scope, { limit: 20, offset: 200 }, { quick: 'frequent' });
  expect(new Set([...large.items, ...tail.items].map((row) => row.id)).size).toBe(220);
  expect([...large.items, ...tail.items].some((row) => row.id === 'hidden')).toBe(false);
});
