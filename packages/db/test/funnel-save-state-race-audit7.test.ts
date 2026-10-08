import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createFunnelVersion, createVersionedFunnel, setFunnelStatus } from '../src/analytics-funnels.js';
import { asD1 } from './d1-test-helper.js';

let raw: Database.Database;
afterEach(() => raw?.close());
const steps = [
  { stepOrder: 1, label: '追加', kind: 'friend_add', match: {} },
  { stepOrder: 2, label: '購入', kind: 'purchase', match: { status: 'confirmed' } },
];
describe('PKG45 funnel edit versus state change', () => {
  it.each(['stopped', 'archived'] as const)('rejects a version when %s wins before the batch', async (status) => {
    raw = new Database(':memory:');
    raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
    raw.pragma('foreign_keys = ON');
    raw.exec("INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES ('account', 'channel', '店', 'token', 'secret')");
    const db = asD1(raw);
    const created = await createVersionedFunnel(db, { lineAccountId: 'account', name: '元の名前', windowDays: 7, steps, createdAt: '2026-10-01' });
    const funnelId = created.funnelId;
    const raced = { ...db, async batch(statements: D1PreparedStatement[]) {
      await setFunnelStatus(db, { lineAccountId: 'account', funnelId, expectedStatus: 'active', status });
      return db.batch(statements);
    } } as D1Database;
    await expect(createFunnelVersion(raced, { lineAccountId: 'account', funnelId, windowDays: 14,
      steps, name: '負けた名前', expectedVersionNumber: 1, createdAt: '2026-10-08' })).rejects.toThrow('analytics_funnel_not_active');
    expect(raw.prepare('SELECT name, status FROM funnels WHERE id = ?').get(funnelId)).toEqual({ name: '元の名前', status });
    expect(raw.prepare('SELECT version_number FROM analytics_funnel_versions WHERE funnel_id = ?').all(funnelId)).toEqual([{ version_number: 1 }]);
  });
});
