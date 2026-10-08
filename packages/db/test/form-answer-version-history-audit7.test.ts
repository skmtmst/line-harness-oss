import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { getFormSubmissionsByFriend, getFormSubmissionsByFriendCursor } from '../src/forms.js';
import { asD1 } from './d1-test-helper.js';

const opened: Database.Database[] = [];
afterEach(() => opened.splice(0).forEach((raw) => raw.close()));

function setup() {
  const raw = new Database(':memory:');
  opened.push(raw);
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.pragma('foreign_keys = ON');
  raw.exec(`
    INSERT INTO friends (id, line_user_id) VALUES ('friend', 'Ufriend');
    INSERT INTO forms (id, name, fields) VALUES ('form', '回答当時の名前', '[{"label":"回答当時の質問"}]');
    INSERT INTO form_submissions (id, form_id, friend_id, form_version_id, created_at)
      VALUES ('fixed', 'form', 'friend', 'form-version-v1-form', '2026-10-02'),
             ('legacy', 'form', 'friend', NULL, '2026-10-01');
    UPDATE forms SET name = '未公開の名前', fields = '[{"label":"未公開の質問"}]' WHERE id = 'form';
  `);
  return { raw, db: asD1(raw) };
}

describe('PKG17 answer-time labels', () => {
  it('uses the immutable version for initial history and the live form only for a legacy answer', async () => {
    const { db } = setup();
    const rows = await getFormSubmissionsByFriend(db, 'friend');
    expect(rows.map((r) => [r.id, r.form_name, JSON.parse(r.form_fields)])).toEqual([
      ['fixed', '回答当時の名前', [{ label: '回答当時の質問' }]],
      ['legacy', '未公開の名前', [{ label: '未公開の質問' }]],
    ]);
  });

  it('keeps answer-time labels while paging, and does not expose another friend', async () => {
    const { db } = setup();
    const first = await getFormSubmissionsByFriendCursor(db, 'friend', { limit: 1 });
    expect(first.items[0]).toMatchObject({ id: 'fixed', form_name: '回答当時の名前', form_fields: '[{"label":"回答当時の質問"}]' });
    const next = await getFormSubmissionsByFriendCursor(db, 'friend', { limit: 1, cursor: first.nextCursor });
    expect(next.items.map((r) => r.id)).toEqual(['legacy']);
    expect(next.nextCursor).toBeNull();
    expect((await getFormSubmissionsByFriendCursor(db, 'other')).items).toEqual([]);
  });
});
