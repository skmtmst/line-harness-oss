import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { getListStats } from '../src/dashboard.js';
import { asD1 } from './d1-test-helper.js';

it('フォームの月別集計は UTC の記録を日本時間の月に数える', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO forms (id, name) VALUES ('form-a', '申込');
      INSERT INTO form_submissions (id, form_id, created_at) VALUES
        ('previous', 'form-a', '2026-08-31 14:59:59'),
        ('current', 'form-a', '2026-08-31 15:00:00');
      INSERT INTO form_opens (id, form_id, friend_id, opened_at) VALUES
        ('open', 'form-a', 'friend-a', '2026-08-31 15:00:00');
    `);
    const stats = await getListStats(asD1(sqlite), { allowedAccountIds: [], includeUnassigned: true });
    expect(stats.forms).toMatchObject({ monthlySubmits: 1, prevMonthSubmits: 1, monthlyCompletionRate: 100 });
  } finally {
    sqlite.close();
    vi.useRealTimers();
  }
});
