import { describe, expect, it } from 'vitest';

import { databaseNameOf, extractBookmark, extractJson } from './migrate';

describe('wrangler の出力の読み取り', () => {
  it('前後にログが混ざっていても配列を取り出せる', () => {
    // wrangler は JSON の前に「⛅️ wrangler x.y.z」などを出す。
    const raw = '⛅️ wrangler 4.77.0\n[{"results":[{"n":1}]}]\n';
    expect(extractJson(raw)).toEqual([{ results: [{ n: 1 }] }]);
  });

  it('配列が無ければ、その出力を添えて落ちる', () => {
    // 黙って空を返すと「0件だった」と読めてしまう。
    expect(() => extractJson('not json at all')).toThrow(/読めませんでした/);
  });
});

describe('Time Travel のブックマークの取り出し', () => {
  const bookmark = '000003a0-00000000-000050c9-3d90f6c994158f0584fc55807a182bf5';

  it.each([
    ['素直な JSON', `{"bookmark":"${bookmark}"}`],
    ['result で包まれた JSON', `{"result":{"bookmark":"${bookmark}"}}`],
    ['ログ混じり', `⛅️ wrangler 4.77.0\n{"bookmark":"${bookmark}"}\n`],
    ['JSON でない出力', `Bookmark: ${bookmark}`],
  ])('%s から取れる', (_label, raw) => {
    expect(extractBookmark(raw)).toBe(bookmark);
  });

  it('取れないときは空を返す', () => {
    // 呼び出し側はここで止まる。戻る先が無いまま当てるほうが危ない。
    expect(extractBookmark('{"other":1}')).toBe('');
  });
});

describe('wrangler 設定からのデータベース名', () => {
  it('d1_databases の database_name を読む', () => {
    const config = `
name = "nen-line-stg"
account_id = "55f4"

[[d1_databases]]
binding = "DB"
database_name = "nen-line-stg"
database_id = "00bd7aca"
`;
    expect(databaseNameOf(config)).toBe('nen-line-stg');
  });

  it('worker 名につられない', () => {
    // 先頭の name = は Worker の名前。ここを拾うと別のDBを見にいく。
    const config = `
name = "nen-line"

[[d1_databases]]
database_name = "nen-line-prod-db"
`;
    expect(databaseNameOf(config)).toBe('nen-line-prod-db');
  });

  it('見つからなければ落ちる', () => {
    // 推測して別のデータベースを触るより、止まるほうがよい。
    expect(() => databaseNameOf('name = "x"')).toThrow(/読めませんでした/);
  });
});
