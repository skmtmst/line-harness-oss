/**
 * migration 347 の持ち主補完と、その安全弁(#713)。
 *
 * 347 は「持ち主(line_account_id)が NULL のテンプレートを、参照元から
 * 一意に決まるときだけ補完し、決まらない行が1つでもあれば ALTER より前に
 * migration 自体を止める」という安全弁を持つ。止め方は
 * `json('MIGRATION_347_TEMPLATE_OWNER_UNRESOLVED')` が malformed JSON を
 * 投げること。正常時は `json('null')` なので通る。
 *
 * #713 で、この安全弁の元になる複合SELECT(8項)が D1 の上限(5項)を超えていて
 * migration 自体が当たらないことが分かり、4項+4項+2項へ割った。
 * **割ると壊れやすいのは安全弁の方**なので、ここで場面ごとに固定する。
 * とくに「A群とB群で持ち主が食い違う」場面は、分けたグループをまたいだ
 * 矛盾を見落としていないかを見るためのもの。
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { splitSqlIntoStatements } from './d1-sql-split.js';

const packageRoot = join(import.meta.dirname, '..');
const migrationsDir = join(packageRoot, 'migrations');
const BENIGN = /duplicate column name|already exists/i;
const MIGRATION_347 = '347_template_published_version.sql';

/** schema.sql と 347 より前の migration だけを当てた、347 適用前の実スキーマ。 */
function buildPre347(): Buffer {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(packageRoot, 'schema.sql'), 'utf8'));
  const earlier = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql') && Number.parseInt(name, 10) < 347)
    .sort();
  for (const file of earlier) {
    for (const statement of splitSqlIntoStatements(readFileSync(join(migrationsDir, file), 'utf8'))) {
      try {
        sqlite.exec(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!BENIGN.test(message)) throw new Error(`${file}: ${message}`);
      }
    }
  }
  return sqlite.serialize();
}

let pre347: Buffer;
// 308 本の migration を実際に当てて台を作るので、既定の 10 秒では足りないことがある。
beforeAll(() => { pre347 = buildPre347(); }, 120_000);

interface Applied { stopped: boolean; reason: string | null }

/** 347 を wrangler と同じ切り方で1文ずつ当てる。止まったらそこで終わる。 */
function apply347(sqlite: Database.Database): Applied {
  const sql = readFileSync(join(migrationsDir, MIGRATION_347), 'utf8');
  for (const statement of splitSqlIntoStatements(sql)) {
    try {
      sqlite.exec(statement);
    } catch (error) {
      return { stopped: true, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  return { stopped: false, reason: null };
}

function account(sqlite: Database.Database, id: string): void {
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'tok', 'sec')`,
  ).run(id, `ch-${id}`, id);
}

function template(sqlite: Database.Database, id: string, owner: string | null): void {
  sqlite.prepare(
    `INSERT INTO templates (id, name, message_type, message_content, line_account_id)
     VALUES (?, 'n', 'text', 'c', ?)`,
  ).run(id, owner);
}

function autoReply(sqlite: Database.Database, id: string, templateId: string, owner: string | null): void {
  sqlite.prepare(
    `INSERT INTO auto_replies (id, keyword, response_content, template_id, line_account_id)
     VALUES (?, 'k', 'r', ?, ?)`,
  ).run(id, templateId, owner);
}

function scenarioStep(sqlite: Database.Database, templateId: string, owner: string): void {
  sqlite.prepare(
    `INSERT INTO scenarios (id, name, trigger_type, line_account_id) VALUES ('s1', 's', 'manual', ?)`,
  ).run(owner);
  sqlite.prepare(
    `INSERT INTO scenario_steps (id, scenario_id, step_order, message_type, message_content, template_id)
     VALUES ('ss1', 's1', 1, 'text', 'c', ?)`,
  ).run(templateId);
}

function richMenuArea(sqlite: Database.Database, templateId: string, owner: string): void {
  sqlite.prepare(
    `INSERT INTO rich_menu_groups (id, account_id, name, chat_bar_text, size)
     VALUES ('g1', ?, 'g', 'bar', 'large')`,
  ).run(owner);
  sqlite.prepare(
    `INSERT INTO rich_menu_pages (id, group_id, order_index, name, alias_id)
     VALUES ('p1', 'g1', 1, 'p', 'al1')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO rich_menu_areas
       (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height, action_type, action_data, template_id)
     VALUES ('a1', 'p1', 0, 0, 1, 1, 'message', '{}', ?)`,
  ).run(templateId);
}

function automation(sqlite: Database.Database, templateId: string, owner: string): void {
  sqlite.prepare(
    `INSERT INTO automations (id, name, event_type, actions, line_account_id)
     VALUES ('au1', 'a', 'friend_added', ?, ?)`,
  ).run(JSON.stringify([{ templateId }]), owner);
}

function owners(sqlite: Database.Database): Record<string, string | null> {
  const rows = sqlite.prepare(`SELECT id, line_account_id FROM templates ORDER BY id`)
    .all() as Array<{ id: string; line_account_id: string | null }>;
  return Object.fromEntries(rows.map((r) => [r.id, r.line_account_id]));
}

function hasPublishedVersion(sqlite: Database.Database): boolean {
  return (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM pragma_table_info('templates') WHERE name = 'published_version'`,
  ).get() as { n: number }).n > 0;
}

