import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';

/*
 * NEN-05 / NEN-06 の実SQL検証。
 *
 * nen-campaign-columns-create.test.ts のモックは「組み立てたSQLの形」しか見ず、
 * 列数と値・bind がずれていても通ってしまった（実際に本番で保存が全部失敗した）。
 * ここでは better-sqlite3 + bootstrap.sql の本物のスキーマへ、本物のルートで
 * POST /api/nen-campaigns/columns を流し、行の中身と配信待ち行列まで確かめる。
 * 外部送信はしない（作成口はLINEを呼ばない）。
 */

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (sql: string, params: unknown[]) => ({
    first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>() => ({ success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {} }),
    run: async <T>() => {
      const info = sqlite.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: info.changes } } as T;
    },
    raw: async () => [],
  });
  return {
    prepare: (sql: string) => {
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        ...wrap(sql, params),
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = [];
      sqlite.exec('BEGIN');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      return results as T;
    },
  } as unknown as D1Database;
}

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const ACCOUNT = 'account-a';

let sqlite: Database.Database;
let db: D1Database;
let nenCampaigns: Awaited<typeof import('./nen-campaigns.js')>['nenCampaigns'];

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'env-owner', name: 'env-owner', role: 'owner', readOnly: false, tenantId: TENANT_ID,
    });
    return next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

function post(body: unknown) {
  const env = { DB: db } as unknown as Env['Bindings'];
  return app().request(`/api/nen-campaigns/columns?lineAccountId=${ACCOUNT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

function columnRows() {
  return sqlite.prepare(`SELECT * FROM nen_columns`).all() as Array<Record<string, unknown>>;
}

function pendingJobCount(): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM nen_delivery_jobs`).get() as { n: number }).n;
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run(ACCOUNT, `channel-${ACCOUNT}`, '本店', TENANT_ID);
  sqlite.prepare(
    `INSERT INTO tags (id, name, line_account_id, created_at)
     VALUES ('tag-a1', 'NEN会員', ?, '2026-01-01T00:00:00.000')`,
  ).run(ACCOUNT);
  db = asD1(sqlite);
  ({ nenCampaigns } = await import('./nen-campaigns.js'));
});

describe('POST /api/nen-campaigns/columns — 実スキーマで下書きが作れる（NEN-05）', () => {
  test('最小入力で下書きが1行でき、配信待ち行列は0件のまま', async () => {
    const res = await post({
      title: '鹿肉の選び方',
      articleUrl: 'https://example.com/columns/venison-guide',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; data: { id: string; queued: number } };
    expect(body.data.queued).toBe(0);

    const rows = columnRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: body.data.id,
      slug: 'venison-guide',
      title: '鹿肉の選び方',
      delivery_status: 'draft',
      delivery_at: null,
      line_account_id: ACCOUNT,
      target_mode: 'all',
    });
    expect(typeof rows[0].intro_text).toBe('string');
    expect(pendingJobCount()).toBe(0);
  });

  test('配信日時・宛先・読了設定つきでも全部の項目がそのまま残り、予約は作らない（NEN-05再訪一致 + NEN-06）', async () => {
    // まず下敷きになるコラムを1本作る。
    const source = await post({
      title: '先に読むコラム', articleUrl: 'https://example.com/columns/source',
    });
    const sourceId = ((await source.json()) as { data: { id: string } }).data.id;

    const res = await post({
      title: '秋の食事コラム',
      category: '食事',
      excerpt: '季節の食事の話',
      articleUrl: 'https://example.com/columns/autumn-meal',
      imageUrl: 'https://cdn.example.com/autumn.jpg',
      publishedAt: '2026-09-01T10:00:00+09:00',
      scheduledAt: '2099-05-01T10:30:00+09:00',
      targetMode: 'tag',
      targetTagId: 'tag-a1',
      completionEventName: '秋の食事コラムを読了',
      completionTagId: 'tag-a1',
      sourceColumnId: sourceId,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string; queued: number } };
    expect(body.data.queued).toBe(0);

    const row = sqlite.prepare(`SELECT * FROM nen_columns WHERE id = ?`).get(body.data.id) as Record<string, unknown>;
    expect(row).toMatchObject({
      slug: 'autumn-meal',
      title: '秋の食事コラム',
      category: '食事',
      excerpt: '季節の食事の話',
      image_url: 'https://cdn.example.com/autumn.jpg',
      published_at: '2026-09-01T01:00:00.000Z',
      delivery_status: 'draft',
      // 配信したい日時は残すが、配信待ち・予約の状態にはしない。
      delivery_at: '2099-05-01T01:30:00.000Z',
      line_account_id: ACCOUNT,
      target_mode: 'tag',
      target_tag_id: 'tag-a1',
      completion_event_name: '秋の食事コラムを読了',
      completion_tag_id: 'tag-a1',
      source_column_id: sourceId,
    });
    expect(pendingJobCount()).toBe(0);
  });

  test('重複するslugは409で、既存の1行のまま増えない', async () => {
    const body = { title: '同じ記事', articleUrl: 'https://example.com/columns/same-slug' };
    const first = await post(body);
    expect(first.status).toBe(201);
    const second = await post(body);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ success: false, error: 'column_already_exists' });
    expect(columnRows()).toHaveLength(1);
  });

  test('無いタグ・無い下敷きへの参照は400で、中途半端な行を残さない', async () => {
    const badTag = await post({
      title: '対象が無い', articleUrl: 'https://example.com/columns/no-tag',
      targetMode: 'tag', targetTagId: 'tag-ghost',
    });
    expect(badTag.status).toBe(400);

    const badSource = await post({
      title: '下敷きが無い', articleUrl: 'https://example.com/columns/no-source',
      sourceColumnId: 'column-ghost',
    });
    expect(badSource.status).toBe(400);

    expect(columnRows()).toHaveLength(0);
    expect(pendingJobCount()).toBe(0);
  });
});
