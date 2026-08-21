import { beforeEach, describe, expect, test, vi } from 'vitest';
import { emptyLayout, newBlockId, type FormInputBlock, type FormLayout } from '@line-crm/shared';

const mocks = vi.hoisted(() => ({
  countChoiceUsage: vi.fn(),
  countFormSubmissionsByFriend: vi.fn(),
  enrollFriendInReminder: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getFriendFieldById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  removeTagFromFriend: vi.fn(),
  setFriendFieldValue: vi.fn(),
  attachTag: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  countChoiceUsage: mocks.countChoiceUsage,
  countFormSubmissionsByFriend: mocks.countFormSubmissionsByFriend,
  enrollFriendInReminder: mocks.enrollFriendInReminder,
  enrollFriendInScenario: mocks.enrollFriendInScenario,
  getFriendFieldById: mocks.getFriendFieldById,
  getMessageTemplateById: mocks.getMessageTemplateById,
  removeTagFromFriend: mocks.removeTagFromFriend,
  setFriendFieldValue: mocks.setFriendFieldValue,
  jstNow: () => '2026-08-19T12:00:00+09:00',
}));

vi.mock('./friend-tag-attach.js', () => ({
  attachTagAndFireSideEffects: mocks.attachTag,
}));

import { applyFormLayoutEffects, checkFormGates } from './form-layout-effects.js';

