import { describe, expect, it, vi } from 'vitest';
import {
  buildLineRichMenuPayload,
  RichMenuValidationError,
  validateRichMenuGroupForPublish,
  validateRichMenuPagesWithLine,
  type GroupInput,
  type LineRichMenuClient,
} from './rich-menu-publisher.js';

/**
 * O(公開前の確認)の単体試験。route 試験（rich-menu-publish-ko.test.ts）が
 * 端から端を守り、ここは検証・組み立ての分岐を守る。
 */

function baseGroup(pages: GroupInput['pages']): GroupInput {
  return {
    id: 'gid12345-aaaa', size: 'large', chatBarText: 'menu', isDefaultForAll: false,
    pages,
  };
}

function urlArea(id: string, label = 'リンクを開く'): GroupInput['pages'][number]['areas'][number] {
  return {
    id, bounds: { x: 0, y: 0, width: 100, height: 100 },
    actionType: 'uri', actionData: { uri: 'https://example.com' },
    intent: 'url', label,
  };
}

function fakeLine(impl: Partial<LineRichMenuClient> = {}): LineRichMenuClient {
  return {
    createRichMenu: vi.fn(),
    validateRichMenu: vi.fn(),
    listRichMenus: vi.fn(async () => []),
    uploadRichMenuImage: vi.fn(),
    deleteRichMenuAlias: vi.fn(),
    createRichMenuAlias: vi.fn(),
    upsertRichMenuAlias: vi.fn(),
    deleteRichMenu: vi.fn(),
    setDefaultRichMenu: vi.fn(),
    clearDefaultRichMenu: vi.fn(),
    getCurrentDefaultRichMenuId: vi.fn(async () => null),
    linkRichMenuBulk: vi.fn(),
    ...impl,
  } as unknown as LineRichMenuClient;
}

describe('10ページ上限', () => {
  function pages(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `p${i}`, orderIndex: i, name: `ページ${i + 1}`,
      imageR2Key: null, imageContentType: null, lineRichMenuId: null,
      areas: [urlArea(`a${i}`)],
    }));
  }

  it('10ページは通る', () => {
    expect(() => validateRichMenuGroupForPublish(baseGroup(pages(10)))).not.toThrow();
  });

  it('11ページは止まる。直しを戻すと赤くなる', () => {
    expect(() => validateRichMenuGroupForPublish(baseGroup(pages(11)))).toThrow(/10まで/);
  });
});

describe('日時を選ぶ・コピーするボタンの検証', () => {
  function groupWith(area: GroupInput['pages'][number]['areas'][number]) {
    return baseGroup([{
      id: 'p1', orderIndex: 0, name: 'ページ1',
      imageR2Key: null, imageContentType: null, lineRichMenuId: null,
      areas: [area],
    }]);
  }

  it('日時の種類ごとに形を見る', () => {
    const good = groupWith({
      ...urlArea('a1', '日時を選ぶ'), intent: 'datetime',
      actionData: { mode: 'datetime', initial: '2026-10-01t10:00' },
    });
    expect(() => validateRichMenuGroupForPublish(good)).not.toThrow();

    const badMode = groupWith({
      ...urlArea('a1', '日時を選ぶ'), intent: 'datetime', actionData: { mode: '' },
    });
    expect(() => validateRichMenuGroupForPublish(badMode)).toThrow(/日時の種類/);

    const badShape = groupWith({
      ...urlArea('a1', '日時を選ぶ'), intent: 'datetime',
      actionData: { mode: 'time', initial: '2026-10-01' },
    });
    expect(() => validateRichMenuGroupForPublish(badShape)).toThrow(/形/);
  });

  it('コピーは空と長すぎを止める', () => {
    const empty = groupWith({
      ...urlArea('a1', 'コピーする'), intent: 'clipboard', actionData: { text: '' },
    });
    expect(() => validateRichMenuGroupForPublish(empty)).toThrow(/コピーする文字/);

    const long = groupWith({
      ...urlArea('a1', 'コピーする'), intent: 'clipboard', actionData: { text: 'あ'.repeat(1001) },
    });
    expect(() => validateRichMenuGroupForPublish(long)).toThrow(/1000文字/);
  });

  it('LINEへの形は本来の動きになる', () => {
    const group = baseGroup([{
      id: 'p1', orderIndex: 0, name: 'ページ1',
      imageR2Key: null, imageContentType: null, lineRichMenuId: null,
      areas: [
        { ...urlArea('a1', '日時を選ぶ'), intent: 'datetime', actionData: { mode: 'date', initial: '2026-10-01' } },
        { ...urlArea('a2', 'コピーする'), intent: 'clipboard', actionData: { text: '合言葉' } },
      ],
    }]);
    const payload = buildLineRichMenuPayload(group, group.pages[0]);
    expect(payload.areas).toEqual([
      { bounds: { x: 0, y: 0, width: 100, height: 100 }, action: expect.objectContaining({ type: 'datetimepicker', mode: 'date', initial: '2026-10-01' }) },
      { bounds: { x: 0, y: 0, width: 100, height: 100 }, action: { type: 'clipboard', text: '合言葉' } },
    ]);
  });
});

describe('LINEの検査APIへの通し方', () => {
  function group() {
    return baseGroup([{
      id: 'p1', orderIndex: 0, name: 'ページ1',
      imageR2Key: null, imageContentType: null, lineRichMenuId: null,
      areas: [urlArea('a1')],
    }]);
  }

  it('通れば何もしない。作る形と同じものを送る', async () => {
    const line = fakeLine();
    await validateRichMenuPagesWithLine(group(), line);
    expect(line.validateRichMenu).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(line.validateRichMenu).mock.calls[0][0] as {
      chatBarText: string; areas: Array<{ action: { type: string } }>;
    };
    expect(sent.chatBarText).toBe('menu');
    expect(sent.areas[0].action.type).toBe('uri');
  });

  it('LINEの400はページ名つきの直し文になる', async () => {
    const line = fakeLine({
      validateRichMenu: vi.fn(async () => {
        throw new RichMenuValidationError('LINE validateRichMenu failed: 400 bad areas');
      }),
    });
    await expect(validateRichMenuPagesWithLine(group(), line)).rejects.toThrow(/ページ1.*検査を通りませんでした/);
  });

  it('通信障害はそのまま投げる（下書きのせいにしない）', async () => {
    const line = fakeLine({
      validateRichMenu: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });
    await expect(validateRichMenuPagesWithLine(group(), line)).rejects.toThrow('fetch failed');
  });
});
