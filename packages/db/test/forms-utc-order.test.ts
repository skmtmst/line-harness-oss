import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { getFormSubmissionsPage, getFormSubmissionsByFriendCursor } from '../src/forms/submissions.js';
import { asD1 } from './d1-test-helper.js';

it('時差なし UTC と時差付きの回答を実時刻順に並べ、次のページにも送る', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE forms (id TEXT, name TEXT, fields TEXT);
    CREATE TABLE form_versions (id TEXT, form_id TEXT, name TEXT, fields TEXT);
    CREATE TABLE friends (id TEXT, display_name TEXT, line_account_id TEXT);
    CREATE TABLE form_submissions (id TEXT, form_id TEXT, friend_id TEXT, form_version_id TEXT, is_test INTEGER, data TEXT, created_at TEXT);
    INSERT INTO forms VALUES ('f','フォーム','[]');
    INSERT INTO friends VALUES ('person','友だち','account');
    INSERT INTO form_submissions VALUES
      ('old','f','person',NULL,0,'{}','2026-11-01T10:00:00.000'),
      ('new','f','person',NULL,0,'{}','2026-11-01 02:00:00');`);
  const db = asD1(sqlite);
  const page = await getFormSubmissionsPage(db, 'f', { limit: 2 });
  expect(page.items.map(item => [item.id, item.created_at])).toEqual([['new', '2026-11-01T02:00:00Z'], ['old', '2026-11-01T10:00:00.000+09:00']]);
  const first = await getFormSubmissionsByFriendCursor(db, 'person', { limit: 1 });
  const next = await getFormSubmissionsByFriendCursor(db, 'person', { limit: 1, cursor: first.nextCursor });
  expect(first.items.map(item => item.id)).toEqual(['new']);
  expect(next.items.map(item => item.id)).toEqual(['old']);
  sqlite.close();
});