describe('347 が通る場面: 持ち主が一意に決まる', () => {
  it('1アカウントだけの環境は、参照の無い行も含めて全部そのアカウントになる', () => {
    const sqlite = new Database(pre347);
    account(sqlite, 'A');
    template(sqlite, 't1', null);
    template(sqlite, 't2', null);
    autoReply(sqlite, 'ar1', 't1', 'A');
    expect(apply347(sqlite).stopped).toBe(false);
    expect(owners(sqlite)).toEqual({ t1: 'A', t2: 'A' });
    expect(hasPublishedVersion(sqlite)).toBe(true);
  });

  it('2アカウントでも、参照元から一意に決まれば補完する', () => {
    const sqlite = new Database(pre347);
    account(sqlite, 'A'); account(sqlite, 'B');
    template(sqlite, 't1', null); template(sqlite, 't2', null);
    autoReply(sqlite, 'ar1', 't1', 'A');
    scenarioStep(sqlite, 't2', 'B');
    expect(apply347(sqlite).stopped).toBe(false);
    expect(owners(sqlite)).toEqual({ t1: 'A', t2: 'B' });
  });

  it('誰からも参照されていない NULL 行は、止めもしないし補完もしない', () => {
    const sqlite = new Database(pre347);
    account(sqlite, 'A'); account(sqlite, 'B');
    template(sqlite, 't1', null);
    expect(apply347(sqlite).stopped).toBe(false);
    expect(owners(sqlite)).toEqual({ t1: null });
  });

  it('automations の json_tree 経由でも持ち主が決まる(割ったときB群へ移った項)', () => {
    const sqlite = new Database(pre347);
    account(sqlite, 'A'); account(sqlite, 'B');
    template(sqlite, 't1', null);
    automation(sqlite, 't1', 'B');
    autoReply(sqlite, 'ar1', 't1', 'B');
    expect(apply347(sqlite).stopped).toBe(false);
    expect(owners(sqlite)).toEqual({ t1: 'B' });
  });

  it('rich_menu 経由でも持ち主が決まる(割ったときB群へ移った項)', () => {
    const sqlite = new Database(pre347);
    account(sqlite, 'A'); account(sqlite, 'B');
    template(sqlite, 't1', null);
    richMenuArea(sqlite, 't1', 'A');
    expect(apply347(sqlite).stopped).toBe(false);
    expect(owners(sqlite)).toEqual({ t1: 'A' });
  });
});

describe('347 が止まる場面: 持ち主が決まらない', () => {
  /** 止まったときは、列を足す前で止まっていること。中途半端な公開版を作らない。 */
  function expectStoppedBeforeAlter(sqlite: Database.Database, applied: Applied): void {
    expect(applied.stopped).toBe(true);
    expect(applied.reason).toMatch(/malformed JSON/i);
    expect(hasPublishedVersion(sqlite)).toBe(false);
  }

  it('2アカウントが同じテンプレを参照していたら止める', () => {
    const sqlite = new Database(pre347);
    account(sqlite, 'A'); account(sqlite, 'B');
    template(sqlite, 't1', null);
    autoReply(sqlite, 'ar1', 't1', 'A');
    scenarioStep(sqlite, 't1', 'B');
    expectStoppedBeforeAlter(sqlite, apply347(sqlite));
    expect(owners(sqlite)).toEqual({ t1: null });
  });

  it('参照はあるが参照元にも持ち主がなければ止める', () => {
    const sqlite = new Database(pre347);
    account(sqlite, 'A'); account(sqlite, 'B');
    template(sqlite, 't1', null);
    autoReply(sqlite, 'ar1', 't1', null);
    expectStoppedBeforeAlter(sqlite, apply347(sqlite));
    expect(owners(sqlite)).toEqual({ t1: null });
  });

  // ここが割ったことで壊れやすい場所。A群(auto_replies)とB群(rich_menu)は
  // 別々の UNION ALL に分かれているので、グループ内だけ見ていると
  // 「どちらも一意」に見えてしまう。またいだ矛盾を捕まえられること。
  it('分けたグループをまたいで持ち主が食い違っていても止める', () => {
    const sqlite = new Database(pre347);
    account(sqlite, 'A'); account(sqlite, 'B');
    template(sqlite, 't1', null);
    autoReply(sqlite, 'ar1', 't1', 'A');
    richMenuArea(sqlite, 't1', 'B');
    expectStoppedBeforeAlter(sqlite, apply347(sqlite));
    expect(owners(sqlite)).toEqual({ t1: null });
  });
});
