import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConversionApprovalQueue } from '../src/affiliate-report.js';
import { getConversionEvents } from '../src/conversions.js';
import { setConversionApproval } from '../src/affiliate-offers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');
const BENIGN = /duplicate column name|already exists/i;

// Canonical IDENTITY_KEY_SQL (kept in sync with apps/worker/src/lib/identity-key.ts).
const ALL_SCOPE = { allowedAccountIds: [] as string[], includeUnassigned: true };

const IDENTITY_KEY_SQL = `
  COALESCE(
    CASE
      WHEN friends.picture_url LIKE 'https://sprofile.line-scdn.net/%' THEN SUBSTR(friends.picture_url, 42, 80)
      WHEN friends.picture_url LIKE 'https://profile.line-scdn.net/%' THEN SUBSTR(friends.picture_url, 41, 80)
      ELSE NULL
    END,
    'uid:' || friends.user_id,
    'solo:' || friends.id
  )
`;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

/*
 * 移行の再生は全部同期で走る。テストごとに繰り返すとその間ワーカーが
 * 止まり、CI が vitest の状況報告待ちで落ちる。1度だけ組み立てて中身を
 * 控え、以後は写しから起こす。写しは独立したDBなので、テスト同士は
 * 影響し合わない。
 */
let migratedSnapshot: Buffer | null = null;

