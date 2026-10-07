import { describe, expect, it } from 'vitest';
import { expandVariables } from './step-delivery.js';
import { renderBroadcastMessageContent } from './render-message.js';
import { buildMessage } from './line-message.js';

/*
 * 2026-10-07 点検：名前や友だち情報に " \ 改行 $& が入っていても、
 * カード（Flex・カルーセル）が壊れず、文のメッセージは見たままの値になる。
 * 壊れると buildMessage が文字のメッセージへ逃げ、中身の JSON がそのままお客さまに届く。
 */
const tricky = '山田 "やまちゃん" \\ 太郎\n$& $1';
const friend = { id: 'f1', display_name: tricky, user_id: 'U1' };

const flex = JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '{{name}}さん {{field.pet}}' }] } });
const carousel = JSON.stringify([{ title: '{{name}}', text: 'こんにちは', actions: [{ type: 'message', label: 'はい', text: '{{name}}' }] }]);

describe('差し込みの値で JSON が壊れない', () => {
  it('シナリオ・自動応答（expandVariables）：Flex は JSON のまま、値は元どおり', () => {
    const out = expandVariables(flex, friend, undefined, 'flex', { fields: { pet: 'ポチ"' } });
    const parsed = JSON.parse(out);
    expect(parsed.body.contents[0].text).toBe(`${tricky}さん ポチ"`);
    expect(buildMessage('flex', out).type).toBe('flex');
  });

  it('シナリオ（expandVariables）：カルーセルは JSON のまま', () => {
    const out = expandVariables(carousel, friend, undefined, 'carousel');
    expect(JSON.parse(out)[0].title).toBe(tricky);
    expect(buildMessage('carousel', out).type).toBe('template');
  });

  it('文のメッセージは値をそのまま入れる（$& を置き換えの記号として読まない）', () => {
    expect(expandVariables('{{name}}さん', friend, undefined, 'text')).toBe(`${tricky}さん`);
  });

  it('一斉配信（renderBroadcastMessageContent）：カルーセルも壊れない・名前の $& もそのまま', () => {
    const out = renderBroadcastMessageContent('carousel', carousel, { displayName: tricky });
    expect(JSON.parse(out)[0].actions[0].text).toBe(tricky);
    expect(renderBroadcastMessageContent('text', '{{name}}さん', { displayName: tricky })).toBe(`${tricky}さん`);
  });
});
