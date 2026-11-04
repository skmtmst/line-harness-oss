import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { getListStats } from '../src/dashboard.js';
import { getFormById, getForms, getFormsWithStats } from '../src/forms/index.js';
import { asD1 } from './d1-test-helper.js';

it('フォームの月別集計は UTC の記録を日本時間の月に数える', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO forms (id, name, created_at, updated_at) VALUES
        ('form-a', '申込', '2026-08-31 15:00:00', '2026-09-01T00:30:00');
      INSERT INTO form_submissions (id, form_id, created_at) VALUES
        ('previous', 'form-a', '2026-08-31 14:59:59'),
        ('previous-jst', 'form-a', '2026-08-31T23:30:00'),
        ('current', 'form-a', '2026-08-31 15:00:00');
      INSERT INTO form_opens (id, form_id, friend_id, opened_at) VALUES
        ('open', 'form-a', 'friend-a', '2026-08-31 15:00:00');
    `);
    const stats = await getListStats(asD1(sqlite), { allowedAccountIds: [], includeUnassigned: true });
    expect(stats.forms).toMatchObject({ monthlySubmits: 1, prevMonthSubmits: 2, monthlyCompletionRate: 100 });
    const [form] = await getFormsWithStats(asD1(sqlite));
    expect(form).toMatchObject({ monthly_submit_count: 1, monthly_open_count: 1, last_submitted_at: '2026-08-31T15:00:00Z', created_at: '2026-08-31T15:00:00Z', updated_at: '2026-09-01T00:30:00+09:00' });
    expect((await getForms(asD1(sqlite)))[0]).toMatchObject({ created_at: '2026-08-31T15:00:00Z', updated_at: '2026-09-01T00:30:00+09:00' });
    expect(await getFormById(asD1(sqlite), 'form-a')).toMatchObject({ created_at: '2026-08-31T15:00:00Z', updated_at: '2026-09-01T00:30:00+09:00' });
    expect(await getFormById(asD1(sqlite), 'form-a', { published: true })).toMatchObject({ created_at: '2026-08-31T15:00:00Z', updated_at: '2026-09-01T00:30:00+09:00' });
    sqlite.exec("INSERT INTO forms(id,name,created_at,updated_at) VALUES ('earlier','別の申込','2026-08-31T23:30:00','2026-08-31T23:30:00')");
    expect((await getForms(asD1(sqlite))).map(row => row.id)).toEqual(['form-a', 'earlier']);
  } finally {
    sqlite.close();
    vi.useRealTimers();
  }
});
