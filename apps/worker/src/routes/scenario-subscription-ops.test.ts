/*
 * 友だち単位の購読操作（#949 N-054 / 機能05）。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物のルートを当てる。
 *   - 止める・再開・失敗を再送・別のシナリオへ移す
 *   - Idempotency-Key が要る。同じキーの再送は同じ結果、別の操作への
 *     使い回しは 409
 *   - scenario.subscription.edit / scenario.step_run.retry の権限キーと
 *     アカウント範囲（他アカウントの購読は 404 で隠す）
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { authMiddleware } from '../middleware/auth.js';

const { scenarios } = await import('./scenarios.js');

let sqlite: SqliteD1;

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};
const subEditStaff: AuthenticatedStaff = {
  id: 'staff-sub', name: '購読を触れる', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: ['/scenarios', 'scenario.subscription.edit'],
};
const retryStaff: AuthenticatedStaff = {
  id: 'staff-retry', name: '再送だけ', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: ['/scenarios', 'scenario.step_run.retry'],
};
const noKeyStaff: AuthenticatedStaff = {
  id: 'staff-none', name: '権限なし', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: [],
};
/** acc-1 しか見えない購読操作staff。acc-2 の購読を触ろうとすると 404。 */
const scopedSubStaff: AuthenticatedStaff = {
  id: 'staff-scoped-sub', name: '店1だけ購読を触れる', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: ['/scenarios', 'scenario.subscription.edit', 'scenario.step_run.retry'],
};

function app(staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: sqlite.db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  instance.route('/', scenarios);
  return instance;
}

let keySeq = 0;
function key() {
  return `op-${++keySeq}-aaaa-bbbb`;
}

