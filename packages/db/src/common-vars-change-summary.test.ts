import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCommonVar,
  getCommonVarVersions,
  updateCommonVar,
} from './common-vars.js';

const packageRoot = join(import.meta.dirname, '..');

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
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

/*
 * 履歴の版テーブルには名前・値・メモ・理由の列しかない。期間や代替値だけの
 * 変更は「同じ値→同じ値」に見えて追えなかったので、保存時に変えた項目の
 * 内訳を理由へ併記する（監査R220）。
 */
describe('共通情報の履歴: 期間・代替値の変更の内訳(R220)', () => {
  let db: D1Database;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-a', 'channel-a', 'account-a', 'token', 'secret')`,
    ).run();
    db = asD1(sqlite);
  });

  it('値が同じまま有効終了だけ変えても、履歴に期間の前後が残る', async () => {
    const created = await createCommonVar(db, {
      lineAccountId: 'account-a', name: '期間案内', varKey: 'period_notice', value: '-12.5',
      validFrom: '2026-09-16T01:00:00.000Z', validUntil: '2026-09-16T03:00:00.000Z',
    });

    await updateCommonVar(db, created.id, 'account-a', {
      changeReason: '期間の修正',
      validUntil: '2026-09-20T09:00:00.000Z',
    });

    const versions = await getCommonVarVersions(db, created.id, 'account-a');
    const latest = versions[0];
    // 値の差分は「-12.5→-12.5」でも、理由に期間の前後が読める。
    expect(latest.value).toBe('-12.5');
    expect(latest.change_reason).toContain('期間の修正');
    expect(latest.change_reason).toContain('有効終了');
    // UTC 03:00Z→JST 12:00、09:00Z→18:00。画面と同じ日本時間で書く。
    expect(latest.change_reason).toContain('2026/9/16 12:00→2026/9/20 18:00');
  });

  it('期間外の動作と代替値の変更は、動きの言葉で履歴に残る', async () => {
    const created = await createCommonVar(db, {
      lineAccountId: 'account-a', name: '営業時間', varKey: 'shop_hours', value: '10-19',
    });

    await updateCommonVar(db, created.id, 'account-a', {
      changeReason: '期限切れ時の動作を変更',
      expiryBehavior: 'fallback',
      fallbackValue: '受付終了',
    });

    const latest = (await getCommonVarVersions(db, created.id, 'account-a'))[0];
    expect(latest.change_reason).toContain('期間外の動作「配信を止める」→「代替値を使う」');
    expect(latest.change_reason).toContain('代替値「（空）」→「受付終了」');
  });

  it('期間を変えていない保存には期間の内訳を足さない', async () => {
    const created = await createCommonVar(db, {
      lineAccountId: 'account-a', name: '営業時間', varKey: 'shop_hours', value: '10-19',
    });

    await updateCommonVar(db, created.id, 'account-a', {
      changeReason: '値の更新', value: '11-20',
    });

    const latest = (await getCommonVarVersions(db, created.id, 'account-a'))[0];
    expect(latest.change_reason).toBe('値の更新');
  });
});
