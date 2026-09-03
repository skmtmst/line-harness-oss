import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * サイドバーが Pen.dev の V5正式共通メニュー（J33xq）と一致していることを確かめる。
 *
 * 設計（`V2 1-1 ダッシュボード` のサイドバー）が出どころで、
 * 区分・並び・呼び名を勝手に変えないための歯止め。
 *
 * 画面を足すときに「ついでにサイドバーへ」とやると、設計から静かにずれる。
 * ずれてよいと決めたときは、この一覧のほうを直す。そのとき
 * 「設計を更新したのか、実装が勝手にずれたのか」が差分に残る。
 */

const SIDEBAR = join(dirname(fileURLToPath(import.meta.url)), 'sidebar.tsx');
/**
 * 項目そのものは `src/lib/menu.ts` に置いてある。サイドバーと機能設定が
 * 同じ一覧を読むようにしたので、区分と項目はそちらを見る。
 */
const MENU = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'menu.ts');
const MENU_START = 'export const MENU_SECTIONS: MenuSection[] = [';
const MENU_END = '/** 区分の目印から中身を引く。 */';

/** Pen.dev V5を基本に、運用中の承認済み追加機能を含めた区分と項目。 */
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
  // 「コンテンツ」1項目に画像と共通情報のタブを詰めていたが、Lステップは
  // コンテンツ区分の下に「共通情報」「登録メディア一覧」の2項目を並べる。
  // 同じ画面の中で切り替えるより、サイドバーから直接行けるほうが近い。
  {
    section: 'コンテンツ',
    items: ['テンプレート', 'リッチメニュー', '回答フォーム', '共通情報', '登録メディア一覧'],
  },
  {
    section: '成果と分析',
    items: ['成果とアフィリエイト', 'マイル', '流入と計測', 'コンバージョン', '分析'],
  },
  { section: '自動化', items: ['オートメーション', '外部連携'] },
  { section: '予約', items: ['予約管理', '予約設定', 'イベント予約'] },
  // LINE通知はV4作成前から運用中の承認済み追加機能なので、専用機能の末尾に残す。
  { section: '専用機能', items: ['NEN配信', '写真審査', 'EC連携', 'LINE通知'] },
  // D-3: 店舗の追加・設定・一覧は統括へ集約し、店舗側の重複導線を戻さない。
  /*
    2026-09-04: 「設定」区分の先頭に「LINEアカウント」を足した。
    要件 `v6-33-account-settings` §5-3。**統括の店舗管理（/hq）とは別**で、
    こちらは送受信に使う LINE公式アカウントそのものの設定。
  */
  { section: '設定', items: ['LINEアカウント', 'ログインユーザー', '機能設定', '運用状態'] },
  {
    section: '飲食店向け（テスト）',
    items: [
      '店舗ダッシュボード', '組織・権限', '承認ワークフロー', '予約台帳', '座席・卓管理',
      '予約枠・在庫', 'メニュー管理', 'Google・口コミ', 'LINE来店フォロー',
    ],
  },
];

/** menu.ts の MENU_SECTIONS から、区分と項目を順序どおりに読む。 */
function readSidebar(): Array<{ section: string | null; items: string[] }> {
  const source = readFileSync(MENU, 'utf8');
  const body = source.slice(source.indexOf(MENU_START), source.indexOf(MENU_END));

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
  共通情報: '/contents/vars',
  登録メディア一覧: '/contents',
  成果とアフィリエイト: '/conversions?tab=affiliates',
  回答フォーム: '/form-submissions',
  マイル: '/mileage',
  流入と計測: '/inflow-links',
  コンバージョン: '/conversions',
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
  LINE通知: '/line-notifications',
  LINEアカウント: '/accounts',
  ログインユーザー: '/staff',
  機能設定: '/settings',
  運用状態: '/emergency',
  店舗ダッシュボード: '/restaurant-test/dashboard',
  '組織・権限': '/restaurant-test/organization',
  承認ワークフロー: '/restaurant-test/approvals',
  予約台帳: '/restaurant-test/reservations',
  '座席・卓管理': '/restaurant-test/tables',
  '予約枠・在庫': '/restaurant-test/inventory',
  メニュー管理: '/restaurant-test/menu',
  'Google・口コミ': '/restaurant-test/google',
  LINE来店フォロー: '/restaurant-test/line-followup',
};

