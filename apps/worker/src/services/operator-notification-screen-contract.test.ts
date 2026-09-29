/*
 * N-327 (#663): 画面の「きっかけ」一覧と Worker の登録簿がずれたら落ちる。
 *
 * この試験が無かったせいで、実際にこうなっていた(審査 2026-09-12 の実測):
 *
 *   登録簿  : ["booking_created","broadcast_completed","ec_order_received","form_submitted"]
 *   画面の4択: ["cv_fire","friend_add","incoming_webhook.custom","message_received"]
 *   交わり  : []
 *
 * **交わりが空。**画面から作れるルールは1つも発火できないのに、公開は 200 で
 * 通り `isActive: true` になっていた。つまり「公開したのに届かない」。
 * この票が直そうとしたものが、入口だけ別の言葉を話していたせいで残っていた。
 *
 * 原因は「両者を突き合わせるものが何も無かった」こと。画面が先にでき、
 * 登録簿が後からでき、誰も照らし合わせなかった。**ここがその照らし合わせ。**
 *
 * ここで止めたい崩れ方:
 *   1. 画面に、登録簿に無い値を足す(選べるのに発火しない)
 *   2. 登録簿に producer を足したのに、画面へ出し忘れる(作れない)
 *   3. 画面のラベルが空・値の重複
 *
 * 画面は別アプリ(apps/web)なので import できない。**ソースを読んで値を
 * 取り出す。**取り出せなくなったら(書き方が変わったら)それ自体を落とす。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listOperatorEventTypes } from './operator-notification-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREEN_OPTIONS_FILE = join(
  HERE, '..', '..', '..', '..',
  'apps', 'web', 'src', 'app', 'line-notifications', 'operator-event-options.ts',
);

/**
 * 画面に出さない登録簿のきっかけ。
 *
 * **空のままにしておくのが既定。**「まだ画面に出さない」種類を足すときは、
 * ここへ値と理由を書く。書かずに画面から外すと下の試験が落ちる。
 * 黙って消えるのを防ぐのがこの配列の役目で、**理由を書く場所があること
 * 自体が抑止**になる。
 */
const SCREEN_HIDDEN_EVENT_TYPES: ReadonlyArray<{ eventType: string; reason: string }> = [];

const screenSource = readFileSync(SCREEN_OPTIONS_FILE, 'utf8');

/** OPERATOR_EVENT_OPTIONS の配列リテラルから value と label を取り出す。 */
function screenOptions(): Array<{ value: string; label: string }> {
  const start = screenSource.indexOf('export const OPERATOR_EVENT_OPTIONS');
  expect(
    start, `画面の一覧(${SCREEN_OPTIONS_FILE})に OPERATOR_EVENT_OPTIONS が見つかりません`,
  ).toBeGreaterThanOrEqual(0);
  // 型注釈の `OperatorEventOption[]` にも `]` があるので、`= [` の開き括弧を
  // 見つけてからその先の `]` を探す。ここを間違えると本体が空になり、
  // 突き合わせが空振りしたまま緑になる。
  const open = screenSource.indexOf('= [', start);
  expect(open, 'OPERATOR_EVENT_OPTIONS の配列リテラルが見つかりません').toBeGreaterThan(start);
  const end = screenSource.indexOf(']', open);
  expect(end).toBeGreaterThan(open);
  const body = screenSource.slice(open, end);
  const found: Array<{ value: string; label: string }> = [];
  const pattern = /\{\s*value:\s*'([^']+)'\s*,\s*label:\s*'([^']*)'\s*\}/g;
  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    found.push({ value: match[1]!, label: match[2]! });
  }
  return found;
}

describe('N-327 #663 画面のきっかけと登録簿の突き合わせ', () => {
  it('画面の一覧を読み出せる（書き方が変わったら気づく）', () => {
    const options = screenOptions();
    // 取り出せない = 突き合わせが空振りする。空振りを緑で通さない。
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.value.length > 0)).toBe(true);
    expect(options.every((option) => option.label.length > 0)).toBe(true);
    // 値の重複は、片方のラベルが死ぬので落とす。
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
  });

  it('画面にあって登録簿に無いきっかけは1つも無い（選べるのに発火しない）', () => {
    const registry = new Set(listOperatorEventTypes().map((entry) => entry.eventType));
    const orphans = screenOptions().map((option) => option.value)
      .filter((value) => !registry.has(value));
    expect(
      orphans,
      `画面にあるが登録簿に無い: ${orphans.join(', ')}。`
      + 'このきっかけは公開しても自動発火しません。producer を繋ぐか、画面から外してください。',
    ).toEqual([]);
  });

  it('登録簿にあって画面に無いきっかけは、理由を書いたものだけ（出し忘れを防ぐ）', () => {
    const shown = new Set(screenOptions().map((option) => option.value));
    const hidden = new Set(SCREEN_HIDDEN_EVENT_TYPES.map((entry) => entry.eventType));
    const missing = listOperatorEventTypes().map((entry) => entry.eventType)
      .filter((eventType) => !shown.has(eventType) && !hidden.has(eventType));
    expect(
      missing,
      `登録簿にあるが画面に無い: ${missing.join(', ')}。`
      + '画面へ足すか、SCREEN_HIDDEN_EVENT_TYPES へ理由を書いてください。',
    ).toEqual([]);
    // 除外の理由は必ず書かせる。空文字で黙らせられないようにする。
    expect(SCREEN_HIDDEN_EVENT_TYPES.every((entry) => entry.reason.trim().length > 0)).toBe(true);
  });

  it('接続済みのきっかけは、必ず画面から選べる', () => {
    const shown = new Set(screenOptions().map((option) => option.value));
    const connectedButHidden = listOperatorEventTypes()
      .filter((entry) => entry.connected && !shown.has(entry.eventType))
      .map((entry) => entry.eventType);
    // 接続済み = producer が実際に出している。出せるのに作れないのは穴。
    expect(connectedButHidden).toEqual([]);
  });
});
