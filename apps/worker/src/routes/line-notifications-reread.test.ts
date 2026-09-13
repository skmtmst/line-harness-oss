import { describe, it, expect } from 'vitest';
import {
  LineNotificationError,
  createCustomerNotificationDefinition,
  publishCustomerNotificationDefinition,
  stopCustomerNotificationDefinition,
  updateCustomerNotificationDraft,
} from '@line-crm/db';

/** 書き込み直後の再読み込みだけ行が消える競合を再現する。 */
function disappearingDb(): D1Database {
  const definition = {
    id: 'definition-1', line_account_id: 'account-1', key: 'shipping',
    name: '発送のお知らせ', category: 'shipping', source_event_type: 'ec.order.shipped',
    status: 'draft', current_version_id: null, draft_config_json: '{}',
    transactional_only: 0, version: 2, created_by: 'owner-1', updated_by: 'owner-1',
    created_at: '2026-09-08T00:00:00+09:00', updated_at: '2026-09-08T00:00:00+09:00',
  };
  let written = false;
  return {
    prepare: (sql: string) => ({
      bind: () => {
        return {
          first: async () => (sql.includes('SELECT d.*') && !written ? definition : null),
          all: async () => ({ results: [] }),
          run: async () => {
            written = true;
            return { meta: { changes: 1 } };
          },
        };
      },
    }),
    batch: async () => {
      written = true;
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
    },
  } as unknown as D1Database;
}

async function expectNotFound(run: Promise<unknown>) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(LineNotificationError);
  expect((error as LineNotificationError).code).toBe('not_found');
}

describe('line notification re-read after write (#600)', () => {
  it('作成後に行が消えていたら not_found を送出する', async () => {
    await expectNotFound(createCustomerNotificationDefinition(disappearingDb(), {
      lineAccountId: 'account-1', key: 'shipping', name: '発送のお知らせ',
      category: 'shipping', sourceEventType: 'ec.order.shipped', draftConfig: {}, staffId: 'owner-1',
    }));
  });

  it('下書き更新後に行が消えていたら not_found を送出する', async () => {
    await expectNotFound(updateCustomerNotificationDraft(disappearingDb(), {
      id: 'definition-1', lineAccountId: 'account-1', expectedVersion: 2,
      name: '発送のお知らせ', category: 'shipping', sourceEventType: 'ec.order.shipped',
      draftConfig: {}, staffId: 'owner-1',
    }));
  });

  it('公開後に行が消えていたら not_found を送出する', async () => {
    await expectNotFound(publishCustomerNotificationDefinition(disappearingDb(), {
      id: 'definition-1', lineAccountId: 'account-1', expectedVersion: 2, staffId: 'owner-1',
    }));
  });

  it('停止後に行が消えていたら not_found を送出する', async () => {
    await expectNotFound(stopCustomerNotificationDefinition(disappearingDb(), {
      id: 'definition-1', lineAccountId: 'account-1', expectedVersion: 2, staffId: 'owner-1',
    }));
  });
});
