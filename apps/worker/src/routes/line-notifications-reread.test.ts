import { describe, it, expect } from 'vitest';
import {
  LineNotificationError,
  updateCustomerNotificationDraft,
} from '@line-crm/db';

/**
 * #509 軽2: 書き込み直後の再読み込みで行が無ければ、例外任せの
 * TypeError（500化け）にせず `not_found` を送出する。
 * 実DBでは書き込みと再読み込みの間に割り込む手段がないため、
 * 呼び出し順に結果を返す D1 スタブで競合消失を再現する。
 */
function raceDb(): D1Database {
  const definition = {
    id: 'definition-1', line_account_id: 'account-1', key: 'shipping',
    name: '発送のお知らせ', category: 'shipping', source_event_type: 'ec.order.shipped',
    status: 'draft', current_version_id: null, draft_config_json: '{}',
    transactional_only: 0, version: 2, created_by: 'owner-1', updated_by: 'owner-1',
    created_at: '2026-09-08T00:00:00+09:00', updated_at: '2026-09-08T00:00:00+09:00',
  };
  let calls = 0;
  return {
    prepare: () => ({
      bind: () => {
        calls += 1;
        const step = calls;
        return {
          // 1: 更新前の存在確認 → 行あり。2: 版一覧 → 空。
          // 3: UPDATE → 1件更新。4: 再読み込み → 行なし（競合消失）。
          first: async () => (step === 1 ? definition : null),
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        };
      },
    }),
  } as unknown as D1Database;
}

describe('line notification re-read after write (#580)', () => {
  it('再読み込みで行が消えていたら not_found を送出する', async () => {
    const error = await updateCustomerNotificationDraft(raceDb(), {
      id: 'definition-1', lineAccountId: 'account-1', expectedVersion: 2,
      name: '発送のお知らせ', category: 'shipping', sourceEventType: 'ec.order.shipped',
      draftConfig: {}, staffId: 'owner-1',
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(LineNotificationError);
    expect((error as LineNotificationError).code).toBe('not_found');
  });
});
