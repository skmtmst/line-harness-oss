/*
 * 会員ランク（★V6 37-1-A / 37-1-B）の設定API。実D1（bootstrap.sql を流した SQLite）で、
 *  1. 初期値（4ランク・4節目）が最初の GET で入る
 *  2. 保存は owner/admin だけ。検証に落ちると 400 で理由を返し、何も変えない
 *  3. 保存で新しいランクのタグが作られ、ECへ署名付きで送られ、同期状態が synced になる
 *  4. ECが落ちていると failed と理由が残り、再送で synced に戻る
 *  5. 会員一覧は見える範囲だけ、通年の多い順
 * を固定する。外部（EC）へは送らない（fetch を mock）。
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1 } from '../test-utils/d1-sqlite.js';

const tagSide = vi.hoisted(() => ({
  attach: vi.fn(async (_db: D1Database, _friendId: string, _tagId: string) => ({ added: true })),
  detach: vi.fn(async (_db: D1Database, _friendId: string, _tagId: string) => ({ removed: true })),
}));
vi.mock('../services/friend-tag-attach.js', () => ({
  attachTagAndFireSideEffects: tagSide.attach,
  detachTagAndFireSideEffects: tagSide.detach,
}));

const { nenRanks } = await import('./nen-ranks.js');

const ACCOUNT = 'account-nen';
let sql: Database.Database;
let db: D1Database;
let fetchMock: ReturnType<typeof vi.fn>;

function seed(raw: Database.Database): void {
  raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('${ACCOUNT}', 'channel-nen', '然', 'token', 'secret'), ('account-other', 'channel-o', '別', 'token', 'secret');
    INSERT INTO tenants (id, name) VALUES ('tenant-default', '既定') ON CONFLICT DO NOTHING;
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, user_id, created_at, updated_at) VALUES
      ('friend-a', 'U-a', '山田 太郎', '${ACCOUNT}', 1, 'ec-a', '2026-09-01', '2026-09-01'),
      ('friend-b', 'U-b', '鈴木 一郎', '${ACCOUNT}', 1, 'ec-b', '2026-09-01', '2026-09-01'),
      ('friend-c', 'U-c', '別店', 'account-other', 1, 'ec-c', '2026-09-01', '2026-09-01');
    INSERT INTO nen_ec_member_snapshots (friend_id, customer_id, purchase_count, purchase_amount, point_balance, member_rank, synced_at,
      annual_miles_yen, lifetime_miles_yen, member_rank_key, mile_rate_percent, mile_balance) VALUES
      ('friend-a', '10231', 12, 412300, 2840, 'プラチナ', '2026-09-16', 138600, 412300, 'platinum', 3, 2840),
      ('friend-b', '10877', 5, 96800, 1120, 'ゴールド', '2026-09-16', 72400, 96800, NULL, NULL, 1120),
      ('friend-c', '20000', 1, 5000, 0, '会員', '2026-09-16', 5000, 5000, 'regular', 1, 0);
  `);
}

function harness(role: 'owner' | 'admin' | 'staff', env: Record<string, unknown> = {}, staff: Record<string, unknown> = {}) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-a', name: '担当者', role, readOnly: false, permissionKeys: [], accountScope: 'all', ...staff });
    c.env = { DB: db, NEN_EC_BASE_URL: 'https://ec.test', ECCUBE_WEBHOOK_SECRET: 'x'.repeat(40), ...env };
    await next();
  });
  app.route('/', nenRanks);
  return app;
}

async function json(app: Hono<any>, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() as any };
}

beforeEach(() => {
  const created = createTestD1();
  sql = created.raw;
  db = created.db;
  seed(sql);
  fetchMock = vi.fn(async () => new Response('{"success":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  tagSide.attach.mockClear();
  tagSide.detach.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/nen/rank-settings', () => {
  it('初期の4ランク・4節目と、ランクごとの会員数を返す', async () => {
    const { status, body } = await json(harness('staff'), 'GET', `/api/nen/rank-settings?accountId=${ACCOUNT}`);
    expect(status).toBe(200);
    expect(body.data.ranks.map((r: any) => [r.name, r.annualThresholdYen, r.mileRatePercent, r.memberCount])).toEqual([
      ['レギュラー', 0, 1, 0], ['シルバー', 30000, 1.5, 0], ['ゴールド', 60000, 2, 0], ['プラチナ', 120000, 3, 1],
    ]);
    expect(body.data.ranks[0].tagName).toBe('[会員] ランク：レギュラー');
    expect(body.data.milestones.map((m: any) => [m.thresholdYen, m.title, m.reachedCount])).toEqual([
      [300000, 'NEN FAMILY', 1], [600000, 'NEN FAMILY＋', 0], [1000000, 'NEN PARTNER', 0], [2000000, 'NEN PARTNER＋', 0],
    ]);
    expect(body.data.rules.syncStatus).toBe('pending');
    expect(body.data.kpis.members).toBe(2);
  });

  it('accountId が無い・見えないアカウントは弾く', async () => {
    expect((await json(harness('owner'), 'GET', '/api/nen/rank-settings')).status).toBe(400);
  });
});

describe('PUT /api/nen/rank-settings', () => {
  const ranksBody = (ranks: unknown[]) => ({ accountId: ACCOUNT, ranks });

  it('staff は保存できない', async () => {
    const { status } = await json(harness('staff'), 'PUT', '/api/nen/rank-settings', ranksBody([]));
    expect(status).toBe(403);
  });

  it('検証に落ちると 400 で理由を返し、設定は変わらない', async () => {
    await json(harness('owner'), 'GET', `/api/nen/rank-settings?accountId=${ACCOUNT}`);
    const { status, body } = await json(harness('owner'), 'PUT', '/api/nen/rank-settings', ranksBody([
      { name: 'シルバー', annualThresholdYen: 30000, mileRatePercent: 1.5 },
    ]));
    expect(status).toBe(400);
    expect(body.error).toContain('0円');
    expect(sql.prepare(`SELECT COUNT(*) AS c FROM nen_rank_settings WHERE line_account_id = ?`).get(ACCOUNT)).toEqual({ c: 4 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('保存すると新ランクのタグを作り、ECへ署名付きで送り、synced になり、友だちのタグを付け替える', async () => {
    const before = (await json(harness('owner'), 'GET', `/api/nen/rank-settings?accountId=${ACCOUNT}`)).body.data.ranks;
    const byName = Object.fromEntries(before.map((r: any) => [r.name, r]));
    const { status, body } = await json(harness('admin'), 'PUT', '/api/nen/rank-settings', ranksBody([
      { id: byName['レギュラー'].id, name: 'レギュラー', annualThresholdYen: 0, mileRatePercent: 1 },
      { id: byName['シルバー'].id, name: 'シルバー', annualThresholdYen: 40000, mileRatePercent: 1.5 },
      { id: byName['ゴールド'].id, name: 'ゴールド', annualThresholdYen: 60000, mileRatePercent: 2 },
      { id: byName['プラチナ'].id, name: 'プラチナ', annualThresholdYen: 120000, mileRatePercent: 3 },
      { name: 'ダイヤモンド', annualThresholdYen: 300000, mileRatePercent: 5 },
    ]));
    expect(status).toBe(200);
    expect(body.data.sync).toEqual({ status: 'synced', error: null });
    expect(body.data.rules.syncStatus).toBe('synced');
    expect(body.data.rules.version).toBe(2);
    const diamond = body.data.ranks.find((r: any) => r.name === 'ダイヤモンド');
    expect(diamond.tagName).toBe('[会員] ランク：ダイヤモンド');
    expect(sql.prepare(`SELECT name FROM tags WHERE id = ?`).get(diamond.tagId)).toEqual({ name: '[会員] ランク：ダイヤモンド' });

    // ECへの送信：署名ヘッダ付き、版と5ランク。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ec.test/line-harness/rank-settings');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Nen-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers['X-Nen-Timestamp']).toMatch(/^\d+$/);
    const payload = JSON.parse(String(init.body));
    expect(payload.version).toBe(2);
    expect(payload.ranks.map((r: any) => [r.key, r.annual_threshold_yen, r.mile_rate_percent])).toEqual([
      ['regular', 0, 1], ['silver', 40000, 1.5], ['gold', 60000, 2], ['platinum', 120000, 3], ['rank-5', 300000, 5],
    ]);
    expect(payload.lifetime_milestones).toHaveLength(4);

    // 付け替え：見える範囲（然アカウント）の友だちだけ。friend-a はプラチナのタグが付く。
    // （テストDBには migration 080 のタグが無いので、初期4ランクのタグも作り直されている。IDは応答から取る）
    const tagOf = (name: string) => body.data.ranks.find((r: any) => r.name === name).tagId as string;
    const attachedFor = (friendId: string) => tagSide.attach.mock.calls.filter((call) => call[1] === friendId).map((call) => call[2]);
    expect(attachedFor('friend-a')).toContain(tagOf('プラチナ'));
    expect(attachedFor('friend-a')).not.toContain(tagOf('ゴールド'));
    // friend-b はECのランク未着（通年 72,400）→ ゴールド（60,000〜）。
    expect(attachedFor('friend-b')).toContain(tagOf('ゴールド'));
    expect(attachedFor('friend-c')).toEqual([]);
  });

  it('ECが落ちていると failed と理由が残り、再送で synced に戻る', async () => {
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }));
    const before = (await json(harness('owner'), 'GET', `/api/nen/rank-settings?accountId=${ACCOUNT}`)).body.data.ranks;
    const { body } = await json(harness('owner'), 'PUT', '/api/nen/rank-settings', ranksBody(
      before.map((r: any) => ({ id: r.id, name: r.name, annualThresholdYen: r.annualThresholdYen, mileRatePercent: r.mileRatePercent })),
    ));
    expect(body.data.sync.status).toBe('failed');
    expect(body.data.rules.syncStatus).toBe('failed');
    expect(body.data.rules.syncError).toContain('503');

    const resent = await json(harness('owner'), 'POST', '/api/nen/rank-settings/resync', { accountId: ACCOUNT });
    expect(resent.body.data.sync.status).toBe('synced');
    expect(resent.body.data.rules.syncError).toBeNull();
  });

  it('つなぎ先が未設定なら送らずに failed と理由を残す', async () => {
    const app = harness('owner', { NEN_EC_BASE_URL: '', ECCUBE_WEBHOOK_SECRET: '' });
    const before = (await json(app, 'GET', `/api/nen/rank-settings?accountId=${ACCOUNT}`)).body.data.ranks;
    const { body } = await json(app, 'PUT', '/api/nen/rank-settings', ranksBody(
      before.map((r: any) => ({ id: r.id, name: r.name, annualThresholdYen: r.annualThresholdYen, mileRatePercent: r.mileRatePercent })),
    ));
    expect(body.data.sync.status).toBe('failed');
    expect(body.data.sync.error).toContain('未設定');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/nen/rank-settings/:id', () => {
  async function initial() {
    return (await json(harness('owner'), 'GET', `/api/nen/rank-settings?accountId=${ACCOUNT}`)).body.data;
  }
  const deletion = (id: string, body: unknown, role: 'owner' | 'admin' | 'staff' = 'owner') =>
    json(harness(role), 'DELETE', `/api/nen/rank-settings/${id}`, body);

  it('会員とタグを移し替え、外部へ送らず次の同期待ちにする', async () => {
    const data = await initial();
    const source = data.ranks.find((r: any) => r.key === 'platinum');
    const target = data.ranks.find((r: any) => r.key === 'gold');
    sql.pragma('foreign_keys = ON');
    sql.prepare('INSERT INTO friend_tags (friend_id, tag_id) VALUES (?, ?)').run('friend-a', source.tagId);
    const result = await deletion(source.id, { accountId: ACCOUNT, replacementRankId: target.id, expectedVersion: data.rules.version });
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({ id: source.id, replacementRankId: target.id, movedMembers: 1, version: 2, ecSync: 'pending', message: '次の同期で反映' });
    expect(sql.prepare('SELECT member_rank_key, member_rank, mile_rate_percent FROM nen_ec_member_snapshots WHERE friend_id = ?').get('friend-a'))
      .toEqual({ member_rank_key: 'gold', member_rank: 'ゴールド', mile_rate_percent: 2 });
    expect(sql.prepare('SELECT tag_id FROM friend_tags WHERE friend_id = ?').all('friend-a')).toEqual([{ tag_id: target.tagId }]);
    expect(sql.prepare('SELECT sync_status, sync_error FROM nen_rank_rules WHERE line_account_id = ?').get(ACCOUNT)).toEqual({ sync_status: 'pending', sync_error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ECのキーがまだ無い会員も表示中のランクから移し、ブロック中の会員も取り残さない', async () => {
    const data = await initial();
    sql.prepare('UPDATE friends SET is_following = 0 WHERE id = ?').run('friend-b');
    const source = data.ranks.find((r: any) => r.key === 'gold');
    const target = data.ranks.find((r: any) => r.key === 'regular');
    const result = await deletion(source.id, { accountId: ACCOUNT, replacementRankId: target.id, expectedVersion: 1 });
    expect(result.body.data.movedMembers).toBe(1);
    expect(sql.prepare('SELECT member_rank_key FROM nen_ec_member_snapshots WHERE friend_id = ?').get('friend-b')).toEqual({ member_rank_key: 'regular' });
    expect(sql.prepare('SELECT member_rank_key FROM nen_ec_member_snapshots WHERE friend_id = ?').get('friend-c')).toEqual({ member_rank_key: 'regular' });
    expect(sql.prepare('SELECT member_rank_key FROM nen_ec_member_snapshots WHERE friend_id = ?').get('friend-a')).toEqual({ member_rank_key: 'platinum' });
  });

  it('会員がいるなら移す先を必須にし、会員がいないなら省略できる', async () => {
    const data = await initial();
    const platinum = data.ranks.find((r: any) => r.key === 'platinum');
    const silver = data.ranks.find((r: any) => r.key === 'silver');
    expect((await deletion(platinum.id, { accountId: ACCOUNT, expectedVersion: 1 })).status).toBe(400);
    const empty = await deletion(silver.id, { accountId: ACCOUNT, expectedVersion: 1 });
    expect(empty.body.data).toMatchObject({ movedMembers: 0, replacementRankId: null, ecSync: 'pending', version: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('0円のランク、自分・別アカウント・存在しない移し先は拒否する', async () => {
    const data = await initial();
    const source = data.ranks.find((r: any) => r.key === 'platinum');
    const regular = data.ranks.find((r: any) => r.key === 'regular');
    expect((await deletion(regular.id, { accountId: ACCOUNT, expectedVersion: 1 })).status).toBe(409);
    for (const replacementRankId of [source.id, 'missing', '']) {
      expect((await deletion(source.id, { accountId: ACCOUNT, replacementRankId, expectedVersion: 1 })).status).toBe(400);
    }
    const other = (await json(harness('owner'), 'GET', '/api/nen/rank-settings?accountId=account-other')).body.data.ranks[0];
    expect((await deletion(source.id, { accountId: ACCOUNT, replacementRankId: other.id, expectedVersion: 1 })).status).toBe(400);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM nen_rank_settings WHERE line_account_id = ?').get(ACCOUNT)).toEqual({ n: 4 });
  });

  it('版の未指定・型違い・古い版、権限不足、別アカウントの削除は拒否する', async () => {
    const data = await initial();
    const source = data.ranks.find((r: any) => r.key === 'platinum');
    const target = data.ranks.find((r: any) => r.key === 'gold');
    for (const expectedVersion of [undefined, '1', 0, 1.5]) {
      expect((await deletion(source.id, { accountId: ACCOUNT, replacementRankId: target.id, expectedVersion })).status).toBe(400);
    }
    expect((await deletion(source.id, { accountId: ACCOUNT, replacementRankId: target.id, expectedVersion: 2 })).status).toBe(409);
    expect((await deletion(source.id, { accountId: ACCOUNT, replacementRankId: target.id, expectedVersion: 1 }, 'staff')).status).toBe(403);
    await json(harness('owner'), 'GET', '/api/nen/rank-settings?accountId=account-other');
    expect((await deletion(source.id, { accountId: 'account-other', expectedVersion: 1 })).status).toBe(404);
    const restricted = harness('admin', {}, { tenantId: 'tenant-other' });
    expect((await json(restricted, 'DELETE', `/api/nen/rank-settings/${source.id}`, { accountId: ACCOUNT, replacementRankId: target.id, expectedVersion: 1 })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('一括保存から移し替えを省略して削除できない', async () => {
    const data = await initial();
    const result = await json(harness('owner'), 'PUT', '/api/nen/rank-settings', { accountId: ACCOUNT,
      ranks: data.ranks.filter((r: any) => r.key !== 'platinum') });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('削除操作');
    expect(sql.prepare('SELECT COUNT(*) AS n FROM nen_rank_settings WHERE line_account_id = ?').get(ACCOUNT)).toEqual({ n: 4 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('読んだ後に別の担当者が版を変えたら、会員・タグ・ランクを変更しない', async () => {
    const data = await initial();
    const source = data.ranks.find((r: any) => r.key === 'platinum');
    const target = data.ranks.find((r: any) => r.key === 'gold');
    const batch = db.batch.bind(db);
    db.batch = async (statements) => {
      sql.prepare('UPDATE nen_rank_rules SET version = 2 WHERE line_account_id = ?').run(ACCOUNT);
      return batch(statements);
    };
    const result = await deletion(source.id, { accountId: ACCOUNT, replacementRankId: target.id, expectedVersion: 1 });
    expect(result.status).toBe(409);
    expect(sql.prepare('SELECT member_rank_key FROM nen_ec_member_snapshots WHERE friend_id = ?').get('friend-a')).toEqual({ member_rank_key: 'platinum' });
    expect(sql.prepare('SELECT COUNT(*) AS n FROM friend_tags').get()).toEqual({ n: 0 });
    expect(sql.prepare('SELECT COUNT(*) AS n FROM nen_rank_settings WHERE line_account_id = ?').get(ACCOUNT)).toEqual({ n: 4 });
  });

  it('途中の保存に失敗したら会員・タグ・削除・版をすべて戻す', async () => {
    const data = await initial();
    const source = data.ranks.find((r: any) => r.key === 'platinum');
    const target = data.ranks.find((r: any) => r.key === 'gold');
    sql.exec("CREATE TRIGGER reject_rank_move BEFORE UPDATE ON nen_ec_member_snapshots BEGIN SELECT RAISE(ABORT, '試験用の失敗'); END");
    const result = await deletion(source.id, { accountId: ACCOUNT, replacementRankId: target.id, expectedVersion: 1 });
    expect(result.status).toBe(500);
    expect(sql.prepare('SELECT member_rank_key FROM nen_ec_member_snapshots WHERE friend_id = ?').get('friend-a')).toEqual({ member_rank_key: 'platinum' });
    expect(sql.prepare('SELECT COUNT(*) AS n FROM friend_tags').get()).toEqual({ n: 0 });
    expect(sql.prepare('SELECT version, sync_error FROM nen_rank_rules WHERE line_account_id = ?').get(ACCOUNT)).toEqual({ version: 1, sync_error: null });
    expect(sql.prepare('SELECT COUNT(*) AS n FROM nen_rank_settings WHERE line_account_id = ?').get(ACCOUNT)).toEqual({ n: 4 });
  });
});

describe('PUT /api/nen/lifetime-milestones', () => {
  it('節目を保存して ECへ送る。同じ金額は 400', async () => {
    await json(harness('owner'), 'GET', `/api/nen/rank-settings?accountId=${ACCOUNT}`);
    const dup = await json(harness('owner'), 'PUT', '/api/nen/lifetime-milestones', { accountId: ACCOUNT, milestones: [
      { thresholdYen: 300000, title: 'A', notifyOnReach: true }, { thresholdYen: 300000, title: 'B', notifyOnReach: true },
    ] });
    expect(dup.status).toBe(400);
    const ok = await json(harness('owner'), 'PUT', '/api/nen/lifetime-milestones', { accountId: ACCOUNT, milestones: [
      { thresholdYen: 500000, title: 'NEN FAMILY', notifyOnReach: false },
    ] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.milestones.map((m: any) => [m.thresholdYen, m.title, m.notifyOnReach, m.reachedCount])).toEqual([[500000, 'NEN FAMILY', false, 0]]);
    expect(ok.body.data.sync.status).toBe('synced');
  });
});

describe('GET /api/nen/members', () => {
  it('見える範囲の会員を通年の多い順に返し、ECのランク未着は設定から求める', async () => {
    const { status, body } = await json(harness('staff'), 'GET', `/api/nen/members?accountId=${ACCOUNT}`);
    expect(status).toBe(200);
    expect(body.data.total).toBe(2);
    expect(body.data.items.map((i: any) => [i.name, i.rankName, i.mileRatePercent, i.annualMilesYen])).toEqual([
      ['山田 太郎', 'プラチナ', 3, 138600],
      ['鈴木 一郎', 'ゴールド', 2, 72400],
    ]);
    expect(body.data.kpis.byRank).toEqual({ platinum: 1, '': 1 });
    expect(body.data.ranks).toHaveLength(4);
  });

  it('ランクで絞り込める', async () => {
    const { body } = await json(harness('staff'), 'GET', `/api/nen/members?accountId=${ACCOUNT}&rank=platinum`);
    expect(body.data.items.map((i: any) => i.name)).toEqual(['山田 太郎']);
  });
});
