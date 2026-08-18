import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * サイドバーが Pen.dev の V2 設計と一致していることを確かめる。
 *
 * 設計（`V2 1-1 ダッシュボード` のサイドバー）が出どころで、
 * 区分・並び・呼び名を勝手に変えないための歯止め。
 *
 * 画面を足すときに「ついでにサイドバーへ」とやると、設計から静かにずれる。
 * ずれてよいと決めたときは、この一覧のほうを直す。そのとき
 * 「設計を更新したのか、実装が勝手にずれたのか」が差分に残る。
 */

const SIDEBAR = join(dirname(fileURLToPath(import.meta.url)), 'sidebar.tsx');

/** Pen.dev の V2 設計から書き写した区分と項目。並びも設計どおり。 */
const DESIGN: Array<{ section: string | null; items: string[] }> = [
  // 上の4つは見出しを付けない。設計でも「対応」「友だち属性」の見出しは無く、
  // 毎日開くものが見出し無しでひとかたまりになっている。
  { section: null, items: ['ダッシュボード', '受信箱', '友だち', '友だち属性'] },
  {
    section: '配信',
    items: [
      'シナリオ配信',
      '一斉配信',
      'リマインダ',
      '自動応答',
      '友だち追加時の配信',
      'ウェビナー',
    ],
  },
  // テンプレート・リッチメニュー・回答フォームは「作って置いておくもの」。
  // 配信や分析ではなく、ここにまとまる。
  { section: 'コンテンツ', items: ['テンプレート', 'リッチメニュー', '回答フォーム', 'コンテンツ'] },
  {
    section: '成果と分析',
    items: ['成果とアフィリエイト', 'マイル', '流入と計測', '分析'],
  },
  { section: '自動化', items: ['オートメーション', '外部連携'] },
  { section: '予約', items: ['予約管理', '予約設定', 'イベント予約'] },
  { section: '専用機能', items: ['NEN配信', '写真審査', 'EC連携'] },
  { section: '設定', items: ['アカウント', 'ログインユーザー', '機能設定', '運用状態'] },
];

/** sidebar.tsx の menuSections から、区分と項目を順序どおりに読む。 */
function readSidebar(): Array<{ section: string | null; items: string[] }> {
  const source = readFileSync(SIDEBAR, 'utf8');
  const start = source.indexOf('const menuSections: MenuSection[] = [');
  const end = source.indexOf('function AccountAvatar');
  const body = source.slice(start, end);

  const sections: Array<{ section: string | null; items: string[] }> = [];
  // `label: '配信',` / `label: null,` が区分の頭。`{ href: ..., label: '...' }` が項目。
  for (const line of body.split('\n')) {
    const sectionMatch = /^\s{4}label:\s*(null|'([^']+)')/.exec(line);
    if (sectionMatch) {
      sections.push({ section: sectionMatch[2] ?? null, items: [] });
      continue;
    }
    const itemMatch = /\{\s*href:\s*'[^']*',\s*label:\s*'([^']+)'/.exec(line);
    if (itemMatch && sections.length > 0) {
      sections[sections.length - 1].items.push(itemMatch[1]);
    }
  }
  return sections;
}

/** 仕様 §2 の「項目 → ルート」。写真審査だけ仕様書の誤りを直してある。 */
const ROUTES: Record<string, string> = {
  ダッシュボード: '/',
  受信箱: '/chats',
  友だち: '/friends',
  友だち属性: '/tags',
  シナリオ配信: '/scenarios',
  一斉配信: '/broadcasts',
  テンプレート: '/templates',
  リマインダ: '/reminders',
  自動応答: '/auto-replies',
  友だち追加時の配信: '/friend-add-settings',
  リッチメニュー: '/rich-menus',
  ウェビナー: '/webinars',
  コンテンツ: '/contents',
  成果とアフィリエイト: '/conversions',
  回答フォーム: '/form-submissions',
  マイル: '/scoring',
  流入と計測: '/inflow-links',
  分析: '/analytics',
  オートメーション: '/automations',
  外部連携: '/webhooks',
  予約管理: '/booking/bookings',
  予約設定: '/booking/menus',
  イベント予約: '/events',
  NEN配信: '/nen-campaigns',
  // 仕様書 §2 は /health と書いているが、/health は「BAN検知ダッシュボード」。
  // 写真審査の画面は /nen-members。§3-1 が BAN検知を「運用状態」へ
  // 統合すると書いているので、そちらに合わせている。
  写真審査: '/nen-members',
  EC連携: '/ec-commerce',
  アカウント: '/accounts',
  ログインユーザー: '/staff',
  機能設定: '/settings',
  運用状態: '/emergency',
};

describe('サイドバーが V2 設計と一致する', () => {
  const actual = readSidebar();

  it('区分の数と並びが設計どおり', () => {
    expect(actual.map((s) => s.section)).toEqual(DESIGN.map((s) => s.section));
  });

  it.each(DESIGN.map((s, i) => [s.section ?? '(見出しなし)', i] as const))(
    '区分「%s」の項目と並びが設計どおり',
    (_label, index) => {
      expect(actual[index]?.items).toEqual(DESIGN[index].items);
    },
  );

  it('項目の総数が設計どおり（30）', () => {
    // 設計に無いものを足すと、ここで気づける。
    const total = actual.reduce((sum, s) => sum + s.items.length, 0);
    expect(total).toBe(30);
  });

  it('項目の行き先が仕様どおり', () => {
    const source = readFileSync(SIDEBAR, 'utf8');
    const body = source.slice(
      source.indexOf('const menuSections: MenuSection[] = ['),
      source.indexOf('function AccountAvatar'),
    );
    const pairs = [...body.matchAll(/\{\s*href:\s*'([^']+)',\s*label:\s*'([^']+)'/g)];
    const actual = Object.fromEntries(pairs.map((m) => [m[2], m[1]]));
    expect(actual).toEqual(ROUTES);
  });

  it('同じ画面を2か所から出していない', () => {
    // 同じ行き先が2つの区分にあると、いまどこにいるのかが分からなくなる。
    const source = readFileSync(SIDEBAR, 'utf8');
    const body = source.slice(
      source.indexOf('const menuSections: MenuSection[] = ['),
      source.indexOf('function AccountAvatar'),
    );
    const hrefs = [...body.matchAll(/\{\s*href:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });
});

describe('レスポンシブのメニュー名を維持する', () => {
  const source = readFileSync(SIDEBAR, 'utf8');

  it('モバイルドロワーは展開表示、デスクトップレールは幅に応じた表示を使う', () => {
    expect(source).toContain('{sidebarContent(true)}');
    expect(source).toContain('{sidebarContent(false)}');
  });

  it('展開したドロワーでは区分名・項目名・件数を隠さない', () => {
    expect(source).toContain("expanded ? 'block' : 'hidden xl:block'");
    expect(source).toContain("expanded ? 'inline' : 'hidden xl:inline'");
    expect(source).toContain("expanded ? 'inline-flex' : 'hidden xl:inline-flex'");
  });

  it('ドロワーに管理メニューの見出しがある', () => {
    expect(source).toContain('管理メニュー');
    expect(source).toContain('aria-label="管理メニュー"');
  });
});
