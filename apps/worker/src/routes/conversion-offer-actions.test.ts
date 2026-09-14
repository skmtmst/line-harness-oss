/*
 * 成果承認の確定で案件の動作（タグ付与・シナリオ開始）を実行する(N-212)。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物の conversions ルートを当てる。
 * モックは LINE 通知と staff の注入だけ。付与・登録・台帳の経路は本物のまま通す。
 *   - 同一アカウントの正常系でタグ付与とシナリオ開始が走る
 *   - 同じ判断の再送は二重付与・二重開始にならない（完了済み購読も含む）
 *   - 他アカウント・無効な参照は黙って実行せず、失敗として返す
 *   - 片方だけ成功した部分失敗は成功表示せず、再送で未完だけ修復する
 *   - 一括承認でも未完は succeeded に混ぜない
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

const notifyAffiliateApproval = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateApproval }));

const { conversions } = await import('./conversions.js');

let sqlite: SqliteD1;

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: '統括1のオーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};
const otherTenantOwner: AuthenticatedStaff = {
  id: 'owner-2', name: '統括2のオーナー', role: 'owner', readOnly: false, tenantId: 'tenant-2',
};

function app(staff: AuthenticatedStaff, db: D1Database = sqlite.db) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  instance.route('/', conversions);
  return instance;
}

function patch(eventId: string, body: unknown, staff: AuthenticatedStaff = owner, db?: D1Database) {
  return app(staff, db ?? sqlite.db).request(`/api/conversions/events/${eventId}/approval`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function listApprovals(status: 'pending' | 'approved' | 'rejected', staff: AuthenticatedStaff = owner) {
  return app(staff).request(`/api/conversions/approvals?status=${status}`);
}

function bulk(items: unknown, staff: AuthenticatedStaff = owner) {
  return app(staff).request('/api/conversions/approvals/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
}

/**
 * 台帳 (friend_tag_side_effect_runs) の「未完を読む」SELECT だけを落とす DB。
 * 付与の書き込み・工程予約は通し、読み取りだけ失敗させる。
 */
function dbWithFailingLedgerRead(): D1Database {
  const inner = sqlite.db;
  const isUnfinishedRead = (sql: string) =>
    sql.includes('FROM friend_tag_side_effect_runs') && sql.includes("status != 'completed'");
  return {
    prepare(sql: string) {
      if (isUnfinishedRead(sql)) {
        const fail = async (): Promise<never> => {
          throw new Error('台帳の読み取りが落ちた想定');
        };
        return { bind: () => ({ all: fail, first: fail, run: fail, raw: fail }) };
      }
      return inner.prepare(sql);
    },
    batch: (stmts: D1PreparedStatement[]) => inner.batch(stmts),
    exec: (q: string) => inner.exec(q),
    dump: () => inner.dump(),
    withSession: (constraint?: unknown) =>
      typeof inner.withSession === 'function' ? inner.withSession(constraint as never) : (undefined as never),
  } as unknown as D1Database;
}

function count(sql: string, ...binds: unknown[]): number {
  const row = sqlite.raw.prepare(sql).get(...binds as never[]) as { n: number };
  return row.n;
}

const TS = '2026-09-01T00:00:00.000Z';

function seedBase(): void {
  const raw = sqlite.raw;
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')`).run();
  for (const [id, tenant] of [['acc-1', 'tenant-1'], ['acc-2', 'tenant-1'], ['acc-3', 'tenant-2']] as const) {
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
    ).run(id, `channel-${id}`, id, tenant);
  }
  for (const [id, name, role, key, tenant, scope, keys] of [
    ['owner-1', '統括1のオーナー', 'owner', 'key-owner-1', 'tenant-1', 'all', '[]'],
    ['owner-2', '統括2のオーナー', 'owner', 'key-owner-2', 'tenant-2', 'all', '[]'],
  ] as const) {
    raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, name, role, key, tenant, scope, keys);
  }
  raw.prepare(
    `INSERT INTO conversion_points (id, name, event_type, line_account_id) VALUES ('cp-1', '購入', 'purchase', 'acc-1')`,
  ).run();
  insertFriend(raw, 'fr-1', { line_account_id: 'acc-1' });
  raw.prepare(
    `INSERT INTO affiliates (id, name, code, tenant_id, line_account_id) VALUES ('aff-1', '紹介者1', 'CODE1', 'tenant-1', 'acc-1')`,
  ).run();
}

