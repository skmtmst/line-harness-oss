import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

/**
 * migration 351 本体の実D1テスト。
 *
 * 351適用前の形（published_version_id 列なし）から作り、ファイルの中身を
 * そのまま流して、既存の稼働中購読が公開版 v1 へ寄ることを確かめる。
 * better-sqlite3 は外部キー制約を有効のままにする（本番D1と無効環境の
 * どちらでも同じ終状態になることが、このPRの契約）。
 */
function setupPre351Db(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE scenarios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      delivery_mode TEXT NOT NULL DEFAULT 'relative',
      audience_condition_json TEXT,
      on_complete_mode TEXT NOT NULL DEFAULT 'pause',
      on_complete_scenario_id TEXT,
      line_account_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE scenario_steps (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      delay_minutes INTEGER NOT NULL DEFAULT 0,
      message_type TEXT NOT NULL,
      message_content TEXT NOT NULL,
      condition_type TEXT,
      condition_value TEXT,
      next_step_on_false INTEGER,
      offset_days INTEGER,
      offset_minutes INTEGER,
      delivery_time TEXT,
      template_id TEXT,
      on_reach_tag_id TEXT,
      after_send TEXT NOT NULL DEFAULT 'continue',
      target_condition_json TEXT,
      question_json TEXT,
      is_draft INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      message_type TEXT NOT NULL,
      message_content TEXT NOT NULL,
      question_json TEXT,
      -- 347 は 351 より先に走る（ファイル名順）。移行時の template 解決は
      -- 公開版と持ち主アカウントを見るので、その形に合わせる。
      published_version INTEGER NOT NULL DEFAULT 0,
      line_account_id TEXT
    );
    CREATE TABLE friends (id TEXT PRIMARY KEY);
    CREATE TABLE friend_scenarios (
      id TEXT PRIMARY KEY,
      friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
      scenario_id TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
      current_step_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL,
      next_delivery_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE messages_log (
      id TEXT PRIMARY KEY,
      friend_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE scenario_actions (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
      hook TEXT NOT NULL,
      step_id TEXT REFERENCES scenario_steps (id) ON DELETE CASCADE,
      choice_index INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      action_type TEXT NOT NULL,
      config_json TEXT NOT NULL,
      condition_json TEXT,
      repeat_on_refire INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // 稼働中のシナリオ：1通目は template 参照、2通目は直接文。
  db.prepare(
    `INSERT INTO scenarios (id, name, delivery_mode, line_account_id, created_at)
     VALUES ('scn-1', '案内', 'relative', 'acc-a', '2026-08-16')`,
  ).run();
  db.prepare(
    `INSERT INTO templates (id, message_type, message_content, question_json, published_version, line_account_id)
     VALUES
       ('tpl-1', 'text', '公開時の文面', NULL, 1, 'acc-a'),
       ('tpl-other', 'text', 'よそのアカウントの文面', NULL, 1, 'acc-b'),
       ('tpl-draft', 'text', '未公開の文面', NULL, 0, 'acc-a')`,
  ).run();
  db.prepare(
    `INSERT INTO scenario_steps
       (id, scenario_id, step_order, delay_minutes, message_type, message_content, template_id, created_at)
     VALUES
       ('live-step-1', 'scn-1', 0, 0, 'text', '下書きの控え', 'tpl-1', '2026-08-16'),
       ('live-step-2', 'scn-1', 1, 60, 'text', '2通目', NULL, '2026-08-16'),
       ('live-step-3', 'scn-1', 2, 60, 'text', 'よそ参照の控え', 'tpl-other', '2026-08-16'),
       ('live-step-4', 'scn-1', 3, 60, 'text', '未公開参照の控え', 'tpl-draft', '2026-08-16')`,
  ).run();
  // アクション設定：1通目に紐づくタグ付けと、質問の選択肢に紐づくもの。
  db.prepare(
    `INSERT INTO scenario_actions
       (id, scenario_id, hook, step_id, choice_index, sort_order, action_type, config_json, repeat_on_refire, created_at)
     VALUES
       ('act-step', 'scn-1', 'step_sent', 'live-step-1', NULL, 0, 'tag', '{"op":"add","tagIds":["tag-1"]}', 1, '2026-08-16'),
       ('act-choice', 'scn-1', 'choice_selected', 'live-step-2', 0, 1, 'tag', '{"op":"add","tagIds":["tag-2"]}', 0, '2026-08-16'),
       ('act-done', 'scn-1', 'scenario_completed', NULL, NULL, 2, 'tag', '{"op":"remove","tagIds":["tag-1"]}', 1, '2026-08-16')`,
  ).run();
  db.prepare(`INSERT INTO friends VALUES ('f-active'), ('f-done')`).run();
  db.prepare(
    `INSERT INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, updated_at)
     VALUES
       ('enr-active', 'f-active', 'scn-1', -1, 'active', '2026-08-16', '2026-08-16'),
       ('enr-done', 'f-done', 'scn-1', 1, 'completed', '2026-08-16', '2026-08-16')`,
  ).run();
  return db;
}

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = setupPre351Db();
});

function apply351(): void {
  // 実運用の移行実行系と同じく、文ごとに流して良性エラー
  //（duplicate column / already exists）は飛ばす。
  const sql = readFileSync(join(PKG_ROOT, 'migrations', '351_scenario_published_versions.sql'), 'utf8');
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
    try {
      sqlite.exec(statement);
    } catch (error) {
      if (!(error instanceof Error) || !/duplicate column name|already exists/i.test(error.message)) {
        throw error;
      }
    }
  }
}

