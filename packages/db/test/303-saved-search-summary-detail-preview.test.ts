import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSavedSearch,
  getSavedSearchReferenceUsageCounts,
  getSavedSearchUsageCounts,
  recordSavedSearchUsage,
  updateSavedSearchWithRevision,
  upsertSavedSearchReference,
} from '../src/saved-searches.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('303 保存した検索の集計・詳細・版', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES
        ('account-1', 'channel-1', '本店', 'token-1', 'secret-1'),
        ('account-2', 'channel-2', '支店', 'token-2', 'secret-2');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('作成版を残し、読み込んだ版が一致するときだけ更新する', async () => {
    const search = await createSavedSearch(db, {
      name: 'VIP',
      conditions: { all: [{ kind: 'tag', op: 'includes', value: 'tag-vip' }] },
      createdBy: 'staff-1',
      lineAccountId: 'account-1',
      isShared: false,
    });
    expect(search).toMatchObject({ revision: 1, updated_by: 'staff-1' });

    const updated = await updateSavedSearchWithRevision(
      db,
      search.id,
      { lineAccountId: 'account-1', staffId: 'staff-1', canManageAll: false },
      1,
      { name: 'VIP未契約' },
    );
    expect(updated).toMatchObject({
      status: 'updated',
      search: { name: 'VIP未契約', revision: 2, updated_by: 'staff-1' },
    });
    expect(sqlite.prepare(
      'SELECT COUNT(*) AS total FROM saved_search_revisions WHERE saved_search_id = ?',
    ).get(search.id)).toEqual({ total: 2 });

    const stale = await updateSavedSearchWithRevision(
      db,
      search.id,
      { lineAccountId: 'account-1', staffId: 'staff-1', canManageAll: false },
      1,
      { name: '古い画面の上書き' },
    );
    expect(stale).toMatchObject({
      status: 'conflict',
      current: { name: 'VIP未契約', revision: 2 },
    });
  });

  it('今月の呼び出しを検索単位と使用先単位で数え、別アカウントを混ぜない', async () => {
    const search = await createSavedSearch(db, {
      name: '休眠顧客',
      conditions: { all: [{ kind: 'name', op: 'contains', value: '山田' }] },
      createdBy: 'staff-1',
      lineAccountId: 'account-1',
    });
    await upsertSavedSearchReference(db, {
      savedSearchId: search.id,
      lineAccountId: 'account-1',
      kind: 'broadcast',
      referenceId: 'broadcast-1',
      referenceName: '月末案内',
      mode: 'fixed',
      revision: 1,
    });
    await recordSavedSearchUsage(db, {
      savedSearchId: search.id,
      lineAccountId: 'account-1',
      revision: 1,
      referenceKind: 'broadcast',
      referenceId: 'broadcast-1',
      usedAt: '2026-09-01T10:00:00.000+09:00',
    });
    await recordSavedSearchUsage(db, {
      savedSearchId: search.id,
      lineAccountId: 'account-1',
      revision: 1,
      referenceKind: 'friends',
      usedBy: 'staff-1',
      usedAt: '2026-09-02T10:00:00.000+09:00',
    });
    await recordSavedSearchUsage(db, {
      savedSearchId: search.id,
      lineAccountId: 'account-1',
      revision: 1,
      referenceKind: 'broadcast',
      referenceId: 'broadcast-1',
      usedAt: '2026-08-31T23:59:59.000+09:00',
    });

    const counts = await getSavedSearchUsageCounts(
      db,
      [search.id],
      'account-1',
      '2026-09-07T12:00:00.000+09:00',
    );
    const references = await getSavedSearchReferenceUsageCounts(
      db,
      [search.id],
      'account-1',
      '2026-09-07T12:00:00.000+09:00',
    );
    expect(counts.get(search.id)).toBe(2);
    expect(references.get(`${search.id}:broadcast:broadcast-1`)).toBe(1);
    expect(await getSavedSearchUsageCounts(
      db,
      [search.id],
      'account-2',
      '2026-09-07T12:00:00.000+09:00',
    )).toEqual(new Map());
  });
});
