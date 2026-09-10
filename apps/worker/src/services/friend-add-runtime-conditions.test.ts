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
import { parseFriendAddConditionAst } from './friend-add-routing.js';
import { buildSegmentWhere, parseCondition } from './segment-query.js';
import { friendAddRules } from '../routes/friend-add-rules.js';
import { toJstParts } from '@line-crm/shared';

// 2026-09-07は月曜（2026-09-08火曜の前日）。祝日ではない週を使う。
const MON_10 = new Date('2026-09-07T10:00:00+09:00');
const TUE_10 = new Date('2026-09-08T10:00:00+09:00');
const FRI_23 = new Date('2026-09-11T23:00:00+09:00');
const SAT_01 = new Date('2026-09-12T01:00:00+09:00');
const SAT_03 = new Date('2026-09-12T03:00:00+09:00');
const SAT_23 = new Date('2026-09-12T23:00:00+09:00');
const SAT_00_45 = new Date('2026-09-12T00:45:00+09:00');

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

  test('不正な時間帯は「制限なし」に読み替えず送らない（fail-closed）', () => {
    // 99:99 のような不正帯が混ざったら、その設定では送らない
    expect(evaluateFriendAddSchedule(
      { weekdays: [], timeWindows: [{ start: '09:00', end: '99:99' }] },
      MON_10,
    )).toEqual({ matched: false, reason: 'invalid_time_window' });
    // 曜日指定があっても不正帯を優先する（送らない）
    expect(evaluateFriendAddSchedule(
      { weekdays: [1], timeWindows: [{ start: '09:00', end: '99:99' }] },
      MON_10,
    )).toEqual({ matched: false, reason: 'invalid_time_window' });
    // 配列でない・中身が壊れた既存値も「制限なし」に読み替えない
    expect(evaluateFriendAddSchedule(
      { weekdays: [], timeWindows: 'oops' as unknown as { start: string; end: string }[] },
      MON_10,
    )).toEqual({ matched: false, reason: 'invalid_time_window' });
    expect(evaluateFriendAddSchedule(
      { weekdays: [], timeWindows: [null] as unknown as { start: string; end: string }[] },
      MON_10,
    )).toEqual({ matched: false, reason: 'invalid_time_window' });
    // 欄自体がない昔の設定は制限なしのまま送る
    expect(evaluateFriendAddSchedule({ weekdays: [], timeWindows: undefined }, MON_10))
      .toEqual({ matched: true, reason: null });
  });

  test('複数帯の日跨ぎは帯ごとに曜日を見る', () => {
    const windows = [{ start: '22:00', end: '02:00' }, { start: '00:30', end: '01:00' }];
    // 土曜00:45は土曜の帯（00:30〜01:00）にいるので土曜指定で送る。
    // 別の帯の日跨ぎに引きずられて金曜扱いにしない。
    expect(evaluateFriendAddSchedule({ weekdays: [6], timeWindows: windows }, SAT_00_45))
      .toEqual({ matched: true, reason: null });
    // 金曜指定でも金曜夜の帯（22:00〜02:00）にいるので送る
    expect(evaluateFriendAddSchedule({ weekdays: [5], timeWindows: windows }, SAT_00_45))
      .toEqual({ matched: true, reason: null });
    // 単一帯の日跨ぎは従来どおり（土曜01:00は金曜の夜）
    expect(evaluateFriendAddSchedule(
      { weekdays: [5], timeWindows: [{ start: '22:00', end: '02:00' }] }, SAT_01,
    )).toEqual({ matched: true, reason: null });
    expect(evaluateFriendAddSchedule(
      { weekdays: [6], timeWindows: [{ start: '22:00', end: '02:00' }] }, SAT_01,
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
    // 意味が違うJSONでも両方持つ人がいれば競合にする（tag-1 対 tag-2）
    const other = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-2' }] });
    expect(areFriendAddConditionsOverlapping(compact, other)).toBe(true);
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
    // どの枝も両立しない入れ子は競合にしない
    const different = JSON.stringify({
      operator: 'AND',
      rules: [],
      groups: [
        {
          operator: 'AND',
          rules: [
            { type: 'tag_not_exists', value: 'tag-1' },
            { type: 'is_following', value: false },
          ],
        },
      ],
    });
    expect(areFriendAddConditionsOverlapping(left, different)).toBe(false);
  });

  test('部分重複は共有する絞り込みで競合にする', () => {
    const tag1 = { type: 'tag_exists', value: 'tag-1' };
    const following = { type: 'is_following', value: true };
    const tag2 = { type: 'tag_exists', value: 'tag-2' };
    // AND条件の包含関係: tag-1 と tag-1 AND following
    const onlyTag1 = JSON.stringify({ operator: 'AND', rules: [tag1] });
    const tag1AndFollowing = JSON.stringify({ operator: 'AND', rules: [tag1, following] });
    expect(areFriendAddConditionsOverlapping(onlyTag1, tag1AndFollowing)).toBe(true);
    // OR条件の共有枝: tag-1 OR following と tag-1 OR tag-2
    const tag1OrFollowing = JSON.stringify({ operator: 'OR', rules: [tag1, following] });
    const tag1OrTag2 = JSON.stringify({ operator: 'OR', rules: [tag1, tag2] });
    expect(areFriendAddConditionsOverlapping(tag1OrFollowing, tag1OrTag2)).toBe(true);
    // 入れ子を含む部分重複: 表の rules が空でも groups の中をたどる
    const nested = JSON.stringify({
      operator: 'AND',
      rules: [tag2],
      groups: [{ operator: 'OR', rules: [tag1, following] }],
    });
    expect(areFriendAddConditionsOverlapping(onlyTag1, nested)).toBe(true);
  });

  test('充足可能性で判定する（反例つき）', () => {
    const tag1 = { type: 'tag_exists', value: 'tag-1' };
    const tag2 = { type: 'tag_exists', value: 'tag-2' };
    const following = { type: 'is_following', value: true };
    const notFollowing = { type: 'is_following', value: false };
    // 反例: tag-1 対 tag-2 は両方持つ人がいるので重なる
    const onlyTag1 = JSON.stringify({ operator: 'AND', rules: [tag1] });
    const onlyTag2 = JSON.stringify({ operator: 'AND', rules: [tag2] });
    expect(areFriendAddConditionsOverlapping(onlyTag1, onlyTag2)).toBe(true);
    // 反例: 矛盾AND（following かつ not following）は誰にも一致しないので重ならない
    const contradiction = JSON.stringify({ operator: 'AND', rules: [following, notFollowing] });
    expect(areFriendAddConditionsOverlapping(contradiction, onlyTag1)).toBe(false);
    // 向こう側のANDの中で矛盾しても重ならない
    const tag1AndFollowing = JSON.stringify({ operator: 'AND', rules: [tag1, following] });
    const tag2AndNotFollowing = JSON.stringify({ operator: 'AND', rules: [tag2, notFollowing] });
    expect(areFriendAddConditionsOverlapping(tag1AndFollowing, tag2AndNotFollowing)).toBe(false);
    // 入れ子のORをほぐして両立する枝があれば重なる
    const nestedOr = JSON.stringify({
      operator: 'AND',
      rules: [tag1],
      groups: [{ operator: 'OR', rules: [following, tag2] }],
    });
    const tag2AndFollowing = JSON.stringify({ operator: 'AND', rules: [tag2, following] });
    expect(areFriendAddConditionsOverlapping(nestedOr, tag2AndFollowing)).toBe(true);
    // 区間が重ならないスコアは重ならない、重なれば重なる
    const lowScore = JSON.stringify({ operator: 'AND', rules: [{ type: 'score_range', value: { min: 0, max: 10 } }] });
    const highScore = JSON.stringify({ operator: 'AND', rules: [{ type: 'score_range', value: { min: 20, max: 30 } }] });
    const midScore = JSON.stringify({ operator: 'AND', rules: [{ type: 'score_range', value: { min: 10, max: 30 } }] });
    expect(areFriendAddConditionsOverlapping(lowScore, highScore)).toBe(false);
    expect(areFriendAddConditionsOverlapping(lowScore, midScore)).toBe(true);
  });

  test('重ならない条件・演算子違いを取り違えない', () => {
    const tag1 = { type: 'tag_exists', value: 'tag-1' };
    const tag2 = { type: 'tag_exists', value: 'tag-2' };
    const following = { type: 'is_following', value: true };
    const notFollowing = { type: 'is_following', value: false };
    // 非重複: 両立しない絞り同士
    const onlyFollowing = JSON.stringify({ operator: 'AND', rules: [following] });
    const onlyNotFollowing = JSON.stringify({ operator: 'AND', rules: [notFollowing] });
    expect(areFriendAddConditionsOverlapping(onlyFollowing, onlyNotFollowing)).toBe(false);
    // 演算子が違っても両立しなければ競合にしない
    const tag1AndFollowing = JSON.stringify({ operator: 'AND', rules: [tag1, following] });
    const notFollowingOrBoth = JSON.stringify({
      operator: 'OR',
      rules: [notFollowing],
      groups: [{ operator: 'AND', rules: [notFollowing, tag2] }],
    });
    expect(areFriendAddConditionsOverlapping(tag1AndFollowing, notFollowingOrBoth)).toBe(false);
    // 演算子が違っても両立すれば競合にする（演算子だけ見て false にしない）
    const tag1OrTag2 = JSON.stringify({ operator: 'OR', rules: [tag1, tag2] });
    expect(areFriendAddConditionsOverlapping(tag1AndFollowing, tag1OrTag2)).toBe(true);
    // 紹介コードが違えば同じ人ではない
    const refA = JSON.stringify({ operator: 'AND', rules: [{ type: 'ref_code', value: 'AAA' }] });
    const refB = JSON.stringify({ operator: 'AND', rules: [{ type: 'ref_code', value: 'BBB' }] });
    expect(areFriendAddConditionsOverlapping(refA, refB)).toBe(false);
    // 反応なしと返信ありは両立しない。反応なしと「なんでも」は両立する
    const noReaction = JSON.stringify({ operator: 'AND', rules: [{ type: 'reaction_state', value: 'none' }] });
    const replied = JSON.stringify({ operator: 'AND', rules: [{ type: 'reaction_state', value: 'reply' }] });
    const anyReaction = JSON.stringify({ operator: 'AND', rules: [{ type: 'reaction_state', value: 'any' }] });
    expect(areFriendAddConditionsOverlapping(noReaction, replied)).toBe(false);
    expect(areFriendAddConditionsOverlapping(noReaction, anyReaction)).toBe(true);
  });

  test('種類が違う否定の組み合わせも充足不能にする', () => {
    const hasA = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-A' }] });
    // tag-A を持つ条件と「tag-Aだけを持たない」条件は両立しない
    const missOnlyA = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_not_all', value: ['tag-A'] }] });
    expect(areFriendAddConditionsOverlapping(hasA, missOnlyA)).toBe(false);
    // 「tag-Aかtag-Bのどちらかを持たない」なら tag-B を持たずに両立する
    const missAorB = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_not_all', value: ['tag-A', 'tag-B'] }] });
    expect(areFriendAddConditionsOverlapping(hasA, missAorB)).toBe(true);
    // 同じ欄・同じ値の equals と not_equals は両立しない
    const equalsTokyo = JSON.stringify({
      operator: 'AND', rules: [{ type: 'metadata_equals', value: { key: 'area', value: 'tokyo' } }],
    });
    const notEqualsTokyo = JSON.stringify({
      operator: 'AND', rules: [{ type: 'metadata_not_equals', value: { key: 'area', value: 'tokyo' } }],
    });
    const notEqualsOsaka = JSON.stringify({
      operator: 'AND', rules: [{ type: 'metadata_not_equals', value: { key: 'area', value: 'osaka' } }],
    });
    const notEqualsGenre = JSON.stringify({
      operator: 'AND', rules: [{ type: 'metadata_not_equals', value: { key: 'genre', value: 'tokyo' } }],
    });
    expect(areFriendAddConditionsOverlapping(equalsTokyo, notEqualsTokyo)).toBe(false);
    expect(areFriendAddConditionsOverlapping(equalsTokyo, notEqualsOsaka)).toBe(true);
    expect(areFriendAddConditionsOverlapping(equalsTokyo, notEqualsGenre)).toBe(true);
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

/*
 * 条件木の検証は最外だけでは足りない、という再現。
 * 旧来の入口 `parseCondition` は入れ子を見ないため、operator の抜けた
 * グループを通す。通ると `buildSegmentWhere` は既定の OR で組み立てる。
 */
describe('条件木の再帰検証（純粋関数）', () => {
  // 入れ子側は「タグ2とタグ3の両方を持つ人」のつもり。operator が抜けている。
  const nestedWithoutOperator = JSON.stringify({
    operator: 'AND',
    rules: [],
    groups: [
      { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] },
      {
        rules: [
          { type: 'tag_exists', value: 'tag-2' },
          { type: 'tag_exists', value: 'tag-3' },
        ],
      },
    ],
  });

  test('旧来の入口は入れ子の operator 欠落を通し、ORとして組み立ててしまう', () => {
    const parsed = parseCondition(nestedWithoutOperator);
    expect(parsed).not.toBeNull();
    // 「両方を満たす人」のつもりが OR でつながり、片方だけの人にも届く
    const sql = buildSegmentWhere(parsed!).sql;
    expect(sql).toContain(' OR ');
    expect(sql).not.toContain('ft.tag_id = ? AND EXISTS');
  });

  test('再帰検証は同じ条件を断る', () => {
    expect(parseFriendAddConditionAst(nestedWithoutOperator)).toEqual({
      ok: false, error: 'bad_operator',
    });
  });

  test('空・自由文・壊れたJSON・深すぎる入れ子・大きすぎる条件を見分ける', () => {
    expect(parseFriendAddConditionAst('')).toEqual({ ok: true, condition: null });
    // 自由文（旧形式のメモ）と、書こうとして壊れたJSONを分ける。
    // 前者は保存を止めず実行時に抑止、後者は保存時に断る。
    expect(parseFriendAddConditionAst('タグ「店頭QR者」')).toEqual({ ok: false, error: 'legacy_text' });
    expect(parseFriendAddConditionAst('{"operator":')).toEqual({ ok: false, error: 'not_json' });
    expect(parseFriendAddConditionAst('[]')).toEqual({ ok: false, error: 'not_object' });
    expect(parseFriendAddConditionAst('{"operator":"AND"}')).toEqual({ ok: false, error: 'bad_rules' });
    expect(parseFriendAddConditionAst('{"operator":"AND","rules":[],"groups":{}}'))
      .toEqual({ ok: false, error: 'bad_groups' });
    expect(parseFriendAddConditionAst(
      JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: '' }] }),
    )).toEqual({ ok: false, error: 'unbuildable' });

    // 深さの上限（9段）を超える入れ子
    let deep: Record<string, unknown> = { operator: 'AND', rules: [] };
    for (let i = 0; i < 9; i++) deep = { operator: 'AND', rules: [], groups: [deep] };
    expect(parseFriendAddConditionAst(JSON.stringify(deep))).toEqual({ ok: false, error: 'too_deep' });

    // ノード数の上限（201件）を超える条件
    const many = {
      operator: 'AND',
      rules: Array.from({ length: 201 }, () => ({ type: 'tag_exists', value: 'tag-1' })),
    };
    expect(parseFriendAddConditionAst(JSON.stringify(many))).toEqual({ ok: false, error: 'too_large' });
  });

  test('正しい入れ子は通す', () => {
    const ok = parseFriendAddConditionAst(JSON.stringify({
      operator: 'AND',
      rules: [{ type: 'is_following', value: true }],
      groups: [{ operator: 'OR', rules: [{ type: 'tag_exists', value: 'tag-1' }] }],
    }));
    expect(ok.ok).toBe(true);
  });
});

