import { describe, it, expect, vi, beforeEach } from 'vitest';

// N-244: 停止した流入経路の公開URL受付と計測を止める回帰テスト。
// active だけが通常受付し、停止は転送先・内部状態を漏らさない同一の
// 終了応答(410)で止まる。存在しない ref は従来の汎用受付のまま
// (affiliate 契約テスト (c) の鎖を保つ)で、経路に結びつく計測を増やさない。
const dbMocks = {
  // eager module-load deps (mirror affiliate-links-redirect.test.ts)
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // /r/:ref resolution helpers
  getEntryRouteByRefCode: vi.fn(),
  getEntryRouteByRefCodeAny: vi.fn().mockResolvedValue(null),
  getTrafficPoolBySlug: vi.fn(),
  getTrafficPoolById: vi.fn(),
  getRandomPoolAccount: vi.fn(),
  getPoolAccounts: vi.fn(),
  getLineAccountById: vi.fn(),
  getAffiliateLinkByRefCode: vi.fn(),
  incrementAffiliateLinkClick: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

// Import after the mock so index.ts binds the mocked helpers.
const worker = (await import('../index.js')).default;

// A stub DB is enough: every query goes through the mocked @line-crm/db
// helpers, so the binding itself is never touched by the /r/:ref handler.
const DB = {} as D1Database;

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

const env = {
  DB,
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
} as unknown as import('../index.js').Env['Bindings'];

function get(path: string) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, {
      headers: { 'user-agent': MOBILE_UA },
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
  dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(null);
});

describe('/r/:ref — N-244 stopped entry routes', () => {
  it('active 経路は通常の公開URL受付を行う', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue({
      id: 'route-active',
      ref_code: 'live1',
      redirect_url: null,
      pool_id: null,
      is_active: 1,
    });
    dbMocks.getTrafficPoolBySlug.mockResolvedValue(null);

    const res = await get('/r/live1');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('LINEで開く');
    expect(html).toContain('ref=live1');
    // active は停止確認の余分な問い合わせをしない。
    expect(dbMocks.getEntryRouteByRefCodeAny).not.toHaveBeenCalled();
  });

  it('停止した経路は410で止まり、後段の受付へ落ちない', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue({
      id: 'route-stopped',
      ref_code: 'stopped1',
      redirect_url: null,
      pool_id: null,
      tag_id: 'tag-x',
      scenario_id: 'sc-x',
      is_active: 0,
    });

    const res = await get('/r/stopped1');
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain('このページは利用できません');
    // 内部状態を漏らさない: ref・タグ・シナリオの痕跡なし。
    expect(html).not.toContain('stopped1');
    expect(html).not.toContain('tag-x');
    expect(html).not.toContain('sc-x');
    // 新規受付・計測を増やさない: 紹介・プール・クリック計測に触れない。
    expect(dbMocks.getAffiliateLinkByRefCode).not.toHaveBeenCalled();
    expect(dbMocks.getTrafficPoolBySlug).not.toHaveBeenCalled();
    expect(dbMocks.incrementAffiliateLinkClick).not.toHaveBeenCalled();
  });

  it('停止した経路は転送設定があっても送らず、同じ終了応答になる', async () => {
    const target = 'https://example.com/secret-lp';
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue({
      id: 'route-stopped-redirect',
      ref_code: 'stopped2',
      redirect_url: target,
      pool_id: null,
      is_active: 0,
    });

    const res = await get('/r/stopped2');
    expect(res.status).toBe(410);
    // 転送先を漏らさない: Location なし、本文にもなし。
    expect(res.headers.get('location')).toBeNull();
    const htmlWithRedirect = await res.text();
    expect(htmlWithRedirect).not.toContain('secret-lp');

    // 転送設定の有無で応答が変わらない: 同じ安全な終了挙動。
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue({
      id: 'route-stopped',
      ref_code: 'stopped1',
      redirect_url: null,
      pool_id: null,
      is_active: 0,
    });
    const plain = await get('/r/stopped1');
    expect(plain.status).toBe(410);
    expect(await plain.text()).toBe(htmlWithRedirect);
  });

  it('存在しない ref は従来の汎用受付のまま、経路の計測を増やさない', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(null);
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue(null);
    dbMocks.getTrafficPoolBySlug.mockResolvedValue(null);

    const res = await get('/r/unknown');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('ref=unknown');
    // 経路に結びつく計測は増えない。
    expect(dbMocks.incrementAffiliateLinkClick).not.toHaveBeenCalled();
    expect(dbMocks.getTrafficPoolBySlug).toHaveBeenCalledWith(DB, 'main');
  });

  it('転送設定のある active 経路は302で送る', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue({
      id: 'route-redirect',
      ref_code: 'moved',
      redirect_url: 'https://example.com/new-lp',
      pool_id: null,
      is_active: 1,
    });

    const res = await get('/r/moved');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/new-lp');
  });

  it('二重アクセスでも計測・帰属を増やさない', async () => {
    // 停止: 2回とも同じ410で、副作用の呼び出しはゼロ。
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue({
      id: 'route-stopped',
      ref_code: 'stopped1',
      redirect_url: null,
      pool_id: null,
      is_active: 0,
    });
    const first = await get('/r/stopped1');
    const second = await get('/r/stopped1');
    expect(first.status).toBe(410);
    expect(second.status).toBe(410);
    expect(await second.text()).toBe(await first.text());
    expect(dbMocks.getAffiliateLinkByRefCode).not.toHaveBeenCalled();
    expect(dbMocks.incrementAffiliateLinkClick).not.toHaveBeenCalled();

    // active 着地: 2回とも受付のみで、着地時の計測書き込みは起きない。
    dbMocks.getEntryRouteByRefCode.mockResolvedValue({
      id: 'route-active',
      ref_code: 'live1',
      redirect_url: null,
      pool_id: null,
      is_active: 1,
    });
    dbMocks.getTrafficPoolBySlug.mockResolvedValue(null);
    const a1 = await get('/r/live1');
    const a2 = await get('/r/live1');
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);
    expect(dbMocks.incrementAffiliateLinkClick).not.toHaveBeenCalled();
  });

  it('/help も停止経路は同じ410で止める', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue({
      id: 'route-stopped',
      ref_code: 'stopped1',
      redirect_url: null,
      pool_id: null,
      is_active: 0,
    });
    const stoppedHelp = await get('/r/stopped1/help');
    expect(stoppedHelp.status).toBe(410);
    const stoppedLanding = await get('/r/stopped1');
    expect(await stoppedHelp.text()).toBe(await stoppedLanding.text());

    // 属さない ref の help は従来どおり回復ページ。
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(null);
    const unknownHelp = await get('/r/unknown/help');
    expect(unknownHelp.status).toBe(200);
    expect(await unknownHelp.text()).toContain('LINEを開く方法');
  });
});
