/*
 * N-101: 友だち追加時配信の曜日・時間・条件・再送制限を実行時評価する契約テスト。
 *
 * 外部LINE・顧客・Calendarへ送らない。DBはテスト用D1（better-sqlite3）だけを使う。
 * 時刻は routingContext.now で差し込む（JSTで評価する）。
 */
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  applyFriendAddRouting,
  areFriendAddConditionsOverlapping,
  canonicalizeFriendAddCondition,
  doFriendAddTimeWindowsOverlap,
  doFriendAddWeekdaySetsOverlap,
  effectiveFriendAddWeekday,
  evaluateFriendAddSchedule,
  friendAddJstHhmm,
  isEmptyFriendAddCondition,
  isInFriendAddTimeWindows,
  isTimeInFriendAddWindow,
} from './friend-add-routing.js';
import { friendAddRules } from '../routes/friend-add-rules.js';
import { toJstParts } from '@line-crm/shared';

// 2026-09-07は月曜（2026-09-08火曜の前日）。祝日ではない週を使う。
const MON_10 = new Date('2026-09-07T10:00:00+09:00');
const TUE_10 = new Date('2026-09-08T10:00:00+09:00');
const FRI_23 = new Date('2026-09-11T23:00:00+09:00');
const SAT_01 = new Date('2026-09-12T01:00:00+09:00');
const SAT_03 = new Date('2026-09-12T03:00:00+09:00');
const SAT_23 = new Date('2026-09-12T23:00:00+09:00');

describe('前提: テスト日付の曜日', () => {
  test('月・火・金・土の想定どおり', () => {
    expect(toJstParts(MON_10).weekday).toBe(1);
    expect(toJstParts(TUE_10).weekday).toBe(2);
    expect(toJstParts(FRI_23).weekday).toBe(5);
    expect(toJstParts(SAT_01).weekday).toBe(6);
  });
});

describe('JST時刻と時間帯の純粋関数', () => {
  test('UTCのDateをJSTのHH:MMに直す', () => {
    expect(friendAddJstHhmm(new Date('2026-09-07T01:00:00Z'))).toBe('10:00');
    expect(friendAddJstHhmm(new Date('2026-09-07T14:59:00Z'))).toBe('23:59');
  });

  test('通常の帯は開始を含み終了を含まない', () => {
    const window = { start: '09:00', end: '18:00' };
    expect(isTimeInFriendAddWindow(9 * 60, window)).toBe(true);
    expect(isTimeInFriendAddWindow(18 * 60 - 1, window)).toBe(true);
    expect(isTimeInFriendAddWindow(18 * 60, window)).toBe(false);
    expect(isTimeInFriendAddWindow(8 * 60 + 59, window)).toBe(false);
  });

  test('日跨ぎの帯は夜から翌朝まで', () => {
    const window = { start: '22:00', end: '02:00' };
    expect(isTimeInFriendAddWindow(23 * 60, window)).toBe(true);
    expect(isTimeInFriendAddWindow(60, window)).toBe(true);
    expect(isTimeInFriendAddWindow(2 * 60, window)).toBe(false);
    expect(isTimeInFriendAddWindow(3 * 60, window)).toBe(false);
    expect(isTimeInFriendAddWindow(21 * 60, window)).toBe(false);
  });

  test('帯が無ければいつでもよい', () => {
    expect(isInFriendAddTimeWindows('03:00', [])).toBe(true);
    expect(isInFriendAddTimeWindows('03:00', [{ start: '22:00', end: '02:00' }])).toBe(false);
    expect(isInFriendAddTimeWindows('01:00', [{ start: '22:00', end: '02:00' }])).toBe(true);
  });

  test('日跨ぎの翌日側は始まった側の曜日で見る', () => {
    const windows = [{ start: '22:00', end: '02:00' }];
    expect(effectiveFriendAddWeekday(FRI_23, windows)).toBe(5);
    // 土曜01:00は「金曜の夜」として金曜扱い
    expect(effectiveFriendAddWeekday(SAT_01, windows)).toBe(5);
    // 土曜03:00は帯の外なので土曜のまま
    expect(effectiveFriendAddWeekday(SAT_03, windows)).toBe(6);
  });

  test('曜日と時間帯の不一致理由を分ける', () => {
    expect(evaluateFriendAddSchedule({ weekdays: [1], timeWindows: [] }, TUE_10))
      .toEqual({ matched: false, reason: 'outside_weekday' });
    expect(evaluateFriendAddSchedule({ weekdays: [], timeWindows: [{ start: '09:00', end: '18:00' }] }, MON_10))
      .toEqual({ matched: true, reason: null });
    expect(evaluateFriendAddSchedule(
      { weekdays: [1], timeWindows: [{ start: '09:00', end: '18:00' }] },
      new Date('2026-09-07T09:00:00+09:00'),
    )).toEqual({ matched: true, reason: null });
    // 両方外れているときは曜日を先に報告する
    expect(evaluateFriendAddSchedule(
      { weekdays: [2], timeWindows: [{ start: '09:00', end: '18:00' }] },
      new Date('2026-09-07T20:00:00+09:00'),
    )).toEqual({ matched: false, reason: 'outside_weekday' });
  });
});

