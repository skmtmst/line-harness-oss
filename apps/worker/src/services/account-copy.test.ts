import { describe, expect, it } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { copyLineAccountSettings, normalizeCopyItems } from './account-copy.js';

describe('normalizeCopyItems', () => {
  it('許可した項目だけを重複なく受け付ける', () => {
    expect(normalizeCopyItems(['scenarios', 'scenarios', 'autoReplies'])).toEqual([
      'scenarios',
      'autoReplies',
    ]);
    expect(normalizeCopyItems(['friends'])).toBeNull();
    expect(normalizeCopyItems('scenarios')).toBeNull();
  });
});

describe('copyLineAccountSettings', () => {
  it('認証・友だち・履歴を触らず、選択した運用設定とシナリオIDを複製する', async () => {
    const { db, raw } = createTestD1();
    Object.assign(db, {
      batch: async (statements: D1PreparedStatement[]) => {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      },
    });

    raw.prepare("INSERT INTO account_settings (id, line_account_id, key, value) VALUES ('setting-1', 'source', 'sidebar.order', '[]')").run();
    raw.prepare("INSERT INTO auto_replies (id, keyword, response_content, line_account_id) VALUES ('reply-1', '予約', '承りました', 'source')").run();
    raw.prepare("INSERT INTO scenarios (id, name, trigger_type, line_account_id, on_complete_scenario_id) VALUES ('scenario-1', '来店後', 'manual', 'source', 'scenario-2')").run();
    raw.prepare("INSERT INTO scenarios (id, name, trigger_type, line_account_id) VALUES ('scenario-2', '再来店', 'manual', 'source')").run();
    raw.prepare("INSERT INTO scenario_steps (id, scenario_id, step_order, message_type, message_content) VALUES ('step-1', 'scenario-1', 1, 'text', 'ありがとうございます')").run();
    raw.prepare("INSERT INTO scenario_actions (id, scenario_id, hook, step_id, action_type, config_json) VALUES ('action-1', 'scenario-1', 'step_sent', 'step-1', 'scenario', '{\"scenarioId\":\"scenario-2\",\"stepId\":\"step-1\"}')").run();
    raw.prepare("INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('friend-1', 'U1', '友だち', 'source')").run();

    await copyLineAccountSettings(db, 'source', 'target', [
      'accountSettings',
      'autoReplies',
      'scenarios',
    ]);

    expect(raw.prepare("SELECT key, value FROM account_settings WHERE line_account_id = 'target'").get()).toEqual({ key: 'sidebar.order', value: '[]' });
    expect(raw.prepare("SELECT keyword, response_content FROM auto_replies WHERE line_account_id = 'target'").get()).toEqual({ keyword: '予約', response_content: '承りました' });
    const copiedScenarios = raw.prepare("SELECT id, name, on_complete_scenario_id FROM scenarios WHERE line_account_id = 'target' ORDER BY name").all() as Array<{ id: string; name: string; on_complete_scenario_id: string | null }>;
    expect(copiedScenarios).toHaveLength(2);
    expect(copiedScenarios.every((scenario) => !['scenario-1', 'scenario-2'].includes(scenario.id))).toBe(true);
    const first = copiedScenarios.find((scenario) => scenario.name === '来店後')!;
    const second = copiedScenarios.find((scenario) => scenario.name === '再来店')!;
    expect(first.on_complete_scenario_id).toBe(second.id);
    const copiedStep = raw.prepare('SELECT id, scenario_id FROM scenario_steps WHERE scenario_id = ?').get(first.id) as { id: string; scenario_id: string };
    const copiedAction = raw.prepare('SELECT step_id, config_json FROM scenario_actions WHERE scenario_id = ?').get(first.id) as { step_id: string; config_json: string };
    expect(copiedAction.step_id).toBe(copiedStep.id);
    expect(JSON.parse(copiedAction.config_json)).toEqual({ scenarioId: second.id, stepId: copiedStep.id });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM friends WHERE line_account_id = 'target'").get()).toEqual({ count: 0 });
  });
});
