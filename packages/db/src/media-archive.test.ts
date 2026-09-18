import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveMedia,
  countMedia,
  createMedia,
  getMedia,
  getMediaById,
  restoreMedia,
} from './media.js';

const packageRoot = join(import.meta.dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

function insertAccount(sqlite: Database.Database, id: string): void {
  sqlite.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(id, `channel-${id}`, id);
}

function auditRows(sqlite: Database.Database, mediaId: string) {
  return sqlite.prepare(
    `SELECT action, actor_id, detail_json FROM operation_audit
       WHERE target_kind = 'media' AND target_id = ? ORDER BY rowid`,
  ).all(mediaId) as Array<{ action: string; actor_id: string | null; detail_json: string }>;
}

async function seedMedia(db: D1Database, id: string, accountId = 'account-a') {
  const media = await createMedia(db, {
    kind: 'image',
    lineAccountId: accountId,
    filename: `${id}.png`,
    mimeType: 'image/png',
    sizeBytes: 1024,
    r2Key: `media/${accountId}/${id}.png`,
  });
  return media.id;
}

describe('メディアのアーカイブと復元', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    insertAccount(sqlite, 'account-a');
    insertAccount(sqlite, 'account-b');
    db = asD1(sqlite);
  });

  it('理由付きで退避でき、実行者・時刻・前後状態が監査へ残る', async () => {
    const id = await seedMedia(db, 'm1');

    const result = await archiveMedia(db, {
      id, lineAccountId: 'account-a', actorId: 'staff-1', reason: '古い素材の整理', now: '2026-09-07T01:00:00.000Z',
    });

    expect(result.status).toBe('archived');
    const media = await getMediaById(db, id, 'account-a');
    expect(media).toMatchObject({
      archived_at: '2026-09-07T01:00:00.000Z',
      archived_by: 'staff-1',
      archive_reason: '古い素材の整理',
    });
    expect(auditRows(sqlite, id)).toEqual([{
      action: 'archived',
      actor_id: 'staff-1',
      detail_json: expect.any(String),
    }]);
    expect(JSON.parse(auditRows(sqlite, id)[0].detail_json)).toMatchObject({
      reason: '古い素材の整理',
      before: 'active',
      after: 'archived',
      archived_at: '2026-09-07T01:00:00.000Z',
      line_account_id: 'account-a',
    });
  });

  it('復元すると一覧へ戻り、退避時の状態が監査のbeforeに残る', async () => {
    const id = await seedMedia(db, 'm1');
    await archiveMedia(db, {
      id, lineAccountId: 'account-a', actorId: 'staff-1', reason: '整理', now: '2026-09-07T01:00:00.000Z',
    });

    const result = await restoreMedia(db, {
      id, lineAccountId: 'account-a', actorId: 'staff-2', reason: '再び使うため', now: '2026-09-07T02:00:00.000Z',
    });

    expect(result.status).toBe('restored');
    const media = await getMediaById(db, id, 'account-a');
    expect(media).toMatchObject({ archived_at: null, archived_by: null, archive_reason: null });
    const rows = auditRows(sqlite, id);
    expect(rows.map((r) => r.action)).toEqual(['archived', 'restored']);
    expect(JSON.parse(rows[1].detail_json)).toMatchObject({
      reason: '再び使うため',
      before: 'archived',
      after: 'active',
      archived_at: '2026-09-07T01:00:00.000Z',
      archived_by: 'staff-1',
    });
    expect(rows[1].actor_id).toBe('staff-2');
  });

  it('退避済みは既定の一覧と件数から外れ、明示条件でだけ見える', async () => {
    const archived = await seedMedia(db, 'old');
    await seedMedia(db, 'live');
    await archiveMedia(db, {
      id: archived, lineAccountId: 'account-a', actorId: 'staff-1', reason: '整理',
    });

    const listed = await getMedia(db, { lineAccountId: 'account-a' });
    expect(listed.map((m) => m.filename)).toEqual(['live.png']);
    await expect(countMedia(db, { lineAccountId: 'account-a' })).resolves.toBe(1);

    const onlyArchived = await getMedia(db, { lineAccountId: 'account-a', archived: 'only' });
    expect(onlyArchived.map((m) => m.filename)).toEqual(['old.png']);
    await expect(countMedia(db, { lineAccountId: 'account-a', archived: 'only' })).resolves.toBe(1);

    const all = await getMedia(db, { lineAccountId: 'account-a', archived: 'all' });
    expect(all).toHaveLength(2);
    await expect(countMedia(db, { lineAccountId: 'account-a', archived: 'all' })).resolves.toBe(2);
  });

  it('別アカウントのメディアは退避できず、状態も監査も動かない', async () => {
    const id = await seedMedia(db, 'm1');

    const result = await archiveMedia(db, {
      id, lineAccountId: 'account-b', actorId: 'staff-b', reason: '越境',
    });

    expect(result.status).toBe('not_found');
    const media = await getMediaById(db, id, 'account-a');
    expect(media?.archived_at ?? null).toBeNull();
    expect(auditRows(sqlite, id)).toEqual([]);
  });

  it('二重の退避は2回目をalreadyで引き返し、監査も行も増えない', async () => {
    const id = await seedMedia(db, 'm1');
    await archiveMedia(db, {
      id, lineAccountId: 'account-a', actorId: 'staff-1', reason: '1回目',
    });

    const second = await archiveMedia(db, {
      id, lineAccountId: 'account-a', actorId: 'staff-2', reason: '2回目',
    });

    expect(second.status).toBe('already_archived');
    expect(auditRows(sqlite, id)).toHaveLength(1);
    const media = await getMediaById(db, id, 'account-a');
    expect(media?.archive_reason).toBe('1回目');
  });

  it('使用中の行への二重復元もalreadyで引き返し、履歴は1組だけ残る', async () => {
    const id = await seedMedia(db, 'm1');
    await archiveMedia(db, { id, lineAccountId: 'account-a', actorId: 'staff-1', reason: '退避' });
    await restoreMedia(db, { id, lineAccountId: 'account-a', actorId: 'staff-1', reason: '戻す' });

    const second = await restoreMedia(db, {
      id, lineAccountId: 'account-a', actorId: 'staff-1', reason: 'もう一度戻す',
    });

    expect(second.status).toBe('already_active');
    expect(auditRows(sqlite, id)).toHaveLength(2);
  });

  it('先読みと書き込みの間に別の退避が入っても、二重に監査を積まない', async () => {
    const id = await seedMedia(db, 'm1');
    // 最初のSELECTの直後に別プロセスが退避した状態を再現する。
    let interleaved = false;
    const racing: D1Database = {
      ...db,
      prepare(query: string) {
        const statement = db.prepare(query);
        if (!interleaved && query.startsWith('SELECT * FROM media')) {
          interleaved = true;
          return {
            ...statement,
            bind: (...params: unknown[]) => {
              const bound = statement.bind(...params);
              return {
                ...bound,
                async first<T>() {
                  const row = await bound.first<T>();
                  // 読み返す前に別の操作で退避済みにする。
                  sqlite.prepare(`UPDATE media SET archived_at = '2026-09-07T03:00:00.000Z', archived_by = 'staff-x', archive_reason = '横から退避' WHERE id = ?`).run(id);
                  return row;
                },
              } as D1PreparedStatement;
            },
          } as D1PreparedStatement;
        }
        return statement;
      },
    };

    const result = await archiveMedia(racing, {
      id, lineAccountId: 'account-a', actorId: 'staff-1', reason: '負けた側',
    });

    expect(result.status).toBe('already_archived');
    // 監査行は増えない（この操作では書き込み0）
    expect(auditRows(sqlite, id)).toEqual([]);
    // 勝った側の値はそのまま残る
    const media = await getMediaById(db, id, 'account-a');
    expect(media?.archive_reason).toBe('横から退避');
  });

  it('存在しないメディアへの退避は not_found で、監査行を書かない', async () => {
    const result = await archiveMedia(db, {
      id: 'missing', lineAccountId: 'account-a', actorId: 'staff-1', reason: '退避',
    });

    expect(result.status).toBe('not_found');
    expect(auditRows(sqlite, 'missing')).toEqual([]);
  });

  it('退避しても使用先の参照は残る（消去ではない）', async () => {
    const id = await seedMedia(db, 'm1');
    sqlite.prepare(
      `INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
       VALUES (?, 'template', 'tmpl-1', '2026-09-07T00:00:00.000Z')`,
    ).run(id);

    await archiveMedia(db, {
      id, lineAccountId: 'account-a', actorId: 'staff-1', reason: '使用中でも退避',
    });

    const usage = sqlite.prepare(`SELECT ref_id FROM media_usages WHERE media_id = ?`).get(id);
    expect(usage).toEqual({ ref_id: 'tmpl-1' });
    // 詳細取得や中身の参照は退避後も使える
    const media = await getMediaById(db, id, 'account-a');
    expect(media?.r2_key).toContain('m1.png');
  });
});