describe('競合確認と本番で同じ重なり関数', () => {
  test('同じ帯は重なり、隣り合う帯は重ならない', () => {
    expect(doFriendAddTimeWindowsOverlap(
      [{ start: '09:00', end: '18:00' }], [{ start: '09:00', end: '18:00' }],
    )).toBe(true);
    expect(doFriendAddTimeWindowsOverlap(
      [{ start: '09:00', end: '18:00' }], [{ start: '18:00', end: '22:00' }],
    )).toBe(false);
  });

  test('日跨ぎ同士の重なりを見落とさない', () => {
    // 22-02と23-01は23-01で重なる。単純な文字列比較だと見落とす。
    expect(doFriendAddTimeWindowsOverlap(
      [{ start: '22:00', end: '02:00' }], [{ start: '23:00', end: '01:00' }],
    )).toBe(true);
    expect(doFriendAddTimeWindowsOverlap(
      [{ start: '22:00', end: '02:00' }], [{ start: '03:00', end: '04:00' }],
    )).toBe(false);
  });

  test('空の指定は競合にしない', () => {
    expect(doFriendAddTimeWindowsOverlap([], [{ start: '09:00', end: '18:00' }])).toBe(false);
    expect(doFriendAddWeekdaySetsOverlap([], [1])).toBe(false);
    expect(doFriendAddWeekdaySetsOverlap([1], [2])).toBe(false);
    expect(doFriendAddWeekdaySetsOverlap([1], [1, 2])).toBe(true);
    expect(areFriendAddConditionsOverlapping('', 'x')).toBe(false);
    expect(areFriendAddConditionsOverlapping('  x  ', 'x')).toBe(true);
  });

  test('同義JSONは整形・キー順・並びが違っても競合を見逃さない', () => {
    const compact = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] });
    const spaced = '{ "rules": [ { "value": "tag-1", "type": "tag_exists" } ], "operator": "AND" }';
    expect(areFriendAddConditionsOverlapping(compact, spaced)).toBe(true);
    // rules の並びが違っても AND の意味は同じ
    const ordered = JSON.stringify({
      operator: 'AND',
      rules: [
        { type: 'tag_exists', value: 'tag-1' },
        { type: 'is_following', value: true },
      ],
    });
    const reordered = JSON.stringify({
      operator: 'AND',
      rules: [
        { type: 'is_following', value: true },
        { type: 'tag_exists', value: 'tag-1' },
      ],
    });
    expect(areFriendAddConditionsOverlapping(ordered, reordered)).toBe(true);
    // 意味が違うJSONは競合にしない
    const other = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-2' }] });
    expect(areFriendAddConditionsOverlapping(compact, other)).toBe(false);
    // 空の構造化JSONは絞りなしとして競合にしない
    expect(areFriendAddConditionsOverlapping('{"operator":"AND","rules":[]}', compact)).toBe(false);
    expect(areFriendAddConditionsOverlapping('', compact)).toBe(false);
  });

  test('入れ子ORグループ内の並びが違っても競合を見逃さない', () => {
    const ruleA = { type: 'tag_exists', value: 'tag-1' };
    const ruleB = { type: 'is_following', value: true };
    // ORグループ内で同じ2条件を逆順に置いた同義条件は競合にする
    const left = JSON.stringify({
      operator: 'AND',
      rules: [],
      groups: [{ operator: 'OR', rules: [ruleA, ruleB] }],
    });
    const right = JSON.stringify({
      operator: 'AND',
      rules: [],
      groups: [{ operator: 'OR', rules: [ruleB, ruleA] }],
    });
    expect(areFriendAddConditionsOverlapping(left, right)).toBe(true);
    // 孫グループの並び違いも吸収する
    const grandLeft = JSON.stringify({
      operator: 'AND',
      rules: [],
      groups: [
        {
          operator: 'OR',
          rules: [],
          groups: [
            { operator: 'AND', rules: [ruleA, ruleB] },
            { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-2' }] },
          ],
        },
      ],
    });
    const grandRight = JSON.stringify({
      operator: 'AND',
      rules: [],
      groups: [
        {
          operator: 'OR',
          rules: [],
          groups: [
            { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-2' }] },
            { operator: 'AND', rules: [ruleB, ruleA] },
          ],
        },
      ],
    });
    expect(areFriendAddConditionsOverlapping(grandLeft, grandRight)).toBe(true);
    // 入れ子の中身が違うものは競合にしない
    const different = JSON.stringify({
      operator: 'AND',
      rules: [],
      groups: [{ operator: 'OR', rules: [ruleA, { type: 'tag_exists', value: 'tag-9' }] }],
    });
    expect(areFriendAddConditionsOverlapping(left, different)).toBe(false);
  });

  test('旧形式の字面はそのまま比べ、JSONは正規化できる', () => {
    expect(areFriendAddConditionsOverlapping('メモA', 'メモA')).toBe(true);
    expect(areFriendAddConditionsOverlapping('メモA', 'メモB')).toBe(false);
    expect(canonicalizeFriendAddCondition('  ')).toBe(null);
    expect(canonicalizeFriendAddCondition('購入回数が1回以上')).toBe(null);
    expect(canonicalizeFriendAddCondition('{"operator":')).toBe(null);
    expect(canonicalizeFriendAddCondition('{"operator":"AND","rules":[]}'))
      .toBe(canonicalizeFriendAddCondition('{ "rules": [], "operator": "AND" }'));
    expect(isEmptyFriendAddCondition('')).toBe(true);
    expect(isEmptyFriendAddCondition('{"operator":"AND","rules":[]}')).toBe(true);
    expect(isEmptyFriendAddCondition('購入回数が1回以上')).toBe(false);
  });
});

