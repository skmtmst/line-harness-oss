import { afterEach, expect, it, vi } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import { recoverStalledBroadcasts } from '@line-crm/db/src/broadcasts/index.js';
import { computeDedupBroadcastPreview } from '../../services/dedup-broadcast.js';
import { processQueuedBroadcasts } from './broadcast.js';

const wire = vi.hoisted(() => ({ recipients: [] as string[] }));
vi.mock('@line-crm/line-sdk', async original => ({
  ...await original<Record<string, unknown>>(),
  LineClient: class {
    async multicast(ids: string[]) {
      wire.recipients.push(...ids);
      return { requestId: 'synthetic-accepted' };
    }
  },
}));

const opened: ReturnType<typeof createTestD1>[] = [];
const fallback = {} as import('@line-crm/line-sdk').LineClient;
afterEach(() => { opened.splice(0).forEach(f => f.raw.close()); wire.recipients = []; });

function fixture(targetType: 'segment' | 'multi-account-dedup', friendIds = ['f']) {
  const f = createTestD1({ foreignKeys: true }); opened.push(f);
  f.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret)
    VALUES('a','合成店舗','10001','synthetic','synthetic')`);
  const add = f.raw.prepare(`INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES(?,?,'a',1)`);
  for (const id of friendIds) add.run(id, `U-${id}`);
  f.raw.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,
    batch_offset,track_links,line_account_id,account_ids,dedup_priority,segment_conditions)
    VALUES('b','合成','text','合成配信',?,'sending',0,0,'a',?,?,?)`)
    .run(targetType, targetType === 'multi-account-dedup' ? '["a"]' : null,
      targetType === 'multi-account-dedup' ? '["a"]' : null,
      targetType === 'segment' ? JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] }) : null);
  return f;
}

it.each(['segment', 'multi-account-dedup'] as const)('%s: 受理後の保存失敗から25時間後に復旧しても送達不明を再送しない', async targetType => {
  const f = fixture(targetType, ['f0', 'f1']);
  // Fail the real atomic settlement after the mocked provider accepts the send.
  f.raw.exec(`CREATE TRIGGER lose_settlement BEFORE UPDATE OF success_count ON broadcasts
    WHEN NEW.success_count>OLD.success_count BEGIN SELECT RAISE(ABORT,'synthetic settlement outage'); END;
    CREATE TRIGGER lose_claim_completion BEFORE UPDATE OF state ON broadcast_send_claims
    WHEN NEW.state='sent' BEGIN SELECT RAISE(ABORT,'synthetic settlement outage'); END`);
  const first = await processQueuedBroadcasts(f.db, fallback, undefined, { accountId: 'a' });
  expect(first.acceptedRecipients).toBe(2);
  expect(wire.recipients).toEqual(['U-f0', 'U-f1']);
  const interrupted = f.raw.prepare("SELECT state,dispatched_at FROM broadcast_send_claims WHERE broadcast_id='b'").get() as { state: string; dispatched_at: string | null };
  expect(interrupted.state).toBe('claimed');
  expect(interrupted.dispatched_at).not.toBeNull();
  expect(f.raw.prepare("SELECT status,batch_offset,success_count FROM broadcasts WHERE id='b'").get())
    .toEqual({ status: 'sending', batch_offset: -1, success_count: 0 });
  f.raw.exec(`DROP TRIGGER lose_settlement; DROP TRIGGER lose_claim_completion;
    UPDATE broadcasts SET batch_lock_at=strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours','-25 hours') WHERE id='b';
    UPDATE broadcast_send_claims SET dispatched_at=strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours','-25 hours') WHERE broadcast_id='b';`);
  await recoverStalledBroadcasts(f.db);
  // A different recipient budget would form a different provider retry key if resent.
  const recovered = await processQueuedBroadcasts(f.db, fallback, undefined, { accountId: 'a', maxRecipients: 1 });
  expect(recovered.acceptedRecipients).toBe(0);
  expect(recovered.lineRequests).toBe(0);
  expect(wire.recipients).toEqual(['U-f0', 'U-f1']);
  expect(f.raw.prepare("SELECT state,error_code FROM broadcast_send_claims WHERE broadcast_id='b'").all())
    .toEqual(Array(2).fill({ state: 'unknown', error_code: 'interrupted_dispatch' }));
});

it('dedup: sent/unknownを保持し、外部へ出していないclaimだけを送る', async () => {
  const f = fixture('multi-account-dedup', ['sent', 'unknown', 'pending']);
  const audience = await computeDedupBroadcastPreview(f.db, ['a'], ['a']);
  const sentIdentity = audience.perAccount[0].recipients.find(r => r.friendId === 'sent')!.identKey;
  f.raw.prepare("UPDATE broadcasts SET dedup_progress=?,success_count=1,batch_offset=-1,batch_lock_at=strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours','-25 hours') WHERE id='b'")
    .run(JSON.stringify({ audience, sentIdentKeys: [sentIdentity] }));
  f.raw.exec(`INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,state,dispatched_at)
    VALUES('b','sent','a','sent','2026-01-01'),('b','unknown','a','unknown','2026-01-01'),('b','pending','a','claimed',NULL)`);
  await recoverStalledBroadcasts(f.db);
  const result = await processQueuedBroadcasts(f.db, fallback, undefined, { accountId: 'a' });
  expect(result.acceptedRecipients).toBe(1);
  expect(wire.recipients).toEqual(['U-pending']);
  expect(f.raw.prepare("SELECT friend_id,state FROM broadcast_send_claims WHERE broadcast_id='b' ORDER BY friend_id").all())
    .toEqual([{ friend_id: 'pending', state: 'sent' }, { friend_id: 'sent', state: 'sent' }, { friend_id: 'unknown', state: 'unknown' }]);
});
