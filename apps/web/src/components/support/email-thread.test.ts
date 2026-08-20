import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * メールのスレッドが叩く経路と、worker が受ける経路をそろえる。
 *
 * **これが揃っていなかった。** 画面は POST /status を投げ、worker は PATCH でしか
 * 受けていなかったので、メールの「対応」を変えても何も起きなかった。
 * しかも戻り値を見ていなかったので、失敗も画面に出なかった。
 *
 * 経路と動詞を突き合わせて、同じずれ方を二度としないようにする。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = readFileSync(join(HERE, 'email-thread.tsx'), 'utf8');
const CHATS_PAGE = readFileSync(join(HERE, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8');
const WORKER = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'routes', 'support-inbox.ts'),
  'utf8',
);

/** 画面が叩く `/api/support/email/threads/…/<末尾>` と、その動詞。 */
const CALLS: Array<{ tail: string; method: string }> = [
  { tail: 'status', method: 'PATCH' },
  { tail: 'assignee', method: 'PATCH' },
  { tail: 'notes', method: 'PATCH' },
  { tail: 'reply', method: 'POST' },
];

describe('メールのスレッドの経路', () => {
  it.each(CALLS)('画面は $tail を $method で叩く', ({ tail, method }) => {
    const call = new RegExp(
      `threads/\\$\\{encodeURIComponent\\(threadId\\)\\}/${tail}\`[\\s\\S]{0,200}?method: '([A-Z]+)'`,
    );
    // 内部メモはトーク内ではなく右側の顧客情報へ移したため、
    // notes だけは受信箱本体にある。他の経路はメール本文の部品にある。
    const found = (tail === 'notes' ? CHATS_PAGE : CLIENT).match(call);
    expect(found?.[1], `${tail} の呼び出しが見つからない`).toBe(method);
  });

  it.each(CALLS)('worker は $tail を $method で受ける', ({ tail, method }) => {
    const verb = method.toLowerCase();
    // 登録は1行のことも、引数で改行していることもある。どちらも拾う。
    const route = new RegExp(
      `supportInbox\\.${verb}\\(\\s*'/api/support/email/threads/:id/${tail}'`,
    );
    expect(route.test(WORKER), `worker に ${method} /${tail} が無い`).toBe(true);
  });
});

describe('メールの担当', () => {
  it('対応を変えても、既に付いている担当を上書きしない', () => {
    // 上書きすると、対応を変えるたびに担当が勝手に別の人へ移る。
    expect(WORKER).toContain('assigned_staff_id = COALESCE(assigned_staff_id, ?)');
  });
});

describe('LINE のトークとそろえたもの', () => {
  it.each(['対応', '担当', 'テンプレートを選択', '送信の設定'])(
    '%s がメール側にもある',
    (label) => {
      expect(CLIENT).toContain(label);
    },
  );

  it('内部メモは右側の顧客情報で保存できる', () => {
    expect(CHATS_PAGE).toContain('内部メモを保存');
  });

  it('送信キーの設定は LINE と同じ置き場を読み書きする', () => {
    // 別々にすると、片方で変えても、もう片方に効かない。
    expect(CLIENT).toContain("localStorage.getItem('chat.sendMode')");
    expect(CLIENT).toContain("localStorage.setItem('chat.sendMode'");
  });
});
