import { expect, test } from 'vitest';
import { consumePublicIngressReceipt, createTemplate, publishTemplate, deleteTemplate, getTemplateById, getTemplates, getTemplatesWithUsageCount, getTemplateVersion } from '@line-crm/db';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

test('テンプレートを削除しても版の本文を保持する', async () => {
  const { db, raw } = createTestD1({ foreignKeys: true });
  const item = await createTemplate(db, { name: '履歴', category: 'text', messageType: 'text', messageContent: '保存する本文' });
  await publishTemplate(db, item.id, { expectedVersion: 0, expectedDraftRevision: 1 });
  expect(await getTemplateVersion(db, item.id, 1)).not.toBeNull();
  await deleteTemplate(db, item.id);
  expect(await getTemplateById(db, item.id)).toBeNull();
  expect(await getTemplates(db)).toHaveLength(0);
  expect((await getTemplatesWithUsageCount(db)).total).toBe(0);
  expect(await getTemplateVersion(db, item.id, 1)).toMatchObject({ message_content: '保存する本文' });
  raw.close();
});

test('受信キーは並行して来ても1回だけ消費し、サイトと地点を分離する', async () => {
  const { db, raw } = createTestD1();
  const input = { kind: 'conversion_nonce' as const, scopeId: 'a', key: 'nonce' };
  expect((await Promise.all([consumePublicIngressReceipt(db, input), consumePublicIngressReceipt(db, input)])).sort()).toEqual([false, true]);
  expect(await consumePublicIngressReceipt(db, { ...input, scopeId: 'b' })).toBe(true);
  expect(await consumePublicIngressReceipt(db, { ...input, kind: 'site_event' })).toBe(true);
  raw.close();
});
