/**
 * N-198/N-204 (#796):「上限に近い」絞り込みが契約上限への圧迫で動くこと。
 *
 * 実SQLite(bootstrap.sql再生)に実物の getMedia/countMedia を当て、
 * 同じ計算元 getMediaStorageQuota の使用率79%・80%・100%・上限行なし・
 * 別境界で確かめる。固定値(画像8MB等)はもう使わない。
 */
import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { countMedia, getMedia, MEDIA_NEAR_LIMIT_SHARE } from '../src/media.js';
import { getMediaStorageQuota } from '../src/media-uploads.js';
import { asD1 } from './d1-test-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const GB = 1024 * 1024 * 1024;
const DEFAULT_LIMIT = 10 * GB;
const SHARE_BYTES = DEFAULT_LIMIT * MEDIA_NEAR_LIMIT_SHARE;

function insertAccount(sqlite: Database.Database, id: string, tenant: string) {
  sqlite.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)`)
    .run(tenant, tenant);
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'tok', 'sec', ?)`,
  ).run(id, `ch-${id}`, id, tenant);
}

function insertMedia(
  sqlite: Database.Database,
  id: string,
  accountId: string,
  sizeBytes: number,
  kind = 'image',
) {
  sqlite.prepare(
    `INSERT INTO media (id, line_account_id, kind, filename, mime_type, size_bytes, r2_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-14T00:00:00+09:00')`,
  ).run(id, accountId, kind, `${id}.bin`, 'application/octet-stream', sizeBytes, `r2-${id}`);
}

describe('上限に近い絞り込みは契約上限への圧迫で決まる（N-198）', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
    insertAccount(sqlite, 'acc-a', 'ten-1');
  });

  test('契約上限の割合以上を占める行だけ返す（境界つき）', async () => {
    insertMedia(sqlite, 'm-small', 'acc-a', 1_000_000);
    insertMedia(sqlite, 'm-below', 'acc-a', Math.floor(SHARE_BYTES) - 1);
    insertMedia(sqlite, 'm-above', 'acc-a', Math.floor(SHARE_BYTES) + 1);
    insertMedia(sqlite, 'm-big', 'acc-a', 500_000_000, 'video');

    const items = await getMedia(db, { lineAccountId: 'acc-a', nearLimitOnly: true });
    const ids = items.map((m) => m.id).sort();
    expect(ids).toEqual(['m-above', 'm-big']);
    expect(await countMedia(db, { lineAccountId: 'acc-a', nearLimitOnly: true })).toBe(2);
  });

  test('79%・80%・100%で絞り込みは同じ圧迫集合、stateだけ変わる（同じ計算元）', async () => {
    insertMedia(sqlite, 'm-big', 'acc-a', 500_000_000, 'video');
    insertMedia(sqlite, 'm-small', 'acc-a', 1_000_000);
    for (const [tag, usage, state] of [
      ['u79', 0.79, 'normal'],
      ['u80', 0.8, 'notice'],
      ['u100', 1.0, 'full'],
    ] as const) {
      insertAccount(sqlite, `acc-${tag}`, 'ten-1');
      insertMedia(sqlite, `m-big-${tag}`, `acc-${tag}`, 500_000_000, 'video');
      insertMedia(sqlite, `m-small-${tag}`, `acc-${tag}`, 1_000_000);
      insertMedia(sqlite, `m-fill-${tag}`, `acc-${tag}`, Math.floor(DEFAULT_LIMIT * usage) - 500_000_000 - 1_000_000);
      const quota = await getMediaStorageQuota(db, `acc-${tag}`);
      expect(quota.state).toBe(state);
      const ids = (await getMedia(db, { lineAccountId: `acc-${tag}`, nearLimitOnly: true }))
        .map((m) => m.id).sort();
      expect(ids).toEqual([`m-big-${tag}`, `m-fill-${tag}`]);
    }
  });

  test('上限行がない口座は既定10GBで動く', async () => {
    insertMedia(sqlite, 'm-big', 'acc-a', 500_000_000, 'video');
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM media_storage_quotas WHERE line_account_id = 'acc-a'`)
      .get() as { n: number }).toMatchObject({ n: 0 });
    const ids = (await getMedia(db, { lineAccountId: 'acc-a', nearLimitOnly: true })).map((m) => m.id);
    expect(ids).toEqual(['m-big']);
  });

  test('壊れ値と0件は安全に扱う', async () => {
    insertMedia(sqlite, 'm-neg', 'acc-a', -5);
    expect(await getMedia(db, { lineAccountId: 'acc-a', nearLimitOnly: true })).toEqual([]);
    expect(await countMedia(db, { lineAccountId: 'acc-a', nearLimitOnly: true })).toBe(0);
    sqlite.prepare(`DELETE FROM media`).run();
    expect(await getMedia(db, { lineAccountId: 'acc-a', nearLimitOnly: true })).toEqual([]);
  });

  test('別口座の行・使用量を混ぜない', async () => {
    insertAccount(sqlite, 'acc-b', 'ten-2');
    insertMedia(sqlite, 'm-huge-b', 'acc-b', 5 * GB, 'video');
    insertMedia(sqlite, 'm-fill-b', 'acc-b', 9 * GB, 'video');
    insertMedia(sqlite, 'm-small-a', 'acc-a', 1_000_000);

    const idsA = (await getMedia(db, { lineAccountId: 'acc-a', nearLimitOnly: true })).map((m) => m.id);
    expect(idsA).toEqual([]);
    const quotaA = await getMediaStorageQuota(db, 'acc-a');
    expect(quotaA.usageBytes).toBe(1_000_000);
    expect(quotaA.state).toBe('normal');
    const idsB = (await getMedia(db, { lineAccountId: 'acc-b', nearLimitOnly: true }))
      .map((m) => m.id).sort();
    expect(idsB).toEqual(['m-fill-b', 'm-huge-b']);
  });
});