describe('migration 351 の適用（#644）', () => {
  test('既存シナリオに公開版 v1 ができ、指針が v1 を指す', () => {
    apply351();

    const version = sqlite
      .prepare(`SELECT * FROM scenario_versions WHERE scenario_id = 'scn-1'`)
      .get() as Record<string, unknown>;
    expect(version.version_number).toBe(0 + 1);
    expect(version.status).toBe('published');
    const pointer = sqlite
      .prepare(`SELECT current_published_version_id AS pointer FROM scenarios WHERE id = 'scn-1'`)
      .get() as { pointer: string };
    expect(pointer.pointer).toBe(version.id);
  });

  test('v1 の写しは template 解決済み・版所有の通IDを持つ', () => {
    apply351();

    const version = sqlite
      .prepare(`SELECT steps_snapshot FROM scenario_versions WHERE scenario_id = 'scn-1'`)
      .get() as { steps_snapshot: string };
    const steps = JSON.parse(version.steps_snapshot) as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(4);
    // template を使う1通目は、公開時の文面が写っている（下書きの控えではない）。
    expect(steps[0].message_content).toBe('公開時の文面');
    expect(steps[0].template_id).toBe('tpl-1');
    expect(steps[0].template_id_at_send).toBe('tpl-1');
    // 通の正体は版所有のID。live の通IDは控えにだけ残る。
    expect(steps[0].version_step_id).toBe(`${(sqlite.prepare(`SELECT id FROM scenario_versions WHERE scenario_id = 'scn-1'`).get() as { id: string }).id}:0`);
    expect(steps[0].live_step_id).toBe('live-step-1');
    expect(steps[1].message_content).toBe('2通目');
  });

  test('移行の template 解決はシナリオの持ち主アカウントの中だけ（#645 と同条件）', () => {
    apply351();

    const version = sqlite
      .prepare(`SELECT steps_snapshot FROM scenario_versions WHERE scenario_id = 'scn-1'`)
      .get() as { steps_snapshot: string };
    const steps = JSON.parse(version.steps_snapshot) as Array<Record<string, unknown>>;

    // よそのアカウントの template は使わない。通の控えへ倒し、
    // template_id_at_send も残さない（この版はその template で送っていない）。
    expect(steps[2].message_content).toBe('よそ参照の控え');
    expect(steps[2].template_id).toBe('tpl-other');
    expect(steps[2].template_id_at_send).toBeNull();

    // 未公開の template も同じ。公開版が無いものを版へ焼き付けない。
    expect(steps[3].message_content).toBe('未公開参照の控え');
    expect(steps[3].template_id_at_send).toBeNull();
  });

  test('持ち主が決まっていないシナリオは template を解決しない（fail-close）', () => {
    sqlite.prepare(`UPDATE scenarios SET line_account_id = NULL WHERE id = 'scn-1'`).run();
    apply351();

    const version = sqlite
      .prepare(`SELECT steps_snapshot FROM scenario_versions WHERE scenario_id = 'scn-1'`)
      .get() as { steps_snapshot: string };
    const steps = JSON.parse(version.steps_snapshot) as Array<Record<string, unknown>>;
    // 同じアカウントかどうかを決められないので、通の控えへ倒す。
    expect(steps[0].message_content).toBe('下書きの控え');
    expect(steps[0].template_id_at_send).toBeNull();
  });

  test('既存の購読（稼働中・完了済み）は v1 へ寄り、live 読みに残らない', () => {
    apply351();

    const rows = sqlite
      .prepare(`SELECT id, published_version_id AS v FROM friend_scenarios ORDER BY id`)
      .all() as Array<{ id: string; v: string | null }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.v).toMatch(/^scenario-version-v1-scn-1$/);
    }
  });

  test('版への参照整合が効く（宙に浮いた購読は書けない）', () => {
    apply351();

    expect(() =>
      sqlite.prepare(
        `INSERT INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, updated_at, published_version_id)
         VALUES ('enr-bad', 'f-active', 'scn-1', -1, 'active', '2026-08-16', '2026-08-16', 'version-missing')`,
      ).run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  test('確定版の直接削除は止まり、親ごとの削除は通る', () => {
    apply351();
    const versionId = (
      sqlite.prepare(`SELECT id FROM scenario_versions WHERE scenario_id = 'scn-1'`).get() as { id: string }
    ).id;

    // 直接の DELETE は止まる。
    expect(() => sqlite.prepare(`DELETE FROM scenario_versions WHERE id = ?`).run(versionId)).toThrow(
      /cannot be deleted/,
    );
    // 親シナリオごとの削除は通る（CASCADE。購読の版参照も親子で消える）。
    sqlite.prepare(`DELETE FROM scenarios WHERE id = 'scn-1'`).run();
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM scenario_versions`).get() as { n: number }).n,
    ).toBe(0);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios`).get() as { n: number }).n,
    ).toBe(0);
  });

  test('アクション設定も v1 へ写り、通は版所有の通IDで指す（#644 再審査 2）', () => {
    apply351();
    const version = sqlite
      .prepare(`SELECT id, actions_snapshot AS a FROM scenario_versions WHERE scenario_id = 'scn-1'`)
      .get() as { id: string; a: string };
    const actions = JSON.parse(version.a) as Array<Record<string, unknown>>;

    expect(actions.map((a) => a['action_id'])).toEqual(['act-step', 'act-choice', 'act-done']);

    // 通に紐づくアクションは版所有の通ID（`<版ID>:<通番>`）を指す。live の
    // 通が消えても、版の中で行き先を見失わない。
    expect(actions[0]!['version_step_id']).toBe(`${version.id}:0`);
    expect(actions[0]!['live_step_id']).toBe('live-step-1');
    expect(actions[1]!['version_step_id']).toBe(`${version.id}:1`);
    expect(actions[1]!['choice_index']).toBe(0);
    // 通に紐づかないアクション（完了時）は null のまま。
    expect(actions[2]!['version_step_id']).toBeNull();
    expect(actions[2]!['hook']).toBe('scenario_completed');
    // 「1回だけ」の指定も写す。
    expect(actions[1]!['repeat_on_refire']).toBe(0);
  });

  test('公開版の actions_snapshot は書き換えられない（不変）', () => {
    apply351();
    const versionId = (
      sqlite.prepare(`SELECT id FROM scenario_versions WHERE scenario_id = 'scn-1'`).get() as { id: string }
    ).id;
    expect(() =>
      sqlite.prepare(`UPDATE scenario_versions SET actions_snapshot = '[]' WHERE id = ?`).run(versionId),
    ).toThrow(/immutable/);
  });

  test('版固定の実行済み台帳は live のアクション行が消えても書ける', () => {
    apply351();
    sqlite
      .prepare(
        `INSERT INTO scenario_pinned_action_fires (action_key, friend_id, fired_at)
         VALUES ('act-step', 'f-active', '2026-08-16')`,
      )
      .run();
    sqlite.prepare(`DELETE FROM scenario_actions WHERE id = 'act-step'`).run();
    expect(
      (
        sqlite
          .prepare(`SELECT COUNT(*) AS n FROM scenario_pinned_action_fires WHERE action_key = 'act-step'`)
          .get() as { n: number }
      ).n,
    ).toBe(1);
  });

  test('再適用しても増えない（冪等）', () => {
    apply351();
    apply351();

    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM scenario_versions`).get() as { n: number }).n,
    ).toBe(1);
    const rows = sqlite
      .prepare(`SELECT published_version_id AS v FROM friend_scenarios`)
      .all() as Array<{ v: string }>;
    expect(new Set(rows.map((r) => r.v)).size).toBe(1);
  });
});
