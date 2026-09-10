import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { createTemplate, publishTemplate } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { buildStepMessages, testSendSteps } from './scenario-test-send.js';

/**
 * 実DBで確かめるテスト送信の解決(独立審査指摘5)。
 * 送る側のアカウントを必ず渡し、未公開・別アカウントは step の控えに落とす。
 */
describe('実DB: テスト送信は送る側のアカウントで解決する', () => {
  let store: SqliteD1;

  beforeEach(() => {
    store = createTestD1();
    for (const [id, channel] of [['account-1', 'channel-1'], ['account-2', 'channel-2']] as const) {
      store.raw.prepare(
        `INSERT INTO line_accounts
           (id, channel_id, name, channel_access_token, channel_secret, is_active)
         VALUES (?, ?, ?, '', '', 1)`,
      ).run(id, channel, id);
    }
    insertFriend(store.raw, 'friend-1', { line_user_id: 'U1', line_account_id: 'account-1' });
  });

  const stepFor = (templateId: string | null) => ({
    id: 'step-1',
    scenario_id: 'scenario-1',
    step_order: 0,
    delay_minutes: 0,
    message_type: 'text',
    message_content: 'step の控え',
    condition_type: null,
    condition_value: null,
    next_step_on_false: null,
    offset_days: null,
    offset_minutes: null,
    delivery_time: null,
    template_id: templateId,
    question_json: null,
  });

  async function publishedTemplate(accountId: string, content: string): Promise<string> {
    const tpl = await createTemplate(store.db, {
      name: `tpl-${content}`, messageType: 'text', messageContent: content, lineAccountId: accountId,
    });
    await publishTemplate(store.db, tpl.id, { idempotencyKey: `testsend-${tpl.id}` });
    return tpl.id;
  }

  it('公開版の同一アカウントはテンプレートを送る', async () => {
    const id = await publishedTemplate('account-1', '公開版の本文');
    const messages = await buildStepMessages(store.db, stepFor(id) as never, 'friend-1', 'account-1');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'text', text: '公開版の本文' });
  });

  it('未公開・別アカウントは step の控えに落とす', async () => {
    const unpublished = await createTemplate(store.db, {
      name: '未公開', messageType: 'text', messageContent: '未公開の本文', lineAccountId: 'account-1',
    });
    const fallbackUnpublished = await buildStepMessages(
      store.db, stepFor(unpublished.id) as never, 'friend-1', 'account-1',
    );
    expect(fallbackUnpublished[0]).toMatchObject({ type: 'text', text: 'step の控え' });

    const other = await publishedTemplate('account-2', '別の本文');
    const fallbackCross = await buildStepMessages(
      store.db, stepFor(other) as never, 'friend-1', 'account-1',
    );
    expect(fallbackCross[0]).toMatchObject({ type: 'text', text: 'step の控え' });
  });

  it('持ち主未定では送らず、送り先の持ち主にも送らない', async () => {
    const id = await publishedTemplate('account-1', '公開版の本文');
    const result = await testSendSteps(
      store.db,
      new LineClient('dummy-token'),
      [stepFor(id) as never],
      'friend-1',
      null,
    );
    expect(result).toMatchObject({ ok: false, sent: 0 });
  });
});
