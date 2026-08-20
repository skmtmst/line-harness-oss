import { describe, it, expect } from 'vitest';
import {
  keywordMatches,
  keywordRuleMatches,
  resolveKeywordRules,
  parseAutoReplyActions,
} from './auto-reply.js';

describe('キーワード1行ぶんの判定', () => {
  it('完全一致と部分一致', () => {
    expect(keywordRuleMatches({ keyword: '予約', matchType: 'exact' }, '予約')).toBe(true);
    expect(keywordRuleMatches({ keyword: '予約', matchType: 'exact' }, '予約したい')).toBe(false);
    expect(keywordRuleMatches({ keyword: '予約', matchType: 'contains' }, '予約したい')).toBe(true);
  });

  it('空のキーワードは当てない（全部に当たってしまう）', () => {
    expect(keywordRuleMatches({ keyword: '', matchType: 'contains' }, 'なんでも')).toBe(false);
  });

  describe('最低字数', () => {
    // 部分一致は短い言葉ほど誤爆する。「はい」を含む応答は「配送はいつ」まで当たる。
    const rule = { keyword: 'はい', matchType: 'contains' as const, minLength: 2 };

    it('ひとことの返事は当たる', () => {
      expect(keywordRuleMatches(rule, 'はい')).toBe(true);
    });

    it('字数が足りなければ当てない', () => {
      expect(keywordRuleMatches({ ...rule, minLength: 5 }, 'はい')).toBe(false);
    });

    it('字数は文字で数える（絵文字を1文字と数える）', () => {
      expect(keywordRuleMatches({ keyword: 'あ', matchType: 'contains', minLength: 3 }, 'あ😀')).toBe(
        false,
      );
      expect(
        keywordRuleMatches({ keyword: 'あ', matchType: 'contains', minLength: 2 }, 'あ😀'),
      ).toBe(true);
    });
  });

  describe('文字の種類を区別しない', () => {
    const rule = { keyword: 'LINE', matchType: 'exact' as const, caseSensitive: false };

    it('大文字小文字をそろえる', () => {
      expect(keywordRuleMatches(rule, 'line')).toBe(true);
      expect(keywordRuleMatches(rule, 'Line')).toBe(true);
    });

    it('全角と半角もそろえる', () => {
      expect(keywordRuleMatches(rule, 'ＬＩＮＥ')).toBe(true);
    });

    it('既定では区別する', () => {
      expect(keywordRuleMatches({ keyword: 'LINE', matchType: 'exact' }, 'line')).toBe(false);
    });
  });
});

describe('resolveKeywordRules', () => {
  it('設定が無ければ、これまでどおりの1行として扱う', () => {
    expect(resolveKeywordRules({ keyword: '予約', match_type: 'contains' })).toEqual([
      { keyword: '予約', matchType: 'contains' },
    ]);
  });

  it('複数行を読む', () => {
    const rules = resolveKeywordRules({
      keyword: '予約',
      match_type: 'exact',
      keywords_json: JSON.stringify([
        { keyword: '渋谷', matchType: 'contains' },
        { keyword: 'しぶや', matchType: 'contains', caseSensitive: false },
      ]),
    });
    expect(rules).toHaveLength(2);
    expect(rules[1].caseSensitive).toBe(false);
  });

  it('読めない設定なら、元の1行に戻す（黙って当たらなくなるのを防ぐ）', () => {
    const rules = resolveKeywordRules({
      keyword: '予約',
      match_type: 'exact',
      keywords_json: '{壊れた',
    });
    expect(rules).toEqual([{ keyword: '予約', matchType: 'exact' }]);
  });

  it('中身が空の配列でも、元の1行に戻す', () => {
    expect(
      resolveKeywordRules({ keyword: '予約', match_type: 'exact', keywords_json: '[]' }),
    ).toEqual([{ keyword: '予約', matchType: 'exact' }]);
  });
});

describe('keywordMatches（複数行はどれか1つに当たればよい）', () => {
  const rule = {
    keyword: '使わない',
    match_type: 'exact',
    keywords_json: JSON.stringify([
      { keyword: '渋谷', matchType: 'contains' },
      { keyword: '新宿', matchType: 'contains' },
    ]),
  };

  it('どれかに当たれば当たり', () => {
    expect(keywordMatches(rule, '渋谷店はどこ')).toBe(true);
    expect(keywordMatches(rule, '新宿に行きたい')).toBe(true);
  });

  it('どれにも当たらなければ外れ', () => {
    expect(keywordMatches(rule, '池袋はどこ')).toBe(false);
  });
});

describe('parseAutoReplyActions', () => {
  it('未設定なら空', () => {
    expect(parseAutoReplyActions(null)).toEqual([]);
    expect(parseAutoReplyActions('')).toEqual([]);
  });

  it('タグ追加を、実行できる形に読む', () => {
    const actions = parseAutoReplyActions(
      JSON.stringify([{ actionType: 'tag', config: { op: 'add', tagIds: ['t-1'] } }]),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].action_type).toBe('tag');
    expect(JSON.parse(actions[0].config_json)).toEqual({ op: 'add', tagIds: ['t-1'] });
    // 自動応答は当たるたびに動かす
    expect(actions[0].repeat_on_refire).toBe(1);
  });

  it('並べた順を保つ（タグを付けてから、それを条件にした次を動かせるように）', () => {
    const actions = parseAutoReplyActions(
      JSON.stringify([
        { actionType: 'tag', config: { op: 'add', tagIds: ['t-1'] } },
        { actionType: 'support_mark', config: { markId: 'm-1' } },
      ]),
    );
    expect(actions.map((a) => a.sort_order)).toEqual([0, 1]);
    expect(actions.map((a) => a.action_type)).toEqual(['tag', 'support_mark']);
  });

  it('読めない設定は空にする（返信ごと止めない）', () => {
    expect(parseAutoReplyActions('{壊れた')).toEqual([]);
  });

  it('中身が足りない行は飛ばす', () => {
    const actions = parseAutoReplyActions(
      JSON.stringify([{ actionType: 'tag' }, { config: {} }, null, 'ごみ']),
    );
    expect(actions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 157: 一律で応答
// ---------------------------------------------------------------------------

describe('一律で応答（キーワードを見ない）', () => {
  const rule = {
    keyword: '',
    match_type: 'exact',
    respond_to_all: 1,
  };

  it('どんな文にも当たる', () => {
    expect(keywordMatches(rule, 'こんにちは')).toBe(true);
    expect(keywordMatches(rule, '予約したい')).toBe(true);
    // キーワードが空でも当たる。空文字を「何にも当たらない」と扱っていた
    // これまでの判定とは別の道を通る。
    expect(keywordMatches(rule, '')).toBe(true);
  });

  it('キーワードが入っていても、一律なら見ない', () => {
    expect(keywordMatches({ ...rule, keyword: '予約' }, '関係ない話')).toBe(true);
  });

  it('切ってあれば、これまでどおりキーワードを見る', () => {
    const off = { keyword: '予約', match_type: 'exact', respond_to_all: 0 };
    expect(keywordMatches(off, '予約')).toBe(true);
    expect(keywordMatches(off, '関係ない話')).toBe(false);
  });

  it('設定が無い（昔のルール）なら、これまでどおり', () => {
    expect(keywordMatches({ keyword: '予約', match_type: 'exact' }, '関係ない話')).toBe(false);
  });
});
