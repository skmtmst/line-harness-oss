import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { submissionPeriodSql } from './form-submission-period.js';

it('SQLite の UTC 既定値と明示時差を同じ日本時間の期間に集計する', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE events (at TEXT NOT NULL);
    INSERT INTO events VALUES ('2026-10-31 14:59:59'), ('2026-10-31 15:00:00'),
      ('2026-11-01T00:00:00+09:00'), ('2026-11-01T15:00:00Z');`);
  const period = submissionPeriodSql('at', { from: '2026-11-01', until: '2026-11-02' });
  const rows = db.prepare(`SELECT at FROM events WHERE 1=1 ${period.sql} ORDER BY at`).all(...period.bindings);
  expect(rows).toEqual([{ at: '2026-10-31 15:00:00' }, { at: '2026-11-01T00:00:00+09:00' }]);
  db.close();
});
