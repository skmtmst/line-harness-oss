import { describe, expect, it, vi } from 'vitest';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import { processBroadcastSend, processQueuedBroadcasts } from './broadcast.js';
import type { LineClient } from '@line-crm/line-sdk';

function insertBroadcast(
  raw: ReturnType<typeof createTestD1>['raw'],
  id: string,
  targetType: 'all' | 'tag',
  bubbles: unknown[],
  tagId: string | null = null,
) {
  raw.prepare(
    `INSERT INTO broadcasts
      (id, title, message_type, message_content, message_bubbles_json, target_type,
       target_tag_id, status, created_at)
     VALUES (?, '複数通', 'text', 'legacy', ?, ?, ?, 'draft', '2026-01-01T00:00:00.000')`,
  ).run(id, JSON.stringify(bubbles), targetType, tagId);
}

const bubbles = [
  { id: '1', type: 'text', content: { text: '一通目' } },
  {
    id: '2', type: 'image',
    content: { originalContentUrl: 'https://e.test/a.jpg', previewImageUrl: 'https://e.test/p.jpg' },
  },
];

describe('一斉配信の複数吹き出し実送信', () => {
  it('全員配信へ2通を1回のLINEリクエストで渡す', async () => {
    const { db, raw } = createTestD1();
    insertBroadcast(raw, 'broadcast-all-multi', 'all', bubbles);
    const broadcast = vi.fn().mockResolvedValue({ requestId: 'request-1' });
    const client = { broadcast } as unknown as LineClient;
    await processBroadcastSend(db, client, 'broadcast-all-multi');
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0]).toHaveLength(2);
    expect(broadcast.mock.calls[0][0].map((message: { type: string }) => message.type))
      .toEqual(['text', 'image']);
  });

  it('タグ配信は友だち数を1として、送信記録だけを2通ぶん残す', async () => {
    const { db, raw } = createTestD1();
    insertFriend(raw, 'friend-1');
    raw.prepare(`INSERT INTO tags (id, name) VALUES ('tag-1', '対象')`).run();
    raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('friend-1', 'tag-1')`).run();
    insertBroadcast(raw, 'broadcast-tag-multi', 'tag', bubbles, 'tag-1');
    const multicast = vi.fn().mockResolvedValue({});
    const client = { multicast } as unknown as LineClient;
    const result = await processBroadcastSend(db, client, 'broadcast-tag-multi');
    expect(multicast.mock.calls[0][1]).toHaveLength(2);
    expect(result.total_count).toBe(1);
    expect(result.success_count).toBe(1);
    const logs = raw.prepare(
      `SELECT message_type, content FROM messages_log WHERE broadcast_id = ? ORDER BY created_at, rowid`,
    ).all('broadcast-tag-multi') as Array<{ message_type: string; content: string }>;
    expect(logs).toHaveLength(2);
    expect(logs.map((row) => row.message_type)).toEqual(['text', 'image']);
  });

  it('絞り込みキューでも2通を送り、進捗は友だち数で数える', async () => {
    const { db, raw } = createTestD1();
    insertFriend(raw, 'friend-queue');
    raw.prepare(
      `INSERT INTO broadcasts
        (id, title, message_type, message_content, message_bubbles_json, target_type,
         status, batch_offset, segment_conditions, created_at)
       VALUES ('broadcast-queue-multi', '複数通', 'text', 'legacy', ?, 'segment',
         'sending', 0, ?, '2026-01-01T00:00:00.000')`,
    ).run(
      JSON.stringify(bubbles),
      JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] }),
    );
    const multicast = vi.fn().mockResolvedValue({});
    await processQueuedBroadcasts(db, { multicast } as unknown as LineClient);
    expect(multicast.mock.calls[0][1]).toHaveLength(2);
    const progress = raw.prepare(
      `SELECT status, total_count, success_count FROM broadcasts WHERE id = 'broadcast-queue-multi'`,
    ).get() as { status: string; total_count: number; success_count: number };
    expect(progress).toEqual({ status: 'sent', total_count: 1, success_count: 1 });
    const logCount = raw.prepare(
      `SELECT COUNT(*) AS count FROM messages_log WHERE broadcast_id = 'broadcast-queue-multi'`,
    ).get() as { count: number };
    expect(logCount.count).toBe(2);
  });

  it('相手ごとの差し込みがある2通でも、成功人数を2倍にしない', async () => {
    const { db, raw } = createTestD1();
    insertFriend(raw, 'friend-personalized', { display_name: '田中' });
    const personalizedBubbles = [
      { id: '1', type: 'text', content: { text: '{{name}}さんへ' } },
      { id: '2', type: 'text', content: { text: '二通目です' } },
    ];
    raw.prepare(
      `INSERT INTO broadcasts
        (id, title, message_type, message_content, message_bubbles_json, target_type,
         status, batch_offset, segment_conditions, created_at)
       VALUES ('broadcast-personalized-multi', '差し込み', 'text', 'legacy', ?, 'segment',
         'sending', 0, ?, '2026-01-01T00:00:00.000')`,
    ).run(
      JSON.stringify(personalizedBubbles),
      JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] }),
    );
    const pushMessage = vi.fn().mockResolvedValue({});
    await processQueuedBroadcasts(db, { pushMessage } as unknown as LineClient);
    expect(pushMessage.mock.calls[0][1]).toHaveLength(2);
    expect(pushMessage.mock.calls[0][1][0]).toMatchObject({ type: 'text', text: '田中さんへ' });
    const progress = raw.prepare(
      `SELECT status, success_count FROM broadcasts WHERE id = 'broadcast-personalized-multi'`,
    ).get() as { status: string; success_count: number };
    expect(progress).toEqual({ status: 'sent', success_count: 1 });
    const logCount = raw.prepare(
      `SELECT COUNT(*) AS count FROM messages_log WHERE broadcast_id = 'broadcast-personalized-multi'`,
    ).get() as { count: number };
    expect(logCount.count).toBe(2);
  });
});
