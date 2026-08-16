import { describe, expect, it } from 'vitest';

import {
  columnsOf,
  judge,
  markersOf,
  schemaFromSqliteMaster,
  splitTopLevel,
  type Schema,
} from './migrate-state';

function schema(
  tables: Record<string, string[]>,
  indexes: string[] = [],
): Schema {
  return {
    tables: new Map(Object.entries(tables).map(([t, c]) => [t, new Set(c)])),
    indexes: new Set(indexes),
  };
}

describe('CREATE 文の分解', () => {
  it('型の中のカンマで切らない', () => {
    // DECIMAL(10, 2) の途中で切ると、列が1つ増えたように見える。
    expect(splitTopLevel('id TEXT, price DECIMAL(10, 2), name TEXT')).toHaveLength(3);
  });

  it('CHECK の中のカンマでも切らない', () => {
    const parts = splitTopLevel("id TEXT, status TEXT CHECK (status IN ('a','b')), x INTEGER");
    expect(parts).toHaveLength(3);
  });

  it('表そのものの制約は列として数えない', () => {
    const cols = columnsOf(
      `CREATE TABLE t (id TEXT, other_id TEXT, PRIMARY KEY (id), FOREIGN KEY (other_id) REFERENCES o(id))`,
    );
    expect([...cols].sort()).toEqual(['id', 'other_id']);
  });

  it('ALTER で後から足された列も読める', () => {
    // SQLite は ADD COLUMN した列を、CREATE 文の括弧の「内側」の末尾に書き足す。
    // ここを読み落とすと、当たっている物を「未適用」と誤判定する。
    const cols = columnsOf(`CREATE TABLE friends (id TEXT, name TEXT, line_account_id TEXT)`);
    expect(cols.has('line_account_id')).toBe(true);
  });

  it('引用符つきの列名も読める', () => {
    expect(columnsOf('CREATE TABLE t ("id" TEXT, [name] TEXT, `x` INTEGER)')).toEqual(
      new Set(['id', 'name', 'x']),
    );
  });
});

describe('sqlite_master からの読み取り', () => {
  it('表と索引を分けて取る', () => {
    const live = schemaFromSqliteMaster([
      { type: 'table', name: 'friends', sql: 'CREATE TABLE friends (id TEXT, name TEXT)' },
      { type: 'index', name: 'idx_friends_name', sql: 'CREATE INDEX idx_friends_name ON friends(name)' },
      { type: 'trigger', name: 'trg', sql: null },
    ]);
    expect(live.tables.get('friends')).toEqual(new Set(['id', 'name']));
    expect(live.indexes.has('idx_friends_name')).toBe(true);
    expect(live.tables.has('trg')).toBe(false);
  });

  it('sql が null でも落ちない', () => {
    const live = schemaFromSqliteMaster([{ type: 'table', name: 't', sql: null }]);
    expect(live.tables.get('t')).toEqual(new Set());
  });
});

describe('目印の取り出し', () => {
  const final = schema({ folders: ['id', 'name'], tags: ['id', 'folder_id'] }, ['idx_tags_folder']);

  it('作る表・足す列・作る索引を拾う', () => {
    const markers = markersOf(
      `CREATE TABLE IF NOT EXISTS folders (id TEXT, name TEXT);
       ALTER TABLE tags ADD COLUMN folder_id TEXT;
       CREATE INDEX idx_tags_folder ON tags(folder_id);`,
      final,
    );
    expect(markers).toHaveLength(3);
  });

  it('最終形に残らない一時表は目印にしない', () => {
    // 027 や 029 の「新しい表を作って旧を捨て、名前を付け替える」型。
    // *_new を目印にすると、正常に終わったマイグレーションを未適用と誤判定する。
    const markers = markersOf(
      `CREATE TABLE tags_new (id TEXT, folder_id TEXT);
       DROP TABLE tags;
       ALTER TABLE tags_new RENAME TO tags;`,
      final,
    );
    expect(markers).toEqual([]);
  });

  it('同じ物を二度数えない', () => {
    const markers = markersOf(
      `CREATE TABLE IF NOT EXISTS folders (id TEXT);
       CREATE TABLE IF NOT EXISTS folders (id TEXT);`,
      final,
    );
    expect(markers).toHaveLength(1);
  });
});