function setupDb(): Database.Database {
  if (migratedSnapshot) return new Database(migratedSnapshot);
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  migratedSnapshot = db.serialize();
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              const info = stmt.run(...params);
              return { results: [], success: true, meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
        async run() {
          const info = sqlite.prepare(query).run();
          return { results: [], success: true, meta: { changes: info.changes } };
        },
        async first<T>() {
          return (sqlite.prepare(query).get() as T) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all() as T[], success: true, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

function insertFriend(
  s: Database.Database,
  id: string,
  opts: { userId?: string | null; displayName?: string } = {},
): void {
  s.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, picture_url, user_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, '2026-01-01T00:00:00.000+09:00', '2026-01-01T00:00:00.000+09:00')`,
  ).run(id, `L-${id}`, opts.displayName ?? id, opts.userId ?? null);
}

function insertAffiliate(s: Database.Database, id: string): void {
  s.prepare(
    `INSERT INTO affiliates (id, name, code, commission_rate, is_active, created_at, friend_id)
     VALUES (?, ?, ?, 0, 1, '2026-01-01T00:00:00.000+09:00', NULL)`,
  ).run(id, `Aff ${id}`, `code-${id}`);
}

function insertPoint(s: Database.Database, id: string, value: number, lineAccountId: string | null = null): void {
  s.prepare(
    `INSERT INTO conversion_points (id, name, event_type, value, line_account_id, created_at)
     VALUES (?, ?, 'purchase', ?, ?, '2026-01-01T00:00:00.000+09:00')`,
  ).run(id, `Point ${id}`, value, lineAccountId);
}

function insertOfferAndLink(
  s: Database.Database,
  opts: {
    offerId: string;
    offerName: string;
    affiliateId: string;
    refCode: string;
    rewardMiles?: number;
    tagId?: string | null;
    scenarioId?: string | null;
    isActive?: boolean;
  },
): void {
  s.prepare(
    `INSERT INTO affiliate_offers (id, name, description, reward_amount, reward_miles, line_account_id, tag_id, scenario_id, is_active, created_at)
     VALUES (?, ?, NULL, 500, ?, NULL, ?, ?, ?, '2026-01-01T00:00:00.000+09:00')`,
  ).run(
    opts.offerId, opts.offerName, opts.rewardMiles ?? 0,
    opts.tagId ?? null, opts.scenarioId ?? null,
    opts.isActive === false ? 0 : 1,
  );
  s.prepare(
    `INSERT INTO affiliate_links (id, affiliate_id, ref_code, label, line_account_id, offer_id, is_active, created_at, click_count)
     VALUES (?, ?, ?, NULL, NULL, ?, 1, '2026-01-01T00:00:00.000+09:00', 0)`,
  ).run(`link-${opts.refCode}`, opts.affiliateId, opts.refCode, opts.offerId);
}

function insertTag(s: Database.Database, id: string): void {
  s.prepare(`INSERT INTO tags (id, name) VALUES (?, ?)`).run(id, `tag-${id}`);
}

function attachTag(s: Database.Database, friendId: string, tagId: string): void {
  s.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES (?, ?)`).run(friendId, tagId);
}

function insertTagRun(
  s: Database.Database,
  friendId: string,
  tagId: string,
  stepKey: string,
  status: string,
): void {
  s.prepare(
    `INSERT INTO friend_tag_side_effect_runs
       (friend_id, tag_id, step_key, assigned_at, status, attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, '2026-02-01T00:00:00.000+09:00', ?, 0,
             '2026-02-01T00:00:00.000+09:00', '2026-02-01T00:00:00.000+09:00')`,
  ).run(friendId, tagId, stepKey, status);
}

function insertScenario(s: Database.Database, id: string): void {
  s.prepare(
    `INSERT INTO scenarios (id, name, trigger_type) VALUES (?, ?, 'manual')`,
  ).run(id, `scn-${id}`);
}

function enrollScenario(
  s: Database.Database,
  opts: { id: string; friendId: string; scenarioId: string; status?: string },
): void {
  s.prepare(
    `INSERT INTO friend_scenarios (id, friend_id, scenario_id, status)
     VALUES (?, ?, ?, ?)`,
  ).run(opts.id, opts.friendId, opts.scenarioId, opts.status ?? 'active');
}

function insertConversion(
  s: Database.Database,
  opts: {
    id: string;
    pointId: string;
    friendId: string;
    affiliateId: string | null;
    refCode: string | null;
    approvalStatus: string | null;
    createdAt: string;
  },
): void {
  s.prepare(
    `INSERT INTO conversion_events (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code, approval_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(opts.id, opts.pointId, opts.friendId, opts.affiliateId, opts.refCode, opts.approvalStatus, opts.createdAt);
}

let sqlite: Database.Database;
let db: D1Database;
beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);
});

describe('getConversionApprovalQueue', () => {
  test('filters by status and resolves friend/affiliate/offer/point + value', async () => {
    insertFriend(sqlite, 'f1', { displayName: 'Alice', userId: 'uid-a' });
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 800);
    insertOfferAndLink(sqlite, { offerId: 'off1', offerName: '案件A', affiliateId: 'aff1', refCode: 'rc1' });
    insertConversion(sqlite, {
      id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1',
      approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00',
    });
    // An approved CV and a non-attributed CV that must NOT surface in pending.
    insertConversion(sqlite, {
      id: 'cv2', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1',
      approvalStatus: 'approved', createdAt: '2026-02-02T00:00:00.000+09:00',
    });
    insertConversion(sqlite, {
      id: 'cv3', pointId: 'p1', friendId: 'f1', affiliateId: null, refCode: null,
      approvalStatus: null, createdAt: '2026-02-03T00:00:00.000+09:00',
    });

    const pending = await getConversionApprovalQueue(db, { status: 'pending', scope: ALL_SCOPE, identityKeySql: IDENTITY_KEY_SQL });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      eventId: 'cv1',
      friendName: 'Alice',
      affiliateName: 'Aff aff1',
      offerName: '案件A',
      conversionPointName: 'Point p1',
      value: 800,
      approvalStatus: 'pending',
      duplicateFlag: false,
    });

    const approved = await getConversionApprovalQueue(db, { status: 'approved', scope: ALL_SCOPE, identityKeySql: IDENTITY_KEY_SQL });
    expect(approved.map((r) => r.eventId)).toEqual(['cv2']);
  });

  test('案件IDと付与マイルを返す。名前で結ぶと同名の案件を取り違える', async () => {
    insertFriend(sqlite, 'f1', { userId: 'uid-a' });
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 800);
    // 名前が同じで中身が違う案件を2つ。名前で突き合わせると区別できない。
    insertOfferAndLink(sqlite, {
      offerId: 'off1', offerName: '同じ名前', affiliateId: 'aff1', refCode: 'rc1', rewardMiles: 200,
    });
    insertOfferAndLink(sqlite, {
      offerId: 'off2', offerName: '同じ名前', affiliateId: 'aff1', refCode: 'rc2', rewardMiles: 50,
    });
    insertConversion(sqlite, {
      id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1',
      approvalStatus: 'approved', createdAt: '2026-02-01T00:00:00.000+09:00',
    });
    insertConversion(sqlite, {
      id: 'cv2', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc2',
      approvalStatus: 'approved', createdAt: '2026-02-02T00:00:00.000+09:00',
    });

    const rows = await getConversionApprovalQueue(db, {
      status: 'approved',
      scope: ALL_SCOPE, identityKeySql: IDENTITY_KEY_SQL,
    });
    const byEvent = new Map(rows.map((r) => [r.eventId, r]));
    expect(byEvent.get('cv1')).toMatchObject({ offerId: 'off1', offerRewardMiles: 200 });
    expect(byEvent.get('cv2')).toMatchObject({ offerId: 'off2', offerRewardMiles: 50 });
  });

  test('案件に結びつかない成果は、案件IDもマイルも null', async () => {
    insertFriend(sqlite, 'f1', { userId: 'uid-a' });
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 800);
    // link が無い ref。外部が発行したコードなど。
    insertConversion(sqlite, {
      id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'unknown',
      approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00',
    });

    const rows = await getConversionApprovalQueue(db, {
      status: 'pending',
      scope: ALL_SCOPE, identityKeySql: IDENTITY_KEY_SQL,
    });
    expect(rows[0]).toMatchObject({ offerId: null, offerName: null, offerRewardMiles: null });
  });

  test('duplicateFlag is true when two friends share an identity_key within the same affiliate', async () => {
    // Two friends, SAME user_id → same identity_key. Both attributed to aff1.
    insertFriend(sqlite, 'f1', { userId: 'shared-uid' });
    insertFriend(sqlite, 'f2', { userId: 'shared-uid' });
    // A third friend on a different key, same affiliate → not flagged.
    insertFriend(sqlite, 'f3', { userId: 'lonely-uid' });
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 100);
    insertOfferAndLink(sqlite, { offerId: 'off1', offerName: 'O', affiliateId: 'aff1', refCode: 'rc1' });

    insertConversion(sqlite, { id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv2', pointId: 'p1', friendId: 'f2', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'pending', createdAt: '2026-02-02T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv3', pointId: 'p1', friendId: 'f3', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'pending', createdAt: '2026-02-03T00:00:00.000+09:00' });

    const rows = await getConversionApprovalQueue(db, { status: 'pending', scope: ALL_SCOPE, identityKeySql: IDENTITY_KEY_SQL });
    const flagByEvent = new Map(rows.map((r) => [r.eventId, r.duplicateFlag]));
    expect(flagByEvent.get('cv1')).toBe(true);
    expect(flagByEvent.get('cv2')).toBe(true);
    expect(flagByEvent.get('cv3')).toBe(false);
  });

  test('duplicate identity_key across DIFFERENT affiliates does not flag', async () => {
    insertFriend(sqlite, 'f1', { userId: 'shared-uid' });
    insertFriend(sqlite, 'f2', { userId: 'shared-uid' });
    insertAffiliate(sqlite, 'aff1');
    insertAffiliate(sqlite, 'aff2');
    insertPoint(sqlite, 'p1', 100);
    insertOfferAndLink(sqlite, { offerId: 'off1', offerName: 'O1', affiliateId: 'aff1', refCode: 'rc1' });
    insertOfferAndLink(sqlite, { offerId: 'off2', offerName: 'O2', affiliateId: 'aff2', refCode: 'rc2' });

    insertConversion(sqlite, { id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv2', pointId: 'p1', friendId: 'f2', affiliateId: 'aff2', refCode: 'rc2', approvalStatus: 'pending', createdAt: '2026-02-02T00:00:00.000+09:00' });

    const rows = await getConversionApprovalQueue(db, { status: 'pending', scope: ALL_SCOPE, identityKeySql: IDENTITY_KEY_SQL });
    expect(rows.every((r) => r.duplicateFlag === false)).toBe(true);
  });

  test('applies account scope before pagination for events and approvals', async () => {
    insertFriend(sqlite, 'f1', { userId: 'uid-a' });
    insertAffiliate(sqlite, 'aff1');
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES (?, ?, ?, 'token', 'secret')`,
    ).run('own', 'channel-own', 'Own');
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES (?, ?, ?, 'token', 'secret')`,
    ).run('other', 'channel-other', 'Other');
    insertPoint(sqlite, 'own-point', 100, 'own');
    insertPoint(sqlite, 'other-point', 100, 'other');
    for (let index = 1; index <= 3; index += 1) {
      insertConversion(sqlite, {
        id: `other-${index}`, pointId: 'other-point', friendId: 'f1', affiliateId: 'aff1', refCode: null,
        approvalStatus: 'pending', createdAt: `2026-02-0${index + 2}T00:00:00.000+09:00`,
      });
    }
    for (let index = 1; index <= 2; index += 1) {
      insertConversion(sqlite, {
        id: `own-${index}`, pointId: 'own-point', friendId: 'f1', affiliateId: 'aff1', refCode: null,
        approvalStatus: 'pending', createdAt: `2026-02-0${index}T00:00:00.000+09:00`,
      });
    }
    const scope = { allowedAccountIds: ['own'], includeUnassigned: false };

    const events = await getConversionEvents(db, { scope, limit: 2, offset: 0 });
    expect(events.map((row) => row.id)).toEqual(['own-2', 'own-1']);

    const approvals = await getConversionApprovalQueue(db, {
      scope, status: 'pending', identityKeySql: IDENTITY_KEY_SQL, limit: 2, offset: 0,
    });
    expect(approvals.map((row) => row.eventId)).toEqual(['own-2', 'own-1']);
  });

  test('アカウント絞りのため、行は成果地点のアカウントIDと名前を返す(N-218)', async () => {
    insertFriend(sqlite, 'f1', { userId: 'uid-a' });
    insertAffiliate(sqlite, 'aff1');
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES (?, ?, ?, 'token', 'secret')`,
    ).run('acc-a', 'channel-a', '本店');
    insertPoint(sqlite, 'p-owned', 100, 'acc-a');
    insertPoint(sqlite, 'p-free', 100, null);
    insertConversion(sqlite, {
      id: 'cv-owned', pointId: 'p-owned', friendId: 'f1', affiliateId: 'aff1', refCode: null,
      approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00',
    });
    insertConversion(sqlite, {
      id: 'cv-free', pointId: 'p-free', friendId: 'f1', affiliateId: 'aff1', refCode: null,
      approvalStatus: 'pending', createdAt: '2026-02-02T00:00:00.000+09:00',
    });

    // allowedAccountIds が空のままだと未割当の行しか返らないので、
    // 権限内アカウントを指定したscopeで読む。
    const rows = await getConversionApprovalQueue(db, {
      status: 'pending',
      scope: { allowedAccountIds: ['acc-a'], includeUnassigned: true },
      identityKeySql: IDENTITY_KEY_SQL,
    });
    const byEvent = new Map(rows.map((r) => [r.eventId, r]));
    expect(byEvent.get('cv-owned')).toMatchObject({ lineAccountId: 'acc-a', lineAccountName: '本店' });
    // 未割当の地点は id・名ともに null。画面側は「アカウント未設定」と出す。
    expect(byEvent.get('cv-free')).toMatchObject({ lineAccountId: null, lineAccountName: null });
  });
});

