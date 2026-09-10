import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findScenarioReferenceMismatches,
  isResourceInScenarioAccount,
} from '../src/scenarios.js';
import { asD1 } from './d1-test-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

/*
 * 参照資源の LINE 公式アカウント境界（#644 再審査 3）。
 *
 * テンプレート・タグ・遷移先シナリオを ID だけで読むと、API を直接叩いて
 * よそのアカウントの資源をシナリオへ混ぜられる。画面で選べないだけでは
 * 足りないので、server 側で確かめる。
 *
 * 移行方針: 既存の不一致は migration で消さない（黙って運用が壊れる）。
 * 実行時に拒否し、洗い出しの口（findScenarioReferenceMismatches）を用意して
 * おく。次に公開した版の写しからは、実行時に落ちる形で外れていく。
 */
describe('参照資源のアカウント境界', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);

    for (const id of ['acc-a', 'acc-b']) {
      sqlite
        .prepare(
          `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, `ch-${id}`, id, `tok-${id}`, `sec-${id}`);
    }
    sqlite
      .prepare(
        `INSERT INTO tags (id, name, created_at, line_account_id) VALUES
           ('tag-a', 'Aのタグ', '2026-08-16', 'acc-a'),
           ('tag-b', 'Bのタグ', '2026-08-16', 'acc-b'),
           ('tag-common', '共通タグ', '2026-08-16', NULL)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO templates (id, name, message_type, message_content, created_at, updated_at, line_account_id) VALUES
           ('tpl-a', 'Aの文', 'text', 'A', '2026-08-16', '2026-08-16', 'acc-a'),
           ('tpl-b', 'Bの文', 'text', 'B', '2026-08-16', '2026-08-16', 'acc-b')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO scenarios (id, name, trigger_type, is_active, delivery_mode, created_at, updated_at, line_account_id) VALUES
           ('scn-a', 'Aの案内', 'manual', 1, 'relative', '2026-08-16', '2026-08-16', 'acc-a'),
           ('scn-b', 'Bの案内', 'manual', 1, 'relative', '2026-08-16', '2026-08-16', 'acc-b'),
           ('scn-common', '共通の案内', 'manual', 1, 'relative', '2026-08-16', '2026-08-16', NULL)`,
      )
      .run();
  });

  test('同じアカウント・共通の資源だけを通す', async () => {
    expect(await isResourceInScenarioAccount(db, 'tag', 'tag-a', 'acc-a')).toBe(true);
    expect(await isResourceInScenarioAccount(db, 'tag', 'tag-common', 'acc-a')).toBe(true);
    expect(await isResourceInScenarioAccount(db, 'tag', 'tag-b', 'acc-a')).toBe(false);
    expect(await isResourceInScenarioAccount(db, 'template', 'tpl-b', 'acc-a')).toBe(false);
    expect(await isResourceInScenarioAccount(db, 'scenario', 'scn-b', 'acc-a')).toBe(false);
  });

  test('消された資源は通さない（IDだけで通さない）', async () => {
    expect(await isResourceInScenarioAccount(db, 'tag', 'tag-missing', 'acc-a')).toBe(false);
  });

  test('共通シナリオ（アカウント未設定）は従来どおり確かめない', async () => {
    expect(await isResourceInScenarioAccount(db, 'tag', 'tag-b', null)).toBe(true);
  });

  test('指定なし（null / 空）は素通しする', async () => {
    expect(await isResourceInScenarioAccount(db, 'tag', null, 'acc-a')).toBe(true);
    expect(await isResourceInScenarioAccount(db, 'tag', '', 'acc-a')).toBe(true);
  });

  test('既存の不一致を洗い出せる（移行では消さず、一覧で示す）', async () => {
    sqlite
      .prepare(
        `INSERT INTO scenario_steps
           (id, scenario_id, step_order, delay_minutes, message_type, message_content, created_at, template_id, on_reach_tag_id)
         VALUES ('step-1', 'scn-a', 0, 0, 'text', '本文', '2026-08-16', 'tpl-b', 'tag-b')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO scenario_actions
           (id, scenario_id, hook, step_id, choice_index, sort_order, action_type, config_json, repeat_on_refire, created_at)
         VALUES
           ('act-tag', 'scn-a', 'step_sent', 'step-1', NULL, 0, 'tag', '{"op":"add","tagIds":["tag-b","tag-a"]}', 1, '2026-08-16'),
           ('act-move', 'scn-a', 'scenario_completed', NULL, NULL, 1, 'scenario', '{"op":"start","scenarioId":"scn-b"}', 1, '2026-08-16')`,
      )
      .run();
    sqlite.prepare(`UPDATE scenarios SET on_complete_scenario_id = 'scn-b' WHERE id = 'scn-a'`).run();

    const found = await findScenarioReferenceMismatches(db, 'scn-a');
    const origins = found.map((f) => `${f.origin}:${f.resourceId}`).sort();

    expect(origins).toEqual(
      [
        'scenario.on_complete:scn-b',
        'step:step-1.template:tpl-b',
        'step:step-1.on_reach_tag:tag-b',
        'action:act-tag.tag:tag-b',
        'action:act-move.scenario:scn-b',
      ].sort(),
    );
    // 同じアカウントのタグは挙がらない。
    expect(origins.some((o) => o.endsWith(':tag-a'))).toBe(false);
    // どのアカウントのものかも分かる。
    expect(found.every((f) => f.scenarioAccountId === 'acc-a')).toBe(true);
    expect(found.find((f) => f.resourceId === 'tag-b')!.resourceAccountId).toBe('acc-b');
  });

  test('不一致が無ければ空', async () => {
    sqlite
      .prepare(
        `INSERT INTO scenario_steps
           (id, scenario_id, step_order, delay_minutes, message_type, message_content, created_at, template_id, on_reach_tag_id)
         VALUES ('step-ok', 'scn-a', 0, 0, 'text', '本文', '2026-08-16', 'tpl-a', 'tag-common')`,
      )
      .run();
    expect(await findScenarioReferenceMismatches(db, 'scn-a')).toEqual([]);
  });
});
