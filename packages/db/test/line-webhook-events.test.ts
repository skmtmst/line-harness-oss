import { describe, expect, test, vi } from 'vitest';
import { listLineWebhookEvents } from '../src/line-webhook-events.js';

const assigned = {
  webhook_event_id: 'evt-assigned', line_account_id: 'account-1', event_type: 'message',
  status: 'failed', attempts: 1, last_error: 'unknown',
  received_at: '2026-08-25T10:00:00.000', updated_at: '2026-08-25T10:00:01.000',
} as const;
const unassigned = {
  ...assigned,
  webhook_event_id: 'evt-unassigned',
  line_account_id: null,
  received_at: '2026-08-25T11:00:00.000',
};

function mockDb() {
  const queries: string[] = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      queries.push(sql);
      return {
        bind: vi.fn(() => ({
          all: vi.fn().mockResolvedValue({
            results: sql.includes('IS NULL') ? [unassigned] : [assigned],
          }),
        })),
      };
    }),
  } as unknown as D1Database;
  return { db, queries };
}

describe('listLineWebhookEvents', () => {
  test('未割り当てを見られる統括にはNULL行も返す', async () => {
    const { db, queries } = mockDb();
    const rows = await listLineWebhookEvents(db, {
      lineAccountIds: ['account-1'], includeUnassigned: true,
    });

    expect(rows.map((row) => row.webhookEventId)).toEqual(['evt-unassigned', 'evt-assigned']);
    expect(queries.some((sql) => sql.includes('line_account_id IS NULL'))).toBe(true);
  });

  test('未割り当てを見られない統括にはNULL行を問い合わせない', async () => {
    const { db, queries } = mockDb();
    const rows = await listLineWebhookEvents(db, {
      lineAccountIds: ['account-1'], includeUnassigned: false,
    });

    expect(rows.map((row) => row.webhookEventId)).toEqual(['evt-assigned']);
    expect(queries.some((sql) => sql.includes('line_account_id IS NULL'))).toBe(false);
  });
});
