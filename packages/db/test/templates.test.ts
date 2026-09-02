import { describe, expect, it } from 'vitest';
import { getTemplateUsage, getTemplatesWithUsageCount } from '../src/templates.js';

function usageDb(): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        all: async () => {
          if (sql.includes('FROM auto_replies')) {
            return { results: [{ id: 'ar-1', keyword: '予約', match_type: 'exact', line_account_id: null }] };
          }
          if (sql.includes('FROM scenario_steps')) {
            return { results: [{ step_id: 'ss-1', step_order: 2, scenario_id: 'sc-1', scenario_name: '来店後' }] };
          }
          if (sql.includes('FROM reminder_steps')) {
            return { results: [{ step_id: 'rs-1', reminder_id: 're-1', reminder_name: '前日案内' }] };
          }
          if (sql.includes('FROM rich_menu_areas')) {
            return { results: [{ area_id: 'ra-1', label: '予約', page_name: '表', group_id: 'rg-1', group_name: '基本' }] };
          }
          if (sql.includes('FROM tracked_links')) {
            return { results: [{ id: 'tl-1', name: '広告A' }] };
          }
          return { results: [] };
        },
      }),
      all: async () => {
        if (sql.includes('FROM automations')) {
          return { results: [{ id: 'au-1', name: '予約後', event_type: 'booking', actions: '[{"params":{"template_id":"tpl-1"}}]' }] };
        }
        return { results: [] };
      },
    }),
  } as unknown as D1Database;
}

describe('テンプレートの使用先', () => {
  it('現行6種類の利用先を同じ形で返す', async () => {
    const usage = await getTemplateUsage(usageDb(), 'tpl-1');

    expect(usage.autoReplies).toHaveLength(1);
    expect(usage.automations).toHaveLength(1);
    expect(usage.scenarioSteps).toHaveLength(1);
    expect(usage.reminderSteps).toHaveLength(1);
    expect(usage.richMenuAreas).toHaveLength(1);
    expect(usage.trackedLinks).toHaveLength(1);
  });

  it('一覧の使用数に列参照とJSON参照を足す', async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => ({ results: [{
            id: 'tpl-1', name: '案内', category: 'general', message_type: 'text',
            message_content: '本文', folder_id: null, carousel_actions_json: null,
            carousel_tap_limit_mode: 'none', carousel_tap_limit_text: null,
            created_at: '2026-08-27', updated_at: '2026-08-27',
          }] }),
        }),
        all: async () => {
          if (sql.includes('SUM(cnt)')) return { results: [{ template_id: 'tpl-1', cnt: 5 }] };
          if (sql.includes('FROM automations')) {
            return { results: [{ actions: '[{"params":{"template_id":"tpl-1"}}]' }] };
          }
          return { results: [{
            id: 'tpl-1', name: '案内', category: 'general', message_type: 'text',
            message_content: '本文', folder_id: null, carousel_actions_json: null,
            carousel_tap_limit_mode: 'none', carousel_tap_limit_text: null,
            created_at: '2026-08-27', updated_at: '2026-08-27',
          }] };
        },
      }),
    } as unknown as D1Database;

    const templates = await getTemplatesWithUsageCount(db);
    expect(templates[0]?.usage_count).toBe(6);
  });

  it('選択したLINEアカウントだけを一覧SQLへ渡す', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          all: async () => {
            calls.push({ sql, values });
            return { results: [] };
          },
        }),
        all: async () => {
          calls.push({ sql, values: [] });
          return { results: [] };
        },
      }),
    } as unknown as D1Database;

    await getTemplatesWithUsageCount(db, 'general', {
      accountIds: ['account-1'],
      includeUnassigned: false,
    });

    expect(calls[0]?.sql).toContain('category = ?');
    expect(calls[0]?.sql).toContain('line_account_id IN (?)');
    expect(calls[0]?.values).toEqual(['general', 'account-1']);
  });
});