describe('setConversionApproval', () => {
  test('updates an attributed row and returns true; missing/non-attributed returns false', async () => {
    insertFriend(sqlite, 'f1', { userId: 'u' });
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 100);
    insertConversion(sqlite, { id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: null, approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv2', pointId: 'p1', friendId: 'f1', affiliateId: null, refCode: null, approvalStatus: null, createdAt: '2026-02-02T00:00:00.000+09:00' });

    expect(await setConversionApproval(db, 'cv1', 'approved')).toBe(true);
    const row = sqlite.prepare(`SELECT approval_status FROM conversion_events WHERE id = 'cv1'`).get() as { approval_status: string };
    expect(row.approval_status).toBe('approved');

    // Non-attributed CV → no update.
    expect(await setConversionApproval(db, 'cv2', 'approved')).toBe(false);
    // Missing CV → no update.
    expect(await setConversionApproval(db, 'nope', 'rejected')).toBe(false);
  });
});

/*
 * offerActionsIncomplete — 承認済みの行に「案件の付帯動作がまだ終わって
 * いない」目印を立てる(N-212)。判定は runApprovedConversionOfferActions の
 * 成功条件と同じ: タグは付与済みかつ台帳未完なし、シナリオは未完購読か
 * 'conversion-offer:'+eventId の購読(完了含む)があれば済み。
 */
describe('offerActionsIncomplete', () => {
  async function flagOf(eventId: string, status: 'pending' | 'approved' | 'rejected' = 'approved') {
    const rows = await getConversionApprovalQueue(db, { status, scope: ALL_SCOPE, identityKeySql: IDENTITY_KEY_SQL });
    return new Map(rows.map((r) => [r.eventId, r.offerActionsIncomplete])).get(eventId);
  }

  test('承認済み+稼働案件+タグ未付与ならtrue', async () => {
    insertFriend(sqlite, 'f1');
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 100);
    insertTag(sqlite, 't1');
    insertOfferAndLink(sqlite, { offerId: 'off1', offerName: 'O', affiliateId: 'aff1', refCode: 'rc1', tagId: 't1' });
    insertConversion(sqlite, { id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'approved', createdAt: '2026-02-01T00:00:00.000+09:00' });

    expect(await flagOf('cv1')).toBe(true);
  });

  test('タグ付与済みかつ台帳全工程完了ならfalse、未完工程が残ればtrue', async () => {
    insertFriend(sqlite, 'f1');
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 100);
    insertTag(sqlite, 't1');
    insertOfferAndLink(sqlite, { offerId: 'off1', offerName: 'O', affiliateId: 'aff1', refCode: 'rc1', tagId: 't1' });
    insertConversion(sqlite, { id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'approved', createdAt: '2026-02-01T00:00:00.000+09:00' });

    attachTag(sqlite, 'f1', 't1');
    insertTagRun(sqlite, 'f1', 't1', 'mileage', 'completed');
    expect(await flagOf('cv1')).toBe(false);

    insertTagRun(sqlite, 'f1', 't1', 'scenario_enroll', 'failed');
    expect(await flagOf('cv1')).toBe(true);
  });

  test('シナリオ未購読ならtrue。未完購読または conversion-offer 由来購読(完了含む)があればfalse', async () => {
    insertFriend(sqlite, 'f1');
    insertFriend(sqlite, 'f2');
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 100);
    insertScenario(sqlite, 's1');
    insertOfferAndLink(sqlite, { offerId: 'off1', offerName: 'O', affiliateId: 'aff1', refCode: 'rc1', scenarioId: 's1' });
    insertConversion(sqlite, { id: 'cv1', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'approved', createdAt: '2026-02-01T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv2', pointId: 'p1', friendId: 'f2', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'approved', createdAt: '2026-02-02T00:00:00.000+09:00' });

    expect(await flagOf('cv1')).toBe(true);
    expect(await flagOf('cv2')).toBe(true);

    // cv1: 別経路の未完購読があれば executor は「済み」と見なす → false。
    enrollScenario(sqlite, { id: 'other-src', friendId: 'f1', scenarioId: 's1', status: 'active' });
    expect(await flagOf('cv1')).toBe(false);

    // cv2: 完了済みでも conversion-offer:cv2 の購読行があれば executor は成功にする → false。
    enrollScenario(sqlite, { id: 'conversion-offer:cv2', friendId: 'f2', scenarioId: 's1', status: 'completed' });
    expect(await flagOf('cv2')).toBe(false);
  });

  test('未承認・停止中の案件・動作未設定・案件なしはfalse', async () => {
    insertFriend(sqlite, 'f1');
    insertAffiliate(sqlite, 'aff1');
    insertPoint(sqlite, 'p1', 100);
    insertTag(sqlite, 't1');
    insertScenario(sqlite, 's1');
    insertOfferAndLink(sqlite, { offerId: 'off1', offerName: 'O', affiliateId: 'aff1', refCode: 'rc1', tagId: 't1' });
    insertOfferAndLink(sqlite, { offerId: 'off2', offerName: 'O2', affiliateId: 'aff1', refCode: 'rc2', tagId: 't1', isActive: false });
    insertOfferAndLink(sqlite, { offerId: 'off3', offerName: 'O3', affiliateId: 'aff1', refCode: 'rc3' });
    insertConversion(sqlite, { id: 'cv-pending', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc1', approvalStatus: 'pending', createdAt: '2026-02-01T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv-stopped', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc2', approvalStatus: 'approved', createdAt: '2026-02-02T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv-noaction', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: 'rc3', approvalStatus: 'approved', createdAt: '2026-02-03T00:00:00.000+09:00' });
    insertConversion(sqlite, { id: 'cv-nooffer', pointId: 'p1', friendId: 'f1', affiliateId: 'aff1', refCode: null, approvalStatus: 'approved', createdAt: '2026-02-04T00:00:00.000+09:00' });

    expect(await flagOf('cv-pending', 'pending')).toBe(false);
    expect(await flagOf('cv-stopped')).toBe(false);
    expect(await flagOf('cv-noaction')).toBe(false);
    expect(await flagOf('cv-nooffer')).toBe(false);
  });
});