describe('本番の振り分け: 曜日・時間帯・条件・再送制限', () => {
  let testDb: SqliteD1;
  let raw: Database.Database;
  let db: D1Database;

  function setupBase(accountId = 'acc-1', scenarioId = 'scenario-1'): void {
    raw.prepare(
      `INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token)
       VALUES (?, 'テスト', ?, ?, ?)`,
    ).run(accountId, `channel-${accountId}`, `secret-${accountId}`, `token-${accountId}`);
    raw.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
       VALUES (?, '案内', 'friend_add', 1, ?)`,
    ).run(scenarioId, accountId);
  }

  function seedRule(options: {
    id?: string;
    accountId?: string;
    kind?: 'first_time' | 'returning';
    routeIds?: string[];
    fallback?: boolean;
    priority?: number;
    scenarioId?: string | null;
    weekdays?: number[];
    timeWindows?: Array<{ start: string; end: string }>;
    friendCondition?: string;
    internalMemo?: string;
    resendSuppressionHours?: number | null;
    returningMode?: 'none' | 'same' | 'other';
  } = {}): { ruleId: string; versionId: string } {
    const accountId = options.accountId ?? 'acc-1';
    const ruleId = options.id ?? `rule-${Math.random().toString(36).slice(2, 8)}`;
    const versionId = `${ruleId}-v1`;
    const definition: Record<string, unknown> = {
      routeIds: options.routeIds ?? ['route-1'],
      scenarioId: options.scenarioId === undefined ? 'scenario-1' : options.scenarioId,
      messageType: 'scenario',
      messageText: '',
      timing: 'scenario',
      actions: [],
      friendCondition: options.friendCondition ?? '',
      activeFrom: null,
      activeUntil: null,
      weekdays: options.weekdays ?? [],
      timeWindows: options.timeWindows ?? [],
    };
    if (options.resendSuppressionHours !== undefined) {
      definition.resendSuppressionHours = options.resendSuppressionHours;
    }
    if (options.internalMemo !== undefined) {
      definition.internalMemo = options.internalMemo;
    }
    if (options.returningMode) definition.returningMode = options.returningMode;
    raw.prepare(
      `INSERT INTO friend_add_rules
        (id, line_account_id, friend_kind, name, priority, is_unknown_route_fallback,
         status, current_version_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'published', ?, '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000')`,
    ).run(
      ruleId, accountId, options.kind ?? 'first_time', ruleId,
      options.priority ?? 1, options.fallback ? 1 : 0, versionId,
    );
    raw.prepare(
      `INSERT INTO friend_add_rule_versions
        (id, rule_id, version_number, definition_snapshot, status)
       VALUES (?, ?, 1, ?, 'published')`,
    ).run(versionId, ruleId, JSON.stringify(definition));
    return { ruleId, versionId };
  }

  function seedCompletedEvent(options: {
    id: string;
    accountId?: string;
    friendId?: string;
    occurredAt: string;
    status?: string;
  }): void {
    raw.prepare(
      `INSERT INTO friend_add_events
        (id, line_account_id, friend_id, webhook_event_id, friend_kind,
         attribution_status, routing_status, occurred_at)
       VALUES (?, ?, ?, ?, 'first_time', 'unavailable', ?, ?)`,
    ).run(
      options.id, options.accountId ?? 'acc-1', options.friendId ?? 'friend-1',
      `webhook-${options.id}`, options.status ?? 'completed', options.occurredAt,
    );
  }

  beforeEach(() => {
    testDb = createTestD1();
    raw = testDb.raw;
    db = testDb.db;
    setupBase();
    insertFriend(raw, 'friend-1', { line_account_id: 'acc-1', unfollow_count: 0 });
  });

  afterEach(() => testDb.raw.close());

  test('正常系: 曜日・時間帯の内側は配信する', async () => {
    const { ruleId, versionId } = seedRule({
      weekdays: [1], timeWindows: [{ start: '09:00', end: '18:00' }],
      resendSuppressionHours: 0,
    });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result).toMatchObject({
      routed: true, suppressed: false, suppressReason: null,
      ruleId, ruleVersionId: versionId,
    });
    expect(result.enrollments).toHaveLength(1);
  });

  test('曜日外は送らず理由を残す（受け皿へ落とさない）', async () => {
    const { ruleId, versionId } = seedRule({
      weekdays: [1], timeWindows: [{ start: '09:00', end: '18:00' }],
      resendSuppressionHours: 0,
    });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: TUE_10 },
    );
    expect(result).toMatchObject({
      routed: true, suppressed: true, suppressReason: 'outside_weekday',
      ruleId, ruleVersionId: versionId,
    });
    expect(result.enrollments).toEqual([]);
    // 送信済みにしない（シナリオ登録を作らない）
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios WHERE friend_id = 'friend-1'`)
      .get() as { n: number }).toMatchObject({ n: 0 });
  });

  test('時間外は送らず理由を残す', async () => {
    seedRule({ timeWindows: [{ start: '09:00', end: '18:00' }], resendSuppressionHours: 0 });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: new Date('2026-09-07T18:00:00+09:00') },
    );
    expect(result).toMatchObject({ routed: true, suppressed: true, suppressReason: 'outside_time_window' });
    expect(result.enrollments).toEqual([]);
  });

  test('境界時刻: 開始は含み終了は含まない', async () => {
    seedRule({ timeWindows: [{ start: '09:00', end: '18:00' }], resendSuppressionHours: 0 });
    const atStart = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: new Date('2026-09-07T09:00:00+09:00') },
    );
    expect(atStart.suppressed).toBe(false);
    const atEnd = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: new Date('2026-09-07T18:00:00+09:00') },
    );
    expect(atEnd).toMatchObject({ suppressed: true, suppressReason: 'outside_time_window' });
  });

  test('日跨ぎ: 金曜の夜から土曜の明け方まで送り、その後は止める', async () => {
    seedRule({
      weekdays: [5], timeWindows: [{ start: '22:00', end: '02:00' }],
      resendSuppressionHours: 0,
    });
    const fridayNight = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: FRI_23 },
    );
    expect(fridayNight.suppressed).toBe(false);
    // 土曜01:00は「金曜の夜」として送る
    const saturdayEarly = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: SAT_01 },
    );
    expect(saturdayEarly.suppressed).toBe(false);
    // 土曜03:00は帯の外
    const saturdayLate = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: SAT_03 },
    );
    expect(saturdayLate.suppressed).toBe(true);
    // 土曜23:00は時刻内だが曜日が違う
    const saturdayNight = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: SAT_23 },
    );
    expect(saturdayNight).toMatchObject({ suppressed: true, suppressReason: 'outside_weekday' });
  });

  test('初回と再追加で別の公開版を選ぶ', async () => {
    raw.prepare(`INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
      VALUES ('scenario-r', '再追加案内', 'friend_add', 1, 'acc-1')`).run();
    seedRule({ id: 'rule-first', routeIds: ['route-1'], scenarioId: 'scenario-1', resendSuppressionHours: 0 });
    seedRule({
      id: 'rule-ret', kind: 'returning', routeIds: ['route-1'],
      scenarioId: 'scenario-r', resendSuppressionHours: 0,
    });
    insertFriend(raw, 'friend-r', { line_account_id: 'acc-1', unfollow_count: 2 });
    const first = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(first).toMatchObject({ kind: 'first_time', ruleId: 'rule-first' });
    expect(first.enrollments[0]?.scenarioId).toBe('scenario-1');
    const returning = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-r', unfollow_count: 2 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(returning).toMatchObject({ kind: 'returning', ruleId: 'rule-ret' });
    expect(returning.enrollments[0]?.scenarioId).toBe('scenario-r');
  });

  test('再追加の「何も配信しない」は理由付きで抑止する', async () => {
    seedRule({
      kind: 'returning', routeIds: ['route-1'], scenarioId: null,
      returningMode: 'none', resendSuppressionHours: 0,
    });
    insertFriend(raw, 'friend-r', { line_account_id: 'acc-1', unfollow_count: 1 });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-r', unfollow_count: 1 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result).toMatchObject({
      routed: true, suppressed: true, suppressReason: 'delivery_disabled',
    });
    expect(result.enrollments).toEqual([]);
  });

  test('再送制限: 24時間以内の送信済みがあれば抑止する', async () => {
    seedRule({ resendSuppressionHours: 24 });
    seedCompletedEvent({ id: 'evt-1', occurredAt: '2026-09-07T09:00:00.000' });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result).toMatchObject({ routed: true, suppressed: true, suppressReason: 'resend_suppressed' });
    expect(result.enrollments).toEqual([]);
  });

  test('再送制限: 期間外の送信済みは抑止しない', async () => {
    seedRule({ resendSuppressionHours: 24 });
    seedCompletedEvent({ id: 'evt-old', occurredAt: '2026-09-06T09:00:00.000' });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result.suppressed).toBe(false);
    expect(result.enrollments).toHaveLength(1);
  });

  test('再送制限: 抑止された実行は数えない（永久に送れなくしない）', async () => {
    seedRule({ resendSuppressionHours: 24 });
    seedCompletedEvent({ id: 'evt-sup', occurredAt: '2026-09-07T09:30:00.000', status: 'suppressed' });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result.suppressed).toBe(false);
  });

  test('再送制限: 0は制限しない・別アカウントと別友だちは数えない', async () => {
    seedRule({ resendSuppressionHours: 0 });
    seedCompletedEvent({ id: 'evt-1', occurredAt: '2026-09-07T09:50:00.000' });
    const unlimited = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(unlimited.suppressed).toBe(false);

    setupBase('acc-2', 'scenario-2');
    insertFriend(raw, 'friend-9', { line_account_id: 'acc-2', unfollow_count: 0 });
    seedRule({ id: 'rule-acc2', accountId: 'acc-2', scenarioId: 'scenario-2', resendSuppressionHours: 24 });
    // 別の友だちの送信済みは数えない（friend-9の実行があってもfriend-8は送る）
    seedCompletedEvent({ id: 'evt-other-friend', accountId: 'acc-2', friendId: 'friend-9', occurredAt: '2026-09-07T09:50:00.000' });
    insertFriend(raw, 'friend-8', { line_account_id: 'acc-2', unfollow_count: 0 });
    const otherFriend = await applyFriendAddRouting(
      db, 'acc-2', { id: 'friend-8', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(otherFriend).toMatchObject({ ruleId: 'rule-acc2', suppressed: false });
  });

  test('他アカウントの通常ルールは使わない（アカウント境界）', async () => {
    setupBase('acc-2', 'scenario-2');
    seedRule({ id: 'rule-acc2', accountId: 'acc-2', scenarioId: 'scenario-2', resendSuppressionHours: 0 });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result.ruleId).not.toBe('rule-acc2');
  });

  test('友だち条件: 空は通す', async () => {
    seedRule({ friendCondition: '', resendSuppressionHours: 0 });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result.suppressed).toBe(false);
  });

  test('友だち条件: JSONでない旧形式は安全側に抑止する（全員一致にしない）', async () => {
    // 旧形式の社内メモ混じりは通さない。社内メモは internalMemo へ分離する。
    seedRule({ friendCondition: '購入回数が1回以上', resendSuppressionHours: 0 });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result).toMatchObject({
      routed: true, suppressed: true, suppressReason: 'friend_condition_unreadable',
    });
    expect(result.enrollments).toEqual([]);
  });

  test('友だち条件: タグの有無で分け、条件外は送らない', async () => {
    raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '見込み客', 'acc-1')`).run();
    raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('friend-1', 'tag-1')`).run();
    insertFriend(raw, 'friend-no-tag', { line_account_id: 'acc-1', unfollow_count: 0 });
    const condition = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] });
    seedRule({ friendCondition: condition, resendSuppressionHours: 0 });

    const matched = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(matched.suppressed).toBe(false);

    const notMatched = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-no-tag', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(notMatched).toMatchObject({
      routed: true, suppressed: true, suppressReason: 'friend_condition_not_met',
    });
    expect(notMatched.enrollments).toEqual([]);
  });

  test('友だち条件: 社内メモだけのルールは条件なしとして送る', async () => {
    seedRule({ friendCondition: '', internalMemo: '店頭QRの人へ送る', resendSuppressionHours: 0 });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result.suppressed).toBe(false);
    expect(result.enrollments).toHaveLength(1);
  });

  test('友だち条件: 未完成の行を含むJSONは安全側に抑止する', async () => {
    seedRule({
      friendCondition: JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: '' }] }),
      resendSuppressionHours: 0,
    });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result).toMatchObject({
      routed: true, suppressed: true, suppressReason: 'friend_condition_unreadable',
    });
    expect(result.enrollments).toEqual([]);
  });

  test('友だち条件: 壊れたJSONは通さない', async () => {
    seedRule({ friendCondition: '{"operator":', resendSuppressionHours: 0 });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10 },
    );
    expect(result).toMatchObject({
      routed: true, suppressed: true, suppressReason: 'friend_condition_unreadable',
    });
    expect(result.enrollments).toEqual([]);
  });

  test('二重実行: 直前の送信済みがある再追加は抑止する', async () => {
    seedRule({ kind: 'returning', routeIds: ['route-1'], resendSuppressionHours: 24 });
    insertFriend(raw, 'friend-r', { line_account_id: 'acc-1', unfollow_count: 1 });
    // 1回目は送る
    const first = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-r', unfollow_count: 1 }, undefined,
      { entryRouteId: 'route-1', now: new Date('2026-09-07T10:00:00+09:00') },
    );
    expect(first.suppressed).toBe(false);
    // 台帳に送信済みを残した後の2回目は抑止する
    seedCompletedEvent({
      id: 'evt-first', friendId: 'friend-r', occurredAt: '2026-09-07T10:00:00.000',
    });
    const second = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-r', unfollow_count: 1 }, undefined,
      { entryRouteId: 'route-1', now: new Date('2026-09-07T10:30:00+09:00') },
    );
    expect(second).toMatchObject({ suppressed: true, suppressReason: 'resend_suppressed' });
    expect(second.enrollments).toEqual([]);
  });

  test('経路不明は受け皿へ（通常ルールがある経路の条件外とは別）', async () => {
    seedRule({ routeIds: ['route-1'], weekdays: [1], resendSuppressionHours: 0 });
    const unknown = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: null, now: MON_10 },
    );
    // 自動生成の受け皿（シナリオ未選択）は安全側で抑止する
    expect(unknown).toMatchObject({ routed: true, suppressed: true });
  });
});

