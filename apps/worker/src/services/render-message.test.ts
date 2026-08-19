import { describe, expect, test } from 'vitest';
import {
  assertNoUnresolvedBroadcastVariables,
  getUnsupportedBroadcastVariables,
  hasRecipientVariables,
  renderBroadcastMessageContent,
  renderMessageContent,
} from './render-message.js';

describe('renderMessageContent', () => {
  test('replaces {{liff_id}} with given liffId', () => {
    expect(renderMessageContent('hello https://liff.line.me/{{liff_id}}/x', '12345-AAA'))
      .toBe('hello https://liff.line.me/12345-AAA/x');
  });

  test('replaces all occurrences', () => {
    expect(renderMessageContent('a={{liff_id}} b={{liff_id}}', 'X'))
      .toBe('a=X b=X');
  });

  test('returns input unchanged when no placeholder', () => {
    expect(renderMessageContent('no placeholder', 'X')).toBe('no placeholder');
  });

  test('returns input unchanged when liffId is null', () => {
    expect(renderMessageContent('a {{liff_id}} b', null)).toBe('a {{liff_id}} b');
  });

  test('returns input unchanged when liffId is empty string', () => {
    expect(renderMessageContent('a {{liff_id}} b', '')).toBe('a {{liff_id}} b');
  });

  test('handles event path embedded in URL template', () => {
    const tpl = 'イベント詳細→ https://liff.line.me/{{liff_id}}/?page=event&id=evt-1';
    expect(renderMessageContent(tpl, 'LIFF-9999')).toBe(
      'イベント詳細→ https://liff.line.me/LIFF-9999/?page=event&id=evt-1',
    );
  });

  test('replaces recipient display name when supplied', () => {
    expect(renderMessageContent('{{name}}さん、こんにちは', { displayName: 'Michi' }))
      .toBe('Michiさん、こんにちは');
    expect(renderMessageContent('{{ name }}さん', { displayName: 'Michi' }))
      .toBe('Michiさん');
  });

  test('keeps {{name}} unresolved when display name is unavailable', () => {
    expect(renderMessageContent('{{name}}さん', { displayName: null })).toBe('{{name}}さん');
  });

  test('safely escapes quotes, backslashes, and newlines in Flex JSON names', () => {
    const template = JSON.stringify({
      type: 'bubble',
      body: { type: 'box', contents: [{ type: 'text', text: '{{name}}さん' }] },
    });
    const rendered = renderBroadcastMessageContent('flex', template, {
      displayName: 'A "quoted" \\ name\nnext',
    });

    expect(JSON.parse(rendered)).toMatchObject({
      body: { contents: [{ text: 'A "quoted" \\ name\nnextさん' }] },
    });
  });

  test('does not JSON-normalize ordinary text messages', () => {
    expect(renderBroadcastMessageContent('text', '  {{name}}  ', { displayName: 'Michi' }))
      .toBe('  Michi  ');
  });

  test('detects recipient and unsupported variables', () => {
    expect(hasRecipientVariables('{{name}} {{liff_id}}')).toBe(true);
    expect(getUnsupportedBroadcastVariables('{{name}} {{coupon}}')).toEqual(['coupon']);
  });

  test('fails closed when any variable remains unresolved', () => {
    expect(() => assertNoUnresolvedBroadcastVariables('hello {{name}}'))
      .toThrow('Unresolved broadcast variables: {{name}}');
    expect(() => assertNoUnresolvedBroadcastVariables('hello Michi')).not.toThrow();
  });
});

/*
 * 一斉配信の差し込みを、シナリオと同じところまで広げたぶんの確認。
 *
 * これまで一斉配信は `{{name}}` と `{{liff_id}}` しか置き換えられず、
 * それ以外を書くと**配信の時刻になって初めて**「Unsupported broadcast
 * variables」で落ちていた。予約配信は夜中や早朝に動くので、落ちたことに
 * 気づくのは翌朝、配信されなかったあとになる。
 */
describe('差し込みを広げた（友だち情報・共通情報・配信日）', () => {
  const at = new Date(Date.UTC(2026, 7, 20, 1)); // JST 8/20 10:00

  test('友だち情報欄を差し込む', () => {
    expect(renderMessageContent('{{field.pet_name}}ちゃん', { fields: { pet_name: 'ココ' } }))
      .toBe('ココちゃん');
  });

  test('未設定の友だち情報欄は空にする（差し込みを本文に残さない）', () => {
    const out = renderMessageContent('{{field.pet_name}}ちゃん', { fields: {} });
    expect(out).toBe('ちゃん');
    expect(out).not.toContain('{{');
  });

  test('共通情報を差し込む', () => {
    expect(renderMessageContent('営業時間は{{var.shop_hours}}です', { vars: { shop_hours: '10-19時' } }))
      .toBe('営業時間は10-19時です');
  });

  test('配信日とカウントダウンを差し込む', () => {
    expect(renderMessageContent('本日{{date:md}}', { deliveredAt: at })).toBe('本日8月20日');
    expect(renderMessageContent('あと{{days_until:2026-08-25}}日', { deliveredAt: at })).toBe('あと5日');
  });

  test('日付を先に処理する（友だち情報の値が差し込みとして解釈されない）', () => {
    // 利用者が入れた値が、たまたま差し込みの形をしていることはある。
    // それを置き換えてしまうと、入れた文字列が勝手に書き換わる。
    expect(renderMessageContent('{{field.memo}}', { fields: { memo: '{{date}}' }, deliveredAt: at }))
      .toBe('{{date}}');
  });

  test('Flex でも壊さずに差し込む', () => {
    const template = JSON.stringify({ type: 'text', text: '{{field.pet_name}}／{{var.shop_hours}}' });
    const out = renderBroadcastMessageContent('flex', template, {
      fields: { pet_name: 'コ"コ' },
      vars: { shop_hours: '10-19時' },
    });
    expect(JSON.parse(out)).toMatchObject({ text: 'コ"コ／10-19時' });
  });
});

describe('どれを1人ずつ送るか', () => {
  test('相手ごとに変わるものだけ 1人ずつ送る', () => {
    expect(hasRecipientVariables('{{name}}さん')).toBe(true);
    expect(hasRecipientVariables('{{field.pet_name}}ちゃん')).toBe(true);
  });

  test('全員同じ値になるものは まとめて送れる', () => {
    // ここを取り違えると、全員に同じ本文でよい配信まで1人ずつ push することになり、
    // 呼び出し回数だけが増える。
    expect(hasRecipientVariables('{{var.shop_hours}}')).toBe(false);
    expect(hasRecipientVariables('{{date}} {{days_until:2026-12-25}}')).toBe(false);
    expect(hasRecipientVariables('{{liff_id}}')).toBe(false);
  });
});

describe('置き換えられない差し込みは保存前に見つける', () => {
  test('一覧に無いものだけを挙げる', () => {
    expect(getUnsupportedBroadcastVariables(
      '{{name}}{{field.pet_name}}{{var.a}}{{date+3}}{{days_until:2026-12-25}}{{liff_id}}',
    )).toEqual([]);
    expect(getUnsupportedBroadcastVariables('{{pet_name}} {{metadata.x}}'))
      .toEqual(['pet_name', 'metadata.x']);
  });
});
