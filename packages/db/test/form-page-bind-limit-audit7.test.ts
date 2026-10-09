import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { getFormSubmitClaimsBySubmissionIds, getFormVersionContentsByIds } from '../src/forms.js';
import { asD1 } from './d1-test-helper.js';

let raw: Database.Database;
afterEach(() => raw?.close());
it('PKG19 reads every claim and distinct answer-time version on a 200-answer page within the D1 bind boundary', async () => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.pragma('foreign_keys = ON');
  raw.exec("INSERT INTO forms (id, name, is_active) VALUES ('form', 'フォーム', 0)");
  const version = raw.prepare(`INSERT INTO form_versions (id, form_id, version_number, source_content_revision,
    name, fields, save_to_metadata, published_at, created_at) VALUES (?, 'form', ?, ?, ?, '[]', 1, '2026-10-01', '2026-10-01')`);
  const claim = raw.prepare(`INSERT INTO form_submit_claims (line_account_id, form_id, friend_id, idempotency_key,
    request_hash, submission_id, owner, created_at, updated_at, expires_at)
    VALUES ('account', 'form', ?, ?, 'hash', ?, 'owner', '2026-10-01', '2026-10-01', '2026-10-02')`);
  const ids = Array.from({ length: 200 }, (_, i) => `answer-${i}`);
  raw.transaction(() => ids.forEach((id, i) => {
    version.run(id, i + 1, i + 1, `版${i}`);
    claim.run(id, id, id);
  }))();
  const db = asD1(raw);
  const claims = await getFormSubmitClaimsBySubmissionIds(db, [...ids, ids[0], '', 'missing']);
  const versions = await getFormVersionContentsByIds(db, [...ids, ids[0], '', 'missing']);
  expect([...claims.keys()].sort()).toEqual([...ids].sort());
  expect([...versions.keys()].sort()).toEqual([...ids].sort());
  expect(versions.get('answer-199')?.name).toBe('版199');
  expect(await getFormSubmitClaimsBySubmissionIds(db, [])).toEqual(new Map());
  expect(await getFormVersionContentsByIds(db, [])).toEqual(new Map());
});
