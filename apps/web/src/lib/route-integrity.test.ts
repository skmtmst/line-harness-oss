import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 行き止まりが無いことを機械的に確かめる。
 *
 * 画面を足すたびに人が目で追うのは無理なので、
 *   1. 実在する画面の一覧を作る
 *   2. 各画面から出ている href / router.push の行き先を集める
 *   3. 行き先が実在するかを突き合わせる
 * を毎回走らせる。
 *
 * この管理画面は静的書き出し（output: 'export'）なので、動的セグメント
 * （[id]）は使えない。詳細画面は /friends/detail?id= のようにクエリで
 * 表す。この検査もその前提で書いている。
 */

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

/** app 配下の page.tsx を集めて、ルートの文字列にする。 */
function listRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry !== 'page.tsx') continue;
      const rel = relative(APP_DIR, dirname(full)).split('/').filter(Boolean);
      // (group) 形式のフォルダはURLに出ない。
      const segments = rel.filter((s) => !s.startsWith('(') || !s.endsWith(')'));
      routes.push('/' + segments.join('/'));
    }
  };
  walk(APP_DIR);
  return [...new Set(routes.map((r) => (r === '/' ? '/' : r.replace(/\/$/, ''))))].sort();
}

function listSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.tsx') && !entry.endsWith('.ts')) continue;
      if (entry.includes('.test.')) continue;
      files.push(full);
    }
  };
  walk(join(APP_DIR, '..'));
  return files;
}

/** href="/..." と router.push('/...') から行き先を集める。 */
function collectInternalLinks(): Array<{ file: string; target: string }> {
  const out: Array<{ file: string; target: string }> = [];
  const patterns = [
    /href=["'](\/[^"'`]*)["']/g,
    /href=\{`(\/[^`$]*)/g,
    /router\.(?:push|replace)\(["'](\/[^"'`]*)["']\)/g,
    /router\.(?:push|replace)\(`(\/[^`$]*)/g,
  ];
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        out.push({ file, target: match[1] });
      }
    }
  }
  return out;
}

/** クエリとハッシュを落として、ルートの部分だけにする。 */
function toRoutePath(target: string): string {
  let path = target.split('?')[0].split('#')[0];
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

/**
 * 画面ではないパス。Worker のAPIや外部のリダイレクト先など、
 * app 配下に page.tsx が無くて当たり前のもの。
 */
const NON_PAGE_PREFIXES = [
  '/api/',
  '/auth/',
  '/admin/',
  '/t/',
  '/r/',
  '/pool/',
  '/webhook',
  '/setup',
  '/liff',
];

const ROUTES = listRoutes();
const ROUTE_SET = new Set(ROUTES);

describe('画面の一覧', () => {
  it('動的セグメントの画面が無い（静的書き出しでは書き出せない）', () => {
    // [id] のような画面はビルド時に全IDが分からないと書き出せない。
    // 詳細画面はクエリ（?id=）で表す。
    const dynamic = ROUTES.filter((r) => r.includes('[') || r.includes(']'));
    expect(
      dynamic,
      `動的セグメントの画面があります: ${dynamic.join(', ')}\n` +
        '静的書き出しでは書き出せません。/friends/detail?id= の形にしてください。',
    ).toEqual([]);
  });

  it('主要な画面がそろっている', () => {
    // V2の骨格。ここが欠けると、サイドバーから行けない場所ができる。
    const required = [
      '/',
      '/login',
      '/chats',
      '/friends',
      '/friends/detail',
      '/tags',
      '/tags/fields/new',
      '/scenarios',
      '/broadcasts',
      '/templates',
      '/reminders',
      '/auto-replies',
      '/rich-menus',
      '/webinars',
      '/conversions',
      '/inflow-links',
      '/form-submissions',
      '/scoring',
      '/automations',
      '/webhooks',
      '/booking/bookings',
      '/booking/menus',
      '/events',
      '/accounts',
      '/staff',
      '/emergency',
    ];
    const missing = required.filter((r) => !ROUTE_SET.has(r));
    expect(missing, `画面が足りません: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('行き止まり', () => {
  it('画面から出ているリンクの行き先がすべて実在する', () => {
    const broken: string[] = [];
    for (const { file, target } of collectInternalLinks()) {
      if (NON_PAGE_PREFIXES.some((p) => target.startsWith(p))) continue;
      const path = toRoutePath(target);
      if (ROUTE_SET.has(path)) continue;
      broken.push(`${relative(APP_DIR, file)} → ${target}`);
    }
    expect(
      [...new Set(broken)].sort(),
      '行き先が実在しないリンクがあります:\n' + [...new Set(broken)].sort().join('\n'),
    ).toEqual([]);
  });
});

describe('旧ルートのリダイレクト', () => {
  const legacy = [
    ['/duplicates', '/friends'],
    ['/users', '/friends'],
    ['/support', '/chats'],
    ['/notifications', '/webhooks'],
    ['/updates', '/emergency'],
    ['/pools', '/accounts'],
    ['/affiliates', '/conversions'],
    ['/booking/staff', '/booking/menus'],
  ] as const;

  const redirects = readFileSync(join(PUBLIC_DIR, '_redirects'), 'utf8');

  it.each(legacy)('%s が %s へ 308 で飛ぶ', (from, toPrefix) => {
    // ブックマークやリッチメニューから旧URLを踏んでいる可能性があるので、
    // 統合しても消さずに残す。
    const line = redirects
      .split('\n')
      .find((l) => !l.trimStart().startsWith('#') && l.trim().startsWith(`${from} `));
    expect(line, `${from} のリダイレクトが _redirects にありません`).toBeTruthy();
    expect(line).toContain(toPrefix);
    expect(line).toContain('308');
  });

  it('リダイレクト先の画面が実在する', () => {
    for (const line of redirects.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [, destination] = trimmed.split(/\s+/);
      expect(ROUTE_SET.has(toRoutePath(destination)), `${destination} の画面がありません`).toBe(
        true,
      );
    }
  });

  it('作成画面は残っている（親だけをリダイレクトしている）', () => {
    // /pools は /accounts?tab=pools へ飛ばすが、/pools/new は残す。
    // 下の階層まで巻き込むと、作成画面へ行けなくなる。
    for (const child of ['/pools/new', '/affiliates/new']) {
      if (!ROUTE_SET.has(child)) continue;
      const parent = child.replace(/\/new$/, '');
      const line = redirects
        .split('\n')
        .find((l) => !l.trimStart().startsWith('#') && l.trim().startsWith(`${parent} `));
      // 親のリダイレクトはワイルドカードにしない。
      expect(line ?? '').not.toContain('*');
    }
  });
});
