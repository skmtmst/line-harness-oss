import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { createTemplate, publishTemplate } from '@line-crm/db';
import { resolveAutoReplyContent } from './auto-reply.js';
import { buildReminderStepMessage } from './reminder-delivery.js';

/**
 * 実DBで確かめる送信時の解決(再審査2)。
 * 未公開・別アカウントのテンプレートは inline・step の控えに落とし、送らない。
 */
describe('実DB: 未公開・別アカウントは送信時に控えに落とす', () => {
  let store: SqliteD1;

  beforeEach(() => {
    store = createTestD1();
    store.raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active)
       VALUES ('account-1', 'channel-1', '店舗1', '', '', 1)`,
    ).run();
    store.raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active)
       VALUES ('account-2', 'channel-2', '店舗2', '', '', 1)`,
    ).run();
  });

  async function publishedTemplate(accountId: string, content: string): Promise<string> {
    const tpl = await createTemplate(store.db, {
      name: `tpl-${content}`, messageType: 'text', messageContent: content, lineAccountId: accountId,
    });
    await publishTemplate(store.db, tpl.id, { idempotencyKey: `guard-${tpl.id}` });
    return tpl.id;
  }

  it('自動応答: 未公開・別アカウントは inline の控えを使う', async () => {
    const unpublished = await createTemplate(store.db, {
      name: '未公開', messageType: 'text', messageContent: '未公開の本文', lineAccountId: 'account-1',
    });
    const inline = { template_id: unpublished.id, response_type: 'text', response_content: '控えの本文' };
    expect(await resolveAutoReplyContent(store.db, inline, 'account-1')).toEqual({
      messageType: 'text', content: '控えの本文',
    });

    const other = await publishedTemplate('account-2', '別の本文');
    expect(await resolveAutoReplyContent(
      store.db,
      { template_id: other, response_type: 'text', response_content: '控えの本文' },
      'account-1',
    )).toEqual({ messageType: 'text', content: '控えの本文' });

    const mine = await publishedTemplate('account-1', '公開版の本文');
    expect(await resolveAutoReplyContent(
      store.db,
      { template_id: mine, response_type: 'text', response_content: '控えの本文' },
      'account-1',
    )).toEqual({ messageType: 'text', content: '公開版の本文' });
  });

  it('通知: 未公開・別アカウントは step の控えを使う', async () => {
    const friend = {
      id: 'friend-1', line_user_id: 'U1', line_account_id: 'account-1',
    } as NonNullable<Awaited<ReturnType<typeof import('@line-crm/db').getFriendById>>>;
    const step = (templateId: string | null) => ({
      id: 'step-1', reminder_id: 'reminder-1', offset_minutes: -60,
      message_type: 'text', message_content: 'step の控え', created_at: '2026-09-01T00:00:00+09:00',
      offset_days: null, send_at_time: null, template_id: templateId,
    });

    const unpublished = await createTemplate(store.db, {
      name: '未公開', messageType: 'text', messageContent: '未公開の本文', lineAccountId: 'account-1',
    });
    const fallback = await buildReminderStepMessage(
      store.db, step(unpublished.id), friend, new Date('2026-09-01T00:00:00+09:00'),
    );
    expect(fallback.messageContent).toBe('step の控え');

    const other = await publishedTemplate('account-2', '別の本文');
    const crossAccount = await buildReminderStepMessage(
      store.db, step(other), friend, new Date('2026-09-01T00:00:00+09:00'),
    );
    expect(crossAccount.messageContent).toBe('step の控え');

    const mine = await publishedTemplate('account-1', '公開版の本文');
    const resolved = await buildReminderStepMessage(
      store.db, step(mine), friend, new Date('2026-09-01T00:00:00+09:00'),
    );
    expect(resolved.messageContent).toBe('公開版の本文');
  });
});
