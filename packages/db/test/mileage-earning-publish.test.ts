/**
 * N-231 案1(公開版)の直接試験。
 *
 * 約束: 公開後に受け付けたイベントだけ新版、公開前に queue 済みの未処理イベントは
 * 旧版、既存の台帳・残高は不変。下書きだけでは何も変わらない。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMileageRulesForEvent,
  createMileageRule,
  getAccountRuleVersionMap,
  getMileageSummaryForFriend,
  parsePublishedSnapshot,
  processPendingMileageEvents,
  updateMileageRule,
} from '../src/mileage.js';
import {
  MileageV6Error,
  publishMileageEarningRule,
  saveMileageEarningRuleDraft,
} from '../src/mileage-admin-v6.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BENIGN = /duplicate column name|already exists/i;
const FIXED_NOW = new Date('2026-08-10T00:00:00.000+09:00');
const PROCESS_NOW = '2026-08-10T10:00:00.000+09:00';

function execSafe(db: Database.Database, sql: string) {
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) {
    try { db.exec(statement); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!BENIGN.test(message)) throw error;
    }
  }
}

let migratedSnapshot: Buffer | null = null;

function setupSqlite() {
  if (migratedSnapshot) return new Database(migratedSnapshot);
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PACKAGE_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(join(PACKAGE_ROOT, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    execSafe(db, readFileSync(join(PACKAGE_ROOT, 'migrations', file), 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, display_name) VALUES ('user-1', '横断ユーザー')`).run();
  db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
              VALUES ('account-1', 'channel-1', '公式A', 'token', 'secret'),
                     ('account-2', 'channel-2', '公式B', 'token', 'secret')`).run();
  db.prepare(`INSERT INTO friends
                (id, line_user_id, display_name, picture_url, user_id, line_account_id)
              VALUES ('friend-1', 'U1', 'ユーザーA', 'https://example.com/a.jpg', 'user-1', 'account-1'),
                     ('friend-2', 'U2', 'ユーザーB', NULL, 'user-1', 'account-2')`).run();
  migratedSnapshot = db.serialize();
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const statement = sqlite.prepare(sql);
          return {
            async run() {
              const result = statement.run(...params);
              return { success: true, results: [], meta: { changes: result.changes } };
            },
            async first<T>() { return (statement.get(...params) as T) ?? null; },
            async all<T>() { return { success: true, results: statement.all(...params) as T[], meta: {} }; },
          };
        },
      };
    },
    // D1 の batch は原子。本物の同時書き込みは試験に無いので逐次でよい。
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

function makeDraft(amount: number, name = 'あいさつでたまる') {
  return {
    name,
    eventType: 'message_received',
    source: 'line',
    amount,
    initialStatus: 'available' as const,
    validFrom: null,
    validUntil: null,
    expiresAfterDays: null,
    cancellationEventTypes: [],
    targetConditions: null,
    sortOrder: 0,
    notification: { enabled: false, messageTemplate: '' },
  };
}

async function makeRuleWithDraft(
  db: D1Database,
  options: { liveAmount: number; draftAmount: number; accountId?: string; name?: string },
) {
  const accountId = options.accountId ?? 'account-1';
  const rule = await createMileageRule(db, {
    name: options.name ?? 'あいさつでたまる',
    eventType: 'message_received',
    source: 'line',
    amount: options.liveAmount,
    initialStatus: 'available',
    lineAccountId: accountId,
  });
  const saved = await saveMileageEarningRuleDraft(db, {
    ruleId: rule.id,
    lineAccountId: accountId,
    expectedVersion: null,
    draft: makeDraft(options.draftAmount, options.name),
    updatedByStaffId: 'staff-1',
  });
  return { rule, draftVersion: saved.version };
}

async function receive(db: D1Database, sourceEventId: string, friendId = 'friend-1') {
  const { event } = await applyMileageRulesForEvent(db, {
    eventType: 'message_received',
    source: 'line',
    sourceEventId,
    friendId,
    occurredAt: '2026-08-10T09:00:00.000+09:00',
  });
  return event;
}

function ledgerByEvent(sqlite: Database.Database, ruleIds?: string[]) {
  const rows = sqlite.prepare(
    `SELECT e.source_event_id AS sourceEventId, l.mileage_rule_id AS ruleId, l.amount AS amount
       FROM mileage_ledger l JOIN engagement_events e ON e.id = l.engagement_event_id
      ORDER BY e.source_event_id, l.mileage_rule_id`,
  ).all() as Array<{ sourceEventId: string; ruleId: string; amount: number }>;
  // 全店共通の組込ルール(builtin-message-received)は旧来どおり live で付く。検証対象の
  // 所属ルールだけに絞って主張し、組込分は別に数える。
  return ruleIds ? rows.filter((row) => ruleIds.includes(row.ruleId)) : rows;
}

function ledgerSnapshot(sqlite: Database.Database) {
  return sqlite.prepare(
    `SELECT id, amount, occurred_at AS occurredAt FROM mileage_ledger ORDER BY id`,
  ).all();
}

async function publishExpectError(
  db: D1Database,
  input: { ruleId: string; lineAccountId: string; expectedVersion: number },
) {
  try {
    await publishMileageEarningRule(db, {
      ...input,
      staffId: 'staff-1',
      idempotencyKey: crypto.randomUUID(),
    });
  } catch (error) {
    expect(error).toBeInstanceOf(MileageV6Error);
    return error as MileageV6Error;
  }
  throw new Error('publish should have failed');
}

describe('mileage earning rule publish (N-231 案1)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    sqlite = setupSqlite();
    db = asD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
  });

  it('下書きだけでは実付与も公開版も変わらない', async () => {
    const { rule } = await makeRuleWithDraft(db, { liveAmount: 100, draftAmount: 200 });
    await receive(db, 'draft-only-1');
    await processPendingMileageEvents(db, { now: PROCESS_NOW });

    expect(ledgerByEvent(sqlite, [rule.id])).toEqual([{ sourceEventId: 'draft-only-1', ruleId: rule.id, amount: 100 }]);
    expect(ledgerByEvent(sqlite).some((row) => row.ruleId === 'builtin-message-received')).toBe(true);
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM mileage_earning_rule_published_versions`).get()).toEqual({ c: 0 });
    expect(sqlite.prepare(`SELECT published_version_number AS v FROM mileage_rules WHERE id = ?`)
      .get(rule.id)).toEqual({ v: null });
  });

  it('公開前queueは旧版・公開後queueは新版で処理する', async () => {
    const { rule, draftVersion } = await makeRuleWithDraft(db, { liveAmount: 100, draftAmount: 200 });
    await receive(db, 'before-publish-1');

    const published = await publishMileageEarningRule(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: draftVersion,
      staffId: 'staff-1', idempotencyKey: crypto.randomUUID(),
    });
    expect(published.versionNumber).toBe(1);

    await receive(db, 'after-publish-1');
    await processPendingMileageEvents(db, { now: PROCESS_NOW });

    // 旧版(v0=100)と新版(v1=200)が1件ずつ。単一IDへ潰していない。
    expect(ledgerByEvent(sqlite, [rule.id])).toEqual([
      { sourceEventId: 'after-publish-1', ruleId: rule.id, amount: 200 },
      { sourceEventId: 'before-publish-1', ruleId: rule.id, amount: 100 },
    ]);
    const versions = sqlite.prepare(
      `SELECT version_number AS v, status FROM mileage_earning_rule_published_versions
        WHERE rule_id = ? ORDER BY version_number`,
    ).all(rule.id) as Array<{ v: number; status: string }>;
    expect(versions).toEqual([{ v: 0, status: 'retired' }, { v: 1, status: 'published' }]);
    expect(sqlite.prepare(`SELECT published_version_number AS v FROM mileage_rules WHERE id = ?`)
      .get(rule.id)).toEqual({ v: 1 });
    expect(sqlite.prepare(`SELECT amount AS a FROM mileage_rules WHERE id = ?`).get(rule.id))
      .toEqual({ a: 200 });
  });

  it('公開の前後で既存ledgerと残高は不変', async () => {
    const { rule, draftVersion } = await makeRuleWithDraft(db, { liveAmount: 100, draftAmount: 200 });
    await receive(db, 'ledger-stable-1');
    await processPendingMileageEvents(db, { now: PROCESS_NOW });

    const before = ledgerSnapshot(sqlite);
    // 所属ルール100＋全店共通の組込1。
    expect(before).toHaveLength(2);
    const balanceBefore = await getMileageSummaryForFriend(db, 'friend-1');

    await publishMileageEarningRule(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: draftVersion,
      staffId: 'staff-1', idempotencyKey: crypto.randomUUID(),
    });

    expect(ledgerSnapshot(sqlite)).toEqual(before);
    expect(await getMileageSummaryForFriend(db, 'friend-1')).toEqual(balanceBefore);
  });

  it('別アカウントと古い下書き版の公開を拒否する', async () => {
    const { rule } = await makeRuleWithDraft(db, { liveAmount: 100, draftAmount: 200 });

    const crossAccount = await publishExpectError(db, { ruleId: rule.id, lineAccountId: 'account-2', expectedVersion: 1 });
    expect(crossAccount.code).toBe('draft_not_found');
    expect(crossAccount.status).toBe(404);

    await saveMileageEarningRuleDraft(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: 1,
      draft: makeDraft(300), updatedByStaffId: 'staff-1',
    });
    const stale = await publishExpectError(db, { ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: 1 });
    expect(stale.code).toBe('version_conflict');
    expect(stale.status).toBe(409);
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM mileage_earning_rule_published_versions`).get()).toEqual({ c: 0 });
  });

  it('同じ冪等キーでは版を増やさず、違うキーでは版を進める', async () => {
    const { rule, draftVersion } = await makeRuleWithDraft(db, { liveAmount: 100, draftAmount: 200 });
    const key = crypto.randomUUID();
    const first = await publishMileageEarningRule(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: draftVersion,
      staffId: 'staff-1', idempotencyKey: key,
    });
    const replay = await publishMileageEarningRule(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: draftVersion,
      staffId: 'staff-1', idempotencyKey: key,
    });
    expect(replay).toEqual(first);

    const second = await publishMileageEarningRule(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: draftVersion,
      staffId: 'staff-1', idempotencyKey: crypto.randomUUID(),
    });
    expect(second.versionNumber).toBe(first.versionNumber + 1);
    expect(second.versionId).not.toBe(first.versionId);
  });

  it('複数ルールの集合境界を保つ(片方だけ公開しても両方旧版で付く)', async () => {
    const first = await makeRuleWithDraft(db, { liveAmount: 100, draftAmount: 200, name: '1つめ' });
    const second = await makeRuleWithDraft(db, { liveAmount: 50, draftAmount: 50, name: '2つめ' });
    await receive(db, 'two-rules-1');

    await publishMileageEarningRule(db, {
      ruleId: first.rule.id, lineAccountId: 'account-1', expectedVersion: first.draftVersion,
      staffId: 'staff-1', idempotencyKey: crypto.randomUUID(),
    });
    await processPendingMileageEvents(db, { now: PROCESS_NOW });

    // 公開した1つめは旧版100、触っていない2つめは50。どちらも落ちない。
    // 行順はUUID任せなので写像で比べる(順序依存の間欠失敗にしない)。
    const rows = ledgerByEvent(sqlite, [first.rule.id, second.rule.id]);
    expect(rows).toHaveLength(2);
    expect(new Map(rows.map((row) => [row.ruleId, row.amount]))).toEqual(
      new Map([[first.rule.id, 100], [second.rule.id, 50]]),
    );
  });

  it('snapshotが無い旧行は旧来どおりliveを読む', async () => {
    const { rule } = await makeRuleWithDraft(db, { liveAmount: 100, draftAmount: 200 });
    await receive(db, 'legacy-null-1');
    sqlite.prepare(`UPDATE mileage_event_queue SET applied_published_snapshot = NULL`).run();

    await updateMileageRule(db, rule.id, { amount: 150 });
    await processPendingMileageEvents(db, { now: PROCESS_NOW });

    expect(ledgerByEvent(sqlite, [rule.id])).toEqual([{ sourceEventId: 'legacy-null-1', ruleId: rule.id, amount: 150 }]);
  });

  it('停止中のルールは固定版があっても付与しない', async () => {
    const { rule, draftVersion } = await makeRuleWithDraft(db, { liveAmount: 100, draftAmount: 200 });
    await publishMileageEarningRule(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: draftVersion,
      staffId: 'staff-1', idempotencyKey: crypto.randomUUID(),
    });
    await updateMileageRule(db, rule.id, { isActive: false });

    await receive(db, 'stopped-1');
    const queue = await processPendingMileageEvents(db, { now: PROCESS_NOW });

    // 組込ルールの1件だけ付き、停止中の所属ルールは付かない。
    expect(queue).toMatchObject({ processed: 1, granted: 1, failed: 0 });
    expect(ledgerByEvent(sqlite, [rule.id])).toEqual([]);
    expect(ledgerByEvent(sqlite).some((row) => row.ruleId === 'builtin-message-received')).toBe(true);
  });

  it('migration再実行でv1 seed・pointer・pending補完が入る', async () => {
    const rule = await createMileageRule(db, {
      name: '旧口のまま', eventType: 'message_received', source: 'line',
      amount: 100, initialStatus: 'available', lineAccountId: 'account-1',
    });
    await receive(db, 'seed-1');
    // migration前の旧行を再現する。受付時のsnapshotもpointerも無い状態。
    sqlite.prepare(`UPDATE mileage_event_queue SET applied_published_snapshot = NULL`).run();

    execSafe(sqlite, readFileSync(join(PACKAGE_ROOT, 'migrations', '394_mileage_earning_rule_publish.sql'), 'utf8'));

    const seed = sqlite.prepare(
      `SELECT version_number AS v, status, content_json AS content
         FROM mileage_earning_rule_published_versions WHERE rule_id = ?`,
    ).get(rule.id) as { v: number; status: string; content: string };
    expect(seed.v).toBe(1);
    expect(seed.status).toBe('published');
    expect((JSON.parse(seed.content) as { amount: number }).amount).toBe(100);
    expect(sqlite.prepare(`SELECT published_version_number AS v FROM mileage_rules WHERE id = ?`)
      .get(rule.id)).toEqual({ v: 1 });

    const row = sqlite.prepare(`SELECT applied_published_snapshot AS s FROM mileage_event_queue`).get() as { s: string };
    expect(parsePublishedSnapshot(row.s)).toEqual({ [rule.id]: 1 });
    expect(await getAccountRuleVersionMap(db, 'account-1')).toEqual({ [rule.id]: 1 });
  });
});

describe('parsePublishedSnapshot', () => {
  it('壊れた値はnullにしてlive読みへ退がらせる', () => {
    expect(parsePublishedSnapshot(null)).toBeNull();
    expect(parsePublishedSnapshot('')).toBeNull();
    expect(parsePublishedSnapshot('壊れたJSON')).toBeNull();
    expect(parsePublishedSnapshot('[1,2]')).toBeNull();
    expect(parsePublishedSnapshot('{"a":-1}')).toBeNull();
    expect(parsePublishedSnapshot('{"a":"1"}')).toBeNull();
    expect(parsePublishedSnapshot('{}')).toEqual({});
    expect(parsePublishedSnapshot('{"r1":0,"r2":3}')).toEqual({ r1: 0, r2: 3 });
  });
});
