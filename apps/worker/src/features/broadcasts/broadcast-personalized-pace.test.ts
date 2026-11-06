/*
 * 差し込み配信は multicast が使えず、1人ずつ push する。
 * Workers の subrequest 上限1,000を守りながら、途中で切れても次の cron が保存済みの位置から再開できることを確かめる。
 */
import { describe, expect, it } from 'vitest';
import { createTestD1, insertFriend } from '../../test-utils/d1-sqlite.js';
import { processQueuedBroadcasts } from './broadcast.js';

/** 送った相手を数えるだけの LineClient。 */
function makeLineClient() {
  const pushed: string[] = [];
  const client = {
    async pushMessage(userId: string) {
      pushed.push(userId);
    },
    async pushMessageWithRequestId(userId: string) {
      pushed.push(userId);
      return { requestId: 'req-1' };
    },
  } as unknown as import('@line-crm/line-sdk').LineClient;
  return { client, pushed };
}

function queuePersonalizedBroadcast(
  raw: import('better-sqlite3').Database,
  id: string,
  friendCount: number,
): void {
  for (let i = 0; i < friendCount; i++) {
    insertFriend(raw, `f${String(i).padStart(4, '0')}`);
  }
  raw
    .prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, target_type, segment_conditions, status, batch_offset, track_links, created_at)
       VALUES (?, ?, 'text', ?, 'all', ?, 'sending', 0, 0, ?)`,
    )
    .run(
      id,
      '差し込みのある配信',
      '{{name}} さんへ',
      // cron が拾うのは segment_conditions か account_ids が入っているもの。
      JSON.stringify([{ type: 'is_following', value: true }]),
      '2026-01-01T00:00:00.000',
    );
}

describe('1人ずつ送る配信の進み方', () => {
  it('1回のcronで150人まで進む', async () => {
    const { db, raw } = createTestD1();
    queuePersonalizedBroadcast(raw, 'b1', 400);
    const { client, pushed } = makeLineClient();

    await processQueuedBroadcasts(db, client);

    // 10人ずつ返していた頃はここが 10 だった。cron は5分刻みなので、
    // 400人送り終えるのに 200 分かかっていた計算になる。
    expect(pushed).toHaveLength(150);
    const row = raw.prepare('SELECT batch_offset, status FROM broadcasts WHERE id = ?').get('b1') as {
      batch_offset: number;
      status: string;
    };
    expect(row.batch_offset).toBe(150);
    expect(row.status).toBe('sending');
  });

  it('次のcronは続きから送り、同じ人に二度送らない', async () => {
    const { db, raw } = createTestD1();
    queuePersonalizedBroadcast(raw, 'b1', 400);

    const first = makeLineClient();
    await processQueuedBroadcasts(db, first.client);
    const second = makeLineClient();
    await processQueuedBroadcasts(db, second.client);
    const third = makeLineClient();
    await processQueuedBroadcasts(db, third.client);

    const all = [...first.pushed, ...second.pushed, ...third.pushed];
    expect(all).toHaveLength(400);
    expect(new Set(all).size).toBe(400);
  });

  it('人数が上限より少なければ、その回で送り終える', async () => {
    const { db, raw } = createTestD1();
    queuePersonalizedBroadcast(raw, 'b1', 30);
    const { client, pushed } = makeLineClient();

    await processQueuedBroadcasts(db, client);

    expect(pushed).toHaveLength(30);
    const row = raw.prepare('SELECT status FROM broadcasts WHERE id = ?').get('b1') as { status: string };
    expect(row.status).toBe('sent');
  });
});
