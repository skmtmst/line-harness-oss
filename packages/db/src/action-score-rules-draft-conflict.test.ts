import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ActionScoreRuleValidationError,
  defaultActionScoreRuleBundle,
  getActionScoreRuleConfiguration,
  saveActionScoreRuleDraft,
} from './action-score-rules.js';

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

describe('R131: 同じ下書きの共同編集で先の保存を失わない', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-r131', 'channel-r131', 'r131', 'token', 'secret')`,
    ).run();
    db = asD1(sqlite);
  });

  it('保存ごとに版を進め、古い版での保存は競合になる', async () => {
    const base = defaultActionScoreRuleBundle();
    const first = await saveActionScoreRuleDraft(db, {
      lineAccountId: 'account-r131',
      expectedDraftVersionId: null,
      configuration: base,
    });
    expect(first.currentDraftVersionId).toBeTruthy();

    // AとBが同じ下書き版を読む。
    const readA = await getActionScoreRuleConfiguration(db, 'account-r131');
    const readB = await getActionScoreRuleConfiguration(db, 'account-r131');
    expect(readA.currentDraftVersionId).toBe(readB.currentDraftVersionId);

    // Aが返信+8→+9を保存。版が進む。
    const bundleA = structuredClone(base);
    bundleA.rules[0] = { ...bundleA.rules[0], value: 9 };
    const afterA = await saveActionScoreRuleDraft(db, {
      lineAccountId: 'account-r131',
      expectedDraftVersionId: readA.currentDraftVersionId,
      configuration: bundleA,
    });
    expect(afterA.currentDraftVersionId).not.toBe(readA.currentDraftVersionId);
    expect(afterA.editableVersion.rules[0].value).toBe(9);

    // 古い版を持つBがURLクリック+5→+6を保存。競合になり、Aの+9が残る。
    const bundleB = structuredClone(base);
    bundleB.rules[1] = { ...bundleB.rules[1], value: 6 };
    await expect(saveActionScoreRuleDraft(db, {
      lineAccountId: 'account-r131',
      expectedDraftVersionId: readB.currentDraftVersionId,
      configuration: bundleB,
    })).rejects.toMatchObject({ code: 'version_conflict' });

    const current = await getActionScoreRuleConfiguration(db, 'account-r131');
    expect(current.editableVersion.rules[0].value).toBe(9);
  });

  it('競合の合図は版の競合として分かる', async () => {
    const base = defaultActionScoreRuleBundle();
    await saveActionScoreRuleDraft(db, {
      lineAccountId: 'account-r131',
      expectedDraftVersionId: null,
      configuration: base,
    });
    const read = await getActionScoreRuleConfiguration(db, 'account-r131');
    const bundle = structuredClone(base);
    bundle.rules[0] = { ...bundle.rules[0], value: 9 };
    await saveActionScoreRuleDraft(db, {
      lineAccountId: 'account-r131',
      expectedDraftVersionId: read.currentDraftVersionId,
      configuration: bundle,
    });
    const stale = saveActionScoreRuleDraft(db, {
      lineAccountId: 'account-r131',
      expectedDraftVersionId: read.currentDraftVersionId,
      configuration: base,
    });
    await expect(stale).rejects.toBeInstanceOf(ActionScoreRuleValidationError);
  });
});