describe('競合確認API: 日跨ぎの重なりも同じ関数で見る', () => {
  let testDb: SqliteD1;
  const owner: AuthenticatedStaff = {
    id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
  };

  function app(db: D1Database) {
    const instance = new Hono<Env>();
    instance.use('*', async (c, next) => {
      c.env = { DB: db } as Env['Bindings'];
      c.set('staff', owner);
      await next();
    });
    instance.route('/', friendAddRules);
    return instance;
  }

  function seedApiRule(raw: Database.Database, id: string, weekdays: number[], start: string, end: string): void {
    const definition = JSON.stringify({
      routeIds: ['route-1'], scenarioId: 'scenario-1', messageType: 'text',
      messageText: '案内', timing: 'immediate', actions: [],
      friendCondition: '', activeFrom: null, activeUntil: null,
      weekdays, timeWindows: [{ start, end }],
    });
    raw.prepare(
      `INSERT INTO friend_add_rules
        (id, line_account_id, friend_kind, name, priority, status, current_version_id, created_at, updated_at)
       VALUES (?, 'account-1', 'first_time', ?, 1, 'published', ?, '2026-09-07T09:00:00.000', '2026-09-07T09:00:00.000')`,
    ).run(id, id, `${id}-v1`);
    raw.prepare(
      `INSERT INTO friend_add_rule_versions
        (id, rule_id, version_number, definition_snapshot, status, published_at)
       VALUES (?, ?, 1, ?, 'published', '2026-09-07T09:00:00.000')`,
    ).run(`${id}-v1`, id, definition);
  }

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')").run();
    testDb.raw.prepare(
      `INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, tenant_id)
       VALUES ('owner-1', 'オーナー', 'owner', 'owner-key', 'tenant-1')`,
    ).run();
    seedApiRule(testDb.raw, 'rule-a', [5], '22:00', '02:00');
    seedApiRule(testDb.raw, 'rule-b', [5, 6], '23:00', '01:00');
  });

  afterEach(() => testDb.raw.close());

  test('日跨ぎ同士の重なりを報告する', async () => {
    const response = await app(testDb.db).request(
      '/api/friend-add-rules/conflicts?account_id=account-1&kind=first_time',
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { conflicts: Array<{ code: string; ruleIds: string[] }> };
    };
    const codes = body.data.conflicts.map((conflict) => conflict.code);
    expect(codes).toContain('overlapping_weekday');
    // 単純な文字列比較では見落とす重なりを報告する
    expect(codes).toContain('overlapping_time');
  });
});
