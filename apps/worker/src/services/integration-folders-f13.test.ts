import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  createIncomingWebhook, createOutgoingWebhook, updateIncomingWebhook, updateOutgoingWebhook,
  createConversionDefinition, reviseConversionDefinition, getConversionDefinitionDetail,
  getFolderItemCounts, readFolderAssignment,
} from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { createAutomationDraftFromTemplate, getAutomationDraft, updateAutomationDraft } from './automation-drafts';
import { createCommonAction, getCommonActionDetail, updateCommonActionDraft } from './common-actions';
import type { Env } from '../index';

vi.mock('./account-access.js', () => ({
  getVisibleLineAccountScope: async () => ({ allowedAccountIds: ['account-a'], ids: ['account-a'], canSeeUnassigned: false }),
}));
const { friendAttributes } = await import('../routes/friend-attributes.js');
let testDb: SqliteD1;
const account = 'account-a';
const tagActions = [{ id: 'step-1', type: 'add_tag', params: { tagId: 'tag-a' }, onFailure: 'stop' }];
const conversionInput = {
  name: '試験の成果', sourceType: 'form_submitted', sourceConfig: {}, measureMethod: 'manual' as const,
  deduplicationMode: 'every' as const, valueMode: 'none' as const, reversalPolicy: 'none' as const,
  lineAccountId: account, usages: [], staffId: 'operator-a', draft: true,
};
const scope = { allowedAccountIds: [account], includeUnassigned: false };
const countScope = { allowedAccountIds: [account], canSeeUnassigned: false };
beforeEach(() => {
  testDb = createTestD1({ foreignKeys: true });
  for (const id of [account, 'account-b']) {
    testDb.raw.prepare(`INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret)
      VALUES (?, ?, ?, '', '')`).run(id, id, id);
    for (const kind of ['automation', 'common_action', 'webhook', 'conversion']) {
      testDb.raw.prepare('INSERT INTO folders (id, kind, name, account_id) VALUES (?, ?, ?, ?)')
        .run(`${kind}-${id}`, kind, kind, id);
    }
  }
  testDb.raw.exec(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-a', '試験の分類', 'account-a')`);
});
afterEach(() => testDb.raw.close());

describe('F-13 分類先の保存と件数', () => {
  it('省略・未分類・不正な値・別アカウント・別種類を区別する', async () => {
    expect(await readFolderAssignment(testDb.db, 'automation', account, undefined)).toBeUndefined();
    expect(await readFolderAssignment(testDb.db, 'automation', account, null)).toBeNull();
    for (const value of ['', false, 1, 'automation-account-b', 'webhook-account-a']) {
      await expect(readFolderAssignment(testDb.db, 'automation', account, value)).rejects.toMatchObject({ code: 'folder_invalid' });
    }
  });
  it('オートメーションは版の保存と同時に分類し、古い版からは分類も変えない', async () => {
    const created = await createAutomationDraftFromTemplate(testDb.db, {
      templateKey: 'received-message-tag', lineAccountId: account, operationKey: 'create-folder-1', folderId: 'automation-account-a',
    });
    const draft = await getAutomationDraft(testDb.db, { id: created.id, lineAccountId: account });
    expect(draft.folderId).toBe('automation-account-a');
    const input = { id: created.id, lineAccountId: account, expectedDraftVersionId: draft.draftVersionId,
      name: draft.name, eventType: draft.eventType, triggerConfig: draft.triggerConfig, conditions: draft.conditions, actions: tagActions };
    await updateAutomationDraft(testDb.db, input);
    expect((await getAutomationDraft(testDb.db, input)).folderId).toBe('automation-account-a');
    await expect(updateAutomationDraft(testDb.db, { ...input, folderId: null })).rejects.toMatchObject({ code: 'version_conflict' });
    const current = await getAutomationDraft(testDb.db, input);
    await updateAutomationDraft(testDb.db, { ...input, expectedDraftVersionId: current.draftVersionId, folderId: null });
    expect((await getAutomationDraft(testDb.db, input)).folderId).toBeNull();
  });
  it('共通アクションは改訂番号の競合時に分類を維持する', async () => {
    const created = await createCommonAction(testDb.db, { lineAccountId: account, name: '試験の処理', actions: tagActions, folderId: 'common_action-account-a' });
    const input = { id: created.id, lineAccountId: account, expectedDraftVersionId: created.draftVersionId,
      expectedDraftRevision: 1, name: '試験の処理', actions: tagActions };
    await updateCommonActionDraft(testDb.db, input);
    await expect(updateCommonActionDraft(testDb.db, { ...input, folderId: null })).rejects.toMatchObject({ code: 'draft_revision_conflict' });
    expect((await getCommonActionDetail(testDb.db, input)).folderId).toBe('common_action-account-a');
    await updateCommonActionDraft(testDb.db, { ...input, expectedDraftRevision: 2, folderId: null });
    expect((await getCommonActionDetail(testDb.db, input)).folderId).toBeNull();
  });
  it('受信・送信Webhookは分類を保存し、省略なら維持、nullなら外す', async () => {
    const incoming = await createIncomingWebhook(testDb.db, { name: '試験の受信', lineAccountId: account, folderId: 'webhook-account-a' });
    const outgoing = await createOutgoingWebhook(testDb.db, { name: '試験の送信', url: 'https://example.invalid/hook', eventTypes: [], lineAccountId: account, folderId: 'webhook-account-a' });
    expect(incoming.folder_id).toBe('webhook-account-a');
    expect(outgoing.folder_id).toBe('webhook-account-a');
    await updateIncomingWebhook(testDb.db, incoming.id, account, { name: '試験の受信2' });
    await updateOutgoingWebhook(testDb.db, outgoing.id, account, { name: '試験の送信2' });
    expect(await getFolderItemCounts(testDb.db, 'webhook', countScope)).toEqual({ byFolderId: { 'webhook-account-a': 2 }, unfiled: 0 });
    await expect(updateIncomingWebhook(testDb.db, incoming.id, account, { folderId: 'webhook-account-b' })).rejects.toMatchObject({ code: 'folder_invalid' });
    await updateIncomingWebhook(testDb.db, incoming.id, account, { folderId: null });
    await updateOutgoingWebhook(testDb.db, outgoing.id, account, { folderId: null });
    expect(await getFolderItemCounts(testDb.db, 'webhook', countScope)).toEqual({ byFolderId: {}, unfiled: 2 });
  });
  it('成果地点は版更新と同時に分類し、古い版では分類も変えない', async () => {
    const created = (await createConversionDefinition(testDb.db, { ...conversionInput, folderId: 'conversion-account-a' }))!;
    expect(created.folderId).toBe('conversion-account-a');
    const input = { ...conversionInput, id: created.id, expectedVersion: 1, scope };
    await reviseConversionDefinition(testDb.db, input);
    await expect(reviseConversionDefinition(testDb.db, { ...input, folderId: null })).rejects.toMatchObject({ code: 'version_conflict' });
    expect((await getConversionDefinitionDetail(testDb.db, created.id, scope))!.folderId).toBe('conversion-account-a');
    await reviseConversionDefinition(testDb.db, { ...input, expectedVersion: 2, folderId: null });
    expect((await getConversionDefinitionDetail(testDb.db, created.id, scope))!.folderId).toBeNull();
  });
  it.each(['automation', 'common_action', 'conversion'] as const)('GET の %s 件数は所属範囲で数える', async kind => {
    if (kind === 'automation') await createAutomationDraftFromTemplate(testDb.db, { templateKey: 'received-message-tag', lineAccountId: account, operationKey: 'counts-key-1', folderId: `${kind}-${account}` });
    if (kind === 'common_action') await createCommonAction(testDb.db, { lineAccountId: account, name: '試験の処理', actions: tagActions, folderId: `${kind}-${account}` });
    if (kind === 'conversion') await createConversionDefinition(testDb.db, { ...conversionInput, folderId: `${kind}-${account}` });
    const app = new Hono<Env>();
    app.use('*', async (c, next) => { c.set('staff', { id: 'operator-a', role: 'owner', name: '試験', readOnly: false }); await next(); });
    app.route('/', friendAttributes);
    const response = await app.request(`/api/folders?kind=${kind}&account_id=${account}`, {}, { DB: testDb.db } as Env['Bindings']);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ id: string; itemCount: number }>; unfiledCount: number };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: `${kind}-${account}`, itemCount: 1 });
    expect(body.unfiledCount).toBe(0);
  });
  it('DBへ直接書いても越境する分類を拒み、分類削除は未分類へ戻す', async () => {
    const outgoing = await createOutgoingWebhook(testDb.db, { name: '試験の送信', url: 'https://example.invalid/hook', eventTypes: [], lineAccountId: account, folderId: 'webhook-account-a' });
    expect(() => testDb.raw.prepare('UPDATE outgoing_webhooks SET folder_id = ? WHERE id = ?').run('webhook-account-b', outgoing.id)).toThrow(/folder_assignment_invalid/);
    testDb.raw.prepare('DELETE FROM folders WHERE id = ?').run('webhook-account-a');
    expect(testDb.raw.prepare('SELECT folder_id FROM outgoing_webhooks WHERE id = ?').get(outgoing.id)).toMatchObject({ folder_id: null });
  });
});
