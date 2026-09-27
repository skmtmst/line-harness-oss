import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * マニュアル導線の週1回の点検（要件 v6-34 §8-4）。台帳 #134。
 *
 * 守りたいのは 3 点。
 *   1. 週1に絞る（cron は短い間隔で回るので、ここで止める）
 *   2. 新たに壊れたリンクにだけ知らせる（「前も壊れていた」には出さない）
 *   3. URL が決まっていないものを broken に混ぜない
 */

const db = {
  listManualLinks: vi.fn(),
  recordCheck: vi.fn(async () => undefined),
};
vi.mock('@line-crm/db', () => db);

const dispatch = { dispatchOperatorEvent: vi.fn(async () => []) };
vi.mock('./operator-notification-dispatch.js', () => dispatch);

const { checkAllManualLinks, runWeeklyManualLinkCheck, notifyBrokenManualLinks } =
  await import('./manual-link-check.js');

const LINKS = {
  ok: { key: '3-1', key_kind: 'screen', name: '友だち', url: 'https://docs.example.com/friends',
    status: 'ok', last_checked_at: null, last_error: null, last_http_status: 200,
    version: 1, updated_by: null, updated_at: '' },
  brokenAlready: { key: '7-1', key_kind: 'screen', name: 'リマインダ', url: 'https://docs.example.com/reminders',
    status: 'broken', last_checked_at: null, last_error: 'HTTP_404', last_http_status: 404,
    version: 1, updated_by: null, updated_at: '' },
  unset: { key: '9-1', key_kind: 'screen', name: '自動応答', url: null,
    status: 'unset', last_checked_at: null, last_error: null, last_http_status: null,
    version: 1, updated_by: null, updated_at: '' },
};

function prepare(results: Record<string, () => Promise<{ ok: boolean; status: number }>>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const key = Object.keys(results).find((k) => String(url).includes(k));
    if (key) return results[key]!() as unknown as Response;
    return { ok: true, status: 200 } as Response;
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.recordCheck.mockResolvedValue(undefined);
});

describe('checkAllManualLinks', () => {
  it('URL が無い行を broken に混ぜない', async () => {
    db.listManualLinks.mockResolvedValue([LINKS.unset]);
    const result = await checkAllManualLinks({} as D1Database);
    expect(result.unset).toBe(1);
    expect(result.broken).toBe(0);
  });

  it('新たに壊れたものだけを newlyBroken に入れる', async () => {
    db.listManualLinks.mockResolvedValue([LINKS.ok, LINKS.brokenAlready]);
    prepare({ 'friends': async () => ({ ok: false, status: 404 }), 'reminders': async () => ({ ok: false, status: 404 }) });
    const result = await checkAllManualLinks({} as D1Database);
    // '3-1' は ok→broken（新たに壊れた）、'7-1' は broken→broken（前から壊れていた）
    expect(result.newlyBroken).toEqual(['3-1']);
    expect(result.broken).toBe(2);
  });

  it('内部アドレスの URL は確かめに行かない', async () => {
    const unsafe = { ...LINKS.ok, key: 'x', url: 'http://169.254.169.254/latest' };
    db.listManualLinks.mockResolvedValue([unsafe]);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await checkAllManualLinks({} as D1Database);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.unsafe).toBe(1);
  });
});

describe('runWeeklyManualLinkCheck（週1に絞る）', () => {
  it('最終確認から7日を経ていなければ何もしない', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dbStub = {
      prepare: () => ({
        first: async () => ({ latest: recent }),
      }),
    } as unknown as D1Database;
    const result = await runWeeklyManualLinkCheck(dbStub);
    expect(result).toBeNull();
  });

  it('7日を経たら走査する', async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    db.listManualLinks.mockResolvedValue([LINKS.unset]);
    const dbStub = {
      prepare: (sql: string) => ({
        first: async () => (sql.includes('MAX(checked_at)') ? { latest: old } : null),
      }),
    } as unknown as D1Database;
    const result = await runWeeklyManualLinkCheck(dbStub);
    expect(result).not.toBeNull();
    expect(result?.unset).toBe(1);
  });
});

describe('notifyBrokenManualLinks（1回だけ知らせる）', () => {
  it('壊れたキーごとに運営へ知らせる', async () => {
    const dbStub = {
      prepare: () => ({ all: async () => ({ results: [{ id: 'acc-1' }] }) }),
    } as unknown as D1Database;
    await notifyBrokenManualLinks(dbStub, {} as never, ['3-1']);
    expect(dispatch.dispatchOperatorEvent).toHaveBeenCalledTimes(1);
    expect(dispatch.dispatchOperatorEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        eventType: 'manual_link_broken',
        sourceEventId: 'manual_link_broken:3-1',
        lineAccountId: 'acc-1',
      }),
    );
  });

  it('新たに壊れたものが無ければ知らせない', async () => {
    const dbStub = { prepare: () => ({ all: async () => ({ results: [] }) }) } as unknown as D1Database;
    await notifyBrokenManualLinks(dbStub, {} as never, []);
    expect(dispatch.dispatchOperatorEvent).not.toHaveBeenCalled();
  });
});