function post(subscriptionId: string, op: string, staff: AuthenticatedStaff = owner, body?: unknown, idemKey: string | null = key()) {
  return app(staff).request(`/api/scenario-subscriptions/${subscriptionId}/${op}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idemKey ? { 'Idempotency-Key': idemKey } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

function sub(id: string) {
  return sqlite.raw.prepare(`SELECT * FROM friend_scenarios WHERE id = ?`).get(id) as
    | { status: string; pause_reason: string | null; next_delivery_at: string | null; scenario_id: string }
    | undefined;
}

function seed(): void {
  const raw = sqlite.raw;
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  for (const id of ['acc-1', 'acc-2']) {
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, 'tenant-1')`,
    ).run(id, `channel-${id}`, id);
  }
  const staffRows = [
    ['owner-1', 'オーナー', 'owner', 'key-owner', 'all', '[]'],
    ['staff-sub', '購読を触れる', 'staff', 'key-sub', 'all', '["/scenarios","scenario.subscription.edit"]'],
    ['staff-retry', '再送だけ', 'staff', 'key-retry', 'all', '["/scenarios","scenario.step_run.retry"]'],
    ['staff-none', '権限なし', 'staff', 'key-none', 'all', '[]'],
    ['staff-scoped-sub', '店1だけ', 'staff', 'key-scoped-sub', 'accounts', '["/scenarios","scenario.subscription.edit","scenario.step_run.retry"]'],
  ] as const;
  for (const [id, name, role, apiKey, scope, keys] of staffRows) {
    raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
       VALUES (?, ?, ?, ?, 'tenant-1', ?, ?)`,
    ).run(id, name, role, apiKey, scope, keys);
  }
  raw.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('staff-scoped-sub', 'acc-1', '2026-09-01T00:00:00.000Z')`,
  ).run();

  // シナリオと公開版（再開・移し先は固定版の通を読む）。
  const stepsSnapshot = JSON.stringify([
    { version_step_id: 'vs-1', step_order: 0, delay_minutes: 0, message_type: 'text', message_content: '1通目' },
    { version_step_id: 'vs-2', step_order: 1, delay_minutes: 60, message_type: 'text', message_content: '2通目' },
  ]);
  for (const [id, accountId, active] of [
    ['sc-1', 'acc-1', 1],
    ['sc-move', 'acc-1', 1],
    ['sc-stopped', 'acc-1', 0],
    ['sc-2', 'acc-2', 1],
  ] as const) {
    raw.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, line_account_id, is_active, allow_concurrent)
       VALUES (?, ?, 'manual', ?, ?, 1)`,
    ).run(id, `筋書き${id}`, accountId, active);
    raw.prepare(
      `INSERT INTO scenario_versions
         (id, scenario_id, version_number, steps_snapshot, status, published_at, created_at, updated_at)
       VALUES (?, ?, 1, ?, 'published', '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000')`,
    ).run(`v-${id}`, id, stepsSnapshot);
    raw.prepare(
      `UPDATE scenarios SET current_published_version_id = ? WHERE id = ?`,
    ).run(`v-${id}`, id);
  }

  // 友だちと購読。同一(friend, scenario)の未完了購読は1本までなので、
  // 状態ごとに別の友だちを立てる。
  for (const [friendId, accountId] of [
    ['f-active', 'acc-1'],
    ['f-paused', 'acc-1'],
    ['f-failed', 'acc-1'],
    ['f-completed', 'acc-1'],
    ['f-move', 'acc-1'],
    ['f-delivering', 'acc-1'],
    ['f-acc2', 'acc-2'],
  ] as const) {
    insertFriend(raw, friendId, { line_account_id: accountId });
  }
  const subs: Array<[string, string, string, string, string | null, number]> = [
    // id, friend, scenario, status, pause_reason, current_step_order
    ['sub-active', 'f-active', 'sc-1', 'active', null, 0],
    ['sub-paused', 'f-paused', 'sc-1', 'paused', 'manual', 0],
    ['sub-failed', 'f-failed', 'sc-1', 'paused', 'delivery_failed', 0],
    ['sub-completed', 'f-completed', 'sc-1', 'completed', null, 1],
    ['sub-move', 'f-move', 'sc-1', 'active', null, 0],
    ['sub-delivering', 'f-delivering', 'sc-1', 'delivering', null, 0],
    ['sub-acc2', 'f-acc2', 'sc-2', 'active', null, 0],
  ];
  for (const [subId, friendId, scenarioId, status, pauseReason, stepOrder] of subs) {
    raw.prepare(
      `INSERT INTO friend_scenarios
         (id, friend_id, scenario_id, current_step_order, status, pause_reason,
          started_at, next_delivery_at, published_version_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '2026-09-01T00:00:00.000', '2026-09-10T00:00:00.000', ?, '2026-09-01T00:00:00.000')`,
    ).run(subId, friendId, scenarioId, stepOrder, status, pauseReason, `v-${scenarioId}`);
  }
}

beforeEach(() => {
  sqlite = createTestD1();
  seed();
});

describe('友だち単位の購読操作（#949 N-054）', () => {
  test('進行中の購読を止めると paused + manual になり、予定が消える', async () => {
    const res = await post('sub-active', 'pause');
    expect(res.status).toBe(200);
    const row = sub('sub-active')!;
    expect(row.status).toBe('paused');
    expect(row.pause_reason).toBe('manual');
    expect(row.next_delivery_at).toBeNull();
  });

  test('同じ確認キーの再送は同じ結果を返し、別の操作への使い回しは409', async () => {
    const shared = key();
    const first = await post('sub-active', 'pause', owner, {}, shared);
    expect(first.status).toBe(200);
    const again = await post('sub-active', 'pause', owner, {}, shared);
    expect(again.status).toBe(200);
    expect(sub('sub-active')!.status).toBe('paused');

    const reused = await post('sub-paused', 'resume', owner, {}, shared);
    expect(reused.status).toBe(409);
    const reusedOp = await post('sub-active', 'resume', owner, {}, shared);
    expect(reusedOp.status).toBe(409);
  });

  test('確認キーが無いと400', async () => {
    const res = await post('sub-active', 'pause', owner, {}, null);
    expect(res.status).toBe(400);
  });

  test('止まっている購読を再開すると active に戻り予定が立つ', async () => {
    const res = await post('sub-paused', 'resume');
    expect(res.status).toBe(200);
    const row = sub('sub-paused')!;
    expect(row.status).toBe('active');
    expect(row.pause_reason).toBeNull();
    expect(row.next_delivery_at).not.toBeNull();
  });

  test('終わった購読は止められず再開もできない（409）', async () => {
    expect((await post('sub-completed', 'pause')).status).toBe(409);
    expect((await post('sub-completed', 'resume')).status).toBe(409);
    expect(sub('sub-completed')!.status).toBe('completed');
  });

  test('配信失敗で止まった購読だけ「失敗を再送」できる', async () => {
    // 手動停止は再送できない
    expect((await post('sub-paused', 'retry', retryStaff)).status).toBe(409);

    const res = await post('sub-failed', 'retry', retryStaff);
    expect(res.status).toBe(200);
    const row = sub('sub-failed')!;
    expect(row.status).toBe('active');
    expect(row.pause_reason).toBeNull();
    expect(row.next_delivery_at).not.toBeNull();
  });

  test('権限キーごとに操作が分かれる（subscription.edit と step_run.retry）', async () => {
    // subscription.edit を持つstaffは止められるが再送はできない
    expect((await post('sub-active', 'pause', subEditStaff)).status).toBe(200);
    expect((await post('sub-failed', 'retry', subEditStaff)).status).toBe(403);
    // step_run.retry を持つstaffは再送できるが停止・再開はできない
    expect((await post('sub-failed', 'retry', retryStaff)).status).toBe(200);
    expect((await post('sub-move', 'pause', retryStaff)).status).toBe(403);
    // キー無しは全部403
    expect((await post('sub-paused', 'resume', noKeyStaff)).status).toBe(403);
    expect((await post('sub-failed', 'retry', noKeyStaff)).status).toBe(403);
  });

  test('担当外アカウントの購読は404で存在を隠す', async () => {
    expect((await post('sub-acc2', 'pause', scopedSubStaff)).status).toBe(404);
    expect(sub('sub-acc2')!.status).toBe('active');
  });

  test('別のシナリオへ移すと元が完了し、移し先の新しい購読が始まる', async () => {
    const res = await post('sub-move', 'move', subEditStaff, { targetScenarioId: 'sc-move' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { scenarioId: string; status: string } };
    expect(body.data.scenarioId).toBe('sc-move');
    expect(body.data.status).toBe('active');
    expect(sub('sub-move')!.status).toBe('completed');
  });

  test('移し先が無い・停止中・別アカウント・同じシナリオは断る', async () => {
    expect((await post('sub-move', 'move', owner, {})).status).toBe(400);
    expect((await post('sub-move', 'move', owner, { targetScenarioId: 'nope' })).status).toBe(404);
    expect((await post('sub-move', 'move', owner, { targetScenarioId: 'sc-stopped' })).status).toBe(422);
    expect((await post('sub-move', 'move', owner, { targetScenarioId: 'sc-2' })).status).toBe(422);
    expect((await post('sub-move', 'move', owner, { targetScenarioId: 'sc-1' })).status).toBe(409);
    expect(sub('sub-move')!.status).toBe('active');
  });

  test('move も確認キーで再送されると同じ結果を返す', async () => {
    const shared = key();
    const first = await post('sub-move', 'move', owner, { targetScenarioId: 'sc-move' }, shared);
    expect(first.status).toBe(200);
    const again = await post('sub-move', 'move', owner, { targetScenarioId: 'sc-move' }, shared);
    expect(again.status).toBe(200);
    // 移し先への購読は1本だけ（未完了の重複が増えない）
    const count = sqlite.raw.prepare(
      `SELECT COUNT(*) AS n FROM friend_scenarios
        WHERE friend_id = 'f-move' AND scenario_id = 'sc-move' AND status != 'completed'`,
    ).get() as { n: number };
    expect(count.n).toBe(1);
  });

  test('move は同じキーでも移し先が違えば409（古い成功応答を再生しない）', async () => {
    const shared = key();
    const first = await post('sub-move', 'move', owner, { targetScenarioId: 'sc-move' }, shared);
    expect(first.status).toBe(200);
    // 同じ購読・同じ操作・同じキーでも、本体（移し先）が違えば使い回し。
    // 直す前は台帳が購読+操作だけを照合していたため、保存済みの 200 が返った。
    const different = await post('sub-move', 'move', owner, { targetScenarioId: 'sc-2' }, shared);
    expect(different.status).toBe(409);
    // 同じ本体の再送は従来どおり保存済みの結果を返す
    const same = await post('sub-move', 'move', owner, { targetScenarioId: 'sc-move' }, shared);
    expect(same.status).toBe(200);
  });

  test('一時的な409は台帳へ残らず、同じキーでも新しいキーでもやり直せる', async () => {
    const shared = key();
    // 配信中の購読は止められない（一時的409）
    const busy = await post('sub-delivering', 'pause', owner, {}, shared);
    expect(busy.status).toBe(409);
    // 失敗は pin されないので予約も残らない
    const ledger = sqlite.raw.prepare(
      `SELECT COUNT(*) AS n FROM friend_scenario_op_keys WHERE op_idempotency_key = ?`,
    ).get(shared) as { n: number };
    expect(ledger.n).toBe(0);
    // 配信が済んで active へ戻ったあと、同じキーでやり直せる
    // （直す前は 409 が pin され、Web がキーを回さないため永遠に止められなかった）
    sqlite.raw.prepare(
      `UPDATE friend_scenarios SET status = 'active' WHERE id = 'sub-delivering'`,
    ).run();
    const retried = await post('sub-delivering', 'pause', owner, {}, shared);
    expect(retried.status).toBe(200);
    expect(sub('sub-delivering')!.status).toBe('paused');
  });

  test('失敗した操作は予約が外れるので、同じキーで本体を直してやり直せる', async () => {
    const shared = key();
    // 移し先が無い 404 は失敗なので台帳へ残らない
    expect(
      (await post('sub-move', 'move', owner, { targetScenarioId: 'nope' }, shared)).status,
    ).toBe(404);
    // 同じキーで正しい移し先へ送り直せる（成功すれば新たに pin される）
    const redo = await post('sub-move', 'move', owner, { targetScenarioId: 'sc-move' }, shared);
    expect(redo.status).toBe(200);
    const again = await post('sub-move', 'move', owner, { targetScenarioId: 'sc-move' }, shared);
    expect(again.status).toBe(200);
  });
});

describe('友だち単位の購読操作の認証経路（#949 監査: 権限対応表への登録）', () => {
  // authMiddleware の実物を通す。Bearer APIキー → staff_members → 役割・
  // permission_keys・account境界まで本番通り。/api/scenario-subscriptions が
  // 権限対応表に無いと、route の requirePermission へ届く前に staff は 403 になる。
  function authedApp() {
    const instance = new Hono<Env>();
    instance.use('*', authMiddleware);
    instance.route('/', scenarios);
    return instance;
  }

  function authedPost(
    subscriptionId: string,
    op: string,
    apiKey: string,
    body?: unknown,
    idemKey: string | null = key(),
  ) {
    return authedApp().request(`/api/scenario-subscriptions/${subscriptionId}/${op}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(idemKey ? { 'Idempotency-Key': idemKey } : {}),
      },
      body: JSON.stringify(body ?? {}),
    }, { DB: sqlite.db } as unknown as Env['Bindings']);
  }

  test('個別権限を持つstaffは第一関門を通って操作できる', async () => {
    // scenario.subscription.edit を持つ staff は停止できる
    expect((await authedPost('sub-active', 'pause', 'key-sub')).status).toBe(200);
    // scenario.step_run.retry を持つ staff は失敗再送できる
    // （購読の操作権限を持たなくても retry へ届く = 個別権限での委譲）
    expect((await authedPost('sub-failed', 'retry', 'key-retry')).status).toBe(200);
  });

  test('権限の無いstaffは403、再送だけの委譲では停止できない', async () => {
    // 再送だけを任された staff が購読を止めると第一関門で 403
    expect((await authedPost('sub-paused', 'pause', 'key-retry')).status).toBe(403);
    // 権限を一切持たない staff も 403
    expect((await authedPost('sub-paused', 'resume', 'key-none')).status).toBe(403);
    // owner/admin は従来どおり通す
    expect((await authedPost('sub-paused', 'resume', 'key-owner')).status).toBe(200);
  });
});
