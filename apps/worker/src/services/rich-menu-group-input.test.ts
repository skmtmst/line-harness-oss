import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLineAccountById, getRichMenuGroupWithPages, setTrackedLinkBaseUrl } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { createRichMenuShells, type LineRichMenuClient, type R2Like } from '../lib/rich-menu-publisher.js';
import { assembleRichMenuGroupInput, richMenuLiveToSnapshot, type RichMenuGroupSnapshot } from './rich-menu-group-input.js';

let testDb: SqliteD1;

beforeEach(() => {
  testDb = createTestD1({ foreignKeys: true });
  testDb.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, liff_id)
    VALUES ('w17-account', 'w17-channel', 'Fixture account', 'fixture-token', 'fixture-secret', 'w17-liff');
    INSERT INTO tracked_links (id, name, original_url, line_account_id, short_code)
    VALUES ('w17-tracked', 'Fixture link', 'https://destination.example.test/page', 'w17-account', 'w17-short');
    INSERT INTO forms (id, name, fields) VALUES ('w17-form', 'Fixture form', '[]');
    INSERT INTO rich_menu_groups
      (id, account_id, name, chat_bar_text, size, is_default_for_all, default_open)
    VALUES ('w17-group', 'w17-account', 'Fixture menu', 'メニュー', 'large', 1, 1);
    INSERT INTO rich_menu_pages
      (id, group_id, order_index, name, alias_id, image_r2_key, image_content_type)
    VALUES ('w17-page', 'w17-group', 0, 'Fixture page', 'lhx-w17-group-0', 'fixture/image.png', 'image/png');
    INSERT INTO rich_menu_areas
      (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height, action_type,
       action_data, intent, label, tracked_link_id)
    VALUES ('w17-area-1', 'w17-page', 0, 0, 800, 800, 'uri',
            '{"uri":"https://destination.example.test/page"}', 'url', '計測リンク', 'w17-tracked');
    INSERT INTO rich_menu_areas
      (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height, action_type,
       action_data, intent, label, form_id)
    VALUES ('w17-area-2', 'w17-page', 800, 0, 800, 800, 'uri',
            '{}', 'form', 'フォーム', 'w17-form');
    INSERT INTO rich_menu_areas
      (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height, action_type,
       action_data, intent, label)
    VALUES ('w17-area-3', 'w17-page', 1600, 0, 800, 800, 'uri',
            '{"uri":"https://plain.example.test/original"}', NULL, '旧URL');
  `);
  expect(testDb.raw.pragma('foreign_keys', { simple: true })).toBe(1);
});
afterEach(() => { testDb.raw.close(); });

function lineFixture(): LineRichMenuClient {
  return {
    createRichMenu: vi.fn(async (_payload: unknown) => ({ richMenuId: 'fixture-line-id' })),
    validateRichMenu: vi.fn(async () => undefined),
    listRichMenus: vi.fn(async () => []),
    uploadRichMenuImage: vi.fn(async () => undefined),
    deleteRichMenuAlias: vi.fn(async () => undefined),
    createRichMenuAlias: vi.fn(async () => undefined),
    upsertRichMenuAlias: vi.fn(async () => undefined),
    deleteRichMenu: vi.fn(async () => undefined),
    setDefaultRichMenu: vi.fn(async () => undefined),
    clearDefaultRichMenu: vi.fn(async () => undefined),
    getCurrentDefaultRichMenuId: vi.fn(async () => null),
    linkRichMenuBulk: vi.fn(async () => undefined),
  };
}
const r2: R2Like = { get: async () => ({ body: new Uint8Array([137, 80, 78, 71]) }) };

async function source() {
  const group = await getRichMenuGroupWithPages(testDb.db, 'w17-group');
  const account = await getLineAccountById(testDb.db, 'w17-account');
  expect(group).not.toBeNull();
  expect(account).not.toBeNull();
  return { group: group!, account: account! };
}

async function payloadFor(snapshot: RichMenuGroupSnapshot, workerBaseUrl?: string) {
  const { account } = await source();
  const input = await assembleRichMenuGroupInput(testDb.db, snapshot, account, {
    fallbackGroupId: 'w17-group', workerBaseUrl: workerBaseUrl ?? undefined,
  });
  const line = lineFixture();
  await createRichMenuShells(input, line, r2);
  const payload = vi.mocked(line.createRichMenu).mock.calls[0][0] as {
    selected: boolean;
    chatBarText: string;
    areas: Array<{ bounds: { x: number; y: number; width: number; height: number }; action: { type: string; uri: string } }>;
  };
  expect(line.upsertRichMenuAlias).not.toHaveBeenCalled();
  expect(line.setDefaultRichMenu).not.toHaveBeenCalled();
  return payload;
}

describe('W17 rich menu group input (real SQL and actual LINE payload builder)', () => {
  for (const path of ['manual', 'scheduled-snapshot', 'restore-live'] as const) {
    for (const branded of [false, true]) {
      it(`${path}: forms use LIFF, tracked links use ${branded ? 'branded' : 'Worker'} base`, async () => {
        if (branded) await setTrackedLinkBaseUrl(testDb.db, '__global__', 'https://go.example.test/');
        const { group } = await source();
        const live = richMenuLiveToSnapshot(group);
        // Scheduled content is a serialized fixed snapshot; manual / restore use
        // explicitly fetched live content, normalized by the same boundary.
        const snapshot = path === 'scheduled-snapshot'
          ? JSON.parse(JSON.stringify(live)) as RichMenuGroupSnapshot
          : live;
        const before = JSON.stringify(snapshot);
        const payload = await payloadFor(snapshot, 'https://worker.example.test/');
        expect(payload.areas.map((area) => area.action)).toEqual([
          { type: 'uri', uri: `${branded ? 'https://go.example.test' : 'https://worker.example.test'}/t/w17-short` },
          { type: 'uri', uri: 'https://liff.line.me/w17-liff?form=w17-form' },
          { type: 'uri', uri: 'https://plain.example.test/original' },
        ]);
        expect(payload.selected).toBe(true);
        expect(JSON.stringify(snapshot)).toBe(before);
      });
    }
  }

  it('fixed snapshot keeps its chosen tracked link, bounds and text after live draft edits', async () => {
    const { group } = await source();
    const snapshot = richMenuLiveToSnapshot(group);
    const before = JSON.stringify(snapshot);
    testDb.raw.exec(`
      INSERT INTO tracked_links (id, name, original_url, line_account_id, short_code)
      VALUES ('w17-new-link', 'New draft link', 'https://new.example.test', 'w17-account', 'new-short');
      UPDATE rich_menu_groups SET chat_bar_text = '新しい下書き', default_open = 0 WHERE id = 'w17-group';
      UPDATE rich_menu_areas SET tracked_link_id = 'w17-new-link', bounds_x = 100
      WHERE id = 'w17-area-1';
    `);
    const payload = await payloadFor(snapshot, 'https://worker.example.test');
    expect(payload.chatBarText).toBe('メニュー');
    expect(payload.selected).toBe(true);
    expect(payload.areas[0]).toMatchObject({
      bounds: { x: 0 }, action: { uri: 'https://worker.example.test/t/w17-short' },
    });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('uses a branded tracked base without WORKER_URL', async () => {
    await setTrackedLinkBaseUrl(testDb.db, '__global__', 'https://go.example.test');
    const { group } = await source();
    const payload = await payloadFor(richMenuLiveToSnapshot(group));
    expect(payload.areas[0].action.uri).toBe('https://go.example.test/t/w17-short');
  });

  it('fails before any LINE creation if tracked links have no Worker or branded base', async () => {
    const { group, account } = await source();
    const line = lineFixture();
    await expect((async () => {
      const input = await assembleRichMenuGroupInput(testDb.db, richMenuLiveToSnapshot(group), account, {
        fallbackGroupId: group.id,
      });
      await createRichMenuShells(input, line, r2);
    })()).rejects.toThrow('set WORKER_URL or tracked_link_base_url');
    expect(line.createRichMenu).not.toHaveBeenCalled();
    expect(line.uploadRichMenuImage).not.toHaveBeenCalled();
  });

  it('does not require a tracking base when no tracked link is selected', async () => {
    testDb.raw.exec(`UPDATE rich_menu_areas SET tracked_link_id = NULL WHERE id = 'w17-area-1'`);
    const { group } = await source();
    const payload = await payloadFor(richMenuLiveToSnapshot(group));
    expect(payload.areas[0].action.uri).toBe('https://destination.example.test/page');
    expect(payload.areas[1].action.uri).toBe('https://liff.line.me/w17-liff?form=w17-form');
  });

  it('uses the LIFF fallback only for form actions, with link ID fallback for old tracked rows', async () => {
    testDb.raw.exec(`UPDATE line_accounts SET liff_id = NULL WHERE id = 'w17-account';
      UPDATE tracked_links SET short_code = NULL WHERE id = 'w17-tracked';`);
    const { group, account } = await source();
    const input = await assembleRichMenuGroupInput(testDb.db, richMenuLiveToSnapshot(group), account, {
      fallbackGroupId: group.id,
      workerBaseUrl: 'https://worker.example.test',
      liffUrl: 'https://liff.line.me/fallback',
    });
    const line = lineFixture();
    await createRichMenuShells(input, line, r2);
    const payload = vi.mocked(line.createRichMenu).mock.calls[0][0] as { areas: Array<{ action: { uri: string } }> };
    expect(payload.areas[0].action.uri).toBe('https://worker.example.test/t/w17-tracked');
    expect(payload.areas[1].action.uri).toBe('https://liff.line.me/fallback?form=w17-form');
  });
});
