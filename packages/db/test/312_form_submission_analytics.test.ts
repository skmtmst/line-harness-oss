import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  getFormSubmissionAnalytics,
  getFormSubmissionsPage,
  updateFormSubmissionDestinationWriteResult,
} from '../src/forms.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '312_form_submission_analytics.sql'),
  'utf8',
);

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const statement = (bindings: unknown[]) => ({
        async run() {
          const info = sqlite.prepare(query).run(...bindings);
          return { results: [], success: true, meta: { changes: info.changes } };
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...bindings) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all(...bindings) as T[], success: true, meta: {} };
        },
      });
      return { bind: (...bindings: unknown[]) => statement(bindings), ...statement([]) };
    },
  } as unknown as D1Database;
}

describe('migration 312 form submission analytics', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE friends (
        id TEXT PRIMARY KEY,
        line_account_id TEXT,
        display_name TEXT
      );
      CREATE TABLE form_submissions (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL,
        friend_id TEXT,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE TABLE form_opens (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL,
        friend_id TEXT,
        opened_at TEXT NOT NULL
      );
      INSERT INTO friends VALUES
        ('friend-a1', 'account-a', '山田'),
        ('friend-a2', 'account-a', '佐藤'),
        ('friend-a3', 'account-a', '田中'),
        ('friend-b1', 'account-b', '別店舗');
      INSERT INTO form_submissions VALUES
        ('legacy-a1', 'form-1', 'friend-a1', '{"next_visit":"2026-09-20"}', '2026-09-01'),
        ('legacy-a2', 'form-1', 'friend-a2', '{"next_visit":"2026-09-25"}', '2026-09-02'),
        ('legacy-b1', 'form-1', 'friend-b1', '{"next_visit":"2026-09-30"}', '2026-09-03');
      INSERT INTO form_opens VALUES
        ('open-a1-1', 'form-1', 'friend-a1', '2026-09-01'),
        ('open-a1-2', 'form-1', 'friend-a1', '2026-09-02'),
        ('open-a2', 'form-1', 'friend-a2', '2026-09-02'),
        ('open-a3', 'form-1', 'friend-a3', '2026-09-03'),
        ('open-b1', 'form-1', 'friend-b1', '2026-09-03');
    `);
    sqlite.exec(migration);
    db = asD1(sqlite);
  });

  test('既存回答は推測せずunknownにし、選択アカウントだけを全件集計する', async () => {
    const summary = await getFormSubmissionAnalytics(
      db,
      'form-1',
      'account-a',
      [{ key: 'next_visit', label: '次回来店日' }],
    );

    expect(summary).toEqual({
      startedUnique: 3,
      submitted: 2,
      completionRate: 66.7,
      destinationWrites: {
        pending: 0,
        succeeded: 0,
        partial: 0,
        failed: 0,
        not_requested: 0,
        unknown: 2,
      },
      dateAnsweredUniqueFriends: 2,
      dateFields: [{
        key: 'next_visit',
        label: '次回来店日',
        answered: 2,
        uniqueFriends: 2,
        minDate: '2026-09-20',
        maxDate: '2026-09-25',
      }],
    });
  });

  test('回答一覧も別アカウントを混ぜず、実際の書き込み結果を保存する', async () => {
    expect(await updateFormSubmissionDestinationWriteResult(db, 'legacy-a1', {
      attempted: 2,
      succeeded: 1,
      failed: 1,
    })).toBe('partial');

    const page = await getFormSubmissionsPage(db, 'form-1', {
      page: 1,
      limit: 20,
      lineAccountId: 'account-a',
    });
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.id)).toEqual(['legacy-a2', 'legacy-a1']);
    expect(page.items.find((item) => item.id === 'legacy-a1')).toMatchObject({
      destination_write_status: 'partial',
      destination_write_attempted: 2,
      destination_write_succeeded: 1,
      destination_write_failed: 1,
    });
  });
});
