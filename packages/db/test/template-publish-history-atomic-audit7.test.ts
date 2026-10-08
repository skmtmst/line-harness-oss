import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createTemplate, getTemplateById, publishTemplate } from '../src/templates.js';
import { asD1 } from './d1-test-helper.js';

let raw: Database.Database;
afterEach(() => raw?.close());
function setup() {
  raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.pragma('foreign_keys = ON');
  return asD1(raw);
}

describe('PKG21 immutable publish history shares the commit boundary', () => {
  it.each([undefined, 'publish-key'])('rolls back the publication and receipt if history fails (key %s)', async (key) => {
    const db = setup();
    const draft = await createTemplate(db, { name: '挨拶', messageType: 'text', messageContent: '公開本文' });
    raw.exec("CREATE TEMP TRIGGER reject_history BEFORE INSERT ON template_versions BEGIN SELECT RAISE(ABORT, 'history unavailable'); END");
    await expect(publishTemplate(db, draft.id, { idempotencyKey: key, expectedVersion: 0, expectedDraftRevision: 1 })).rejects.toThrow('history unavailable');
    expect(await getTemplateById(db, draft.id)).toMatchObject({ published_version: 0, draft_revision: 1, draft_message_content: '公開本文', published_at: null });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM template_publish_keys').get()).toEqual({ n: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM template_versions').get()).toEqual({ n: 0 });
    raw.exec('DROP TRIGGER reject_history');
    const result = await publishTemplate(db, draft.id, { idempotencyKey: key, expectedVersion: 0, expectedDraftRevision: 1, effectiveFrom: '2026-10-10' });
    expect(result.row.published_version).toBe(1);
    expect(raw.prepare('SELECT version_number, message_content, effective_from FROM template_versions').all()).toEqual([
      { version_number: 1, message_content: '公開本文', effective_from: '2026-10-10' },
    ]);
    if (key) {
      expect((await publishTemplate(db, draft.id, { idempotencyKey: key })).replayed).toBe(true);
      expect(raw.prepare('SELECT COUNT(*) AS n FROM template_versions').get()).toEqual({ n: 1 });
    }
  });
});