describe('当たっているかの判定', () => {
  const final = schema({ folders: ['id'], tags: ['id', 'folder_id'] }, ['idx_tags_folder']);
  const markers = markersOf(
    `CREATE TABLE folders (id TEXT);
     ALTER TABLE tags ADD COLUMN folder_id TEXT;
     CREATE INDEX idx_tags_folder ON tags(folder_id);`,
    final,
  );

  it('全部あれば適用済み', () => {
    expect(judge(markers, final).state).toBe('applied');
  });

  it('1つも無ければ未適用', () => {
    expect(judge(markers, schema({ tags: ['id'] })).state).toBe('missing');
  });

  it('一部だけなら部分適用として、欠けている物を返す', () => {
    // ここは自動で流してはいけない。途中で落ちた跡の可能性がある。
    const result = judge(markers, schema({ folders: ['id'], tags: ['id'] }));
    expect(result.state).toBe('partial');
    if (result.state === 'partial') {
      expect(result.missing.map((m) => m.name).sort()).toEqual(['idx_tags_folder', 'tags']);
    }
  });

  it('目印が無いものは判定不能', () => {
    // データだけを入れるマイグレーション。現物からは当否が分からない。
    expect(judge([], final).state).toBe('unknown');
  });
});

describe('bootstrap.sql の読み取り', () => {
  it('閉じ括弧の書式に関係なく列を取れる', () => {
    // 行末の書式に頼った正規表現で 127 表のうち 24 表を取りこぼし、
    // スキーマを変えるマイグレーション30件が「データのみ」に化けたことがある。
    // 最終形に無い＝目印にしない、という作りなので、ここの取りこぼしは
    // そのまま誤判定になる。
    const oneLine = 'CREATE TABLE a (id TEXT, name TEXT);';
    const multiLine = 'CREATE TABLE b (\n  id TEXT,\n  name TEXT\n);';
    const noNewlineBeforeParen = 'CREATE TABLE c (\n  id TEXT, name TEXT );';
    for (const sql of [oneLine, multiLine, noNewlineBeforeParen]) {
      expect(columnsOf(sql)).toEqual(new Set(['id', 'name']));
    }
  });

  it('後ろに別の文が続いても、その表の括弧だけを読む', () => {
    const text = 'CREATE TABLE a (id TEXT);\nCREATE TABLE b (x TEXT, y TEXT);';
    expect(columnsOf(text)).toEqual(new Set(['id']));
  });
});

describe('実物で確かめた8件（2026-08-16 の nen-line-stg）', () => {
  // wrangler で直接 pragma_table_info / sqlite_master に問い合わせた結果。
  // 判定の作りを変えたときに、この8件がずれないことを確かめる。
  const live = schemaFromSqliteMaster([
    { type: 'table', name: 'friends', sql: 'CREATE TABLE friends (id TEXT, line_account_id TEXT)' },
    { type: 'table', name: 'broadcasts', sql: 'CREATE TABLE broadcasts (id TEXT, batch_offset INTEGER)' },
    { type: 'table', name: 'messages_log', sql: 'CREATE TABLE messages_log (id TEXT, source TEXT)' },
    {
      type: 'table',
      name: 'nen_knowledge_articles',
      sql: 'CREATE TABLE nen_knowledge_articles (id TEXT, reviewed_at TEXT)',
    },
    { type: 'table', name: 'staff_members', sql: 'CREATE TABLE staff_members (id TEXT, access_level TEXT)' },
  ]);

  it.each([
    ['friends', 'line_account_id', true],
    ['broadcasts', 'batch_offset', true],
    ['messages_log', 'source', true],
    ['nen_knowledge_articles', 'reviewed_at', true],
    ['staff_members', 'access_level', true],
    ['broadcasts', 'delivery_type', false],
  ])('%s.%s は %s', (table, column, expected) => {
    expect(live.tables.get(table)?.has(column) ?? false).toBe(expected);
  });

  it.each([
    ['staff_availability_rules', false],
    ['mileage_rules', false],
  ])('表 %s は %s', (table, expected) => {
    expect(live.tables.has(table)).toBe(expected);
  });
});
