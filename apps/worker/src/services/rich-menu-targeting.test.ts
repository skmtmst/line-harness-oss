import { describe, it, expect, vi, beforeEach } from 'vitest';

const matchesCondition = vi.fn();
vi.mock('./segment-query.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./segment-query.js')>();
  return {
    ...actual,
    matchesCondition: (...args: unknown[]) => matchesCondition(...args),
  };
});

vi.mock('@line-crm/db', () => ({
  getRichMenuTargetingCandidates: vi.fn(),
}));

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    linkRichMenuToUser = vi.fn();
    unlinkRichMenuFromUser = vi.fn();
  },
}));

import { isTargetingTrigger, pickMenuForFriend } from './rich-menu-targeting.js';

const db = {} as D1Database;

function candidate(groupId: string, priority: number, condition: unknown) {
  return {
    groupId,
    name: groupId,
    priority,
    condition: typeof condition === 'string' ? condition : JSON.stringify(condition),
    lineRichMenuId: `rm-${groupId}`,
  };
}

const TAG_RULE = { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] };

beforeEach(() => {
  matchesCondition.mockReset();
});

describe('isTargetingTrigger', () => {
  it('タグの変化・友だち追加・コンバージョンで見直す', () => {
    expect(isTargetingTrigger('tag_change')).toBe(true);
    expect(isTargetingTrigger('friend_add')).toBe(true);
    expect(isTargetingTrigger('cv_fire')).toBe(true);
  });

  it('メッセージやボタンのたびには見直さない（数が多すぎる）', () => {
    expect(isTargetingTrigger('message_received')).toBe(false);
    expect(isTargetingTrigger('postback_received')).toBe(false);
  });
});

describe('pickMenuForFriend', () => {
  it('当てはまった最初の1つを返し、そこで見るのをやめる', async () => {
    matchesCondition.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const picked = await pickMenuForFriend(db, 'friend-1', [
      candidate('a', 0, TAG_RULE),
      candidate('b', 1, TAG_RULE),
      candidate('c', 2, TAG_RULE),
    ]);
    expect(picked?.groupId).toBe('b');
    // 3つめは見ない。上にあるものが優先、という読みと動きを一致させる。
    expect(matchesCondition).toHaveBeenCalledTimes(2);
  });

  it('どれにも当てはまらなければ null', async () => {
    matchesCondition.mockResolvedValue(false);
    const picked = await pickMenuForFriend(db, 'friend-1', [
      candidate('a', 0, TAG_RULE),
      candidate('b', 1, TAG_RULE),
    ]);
    expect(picked).toBeNull();
  });

  it('読めない条件は飛ばす。全員に当たったことにはしない', async () => {
    matchesCondition.mockResolvedValue(true);
    const picked = await pickMenuForFriend(db, 'friend-1', [
      candidate('broken', 0, '{壊れた JSON'),
      candidate('ok', 1, TAG_RULE),
    ]);
    expect(picked?.groupId).toBe('ok');
    // 壊れているほうは判定にすら回さない
    expect(matchesCondition).toHaveBeenCalledTimes(1);
  });

  it('候補が無ければ null', async () => {
    expect(await pickMenuForFriend(db, 'friend-1', [])).toBeNull();
    expect(matchesCondition).not.toHaveBeenCalled();
  });
});
