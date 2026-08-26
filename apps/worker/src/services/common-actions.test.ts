import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import {
  CommonActionValidationError,
  createCommonAction,
  createCommonActionDraft,
  duplicateCommonAction,
  getCommonActionDetail,
  listCommonActionResources,
  listCommonActions,
  publishCommonActionDraft,
  updateCommonActionBindingVersion,
  updateCommonActionDraft,
} from './common-actions';

function addAccount(raw: Database.Database, id: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active)
     VALUES (?, ?, ?, '', '', 1)`,
  ).run(id, `channel-${id}`, id);
}

function addTag(raw: Database.Database, id: string, accountId: string): void {
  raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES (?, ?, ?)`)
    .run(id, id, accountId);
}

const tagAction = (tagId: string) => [{
  id: 'tag-step',
  type: 'add_tag',
  params: { tagId },
  onFailure: 'stop',
}];

describe('V6共通アクション', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    addAccount(testDb.raw, 'account-1');
    addAccount(testDb.raw, 'account-2');
    addTag(testDb.raw, 'tag-1', 'account-1');
    addTag(testDb.raw, 'tag-2', 'account-2');
  });

  it('下書きを作成・編集・公開し、公開版を直接変更できない', async () => {
    const created = await createCommonAction(testDb.db, {
      lineAccountId: 'account-1',
      name: '来店後フォロー',
      description: '来店済みタグを付ける',
      actions: tagAction('tag-1'),
      createdBy: 'staff-1',
    });
    await updateCommonActionDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      expectedDraftVersionId: created.draftVersionId,
      name: '来店後フォロー',
      description: '公開前の変更',
      actions: tagAction('tag-1'),
    });
    const published = await publishCommonActionDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      draftVersionId: created.draftVersionId,
    });

    expect(published).toEqual({ versionId: created.draftVersionId, versionNumber: 1 });
    const detail = await getCommonActionDetail(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
    });
    expect(detail).toMatchObject({
      name: '来店後フォロー',
      status: 'published',
      currentDraftVersionId: null,
      currentPublishedVersionId: created.draftVersionId,
      versions: [{ versionNumber: 1, status: 'published' }],
    });
    expect(() => testDb.raw.prepare(
      `UPDATE common_action_versions SET action_config = '[]' WHERE id = ?`,
    ).run(created.draftVersionId)).toThrow(/immutable/);
  });

  it('別アカウントの参照先は公開を拒否する', async () => {
    const created = await createCommonAction(testDb.db, {
      lineAccountId: 'account-1',
      name: '危険な下書き',
      actions: tagAction('tag-2'),
    });
    await expect(publishCommonActionDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      draftVersionId: created.draftVersionId,
    })).rejects.toMatchObject({
      code: 'resource_not_found',
      field: 'actions.0.params.tagId',
    });
    expect(testDb.raw.prepare(
      `SELECT status FROM common_action_versions WHERE id = ?`,
    ).get(created.draftVersionId)).toEqual({ status: 'draft' });
  });

  it('未知の処理を保存も公開もしない', async () => {
    await expect(createCommonAction(testDb.db, {
      lineAccountId: 'account-1',
      name: '未接続処理',
      actions: [{ id: 'future', type: 'future_action', params: {}, onFailure: 'stop' }],
    })).rejects.toMatchObject({ code: 'action_type_unsupported' });
  });

  it('複製は元とつながらない独立した下書きを作る', async () => {
    const source = await createCommonAction(testDb.db, {
      lineAccountId: 'account-1', name: '来店後フォロー', actions: tagAction('tag-1'),
    });
    await publishCommonActionDraft(testDb.db, {
      id: source.id, lineAccountId: 'account-1', draftVersionId: source.draftVersionId,
    });
    const copied = await duplicateCommonAction(testDb.db, {
      id: source.id, lineAccountId: 'account-1', createdBy: 'staff-1',
    });
    expect(copied.id).not.toBe(source.id);
    const detail = await getCommonActionDetail(testDb.db, {
      id: copied.id, lineAccountId: 'account-1',
    });
    expect(detail).toMatchObject({ name: '来店後フォロー のコピー', status: 'draft' });
    expect(detail.versions[0].actions).toEqual(tagAction('tag-1'));
    expect(detail.bindings).toEqual([]);
  });

  it('空の友だち情報項目名を公開せず、待機時間を実行形式へ揃える', async () => {
    const invalid = await createCommonAction(testDb.db, {
      lineAccountId: 'account-1',
      name: '入力不足',
      actions: [{ id: 'metadata', type: 'set_metadata', params: { values: { '': '値' } }, onFailure: 'stop' }],
    });
    await expect(publishCommonActionDraft(testDb.db, {
      id: invalid.id, lineAccountId: 'account-1', draftVersionId: invalid.draftVersionId,
    })).rejects.toMatchObject({ code: 'metadata_key_required' });

    const waiting = await createCommonAction(testDb.db, {
      lineAccountId: 'account-1',
      name: '5分待つ',
      actions: [{ id: 'wait', type: 'wait', params: { minutes: 5 }, onFailure: 'stop' }],
    });
    await publishCommonActionDraft(testDb.db, {
      id: waiting.id, lineAccountId: 'account-1', draftVersionId: waiting.draftVersionId,
    });
    const detail = await getCommonActionDetail(testDb.db, {
      id: waiting.id, lineAccountId: 'account-1',
    });
    expect(detail.versions[0].actions[0].params).toEqual({ durationMinutes: 5 });
  });

  it('新版公開後も利用先は旧版のままにし、明示操作でだけ切り替える', async () => {
    const created = await createCommonAction(testDb.db, {
      lineAccountId: 'account-1', name: '固定版', actions: tagAction('tag-1'),
    });
    await publishCommonActionDraft(testDb.db, {
      id: created.id, lineAccountId: 'account-1', draftVersionId: created.draftVersionId,
    });
    testDb.raw.prepare(
      `INSERT INTO common_action_bindings
         (id, line_account_id, common_action_id, common_action_version_id,
          consumer_type, consumer_id, consumer_path)
       VALUES ('binding-1', 'account-1', ?, ?, 'automation', 'automation-1', 'step-1')`,
    ).run(created.id, created.draftVersionId);
    const draft2 = await createCommonActionDraft(testDb.db, {
      id: created.id, lineAccountId: 'account-1', createdBy: 'staff-1',
    });
    await updateCommonActionDraft(testDb.db, {
      id: created.id,
      lineAccountId: 'account-1',
      expectedDraftVersionId: draft2.draftVersionId,
      name: '固定版',
      actions: [{ id: 'wait', type: 'wait', params: { minutes: 5 }, onFailure: 'stop' }],
    });
    await publishCommonActionDraft(testDb.db, {
      id: created.id, lineAccountId: 'account-1', draftVersionId: draft2.draftVersionId,
    });

    expect(testDb.raw.prepare(
      `SELECT common_action_version_id FROM common_action_bindings WHERE id = 'binding-1'`,
    ).get()).toEqual({ common_action_version_id: created.draftVersionId });
    let detail = await getCommonActionDetail(testDb.db, {
      id: created.id, lineAccountId: 'account-1',
    });
    expect(detail.bindings[0]).toMatchObject({ versionNumber: 1, hasNewerVersion: true });

    await updateCommonActionBindingVersion(testDb.db, {
      id: created.id,
      bindingId: 'binding-1',
      lineAccountId: 'account-1',
      versionId: draft2.draftVersionId,
    });
    detail = await getCommonActionDetail(testDb.db, {
      id: created.id, lineAccountId: 'account-1',
    });
    expect(detail.bindings[0]).toMatchObject({ versionNumber: 2, hasNewerVersion: false });
  });

  it('共通アクション同士の循環を公開できない', async () => {
    const first = await createCommonAction(testDb.db, {
      lineAccountId: 'account-1', name: 'A', actions: tagAction('tag-1'),
    });
    const second = await createCommonAction(testDb.db, {
      lineAccountId: 'account-1', name: 'B', actions: tagAction('tag-1'),
    });
    await publishCommonActionDraft(testDb.db, {
      id: first.id, lineAccountId: 'account-1', draftVersionId: first.draftVersionId,
    });
    await updateCommonActionDraft(testDb.db, {
      id: second.id,
      lineAccountId: 'account-1',
      expectedDraftVersionId: second.draftVersionId,
      name: 'B',
      actions: [{
        id: 'call-a', type: 'common_action',
        params: { commonActionId: first.id }, onFailure: 'stop',
      }],
    });
    await publishCommonActionDraft(testDb.db, {
      id: second.id, lineAccountId: 'account-1', draftVersionId: second.draftVersionId,
    });
    const draftA2 = await createCommonActionDraft(testDb.db, {
      id: first.id, lineAccountId: 'account-1',
    });
    await updateCommonActionDraft(testDb.db, {
      id: first.id,
      lineAccountId: 'account-1',
      expectedDraftVersionId: draftA2.draftVersionId,
      name: 'A',
      actions: [{
        id: 'call-b', type: 'common_action',
        params: { commonActionId: second.id }, onFailure: 'stop',
      }],
    });

    await expect(publishCommonActionDraft(testDb.db, {
      id: first.id, lineAccountId: 'account-1', draftVersionId: draftA2.draftVersionId,
    })).rejects.toBeInstanceOf(CommonActionValidationError);
    await expect(publishCommonActionDraft(testDb.db, {
      id: first.id, lineAccountId: 'account-1', draftVersionId: draftA2.draftVersionId,
    })).rejects.toMatchObject({ code: 'common_action_cycle' });
  });

  it('一覧で旧版利用ありと未使用を区別する', async () => {
    const used = await createCommonAction(testDb.db, {
      lineAccountId: 'account-1', name: '利用中', actions: tagAction('tag-1'),
    });
    await publishCommonActionDraft(testDb.db, {
      id: used.id, lineAccountId: 'account-1', draftVersionId: used.draftVersionId,
    });
    const unused = await createCommonAction(testDb.db, {
      lineAccountId: 'account-1', name: '未使用', actions: tagAction('tag-1'),
    });
    await publishCommonActionDraft(testDb.db, {
      id: unused.id, lineAccountId: 'account-1', draftVersionId: unused.draftVersionId,
    });
    testDb.raw.prepare(
      `INSERT INTO common_action_bindings
         (id, line_account_id, common_action_id, common_action_version_id,
          consumer_type, consumer_id, consumer_path)
       VALUES ('binding-used', 'account-1', ?, ?, 'automation', 'automation-1', 'step-1')`,
    ).run(used.id, used.draftVersionId);

    const unusedRows = await listCommonActions(testDb.db, {
      lineAccountId: 'account-1', status: 'unused',
    });
    expect(unusedRows.map((row) => row.id)).toEqual([unused.id]);
  });

  it('編集画面の選択肢をLINE公式アカウント内に限定する', async () => {
    const resources = await listCommonActionResources(testDb.db, {
      lineAccountId: 'account-1',
    });
    expect(resources.tags).toEqual([{ id: 'tag-1', name: 'tag-1' }]);
    expect(resources.tags).not.toContainEqual(expect.objectContaining({ id: 'tag-2' }));
  });
});