describe('サイドバーが V5正式共通メニューの契約と一致する', () => {
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

  it('項目の総数が設計どおり（42）', () => {
    // 設計に無いものを足すと、ここで気づける。
    // 統括一覧を独立した /hq へ移し、店舗側は飲食店向け9項目を維持する。
    // 2026-09-04: 「設定」区分に「LINEアカウント」を足して 42（要件 §5-3）。
    const total = actual.reduce((sum, s) => sum + s.items.length, 0);
    expect(total).toBe(42);
  });

  it('項目の行き先が仕様どおり', () => {
    const source = readFileSync(MENU, 'utf8');
    const body = source.slice(source.indexOf(MENU_START), source.indexOf(MENU_END));
    const pairs = [...body.matchAll(/\{\s*href:\s*'([^']+)',\s*label:\s*'([^']+)'/g)];
    const actual = Object.fromEntries(pairs.map((m) => [m[2], m[1]]));
    expect(actual).toEqual(ROUTES);
  });

  it('同じ画面を2か所から出していない', () => {
    // 同じ行き先が2つの区分にあると、いまどこにいるのかが分からなくなる。
    const source = readFileSync(MENU, 'utf8');
    const body = source.slice(source.indexOf(MENU_START), source.indexOf(MENU_END));
    const hrefs = [...body.matchAll(/\{\s*href:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });
});

describe('レスポンシブのメニュー名を維持する', () => {
  const source = readFileSync(SIDEBAR, 'utf8');

  it('ドロワーと常時表示で同じ中身を出す', () => {
    // 別のマークアップを2つ持つと、片方だけ直す事故が起きる。
    expect(source).toContain('{sidebarContent(true)}');
    expect(source).toContain('{sidebarContent(false)}');
  });

  it('どの幅でも区分名・項目名・件数を隠さない', () => {
    /*
     * もとは「展開しているときだけ名前を出す」書き方（expanded ? ... :
     * 'hidden xl:...'）が残っていることを見ていた。64px のアイコンレールが
     * あり、その幅では名前を隠す必要があったため。
     *
     * レールをやめて 1280px 未満はドロワーだけにしたので、隠す幅が無くなった。
     * 書き方ではなく「隠していないこと」を見る。ここに 'hidden xl:inline' が
     * 戻ってきたら、また名前の読めない幅ができたということ。
     */
    expect(source).not.toContain("'hidden xl:inline'");
    expect(source).not.toContain("'hidden xl:block'");
    expect(source).not.toContain("'hidden xl:inline-flex'");
  });

  it('アイコンだけの帯を作らない', () => {
    // w-16 の常時表示は、絵しか出ない帯。何の項目かを覚えている人しか使えない。
    expect(source).not.toContain('w-16 xl:w-64');
  });

  it('ドロワーに管理メニューの見出しがある', () => {
    expect(source).toContain('管理メニュー');
    expect(source).toContain('aria-label="管理メニュー"');
  });

  it('先頭は会社名とバージョン。アカウント切替はトップバーへ移した', () => {
    // 2026-08-26 にアカウント切替・名前・権限・ログアウトをトップバーへ移した。
    // ここに残すと二重に出る（docs/v6-common-rules.md §1）。
    expect(source).toContain('SidebarIdentity');
    expect(source).not.toContain('AccountSwitcher');
    expect(source).not.toContain('countryFlag');
  });

  it('下端に名前・権限・ログアウトを置かない', () => {
    // コメントには残るので、実際に描く要素と処理で見る。
    // `lh_staff_role` はメニューの出し分けに要るので、ここでは見ない。
    expect(source).not.toContain('<span>ログアウト</span>');
    expect(source).not.toContain('auth/logout');
    expect(source).not.toContain('clearAdminSession');
  });

  it('PCの先頭はV5どおりLINEアカウント切替から始まる', () => {
    expect(source).toContain('null');
    expect(source).not.toContain('PCの先頭はアカウント切替ではなく');
  });
});
