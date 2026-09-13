import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  getWebinarViewSegmentCoverage,
  publishWebinarEditorVersion,
  recordWebinarViewSegment,
  saveWebinarEditorSettings,
} from '../src/webinars.js';
import { asD1 } from './d1-test-helper.js';

describe('329 webinar editor and view segment contract', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE friends (id TEXT PRIMARY KEY);
      CREATE TABLE forms (id TEXT PRIMARY KEY);
      CREATE TABLE webinars (id TEXT PRIMARY KEY);
      INSERT INTO friends VALUES ('friend-1');
      INSERT INTO forms VALUES ('form-1');
      INSERT INTO webinars VALUES ('webinar-1');
    `);
    sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/329_webinar_editor_and_view_segments.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  test('楽観ロックで編集版を進め、公開版のスナップショットを残す', async () => {
    const first = await saveWebinarEditorSettings(db, 'webinar-1', 0, {
      deliveryKind: 'on_demand', registrationFormId: 'form-1',
      viewingCondition: { kind: 'registered', label: '申込済み' },
    });
    const stale = await saveWebinarEditorSettings(db, 'webinar-1', 0, { publicDescription: '競合' });
    const second = await saveWebinarEditorSettings(db, 'webinar-1', 1, { publicDescription: '公開する説明' });
    const published = await publishWebinarEditorVersion(db, 'webinar-1', 2);

    expect(first?.version).toBe(1);
    expect(stale).toBeNull();
    expect(second?.version).toBe(2);
    expect(published).toMatchObject({ version: 2, published_version: 2 });
    expect(sqlite.prepare('SELECT version, state FROM webinar_versions ORDER BY version').all()).toEqual([
      { version: 1, state: 'draft' },
      { version: 2, state: 'published' },
    ]);
  });

  test('同じハートビートは二重計上せず、区間別の人数を返す', async () => {
    await recordWebinarViewSegment(db, 'webinar-1', 'friend-1', 1000, 90);
    await recordWebinarViewSegment(db, 'webinar-1', 'friend-1', 1000, 90);

    expect(await getWebinarViewSegmentCoverage(db, 'webinar-1')).toEqual([
      { start_seconds: 60, end_seconds: 90, viewers: 1 },
    ]);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM webinar_view_segments').get()).toEqual({ count: 1 });
  });
});