function seedTag(id: string, accountId: string, status = 'active'): void {
  sqlite.raw.prepare(
    `INSERT INTO tags (id, name, line_account_id, status, normalized_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, `タグ-${id}`, accountId, status, `tag-${id}`, TS);
}

/**
 * 公開版つきのシナリオを作る。steps='[]' なら購読は即 completed になる
 * （再送冪等の要となる角ケース）。
 */
function seedScenario(
  id: string,
  accountId: string,
  options: { isActive?: number; published?: boolean; steps?: string } = {},
): void {
  const published = options.published !== false;
  const versionId = published ? `sv-${id}` : null;
  sqlite.raw.prepare(
    `INSERT INTO scenarios (id, name, trigger_type, is_active, delivery_mode, allow_concurrent,
                            created_at, updated_at, line_account_id, current_published_version_id)
     VALUES (?, ?, 'manual', ?, 'relative', 1, ?, ?, ?, ?)`,
  ).run(id, `シナリオ-${id}`, options.isActive ?? 1, TS, TS, accountId, versionId);
  if (published) {
    sqlite.raw.prepare(
      `INSERT INTO scenario_versions
         (id, scenario_id, version_number, delivery_mode, steps_snapshot, actions_snapshot,
          status, published_at, created_at, updated_at)
       VALUES (?, ?, 1, 'relative', ?, '[]', 'published', ?, ?, ?)`,
    ).run(versionId, id, options.steps ?? '[]', TS, TS, TS);
  }
}

function seedOffer(
  id: string,
  accountId: string,
  refs: { tagId?: string | null; scenarioId?: string | null; isActive?: boolean } = {},
): void {
  sqlite.raw.prepare(
    `INSERT INTO affiliate_offers
       (id, name, description, reward_amount, reward_miles, mileage_program_id,
        line_account_id, tag_id, scenario_id, is_active, created_at)
     VALUES (?, ?, NULL, 1000, 0, 'default', ?, ?, ?, ?, ?)`,
  ).run(id, `案件-${id}`, accountId, refs.tagId ?? null, refs.scenarioId ?? null, refs.isActive === false ? 0 : 1, TS);
}

function seedLink(refCode: string, offerId: string | null): void {
  sqlite.raw.prepare(
    `INSERT INTO affiliate_links (id, affiliate_id, ref_code, label, line_account_id, offer_id, is_active, created_at)
     VALUES (?, 'aff-1', ?, ?, 'acc-1', ?, 1, ?)`,
  ).run(`link-${refCode}`, refCode, refCode, offerId, TS);
}

function seedEvent(id: string, refCode: string | null): void {
  sqlite.raw.prepare(
    `INSERT INTO conversion_events (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code, created_at)
     VALUES (?, 'cp-1', 'fr-1', 'aff-1', ?, ?)`,
  ).run(id, refCode, TS);
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = createTestD1();
  seedBase();
});

describe('N-212 承認確定時の案件動作', () => {
  test('正常系: 承認でタグ付与・シナリオ開始が走り、副作用台帳は全工程完了になる', async () => {
    seedTag('tag-a', 'acc-1');
    seedScenario('scn-a', 'acc-1', {
      steps: JSON.stringify([
        { version_step_id: 'sv-a-1', step_order: 0, delay_minutes: 1440, message_type: 'text', message_content: 'こんにちは', is_draft: 0 },
      ]),
    });
    seedOffer('off-1', 'acc-1', { tagId: 'tag-a', scenarioId: 'scn-a' });
    seedLink('REF-OK', 'off-1');
    seedEvent('ev-1', 'REF-OK');

    const res = await patch('ev-1', { status: 'approved', expectedStatus: 'pending' });
    expect(res.status).toBe(200);

    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1' AND tag_id='tag-a'`)).toBe(1);
    const enrollment = sqlite.raw.prepare(
      `SELECT status FROM friend_scenarios WHERE friend_id='fr-1' AND scenario_id='scn-a'`,
    ).get() as { status: string } | undefined;
    expect(enrollment?.status).toBe('active');
    // 台帳の3工程は全部完了。未完が残る形で成功にはしない。
    const runs = sqlite.raw.prepare(
      `SELECT step_key, status FROM friend_tag_side_effect_runs WHERE friend_id='fr-1' AND tag_id='tag-a' ORDER BY step_key`,
    ).all() as { step_key: string; status: string }[];
    expect(runs.map((r) => `${r.step_key}:${r.status}`)).toEqual([
      'event_tag_change:completed',
      'mileage:completed',
      'scenario_enroll:completed',
    ]);
  });

  test('同じ承認の再送は冪等: 完了済み購読でも二重付与・二重開始にならない', async () => {
    seedTag('tag-a', 'acc-1');
    // 通0本のシナリオは購読が即 completed になる。再送で dup 判定をすり抜ける
    // 角ケースなので、これで二重開始を確かめる。
    seedScenario('scn-a', 'acc-1');
    seedOffer('off-1', 'acc-1', { tagId: 'tag-a', scenarioId: 'scn-a' });
    seedLink('REF-OK', 'off-1');
    seedEvent('ev-1', 'REF-OK');

    const first = await patch('ev-1', { status: 'approved', expectedStatus: 'pending' });
    expect(first.status).toBe(200);
    expect(count(`SELECT COUNT(*) AS n FROM friend_scenarios WHERE friend_id='fr-1' AND scenario_id='scn-a'`)).toBe(1);

    // 画面の再送と同じ形（一覧に approved で見えているので expectedStatus=approved）。
    const retry = await patch('ev-1', { status: 'approved', expectedStatus: 'approved' });
    expect(retry.status).toBe(200);
    const body = (await retry.json()) as { data: { alreadySet?: boolean } };
    expect(body.data.alreadySet).toBe(true);

    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1' AND tag_id='tag-a'`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM friend_scenarios WHERE friend_id='fr-1' AND scenario_id='scn-a'`)).toBe(1);
  });

  test('他アカウント・アーカイブ済み・不存在のタグを結んだ古い案件は実行せず、失敗として返す', async () => {
    seedTag('tag-b', 'acc-2');
    seedTag('tag-old', 'acc-1', 'archived');
    // 保存時検査をすり抜けた古い不正参照を直に再現する。
    for (const tagId of ['tag-b', 'tag-old', 'tag-missing']) {
      const eventId = `ev-${tagId}`;
      seedOffer(`off-${tagId}`, 'acc-1', { tagId });
      seedLink(`REF-${tagId}`, `off-${tagId}`);
      seedEvent(eventId, `REF-${tagId}`);

      const res = await patch(eventId, { status: 'approved', expectedStatus: 'pending' });
      // 422 を期待する — fetchApi が本文の文言を運用者へ通すのは
      // {400,409,422,428} だけ。500 だと理由が潰れて画面に届かない。
      expect(res.status).toBe(422);
      const body = (await res.json()) as { success: boolean; code: string; data: { actionFailures: { action: string; refId: string; retryable: boolean }[] } };
      expect(body.success).toBe(false);
      expect(body.code).toBe('offer_actions_incomplete');
      expect(body.data.actionFailures).toEqual([
        { action: 'tag', refId: tagId, reason: expect.any(String), retryable: false },
      ]);

      // タグは付いていない。承認そのものは残る（部分の状態は消さない）。
      expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1' AND tag_id=?`, tagId)).toBe(0);
      const status = sqlite.raw.prepare(`SELECT approval_status FROM conversion_events WHERE id=?`).get(eventId) as { approval_status: string };
      expect(status.approval_status).toBe('approved');
    }

    // 運用者が見る通知センターへ成果×動作ごとに1件残る。再送しても増えない。
    expect(count(`SELECT COUNT(*) AS n FROM notifications WHERE event_type='affiliate_offer_action_failed'`)).toBe(3);
    await patch('ev-tag-b', { status: 'approved', expectedStatus: 'approved' });
    expect(count(`SELECT COUNT(*) AS n FROM notifications WHERE event_type='affiliate_offer_action_failed'`)).toBe(3);
  });

  test('停止中・不存在のシナリオ参照は実行せず失敗を返す', async () => {
    seedScenario('scn-stopped', 'acc-1', { isActive: 0 });
    for (const [eventId, scenarioId] of [['ev-stopped', 'scn-stopped'], ['ev-missing', 'scn-missing']] as const) {
      seedOffer(`off-${eventId}`, 'acc-1', { scenarioId });
      seedLink(`REF-${eventId}`, `off-${eventId}`);
      seedEvent(eventId, `REF-${eventId}`);
      const res = await patch(eventId, { status: 'approved', expectedStatus: 'pending' });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('offer_actions_incomplete');
      expect(count(`SELECT COUNT(*) AS n FROM friend_scenarios WHERE friend_id='fr-1' AND scenario_id=?`, scenarioId)).toBe(0);
    }
  });

  test('タグだけ成功してシナリオが未完なら成功にせず、再送で未完だけ修復する', async () => {
    seedTag('tag-a', 'acc-1');
    seedScenario('scn-nopub', 'acc-1', { published: false });
    seedOffer('off-partial', 'acc-1', { tagId: 'tag-a', scenarioId: 'scn-nopub' });
    seedLink('REF-P', 'off-partial');
    seedEvent('ev-p', 'REF-P');

    const first = await patch('ev-p', { status: 'approved', expectedStatus: 'pending' });
    expect(first.status).toBe(422);
    const body = (await first.json()) as { success: boolean; data: { actionFailures: { action: string; retryable: boolean }[] } };
    expect(body.success).toBe(false);
    expect(body.data.actionFailures).toEqual([
      { action: 'scenario', refId: 'scn-nopub', reason: expect.any(String), retryable: true },
    ]);
    // タグは付いたまま（部分成功の実績は残る）、シナリオは始まっていない。
    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1' AND tag_id='tag-a'`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM friend_scenarios WHERE friend_id='fr-1' AND scenario_id='scn-nopub'`)).toBe(0);

    // 公開版を用意してから同じ承認を送り直す → 未完のシナリオだけ修復される。
    sqlite.raw.prepare(
      `INSERT INTO scenario_versions
         (id, scenario_id, version_number, delivery_mode, steps_snapshot, actions_snapshot,
          status, published_at, created_at, updated_at)
       VALUES ('sv-fix', 'scn-nopub', 1, 'relative', '[]', '[]', 'published', ?, ?, ?)`,
    ).run(TS, TS, TS);
    sqlite.raw.prepare(`UPDATE scenarios SET current_published_version_id='sv-fix' WHERE id='scn-nopub'`).run();

    const retry = await patch('ev-p', { status: 'approved', expectedStatus: 'approved' });
    expect(retry.status).toBe(200);
    expect(count(`SELECT COUNT(*) AS n FROM friend_scenarios WHERE friend_id='fr-1' AND scenario_id='scn-nopub'`)).toBe(1);
    // 修復でタグが二重付与されていない。
    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1' AND tag_id='tag-a'`)).toBe(1);
  });

  test('承認済みで動作未完の行は一覧で offerActionsIncomplete が立ち、修復で下りる', async () => {
    seedTag('tag-a', 'acc-1');
    seedOffer('off-1', 'acc-1', { tagId: 'tag-a', scenarioId: 'scn-missing' });
    seedLink('REF-OK', 'off-1');
    seedEvent('ev-1', 'REF-OK');

    const res = await patch('ev-1', { status: 'approved', expectedStatus: 'pending' });
    expect(res.status).toBe(422);

    const incompleteFlag = async () => {
      const list = await listApprovals('approved');
      expect(list.status).toBe(200);
      const body = (await list.json()) as { data: { eventId: string; offerActionsIncomplete: boolean }[] };
      return body.data.find((row) => row.eventId === 'ev-1')?.offerActionsIncomplete;
    };
    expect(await incompleteFlag()).toBe(true);

    // 案件のシナリオ参照を有効なものに直して承認を再送 → 修復され旗が下りる。
    seedScenario('scn-a', 'acc-1');
    sqlite.raw.prepare(`UPDATE affiliate_offers SET scenario_id='scn-a' WHERE id='off-1'`).run();
    const retry = await patch('ev-1', { status: 'approved', expectedStatus: 'approved' });
    expect(retry.status).toBe(200);
    expect(await incompleteFlag()).toBe(false);
  });

  test('却下では案件の動作を実行しない', async () => {
    seedTag('tag-a', 'acc-1');
    seedScenario('scn-a', 'acc-1');
    seedOffer('off-1', 'acc-1', { tagId: 'tag-a', scenarioId: 'scn-a' });
    seedLink('REF-OK', 'off-1');
    seedEvent('ev-1', 'REF-OK');

    const res = await patch('ev-1', { status: 'rejected', expectedStatus: 'pending' });
    expect(res.status).toBe(200);
    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1'`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM friend_scenarios WHERE friend_id='fr-1'`)).toBe(0);
  });

  test('案件を結んでいない成果は何もせず成功する', async () => {
    seedLink('REF-FREE', null);
    seedEvent('ev-free', 'REF-FREE');
    const res = await patch('ev-free', { status: 'approved', expectedStatus: 'pending' });
    expect(res.status).toBe(200);
    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1'`)).toBe(0);
  });

  test('停止中の案件は承認だけ成功し、タグ付与・シナリオ開始は走らない', async () => {
    seedTag('tag-a', 'acc-1');
    seedScenario('scn-a', 'acc-1');
    seedOffer('off-1', 'acc-1', { tagId: 'tag-a', scenarioId: 'scn-a', isActive: false });
    seedLink('REF-OK', 'off-1');
    seedEvent('ev-1', 'REF-OK');

    const res = await patch('ev-1', { status: 'approved', expectedStatus: 'pending' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { approvalStatus: string } };
    expect(body.success).toBe(true);
    expect(body.data.approvalStatus).toBe('approved');
    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1'`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM friend_scenarios WHERE friend_id='fr-1'`)).toBe(0);

    // 案件を動かし直したあとに承認を再送すると、動作だけがあとから走る。
    sqlite.raw.prepare(`UPDATE affiliate_offers SET is_active = 1 WHERE id = 'off-1'`).run();
    const retry = await patch('ev-1', { status: 'approved', expectedStatus: 'approved' });
    expect(retry.status).toBe(200);
    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1' AND tag_id='tag-a'`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM friend_scenarios WHERE friend_id='fr-1' AND scenario_id='scn-a'`)).toBe(1);
  });

  test('一括承認: 未完の動作は succeeded に混ぜず failed に分ける', async () => {
    seedTag('tag-a', 'acc-1');
    seedOffer('off-ok', 'acc-1', { tagId: 'tag-a' });
    seedOffer('off-bad', 'acc-1', { scenarioId: 'scn-missing' });
    seedLink('REF-OK', 'off-ok');
    seedLink('REF-BAD', 'off-bad');
    seedEvent('ev-ok', 'REF-OK');
    seedEvent('ev-bad', 'REF-BAD');

    const res = await bulk([
      { id: 'ev-ok', status: 'approved', expectedStatus: 'pending' },
      { id: 'ev-bad', status: 'approved', expectedStatus: 'pending' },
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { succeeded: string[]; failed: { id: string }[] } };
    expect(body.data.succeeded).toEqual(['ev-ok']);
    expect(body.data.failed).toEqual([{ id: 'ev-bad', error: expect.any(String) }]);
    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1' AND tag_id='tag-a'`)).toBe(1);
  });

  test('台帳の読み取りが落ちた承認は、承認済みでもHTTP成功にしない', async () => {
    seedTag('tag-a', 'acc-1');
    seedOffer('off-1', 'acc-1', { tagId: 'tag-a' });
    seedLink('REF-OK', 'off-1');
    seedEvent('ev-1', 'REF-OK');

    const res = await patch('ev-1', { status: 'approved', expectedStatus: 'pending' }, owner, dbWithFailingLedgerRead());
    // 読めなかったことを隠して成功にはしない。承認とタグ付与の実績は残る。
    expect(res.status).toBe(500);
    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1' AND tag_id='tag-a'`)).toBe(1);
    const status = sqlite.raw.prepare(`SELECT approval_status FROM conversion_events WHERE id='ev-1'`).get() as { approval_status: string };
    expect(status.approval_status).toBe('approved');

    // 台帳が読める通常経路での再送は、未完を修復して成功に戻る。
    const retry = await patch('ev-1', { status: 'approved', expectedStatus: 'approved' });
    expect(retry.status).toBe(200);
  });

  test('別tenantのオーナーには404で、動作も走らない', async () => {
    seedTag('tag-a', 'acc-1');
    seedOffer('off-1', 'acc-1', { tagId: 'tag-a' });
    seedLink('REF-OK', 'off-1');
    seedEvent('ev-1', 'REF-OK');
    const res = await patch('ev-1', { status: 'approved', expectedStatus: 'pending' }, otherTenantOwner);
    expect(res.status).toBe(404);
    expect(count(`SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id='fr-1'`)).toBe(0);
  });
});
