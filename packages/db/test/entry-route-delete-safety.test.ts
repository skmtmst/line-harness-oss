import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createEntryRoute,
  deleteEntryRoute,
  getEntryRouteById,
} from '../src/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const result = statement.run(...params);
              return { success: true, meta: { changes: result.changes } };
            },
            async first<T>() { return (statement.get(...params) as T) ?? null; },
            async all<T>() { return { results: statement.all(...params) as T[], success: true, meta: {} }; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('流入経路の完全削除安全契約 (N-246 #906)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  it('利用履歴が1件でもあれば経路と履歴をどちらも残す', async () => {
    const route = await createEntryRoute(db, { refCode: 'used-route', name: '利用済み経路' });
    sqlite.prepare(
      `INSERT INTO ref_tracking (id, ref_code, entry_route_id, created_at)
       VALUES ('click-1', 'used-route', ?, '2026-09-16T09:00:00.000+09:00')`,
    ).run(route.id);

    expect(await deleteEntryRoute(db, route.id, route.name)).toBe('in_use');
    expect(await getEntryRouteById(db, route.id)).not.toBeNull();
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ref_tracking WHERE id = 'click-1'`).get())
      .toEqual({ count: 1 });
  });

  it('管理画面が経路を読んだ後に履歴が増えても、DELETE時点で再判定して残す', async () => {
    const route = await createEntryRoute(db, { refCode: 'race-route', name: '競合する経路' });
    const staleConfirmation = (await getEntryRouteById(db, route.id))!.name;
    sqlite.prepare(
      `INSERT INTO ref_tracking (id, ref_code, entry_route_id, created_at)
       VALUES ('race-click', 'race-route', ?, '2026-09-16T09:00:00.000+09:00')`,
    ).run(route.id);

    expect(await deleteEntryRoute(db, route.id, staleConfirmation)).toBe('in_use');
    expect(await getEntryRouteById(db, route.id)).not.toBeNull();
  });

  it('流入履歴を持つ全テーブルを削除条件で覆う', async () => {
    sqlite.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active)
       VALUES ('account-a', 'channel-a', 'A店', 'token', 'secret', 1)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO conversion_points (id, name, event_type) VALUES ('point-1', '購入', 'purchase')`,
    ).run();
    const makeFriend = (id: string) => sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id) VALUES (?, ?, 'account-a')`,
    ).run(id, `line-${id}`);

    const click = await createEntryRoute(db, { refCode: 'history-click', name: 'クリック' });
    sqlite.prepare(`INSERT INTO ref_tracking (id, ref_code, entry_route_id) VALUES ('h-click', ?, ?)`)
      .run(click.ref_code, click.id);

    const friend = await createEntryRoute(db, { refCode: 'history-friend', name: '友だち' });
    sqlite.prepare(`INSERT INTO friends (id, line_user_id, ref_code) VALUES ('friend-direct', 'line-direct', ?)`)
      .run(friend.ref_code);

    const event = await createEntryRoute(db, { refCode: 'history-event', name: '追加イベント' });
    makeFriend('friend-event');
    sqlite.prepare(
      `INSERT INTO friend_add_events
         (id, line_account_id, friend_id, webhook_event_id, friend_kind,
          ref_code, entry_route_id, occurred_at)
       VALUES ('event-1', 'account-a', 'friend-event', 'webhook-1', 'first_time', ?, ?,
               '2026-09-16T09:00:00.000+09:00')`,
    ).run(event.ref_code, event.id);

    const candidate = await createEntryRoute(db, { refCode: 'history-candidate', name: '帰属候補' });
    makeFriend('friend-candidate');
    sqlite.prepare(
      `INSERT INTO friend_add_attribution_candidates
         (id, line_account_id, friend_id, ref_code, entry_route_id, source,
          occurred_at, expires_at)
       VALUES ('candidate-1', 'account-a', 'friend-candidate', ?, ?, 'liff',
               '2026-09-16T09:00:00.000+09:00', '2026-09-16T09:10:00.000+09:00')`,
    ).run(candidate.ref_code, candidate.id);

    const conversion = await createEntryRoute(db, { refCode: 'history-conversion', name: '成果' });
    makeFriend('friend-conversion');
    sqlite.prepare(
      `INSERT INTO conversion_events
         (id, conversion_point_id, friend_id, attributed_ref_code)
       VALUES ('conversion-1', 'point-1', 'friend-conversion', ?)`,
    ).run(conversion.ref_code);

    const suppression = await createEntryRoute(db, { refCode: 'history-stop', name: '停止抑止' });
    sqlite.prepare(
      `INSERT INTO entry_route_stop_suppressions
         (id, line_account_id, line_user_id, ref_code, source, occurred_at, expires_at)
       VALUES ('suppression-1', 'account-a', 'line-stop', ?, 'liff',
               '2026-09-16T09:00:00.000+09:00', '2026-09-16T09:10:00.000+09:00')`,
    ).run(suppression.ref_code);

    for (const route of [click, friend, event, candidate, conversion, suppression]) {
      expect(await deleteEntryRoute(db, route.id, route.name), route.name).toBe('in_use');
      expect(await getEntryRouteById(db, route.id), route.name).not.toBeNull();
    }
  });

  it('未利用でも現在の経路名と1文字でも違えば削除しない', async () => {
    const route = await createEntryRoute(db, { refCode: 'unused-wrong', name: '店頭QR' });

    expect(await deleteEntryRoute(db, route.id, '店頭ＱＲ')).toBe('name_mismatch');
    expect(await getEntryRouteById(db, route.id)).not.toBeNull();
  });

  it('利用履歴0件かつ現在名の完全一致だけを完全削除する', async () => {
    const route = await createEntryRoute(db, { refCode: 'unused-exact', name: '未使用の経路' });

    expect(await deleteEntryRoute(db, route.id, '未使用の経路')).toBe('deleted');
    expect(await getEntryRouteById(db, route.id)).toBeNull();
  });
});
