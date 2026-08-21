import { describe, expect, it, vi } from 'vitest';
import { expandVariables } from './step-delivery.js';
import { resolveInterpolationExtra, findUnknownPlaceholders } from './interpolation-context.js';

const FRIEND = {
  id: 'f-1',
  display_name: '山田',
  user_id: null,
  ref_code: null,
  metadata: {},
};

describe('友だち情報欄の差し込み', () => {
  it('値を差し込む', () => {
    const out = expandVariables('{{field.pet_name}}ちゃん、こんにちは', FRIEND, undefined, 'text', {
      fields: { pet_name: 'ポチ' },
    });
    expect(out).toBe('ポチちゃん、こんにちは');
  });

  it('未設定の項目は空文字になる', () => {
    // 「未設定」と書くと、そのままお客様に送られてしまう。
    const out = expandVariables('{{field.pet_name}}ちゃん', FRIEND, undefined, 'text', {
      fields: {},
    });
    expect(out).toBe('ちゃん');
  });

  it('値があるときだけ出す書き方ができる', () => {
    const tpl = '{{#if_field.pet_name}}{{field.pet_name}}ちゃんの{{/if_field.pet_name}}ご予約';
    expect(expandVariables(tpl, FRIEND, undefined, 'text', { fields: { pet_name: 'ポチ' } })).toBe(
      'ポチちゃんのご予約',
    );
    expect(expandVariables(tpl, FRIEND, undefined, 'text', { fields: {} })).toBe('ご予約');
  });

  it('共通情報も差し込める', () => {
    const out = expandVariables('営業時間は{{var.shop_hours}}です', FRIEND, undefined, 'text', {
      vars: { shop_hours: '10時〜19時' },
    });
    expect(out).toBe('営業時間は10時〜19時です');
  });

  it('既存の差し込みと混ぜても壊れない', () => {
    const out = expandVariables(
      '{{name}}さん、{{field.pet_name}}ちゃん、{{var.shop_hours}}',
      FRIEND,
      undefined,
      'text',
      { fields: { pet_name: 'ポチ' }, vars: { shop_hours: '10-19' } },
    );
    expect(out).toBe('山田さん、ポチちゃん、10-19');
  });

  it('Flex の JSON を壊さない', () => {
    // 単一の波括弧で置換していたら、ここで本文が壊れる。
    const flex = '{"type":"bubble","body":{"type":"box","contents":[{"type":"text","text":"{{field.pet_name}}"}]}}';
    const out = expandVariables(flex, FRIEND, undefined, 'flex', { fields: { pet_name: 'ポチ' } });
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).toContain('"text":"ポチ"');
  });

  it('差し込みを渡さなくても落ちない', () => {
    expect(expandVariables('{{field.x}}{{var.y}}', FRIEND)).toBe('');
  });
});

describe('差し込みの値を引くかどうか', () => {
  function makeDb() {
    const queries: string[] = [];
    const db = {
      prepare(query: string) {
        queries.push(query);
        return {
          bind() {
            return { async all() { return { results: [] }; } };
          },
          async all() {
            return { results: [] };
          },
        };
      },
    } as unknown as D1Database;
    return { db, queries };
  }

  it('差し込みが1つも無ければDBを引かない', async () => {
    const { db, queries } = makeDb();
    const extra = await resolveInterpolationExtra(db, 'f-1', 'ふつうの本文です');
    expect(extra).toEqual({});
    expect(queries).toEqual([]);
  });

  it('情報欄の差し込みがあれば引く', async () => {
    const { db, queries } = makeDb();
    await resolveInterpolationExtra(db, 'f-1', '{{field.pet_name}}');
    expect(queries.some((q) => q.includes('friend_fields'))).toBe(true);
    expect(queries.some((q) => q.includes('common_vars'))).toBe(false);
  });

  it('条件ブロックだけでも引く', async () => {
    const { db, queries } = makeDb();
    await resolveInterpolationExtra(db, 'f-1', '{{#if_field.x}}あり{{/if_field.x}}');
    expect(queries.some((q) => q.includes('friend_fields'))).toBe(true);
  });

  it('共通情報だけなら共通情報だけ引く', async () => {
    const { db, queries } = makeDb();
    await resolveInterpolationExtra(db, 'f-1', '{{var.shop_hours}}');
    expect(queries.some((q) => q.includes('common_vars'))).toBe(true);
    expect(queries.some((q) => q.includes('friend_fields'))).toBe(false);
  });
});

describe('未定義の差し込みの検出', () => {
  const known = { fields: new Set(['pet_name']), vars: new Set(['shop_hours']) };

  it('定義済みは拾わない', () => {
    expect(findUnknownPlaceholders('{{field.pet_name}}{{var.shop_hours}}', known)).toEqual([]);
  });

  it('未定義は名前を返す', () => {
    expect(findUnknownPlaceholders('{{field.ghost}}', known)).toEqual(['field.ghost']);
    expect(findUnknownPlaceholders('{{var.ghost}}', known)).toEqual(['var.ghost']);
  });

  it('同じものは1回だけ', () => {
    expect(findUnknownPlaceholders('{{field.ghost}}{{field.ghost}}', known)).toEqual([
      'field.ghost',
    ]);
  });

  it('条件ブロックの中も見る', () => {
    expect(findUnknownPlaceholders('{{#if_field.ghost}}x{{/if_field.ghost}}', known)).toEqual([
      'field.ghost',
    ]);
  });
});
