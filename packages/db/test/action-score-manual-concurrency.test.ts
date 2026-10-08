import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postActionScoreManualAdjustment } from '../src/action-score-rules.js';
import { openSharedD1, type SharedD1 } from './shared-d1-test-helper.js';

describe('manual score atomic delta (PKG31)', () => {
  let dir: string;
  let connections: SharedD1[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'audit7-score-'));
    const first = openSharedD1(join(dir, 'shared.sqlite'));
    first.raw.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    first.raw.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account', 'channel', 'account', 'token', 'secret');
      INSERT INTO friends (id, line_user_id, line_account_id, score) VALUES ('friend', 'U-friend', 'account', 50);`);
    connections = [first, openSharedD1(join(dir, 'shared.sqlite'))];
  });
  afterEach(() => { connections.forEach((c) => c.close()); rmSync(dir, { recursive: true }); });
  const input = (change: number, key: string) => ({
    lineAccountId: 'account', friendId: 'friend', scoreChange: change, reason: 'correction',
    idempotencyKey: key, executedByStaffId: null, executedByStaffName: 'staff',
  });

  it('keeps both deltas and a continuous history across independent connections', async () => {
    const results = await Promise.all([
      postActionScoreManualAdjustment(connections[0].db, input(10, 'first')),
      postActionScoreManualAdjustment(connections[1].db, input(20, 'second')),
    ]);
    expect(results.map((r) => r.appliedChange).sort((a, b) => a - b)).toEqual([10, 20]);
    expect(connections[0].raw.prepare('SELECT score FROM friends').get()).toEqual({ score: 80 });
    const history = connections[0].raw.prepare('SELECT score_before, score_after FROM friend_scores ORDER BY rowid').all();
    expect(history).toEqual([{ score_before: 50, score_after: 60 }, { score_before: 60, score_after: 80 }]);
  });

  it('rejects the delta that would cross the bound after the other delta commits', async () => {
    connections[0].raw.prepare('UPDATE friends SET score = 90').run();
    const results = await Promise.allSettled([
      postActionScoreManualAdjustment(connections[0].db, input(7, 'first')),
      postActionScoreManualAdjustment(connections[1].db, input(8, 'second')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(connections[0].raw.prepare('SELECT score FROM friends').get()).toEqual({ score: 97 });
    expect(connections[0].raw.prepare('SELECT COUNT(*) AS n FROM friend_scores').get()).toEqual({ n: 1 });
  });

  it('replays the same key without applying twice and rejects different contents', async () => {
    const results = await Promise.all([
      postActionScoreManualAdjustment(connections[0].db, input(10, 'same')),
      postActionScoreManualAdjustment(connections[1].db, input(10, 'same')),
    ]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(connections[0].raw.prepare('SELECT score FROM friends').get()).toEqual({ score: 60 });
    expect(connections[0].raw.prepare('SELECT COUNT(*) AS n FROM friend_scores').get()).toEqual({ n: 1 });
    await expect(postActionScoreManualAdjustment(connections[1].db, input(20, 'same')))
      .rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
});
