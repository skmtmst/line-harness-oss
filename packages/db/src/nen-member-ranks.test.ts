import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_NEN_RANKS,
  NenRankValidationError,
  ensureNenRankDefaults,
  getNenLifetimeMilestones,
  getNenMemberKpis,
  getNenRankRules,
  getNenRankSettings,
  listNenMembers,
  resolveRank,
  saveNenLifetimeMilestones,
  saveNenRankSettings,
  setNenRankSyncStatus,
  validateNenRankInputs,
} from './nen-member-ranks.js';

/**
 * 会員ランク（通年）の設定と一覧。★V6 37-1 / 37-1-A / 37-1-B。
 * bootstrap.sql（migration 410 を含む）を流した実SQLiteで、
 * 「初期値が1回だけ入る」「保存で版が上がり同期待ちに戻る」「レギュラーは消せない」
 * 「一覧が見える範囲と絞り込みを守る」を固定する。
 */

const packageRoot = join(import.meta.dirname, '..');
const bootstrap = readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8');

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
  return { prepare } as unknown as D1Database;
}

const ACCOUNT = 'account-nen';
const NOW = '2026-09-16T10:00:00.000';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(bootstrap);
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('${ACCOUNT}', 'channel-nen', '然', 'token', 'secret'), ('account-other', 'channel-o', '別', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at) VALUES
      ('friend-a', 'U-a', '山田 太郎', '${ACCOUNT}', 1, '${NOW}', '${NOW}'),
      ('friend-b', 'U-b', '鈴木 一郎', '${ACCOUNT}', 1, '${NOW}', '${NOW}'),
      ('friend-c', 'U-c', '別店の人', 'account-other', 1, '${NOW}', '${NOW}'),
      ('friend-d', 'U-d', 'ブロック中', '${ACCOUNT}', 0, '${NOW}', '${NOW}');
    INSERT INTO nen_ec_member_snapshots (friend_id, customer_id, purchase_count, purchase_amount, point_balance, member_rank, synced_at,
      annual_miles_yen, lifetime_miles_yen, member_rank_key, mile_rate_percent, mile_balance, miles_used_this_month, last_purchased_at) VALUES
      ('friend-a', '10231', 12, 412300, 2840, 'プラチナ', '${NOW}', 138600, 412300, 'platinum', 3, 2840, 500, '2026-09-12'),
      ('friend-b', '10877', 5, 96800, 1120, 'ゴールド', '${NOW}', 72400, 96800, 'gold', 2, 1120, 0, '2026-09-10'),
      ('friend-c', '20000', 1, 5000, 0, '会員', '${NOW}', 5000, 5000, 'regular', 1, 0, 0, NULL),
      ('friend-d', '30000', 1, 5000, 0, '会員', '${NOW}', 5000, 5000, 'regular', 1, 0, 0, NULL);
    INSERT INTO nen_pet_profiles (id, friend_id, name, animal_type, created_at, updated_at) VALUES
      ('pet-a1', 'friend-a', 'そら', 'dog', '${NOW}', '${NOW}'),
      ('pet-a2', 'friend-a', 'ハナ', 'dog', '${NOW}', '${NOW}'),
      ('pet-b1', 'friend-b', 'むぎ', 'cat', '${NOW}', '${NOW}');
  `);
  db = asD1(sqlite);
});

describe('ensureNenRankDefaults', () => {
  it('初期の4ランク・ルール・4節目を1回だけ入れ、既存のランクタグにつなぐ', async () => {
    await ensureNenRankDefaults(db, ACCOUNT, NOW);
    await ensureNenRankDefaults(db, ACCOUNT, NOW);
    const ranks = await getNenRankSettings(db, ACCOUNT);
    expect(ranks.map((r) => [r.rank_key, r.annual_threshold_yen, r.mile_rate_percent, r.tag_id])).toEqual(
      DEFAULT_NEN_RANKS.map((r) => [r.key, r.thresholdYen, r.ratePercent, r.tagId]),
    );
    expect((await getNenRankRules(db, ACCOUNT))?.version).toBe(1);
    expect((await getNenLifetimeMilestones(db, ACCOUNT)).map((m) => m.threshold_yen)).toEqual([300_000, 600_000, 1_000_000, 2_000_000]);
  });
});

describe('saveNenRankSettings', () => {
  it('しきい値順に並べ直し、版を上げて同期待ちに戻す。渡さなかった行は消える', async () => {
    await ensureNenRankDefaults(db, ACCOUNT, NOW);
    const before = await getNenRankSettings(db, ACCOUNT);
    const regular = before.find((r) => r.rank_key === 'regular')!;
    const silver = before.find((r) => r.rank_key === 'silver')!;
    await setNenRankSyncStatus(db, ACCOUNT, 'synced', null, NOW);
    const saved = await saveNenRankSettings(db, ACCOUNT, [
      { name: 'ダイヤモンド', annualThresholdYen: 300_000, mileRatePercent: 5 },
      { id: silver.id, name: 'シルバー', annualThresholdYen: 40_000, mileRatePercent: 1.5 },
      { id: regular.id, name: 'レギュラー', annualThresholdYen: 0, mileRatePercent: 1 },
    ], NOW);
    expect(saved.map((r) => [r.name, r.annual_threshold_yen])).toEqual([
      ['レギュラー', 0], ['シルバー', 40_000], ['ダイヤモンド', 300_000],
    ]);
    expect(saved.find((r) => r.name === 'シルバー')?.id).toBe(silver.id);
    expect(saved.find((r) => r.name === 'ダイヤモンド')?.tag_id).toBeNull();
    const rules = await getNenRankRules(db, ACCOUNT);
    expect(rules?.version).toBe(2);
    expect(rules?.sync_status).toBe('pending');
  });

  it('検証：0円のランクが無い・重なる・還元率が範囲外は保存しない', () => {
    expect(() => validateNenRankInputs([{ name: 'A', annualThresholdYen: 1000, mileRatePercent: 1 }])).toThrow(NenRankValidationError);
    expect(() => validateNenRankInputs([
      { name: 'A', annualThresholdYen: 0, mileRatePercent: 1 },
      { name: 'B', annualThresholdYen: 0, mileRatePercent: 2 },
    ])).toThrow('同じしきい値');
    expect(() => validateNenRankInputs([{ name: 'A', annualThresholdYen: 0, mileRatePercent: 11 }])).toThrow('マイル還元');
    expect(() => validateNenRankInputs([{ name: '', annualThresholdYen: 0, mileRatePercent: 1 }])).toThrow('ランク名');
  });
});

describe('saveNenLifetimeMilestones', () => {
  it('金額順に保存し、消した節目は無くなる', async () => {
    await ensureNenRankDefaults(db, ACCOUNT, NOW);
    const saved = await saveNenLifetimeMilestones(db, ACCOUNT, [
      { thresholdYen: 500_000, title: 'NEN FAMILY', notifyOnReach: true },
      { thresholdYen: 100_000, title: 'はじめの一歩', notifyOnReach: false },
    ], NOW);
    expect(saved.map((m) => [m.threshold_yen, m.title, m.notify_on_reach])).toEqual([[100_000, 'はじめの一歩', 0], [500_000, 'NEN FAMILY', 1]]);
    expect((await getNenRankRules(db, ACCOUNT))?.version).toBe(2);
  });
});

describe('resolveRank', () => {
  it('通年の金額でしきい値以上の最上位を選び、ECのランクキーがあればそれを優先する', async () => {
    await ensureNenRankDefaults(db, ACCOUNT, NOW);
    const ranks = await getNenRankSettings(db, ACCOUNT);
    expect(resolveRank(ranks, 72_400).rank?.rank_key).toBe('gold');
    expect(resolveRank(ranks, 72_400).next?.rank_key).toBe('platinum');
    expect(resolveRank(ranks, 0).rank?.rank_key).toBe('regular');
    expect(resolveRank(ranks, 999_999).next).toBeNull();
    expect(resolveRank(ranks, 0, 'platinum').rank?.rank_key).toBe('platinum');
    expect(resolveRank(ranks, 72_400, 'unknown-key').rank?.rank_key).toBe('gold');
  });
});

describe('listNenMembers / getNenMemberKpis', () => {
  it('見える範囲の友だちだけを通年の多い順に返し、ペットの頭数と名前が付く', async () => {
    const { items, total } = await listNenMembers(db, { accountIds: [ACCOUNT] });
    expect(total).toBe(2);
    expect(items.map((i) => i.friend_id)).toEqual(['friend-a', 'friend-b']);
    expect(items[0]!.pet_count).toBe(2);
    expect(items[0]!.pet_names).toBe('そら（犬）、ハナ（犬）');
    expect(items[1]!.pet_names).toBe('むぎ（猫）');
  });

  it('ランク・ペットの有無・検索で絞り込める', async () => {
    expect((await listNenMembers(db, { accountIds: [ACCOUNT], rankKey: 'gold' })).items.map((i) => i.friend_id)).toEqual(['friend-b']);
    expect((await listNenMembers(db, { accountIds: [ACCOUNT], query: '10231' })).items.map((i) => i.friend_id)).toEqual(['friend-a']);
    expect((await listNenMembers(db, { accountIds: [ACCOUNT], query: '鈴木' })).items.map((i) => i.friend_id)).toEqual(['friend-b']);
    expect((await listNenMembers(db, { accountIds: [], })).total).toBe(0);
  });

  it('数値カードの合計はブロック中と別アカウントを含めない', async () => {
    const kpis = await getNenMemberKpis(db, [ACCOUNT]);
    expect(kpis).toEqual({
      members: 2,
      annualTotalYen: 211_000,
      lifetimeTotalYen: 509_100,
      balanceTotal: 3_960,
      usedThisMonth: 500,
      byRank: { platinum: 1, gold: 1 },
    });
  });
});