describe('本番の振り分け: 曜日・時間帯・条件・再送制限', () => {
  let testDb: SqliteD1;
  let raw: Database.Database;
  let db: D1Database;

  function setupBase(accountId = 'acc-1', scenarioId = 'scenario-1'): void {
    raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    raw.prepare(
      `INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token, tenant_id)
       VALUES (?, 'テスト', ?, ?, ?, 'tenant-1')`,
    ).run(accountId, `channel-${accountId}`, `secret-${accountId}`, `token-${accountId}`);
    raw.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
       VALUES (?, '案内', 'friend_add', 1, ?)`,
    ).run(scenarioId, accountId);
    // 実行時は設定が指す流入リンクの持ち物も確かめるので、実データを置く。
    // 同じテナントの共有リンク（所有アカウント未設定）として置き、
    // どちらのアカウントの設定からも使える形にする。
    raw.prepare(
      `INSERT OR IGNORE INTO entry_routes (id, name, ref_code, is_active, tenant_id)
       VALUES ('route-1', '紹介QR', 'REF001', 1, 'tenant-1')`,
    ).run();
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
      routed: true, suppressed: true, suppressReason: 'friend_condition_invalid',
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

  test('送信権なし: 選ぶだけ選んで登録も送信もしない', async () => {
    seedRule({ routeIds: ['route-1'], resendSuppressionHours: 0 });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10, sendRight: false },
    );
    expect(result).toMatchObject({
      routed: true, suppressed: true, suppressReason: 'duplicate_in_flight',
    });
    expect(result.enrollments).toEqual([]);
    // 勝った側の cron が拾う登録を残さない
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios`).get()).toEqual({ n: 0 });
  });

  test('送信権なし（予約失敗）: 理由を残して抑止する', async () => {
    seedRule({ routeIds: ['route-1'], resendSuppressionHours: 0 });
    const result = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
      { entryRouteId: 'route-1', now: MON_10, sendRight: false, claimError: true },
    );
    expect(result).toMatchObject({
      routed: true, suppressed: true, suppressReason: 'send_claim_unavailable',
    });
    expect(result.enrollments).toEqual([]);
  });

  test('再送可能: 送れなかった実行（partial_failed）は再送制限に数えない', async () => {
    seedRule({ kind: 'returning', routeIds: ['route-1'], resendSuppressionHours: 24 });
    insertFriend(raw, 'friend-r', { line_account_id: 'acc-1', unfollow_count: 1 });
    // 送れなかった実行が残っていても、次の追加では選び直す（抑止しない）
    seedCompletedEvent({
      id: 'evt-partial', friendId: 'friend-r', occurredAt: '2026-09-07T10:00:00.000',
      status: 'partial_failed',
    });
    const retry = await applyFriendAddRouting(
      db, 'acc-1', { id: 'friend-r', unfollow_count: 1 }, undefined,
      { entryRouteId: 'route-1', now: new Date('2026-09-07T10:30:00+09:00') },
    );
    expect(retry.suppressed).toBe(false);
    expect(retry.suppressReason).not.toBe('resend_suppressed');
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

  /*
   * 条件木は入れ子まで検証する。`parseCondition` は最外だけを見るため、
   * 入れ子グループの operator が抜けていても通り、実行時に既定の OR へ
   * 読み替わる。「両方を満たす人」で絞ったつもりが「どちらかを満たす人
   * すべて」に広がり、送ってはいけない相手に届く。
   */
  describe('条件木の再帰検証', () => {
    test('入れ子グループの operator が無い条件は送らない（ORへ読み替えない）', async () => {
      const nested = JSON.stringify({
        operator: 'AND',
        rules: [],
        groups: [
          { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] },
          // operator が抜けている。旧実装はこれを OR として扱った。
          { rules: [{ type: 'tag_exists', value: 'tag-2' }] },
        ],
      });
      seedRule({ friendCondition: nested, resendSuppressionHours: 0 });
      const result = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(result).toMatchObject({
        routed: true, suppressed: true, suppressReason: 'friend_condition_invalid',
      });
      expect(result.enrollments).toEqual([]);
    });

    test('入れ子グループの operator が不正な文字列でも送らない', async () => {
      const nested = JSON.stringify({
        operator: 'AND',
        rules: [],
        groups: [{ operator: 'and', rules: [{ type: 'tag_exists', value: 'tag-1' }] }],
      });
      seedRule({ friendCondition: nested, resendSuppressionHours: 0 });
      const result = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(result).toMatchObject({ suppressed: true, suppressReason: 'friend_condition_invalid' });
    });

    test('入れ子の中に使えない種別があれば送らない', async () => {
      const nested = JSON.stringify({
        operator: 'AND',
        rules: [],
        groups: [{
          operator: 'OR',
          rules: [{ type: 'tag_exists', value: 'tag-1' }],
          groups: [{ operator: 'AND', rules: [{ type: 'sql_injection', value: 'x' }] }],
        }],
      });
      seedRule({ friendCondition: nested, resendSuppressionHours: 0 });
      const result = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(result).toMatchObject({ suppressed: true, suppressReason: 'friend_condition_invalid' });
    });

    test('入れ子の中に値の足りない行があれば送らない', async () => {
      const nested = JSON.stringify({
        operator: 'AND',
        rules: [],
        groups: [{ operator: 'AND', rules: [{ type: 'tag_all', value: [] }] }],
      });
      seedRule({ friendCondition: nested, resendSuppressionHours: 0 });
      const result = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(result).toMatchObject({ suppressed: true, suppressReason: 'friend_condition_invalid' });
    });

    test('正しい入れ子は通し、実データで評価する', async () => {
      raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '来店', 'acc-1')`).run();
      raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('friend-1', 'tag-1')`).run();
      const nested = JSON.stringify({
        operator: 'AND',
        rules: [],
        groups: [{
          operator: 'OR',
          rules: [{ type: 'tag_exists', value: 'tag-1' }],
          groups: [{ operator: 'AND', rules: [{ type: 'is_following', value: true }] }],
        }],
      });
      seedRule({ friendCondition: nested, resendSuppressionHours: 0 });
      const result = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(result).toMatchObject({ suppressed: false, suppressReason: null });
      expect(result.enrollments).toHaveLength(1);
    });
  });

  /*
   * 保存のあとでもタグ・シナリオは消せる・別アカウントへ移せる。
   * 公開版のスナップショットは古い参照を抱えたまま動くので、実行時にも
   * 持ち物かを確かめる。別アカウントの持ち物を指していたら送らない。
   */
  describe('参照の所属（実行時）', () => {
    test('友だち条件が別アカウントのタグを指していたら送らない', async () => {
      setupBase('acc-2', 'scenario-2');
      raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-x', '他店タグ', 'acc-2')`).run();
      seedRule({
        friendCondition: JSON.stringify({
          operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-x' }],
        }),
        resendSuppressionHours: 0,
      });
      const result = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(result).toMatchObject({
        routed: true, suppressed: true, suppressReason: 'reference_out_of_account',
      });
      expect(result.enrollments).toEqual([]);
    });

    test('配信するシナリオが別アカウントの持ち物になったら送らない', async () => {
      setupBase('acc-2', 'scenario-2');
      seedRule({ scenarioId: 'scenario-2', resendSuppressionHours: 0 });
      const result = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(result).toMatchObject({ suppressed: true, suppressReason: 'reference_out_of_account' });
      expect(result.enrollments).toEqual([]);
      // 他アカウントのシナリオへ登録していない
      expect(raw.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios`).get()).toEqual({ n: 0 });
    });

    test('所有者が未設定のタグは使えない扱いにする（どのアカウントの持ち物か言い切れない）', async () => {
      raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-legacy', '旧タグ', NULL)`).run();
      raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('friend-1', 'tag-legacy')`).run();
      seedRule({
        friendCondition: JSON.stringify({
          operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-legacy' }],
        }),
        resendSuppressionHours: 0,
      });
      const result = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(result).toMatchObject({ suppressed: true, suppressReason: 'reference_out_of_account' });
      expect(result.enrollments).toEqual([]);
    });

    test('消えたタグを指す条件では送らない（絞れていない状態で配らない）', async () => {
      seedRule({
        friendCondition: JSON.stringify({
          operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-deleted' }],
        }),
        resendSuppressionHours: 0,
      });
      const result = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(result).toMatchObject({ suppressed: true, suppressReason: 'reference_out_of_account' });
      expect(result.enrollments).toEqual([]);
    });

    /*
     * 参照の収集は入れ子グループの中まで降りる必要がある。1段目しか見ないと、
     * 入れ子に他店のタグを1つ混ぜるだけで所属の検査を素通りできてしまう。
     */
    test('入れ子グループの中の他店タグも見つけて止める', async () => {
      setupBase('acc-2', 'scenario-2');
      raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-mine', '自店', 'acc-1')`).run();
      raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-far', '他店', 'acc-2')`).run();
      // 1段目は自店のタグだけ。他店のタグは2段目の入れ子に置く。
      seedRule({
        friendCondition: JSON.stringify({
          operator: 'AND',
          rules: [{ type: 'tag_exists', value: 'tag-mine' }],
          groups: [{
            operator: 'OR',
            rules: [],
            groups: [{ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-far' }] }],
          }],
        }),
        resendSuppressionHours: 0,
      });
      const result = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(result).toMatchObject({ suppressed: true, suppressReason: 'reference_out_of_account' });
      expect(result.enrollments).toEqual([]);
    });

    test('入れ子グループの中の消えたシナリオ・友だち情報欄も見つけて止める', async () => {
      raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-ok', '自店', 'acc-1')`).run();
      for (const nested of [
        { type: 'scenario_state', value: { scenarioId: 'scenario-gone', state: 'subscribed' } },
        { type: 'friend_field', value: { fieldId: 'field-gone', op: 'exists', text: '' } },
      ]) {
        seedRule({
          id: `rule-nested-${nested.type}`,
          friendCondition: JSON.stringify({
            operator: 'AND',
            rules: [{ type: 'tag_exists', value: 'tag-ok' }],
            groups: [{ operator: 'AND', rules: [nested] }],
          }),
          resendSuppressionHours: 0,
        });
        const result = await applyFriendAddRouting(
          db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
          { entryRouteId: 'route-1', now: MON_10 },
        );
        expect(result.suppressReason).toBe('reference_out_of_account');
        raw.prepare(`DELETE FROM friend_add_rules WHERE id = ?`).run(`rule-nested-${nested.type}`);
      }
    });

    test('条件の中のフォーム・対応マークも存在を確かめる', async () => {
      seedRule({
        friendCondition: JSON.stringify({
          operator: 'AND', rules: [{ type: 'form_answered', value: 'form-deleted' }],
        }),
        resendSuppressionHours: 0,
      });
      const missing = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(missing).toMatchObject({ suppressed: true, suppressReason: 'reference_out_of_account' });

      raw.prepare(
        `INSERT INTO forms (id, name, fields) VALUES ('form-1', 'アンケート', '[]')`,
      ).run();
      raw.prepare(
        `INSERT INTO form_submissions (id, form_id, friend_id, data)
         VALUES ('sub-1', 'form-1', 'friend-1', '{}')`,
      ).run();
      seedRule({
        id: 'rule-form-ok',
        friendCondition: JSON.stringify({
          operator: 'AND', rules: [{ type: 'form_answered', value: 'form-1' }],
        }),
        resendSuppressionHours: 0,
      });
      const present = await applyFriendAddRouting(
        db, 'acc-1', { id: 'friend-1', unfollow_count: 0 }, undefined,
        { entryRouteId: 'route-1', now: MON_10 },
      );
      expect(present.suppressReason).not.toBe('reference_out_of_account');
    });
  });
});
