import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultActionScoreRuleBundle, processActionScoreInactivity,
  publishActionScoreRuleDraft, saveActionScoreRuleDraft,
} from '../src/action-score-rules.js';
import { asD1 } from './d1-test-helper.js';

const NOW = '2026-10-08T03:00:00.000Z';
describe('inactivity queue reaches every eligible period (PKG32)', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('on', 'channel-on', 'ON', 'token', 'secret'), ('off', 'channel-off', 'OFF', 'token', 'secret');
      INSERT INTO account_settings (line_account_id, key, value) VALUES
        ('on', 'feature.mileage', 'true'), ('off', 'feature.mileage', 'false');`);
    db = asD1(sqlite);
  });
  afterEach(() => sqlite.close());
  async function publish(account: string, extraRule = false) {
    const bundle = defaultActionScoreRuleBundle();
    bundle.rules = bundle.rules.filter((r) => r.eventType === 'inactivity_30d');
    if (extraRule) bundle.rules.push({ ...bundle.rules[0]!, id: 'second-inactivity-rule' });
    const saved = await saveActionScoreRuleDraft(db, {
      lineAccountId: account, expectedDraftVersionId: null, configuration: bundle,
    });
    await publishActionScoreRuleDraft(db, { lineAccountId: account, draftVersionId: saved.currentDraftVersionId! });
  }
  function friends(account: string, count: number, createdAt: string) {
    const insert = sqlite.prepare(`INSERT INTO friends (id, line_user_id, line_account_id, score, created_at)
      VALUES (?, ?, ?, 50, ?)`);
    for (let i = 0; i < count; i++) insert.run(`${account}-${i}`, `U-${account}-${i}`, account, createdAt);
  }

  it('continues past 200 completed periods and keeps one deduction per period', async () => {
    await publish('on');
    friends('on', 202, '2026-08-01T00:00:00.000Z');
    expect((await processActionScoreInactivity(db, { now: NOW, limit: 200 })).applied).toBe(200);
    expect((await processActionScoreInactivity(db, { now: NOW, limit: 200 })).applied).toBe(2);
    expect((await processActionScoreInactivity(db, { now: NOW, limit: 200 })).applied).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM friend_scores').get()).toEqual({ n: 202 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM friends WHERE score = 40').get()).toEqual({ n: 202 });
  });

  it('does not let 200 OFF candidates block ON candidates or mutate OFF data', async () => {
    await publish('on'); await publish('off');
    friends('off', 200, '2026-07-01T00:00:00.000Z');
    friends('on', 2, '2026-08-01T00:00:00.000Z');
    expect((await processActionScoreInactivity(db, { now: NOW, limit: 200 })).applied).toBe(2);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM friend_scores WHERE line_account_id = 'off'").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM friends WHERE line_account_id = 'off' AND score = 50").get()).toEqual({ n: 200 });
  });

  it('finishes another pending rule after one rule of the same period was saved', async () => {
    await publish('on', true);
    friends('on', 1, '2026-08-01T00:00:00.000Z');
    // Stop after the first real INSERT to model an interrupted dispatcher.
    const ordinary = asD1(sqlite);
    let writes = 0;
    const interrupted = { ...ordinary, prepare(sql: string) {
      const stmt = ordinary.prepare(sql);
      if (!sql.includes('INSERT OR IGNORE INTO friend_scores')) return stmt;
      return { ...stmt, bind(...params: unknown[]) {
        const bound = stmt.bind(...params);
        return { ...bound, async run() {
          if (++writes === 2) throw new Error('dispatcher interrupted');
          return bound.run();
        } };
      } };
    } } as D1Database;
    await expect(processActionScoreInactivity(interrupted, { now: NOW })).rejects.toThrow('dispatcher interrupted');
    expect((await processActionScoreInactivity(db, { now: NOW })).applied).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM friend_scores').get()).toEqual({ n: 2 });
    expect(sqlite.prepare('SELECT score FROM friends').get()).toEqual({ score: 30 });
  });
});
