import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEntryRoute, getEntryRouteSources } from '../src/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() { statement.run(...params); return { success: true, meta: {} }; },
            async first<T>() { return (statement.get(...params) as T) ?? null; },
            async all<T>() { return { results: statement.all(...params) as T[], success: true, meta: {} }; },
          };
        },
        async all<T>() { return { results: statement.all() as T[], success: true, meta: {} }; },
      };
    },
    async batch(statements: D1PreparedStatement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

/** クリックを1件記録する。utm_source と参照元URLは省略できる。 */
function click(
  sqlite: Database.Database,
  opts: { id: string; routeId: string; refCode: string; utmSource?: string; sourceUrl?: string },
): void {
  sqlite
    .prepare(
      `INSERT INTO ref_tracking (id, ref_code, entry_route_id, source_url, utm_source, created_at)
       VALUES (?, ?, ?, ?, ?, '2026-08-01T00:00:00.000+09:00')`,
    )
    .run(opts.id, opts.refCode, opts.routeId, opts.sourceUrl ?? null, opts.utmSource ?? null);
}

describe('getEntryRouteSources', () => {
  let db: D1Database;
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  it('utm_source を優先し、無ければ参照元のホスト名にする', async () => {
    const route = await createEntryRoute(db, { refCode: 'ig01', name: 'Instagram' });
    click(sqlite, { id: 'c1', routeId: route.id, refCode: 'ig01', utmSource: 'instagram_story' });
    click(sqlite, { id: 'c2', routeId: route.id, refCode: 'ig01', utmSource: 'instagram_story' });
    click(sqlite, {
      id: 'c3', routeId: route.id, refCode: 'ig01',
      sourceUrl: 'https://www.instagram.com/p/abc?x=1',
    });

    expect(await getEntryRouteSources(db, route.id)).toEqual([
      { label: 'instagram_story', count: 2 },
      { label: 'www.instagram.com', count: 1 },
    ]);
  });

  it('どちらも無いクリックは「直接アクセス」。QRや紙のURLがこれになる', async () => {
    const route = await createEntryRoute(db, { refCode: 'pop1', name: '店頭POP' });
    click(sqlite, { id: 'c1', routeId: route.id, refCode: 'pop1' });

    expect(await getEntryRouteSources(db, route.id)).toEqual([
      { label: '直接アクセス', count: 1 },
    ]);
  });

  it('同じホストは、URLのパラメータが違っても1つにまとめる', async () => {
    const route = await createEntryRoute(db, { refCode: 'yt01', name: 'YouTube' });
    click(sqlite, { id: 'c1', routeId: route.id, refCode: 'yt01', sourceUrl: 'https://youtube.com/watch?v=1' });
    click(sqlite, { id: 'c2', routeId: route.id, refCode: 'yt01', sourceUrl: 'https://youtube.com/watch?v=2' });

    expect(await getEntryRouteSources(db, route.id)).toEqual([
      { label: 'youtube.com', count: 2 },
    ]);
  });

  it('上位を超えた分は「その他」にまとめる。黙って捨てると合計が合わない', async () => {
    const route = await createEntryRoute(db, { refCode: 'many', name: 'いろいろ' });
    // 6種類。上位5件＋その他 になる。
    const sources = ['s1', 's2', 's3', 's4', 's5', 's6'];
    sources.forEach((src, i) => {
      // s1 が最多になるよう、後ろほど少なくする。
      for (let n = 0; n < sources.length - i; n++) {
        click(sqlite, { id: `c-${src}-${n}`, routeId: route.id, refCode: 'many', utmSource: src });
      }
    });

    const rows = await getEntryRouteSources(db, route.id);
    expect(rows.map((r) => r.label)).toEqual(['s1', 's2', 's3', 's4', 's5', 'その他']);
    // 6+5+4+3+2+1 = 21。合計が保たれる。
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(21);
    expect(rows.at(-1)).toEqual({ label: 'その他', count: 1 });
  });

  it('別のリンクのクリックは混ざらない', async () => {
    const a = await createEntryRoute(db, { refCode: 'a', name: 'A' });
    const b = await createEntryRoute(db, { refCode: 'b', name: 'B' });
    click(sqlite, { id: 'c1', routeId: a.id, refCode: 'a', utmSource: 'x' });
    click(sqlite, { id: 'c2', routeId: b.id, refCode: 'b', utmSource: 'y' });

    expect(await getEntryRouteSources(db, a.id)).toEqual([{ label: 'x', count: 1 }]);
  });
});