/** UPDATE 文を覚えるだけの D1 の身代わり。 */
function fakeDb() {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            run: async () => {
              calls.push({ sql, binds });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

function input(partial: Partial<FormInputBlock> & { name: string }): FormInputBlock {
  return {
    id: newBlockId(),
    kind: 'input',
    type: 'text',
    label: partial.name,
    ...partial,
  };
}

function layoutWith(blocks: FormInputBlock[]): FormLayout {
  const layout = emptyLayout();
  layout.sections[0].blocks = blocks;
  return layout;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countChoiceUsage.mockResolvedValue(new Map());
  mocks.countFormSubmissionsByFriend.mockResolvedValue(0);
  mocks.getFriendFieldById.mockResolvedValue({ id: 'ff-1', ec_is_master: 0 });
});

describe('受け付けてよいかの判定', () => {
  const base = {
    formId: 'form-1',
    friendId: 'friend-1',
    submitCount: 0,
    answers: {} as Record<string, unknown>,
  };

  test('期限を過ぎていたら断る', async () => {
    const layout = emptyLayout();
    layout.options.deadline = {
      enabled: true,
      endsAt: '2026-08-18T23:59',
      message: '締め切りました',
    };
    const { db } = fakeDb();

    const result = await checkFormGates({
      ...base,
      db,
      layout,
      now: new Date('2026-08-19T00:00:00+09:00'),
    });
    expect(result).toBe('締め切りました');
  });

  test('期限内なら通す', async () => {
    const layout = emptyLayout();
    layout.options.deadline = { enabled: true, endsAt: '2026-08-31T23:59' };
    const { db } = fakeDb();

    expect(
      await checkFormGates({
        ...base,
        db,
        layout,
        now: new Date('2026-08-19T00:00:00+09:00'),
      }),
    ).toBeNull();
  });

  test('総数が上限に達していたら断る。DBは読みに行かない', async () => {
    const layout = emptyLayout();
    layout.options.totalLimit = { enabled: true, max: 100 };
    const { db } = fakeDb();

    expect(await checkFormGates({ ...base, db, layout, submitCount: 100 })).toBe(
      'このフォームは受付を終了しました',
    );
    expect(mocks.countFormSubmissionsByFriend).not.toHaveBeenCalled();
  });

  test('1人1回。2回目は断る', async () => {
    const layout = emptyLayout();
    layout.options.oncePerFriend = { enabled: true };
    mocks.countFormSubmissionsByFriend.mockResolvedValue(1);
    const { db } = fakeDb();

    expect(await checkFormGates({ ...base, db, layout })).toBe(
      'このフォームは、お一人さま1回までです',
    );
  });

  test('必須が空なら、DBを読む前に断る', async () => {
    const layout = layoutWith([input({ name: 'x', label: 'お名前', required: true })]);
    layout.options.oncePerFriend = { enabled: true };
    const { db } = fakeDb();

    expect(await checkFormGates({ ...base, db, layout, answers: {} })).toBe(
      'お名前 は必須項目です',
    );
    expect(mocks.countFormSubmissionsByFriend).not.toHaveBeenCalled();
  });

  test('定員が埋まった選択肢は断る', async () => {
    const layout = layoutWith([
      input({
        name: 'slot',
        label: '希望の回',
        type: 'radio',
        choices: [
          { id: 'c1', label: '午前', capacity: { enabled: true, limit: 2 } },
          { id: 'c2', label: '午後', capacity: { enabled: true, limit: 2 } },
        ],
      }),
    ]);
    mocks.countChoiceUsage.mockResolvedValue(new Map([['午前', 2]]));
    const { db } = fakeDb();

    expect(await checkFormGates({ ...base, db, layout, answers: { slot: '午前' } })).toBe(
      '「午前」は定員に達しました',
    );
    expect(await checkFormGates({ ...base, db, layout, answers: { slot: '午後' } })).toBeNull();
  });

  test('定員を決めていない選択肢は、数えに行かない', async () => {
    const layout = layoutWith([
      input({
        name: 'slot',
        label: '希望の回',
        type: 'radio',
        choices: [{ id: 'c1', label: '午前' }],
      }),
    ]);
    const { db } = fakeDb();

    expect(await checkFormGates({ ...base, db, layout, answers: { slot: '午前' } })).toBeNull();
    expect(mocks.countChoiceUsage).not.toHaveBeenCalled();
  });
});

describe('回答を配る', () => {
  test('登録先の情報欄すべてに書く', async () => {
    const layout = layoutWith([
      input({
        name: 'full_name',
        label: 'お名前',
        destinations: { friendFieldIds: ['ff-1', 'ff-2'] },
      }),
    ]);
    const { db } = fakeDb();

    await applyFormLayoutEffects({
      db,
      layout,
      friendId: 'friend-1',
      answers: { full_name: '山田太郎' },
    });

    expect(mocks.setFriendFieldValue).toHaveBeenCalledTimes(2);
    expect(mocks.setFriendFieldValue).toHaveBeenCalledWith(db, {
      friendId: 'friend-1',
      fieldId: 'ff-1',
      value: '山田太郎',
      updatedBy: 'form',
    });
  });

  test('EC側が正の情報欄には書かない', async () => {
    mocks.getFriendFieldById.mockResolvedValue({ id: 'ff-1', ec_is_master: 1 });
    const layout = layoutWith([
      input({ name: 'addr', label: '住所', destinations: { friendFieldIds: ['ff-1'] } }),
    ]);
    const { db } = fakeDb();

    await applyFormLayoutEffects({
      db,
      layout,
      friendId: 'friend-1',
      answers: { addr: '東京都...' },
    });
    expect(mocks.setFriendFieldValue).not.toHaveBeenCalled();
  });

  test('本名・システム表示名・個別メモは friends の列に書く', async () => {
    const layout = layoutWith([
      input({
        name: 'full_name',
        label: 'お名前',
        destinations: { realName: true, displayName: true, note: true },
      }),
    ]);
    const { db, calls } = fakeDb();

    await applyFormLayoutEffects({
      db,
      layout,
      friendId: 'friend-1',
      answers: { full_name: '山田太郎' },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('real_name = ?');
    expect(calls[0].sql).toContain('system_display_name = ?');
    expect(calls[0].sql).toContain('private_memo = ?');
    expect(calls[0].binds.slice(0, 3)).toEqual(['山田太郎', '山田太郎', '山田太郎']);
  });

  test('選んだ選択肢のタグだけを付ける', async () => {
    const layout = layoutWith([
      input({
        name: 'pet',
        label: '飼っている子',
        type: 'checkbox',
        choiceMode: 'tag',
        choices: [
          { id: 'c1', label: '犬', tagId: 'tag-dog' },
          { id: 'c2', label: '猫', tagId: 'tag-cat' },
          { id: 'c3', label: '鳥', tagId: 'tag-bird' },
        ],
      }),
    ]);
    const { db } = fakeDb();

    await applyFormLayoutEffects({
      db,
      layout,
      friendId: 'friend-1',
      answers: { pet: ['犬', '鳥'] },
    });

    const attached = mocks.attachTag.mock.calls.map((c) => c[2]);
    expect(attached).toEqual(['tag-dog', 'tag-bird']);
  });

  test('友だち情報に登録するときは、値が空なら選択肢名を入れる', async () => {
    const layout = layoutWith([
      input({
        name: 'plan',
        label: 'プラン',
        type: 'radio',
        choiceMode: 'friendField',
        choiceFriendFieldId: 'ff-1',
        choices: [
          { id: 'c1', label: '松', value: 'premium' },
          { id: 'c2', label: '竹' },
        ],
      }),
    ]);
    const { db } = fakeDb();

    await applyFormLayoutEffects({ db, layout, friendId: 'f1', answers: { plan: '松' } });
    expect(mocks.setFriendFieldValue).toHaveBeenCalledWith(db, {
      friendId: 'f1',
      fieldId: 'ff-1',
      value: 'premium',
      updatedBy: 'form',
    });

    vi.clearAllMocks();
    mocks.getFriendFieldById.mockResolvedValue({ id: 'ff-1', ec_is_master: 0 });
    await applyFormLayoutEffects({ db, layout, friendId: 'f1', answers: { plan: '竹' } });
    expect(mocks.setFriendFieldValue).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ value: '竹' }),
    );
  });

  test('選択肢の動作を、選んだものだけ実行する', async () => {
    const layout = layoutWith([
      input({
        name: 'want',
        label: '希望',
        type: 'radio',
        choiceMode: 'action',
        choices: [
          {
            id: 'c1',
            label: '資料がほしい',
            actions: [
              { kind: 'send_text', text: '資料をお送りします' },
              { kind: 'scenario', op: 'start', scenarioId: 'sc-1' },
            ],
          },
          {
            id: 'c2',
            label: '今はいい',
            actions: [{ kind: 'tag', op: 'add', tagIds: ['tag-later'] }],
          },
        ],
      }),
    ]);
    const { db } = fakeDb();
    const sent: string[] = [];

    await applyFormLayoutEffects({
      db,
      layout,
      friendId: 'f1',
      answers: { want: '資料がほしい' },
      pushText: async (text) => {
        sent.push(text);
      },
    });

    expect(sent).toEqual(['資料をお送りします']);
    expect(mocks.enrollFriendInScenario).toHaveBeenCalledWith(db, 'f1', 'sc-1');
    expect(mocks.attachTag).not.toHaveBeenCalled();
  });

  test('日付の回答からリマインダを動かす', async () => {
    const layout = layoutWith([
      input({
        name: 'birthday',
        label: '生年月日',
        type: 'date',
        reminder: { reminderId: 'rm-1', time: '09:00' },
      }),
    ]);
    const { db } = fakeDb();

    await applyFormLayoutEffects({
      db,
      layout,
      friendId: 'f1',
      answers: { birthday: '2026-09-01' },
    });

    expect(mocks.enrollFriendInReminder).toHaveBeenCalledWith(db, {
      friendId: 'f1',
      reminderId: 'rm-1',
      targetDate: '2026-09-01',
    });
  });

  test('回答後の動作を実行する', async () => {
    const layout = emptyLayout();
    layout.options.afterActions = [{ kind: 'tag', op: 'remove', tagIds: ['tag-old'] }];
    const { db } = fakeDb();

    await applyFormLayoutEffects({ db, layout, friendId: 'f1', answers: {} });
    expect(mocks.removeTagFromFriend).toHaveBeenCalledWith(db, 'f1', 'tag-old');
  });

  test('1つ失敗しても、残りは実行する', async () => {
    mocks.attachTag.mockRejectedValueOnce(new Error('タグの付与に失敗'));
    const layout = layoutWith([
      input({
        name: 'pet',
        label: '飼っている子',
        type: 'checkbox',
        choiceMode: 'tag',
        choices: [
          { id: 'c1', label: '犬', tagId: 'tag-dog' },
          { id: 'c2', label: '猫', tagId: 'tag-cat' },
        ],
      }),
      input({
        name: 'full_name',
        label: 'お名前',
        destinations: { friendFieldIds: ['ff-1'] },
      }),
    ]);
    const { db } = fakeDb();

    await expect(
      applyFormLayoutEffects({
        db,
        layout,
        friendId: 'f1',
        answers: { pet: ['犬', '猫'], full_name: '山田' },
      }),
    ).resolves.toBeUndefined();

    expect(mocks.setFriendFieldValue).toHaveBeenCalled();
  });

  test('テキストではないテンプレートは送らない', async () => {
    mocks.getMessageTemplateById.mockResolvedValue({
      id: 'tpl-1',
      message_type: 'flex',
      message_content: '{}',
    });
    const layout = emptyLayout();
    layout.options.afterActions = [{ kind: 'send_template', templateId: 'tpl-1' }];
    const { db } = fakeDb();
    const sent: string[] = [];

    await applyFormLayoutEffects({
      db,
      layout,
      friendId: 'f1',
      answers: {},
      pushText: async (t) => {
        sent.push(t);
      },
    });
    expect(sent).toEqual([]);
  });

  test('答えていない欄には、何も起こさない', async () => {
    const layout = layoutWith([
      input({
        name: 'pet',
        label: '飼っている子',
        type: 'radio',
        choiceMode: 'tag',
        choices: [{ id: 'c1', label: '犬', tagId: 'tag-dog' }],
      }),
    ]);
    const { db } = fakeDb();

    await applyFormLayoutEffects({ db, layout, friendId: 'f1', answers: {} });
    expect(mocks.attachTag).not.toHaveBeenCalled();
  });
});
