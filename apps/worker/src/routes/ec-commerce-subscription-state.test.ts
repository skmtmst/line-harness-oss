/*
 * 状態の写像が JS と SQL で一致すること(#731)。
 *
 * 契約の状態は、いま2か所で判定している。
 *   - JS: `subscriptionState()`   … 1件を整形するとき
 *   - SQL: `subscriptionStateSql()` … 数えるとき・絞り込むとき・並べるとき
 *
 * **表(`SUBSCRIPTION_STATE_RULES`)は1か所だけ**にしてあるが、表を共有しても
 * **順序までは揃わない**。「解約」と「休止」の両方を含む文字列がどちらに倒れるかは、
 * 組み立て方ではなく評価の順で決まる。だからここで**同じ入力を両方へ食わせて
 * 突き合わせる**。
 *
 * 基準は「**いまの JS 関数と同じ結果になること**」。EC 側が実際に何を返すかは
 * 手元では分からないので、実データに合わせるのではなく、**振る舞いを変えない**
 * ことを固定する(#731 の裁定)。
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  SUBSCRIPTION_STATE_FALLBACK,
  SUBSCRIPTION_STATE_RULES,
  subscriptionState,
  subscriptionStateSql,
} from './ec-commerce.js';

let sqlite: Database.Database;

beforeEach(() => { sqlite = new Database(':memory:'); });

/**
 * SQL 側の判定を1件ぶん評価する。本番と同じ `subscriptionStateSql` を使う。
 *
 * 式は語の数だけ展開されるので、`?` を渡すとその数だけ値が要る。名前つきの
 * 引数を使って、1つの値を全部の場所へ配る。
 */
function stateBySql(value: string): string {
  const row = sqlite
    .prepare(`SELECT ${subscriptionStateSql(':status')} AS state`)
    .get({ status: value }) as { state: string };
  return row.state;
}

/** 表に出てくる語を全部集める。語が増えたらこの試験の入力も自動で増える。 */
const NEEDLES = SUBSCRIPTION_STATE_RULES.flatMap((rule) => rule.needles);

/** 語の全組み合わせ(2^n)。順序の取り違えは、複数語が混ざったときに出る。 */
function combinations(words: string[]): string[] {
  const out: string[] = [];
  for (let mask = 0; mask < 2 ** words.length; mask += 1) {
    const picked = words.filter((_, index) => (mask >> index) & 1);
    out.push(picked.join('-'));
  }
  return out;
}

describe('#731 状態の写像は JS と SQL で一致する', () => {
  test('表の語を全部、そしてその組み合わせを全部当てても一致する', () => {
    const inputs = combinations(NEEDLES);
    expect(inputs).toHaveLength(2 ** NEEDLES.length);
    const mismatches: Array<{ input: string; js: string; sql: string }> = [];
    for (const input of inputs) {
      const js = subscriptionState(input);
      const sql = stateBySql(input);
      if (js !== sql) mismatches.push({ input, js, sql });
    }
    console.log('AUDIT-STATE 当てた入力の数 =', inputs.length, ' 語 =', JSON.stringify(NEEDLES));
    console.log('AUDIT-STATE 食い違い =', mismatches.length);
    expect(mismatches).toEqual([]);
  });

  test('語の前後に文字があっても、大文字でも一致する', () => {
    const decorated = NEEDLES.flatMap((needle) => [
      needle, needle.toUpperCase(), `前${needle}後`, ` ${needle} `,
      `status:${needle}`, `${needle}${needle}`,
    ]);
    const mismatches = decorated.filter((input) => subscriptionState(input) !== stateBySql(input));
    console.log('AUDIT-STATE 装飾つき入力 =', decorated.length, ' 食い違い =', mismatches.length);
    expect(mismatches).toEqual([]);
  });

  test('どの語にも当たらない入力は、両方とも既定の状態になる', () => {
    for (const input of ['', 'active', 'unknown', '継続中', '???', '0']) {
      expect(subscriptionState(input)).toBe(stateBySql(input));
      expect(stateBySql(input)).toBe(SUBSCRIPTION_STATE_FALLBACK);
    }
    console.log('AUDIT-STATE 既定 =', SUBSCRIPTION_STATE_FALLBACK);
  });

  test('表に並んだ順が、両方で同じ意味を持つ(先に書いたものが勝つ)', () => {
    // 表の1番目と2番目の語を混ぜたら、両方とも1番目に倒れること。
    const [first, second] = SUBSCRIPTION_STATE_RULES;
    const mixed = `${second.needles[0]}-${first.needles[0]}`;
    console.log('AUDIT-STATE 混在入力 =', mixed, ' js =', subscriptionState(mixed), ' sql =', stateBySql(mixed));
    expect(subscriptionState(mixed)).toBe(first.state);
    expect(stateBySql(mixed)).toBe(first.state);
  });
});
