import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// このファイルではpublisherをmockしない。routeが渡す決定名、LINE create/upload、
// alias/defaultの途中状態まで、実際のpublish実装を通して確かめる。
const db = vi.hoisted(() => ({
  getRichMenuGroupWithPages: vi.fn(),
  createRichMenuManualPublishRequestAtomic: vi.fn(),
  getRichMenuManualPublishRequest: vi.fn(),
  getRichMenuManualPublishShells: vi.fn(),
  recordRichMenuManualPublishShells: vi.fn(),
  claimRichMenuManualPublishRequest: vi.fn(),
  markRichMenuManualPublishSucceeded: vi.fn(),
  markRichMenuManualPublishFailed: vi.fn(),
  restartRichMenuManualPublishRequest: vi.fn(),
  isPublishLeaseHeld: vi.fn(),
  acquirePublishLease: vi.fn(),
  renewPublishLease: vi.fn(),
  releasePublishLease: vi.fn(),
  setPageRichMenuId: vi.fn(),
  markRichMenuGroupPublished: vi.fn(),
  getLineAccountById: vi.fn(),
  getTrackedLinkById: vi.fn(),
  jstNow: vi.fn(() => '2026-09-16T00:00:00.000Z'),
}));
vi.mock('@line-crm/db', () => db);

const access = vi.hoisted(() => ({ canAccessAllLineAccounts: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => access);

const { richMenuGroups } = await import('./rich-menu-groups.js');

const group = {
  id: 'g1', account_id: 'a1', name: 'menu', chat_bar_text: 'menu', size: 'large', default_page_id: 'p1',
  is_default_for_all: 1, status: 'draft', targeting_condition: null, targeting_priority: 0, targeting_enabled: 0,
  folder_id: null, display_order: 0, created_at: '', updated_at: '', pages: [{
    id: 'p1', order_index: 0, name: 'page', alias_id: 'alias', line_richmenu_id: 'old', image_r2_key: 'image', image_content_type: 'image/png', areas: [{
      id: 'area-1', bounds_x: 0, bounds_y: 0, bounds_width: 2500, bounds_height: 1686,
      action_type: 'uri', actionData: { uri: 'https://example.com' }, intent: 'url', label: 'サイトを開く',
      tag_ids: null, score_change: null, template_id: null, form_id: null, tracked_link_id: null,
    }],
  }],
};

type RequestRow = {
  id: string;
  group_id: string;
  account_id: string;
  request_fingerprint: string;
  idempotency_key: string;
  status: 'running' | 'failed' | 'succeeded';
  result_json: string | null;
  execution_token: string | null;
};
type Shell = { request_id: string; page_id: string; order_index: number; new_richmenu_id: string; old_richmenu_id: string | null };

let requests: Map<string, RequestRow>;
let shells: Map<string, Shell[]>;
let menus: Map<string, { richMenuId: string; name: string }>;
let aliases: Array<{ aliasId: string; richMenuId: string }>;
let defaultCalls: string[];
let createCalls: Array<{ id: string; name: string }>;
let rejectJournalOnce: boolean;
let rejectDefaultOnce: boolean;

function requestKey(accountId: string, idempotencyKey: string) {
  return `${accountId}:${idempotencyKey}`;
}

function app() {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 's1', role: 'owner' });
    c.env = {
      DB: {},
      IMAGES: { get: vi.fn(async () => ({ body: new Uint8Array([1, 2, 3]) })) },
    };
    await next();
  });
  instance.route('/', richMenuGroups);
  return instance;
}

function post(key = 'same-key') {
  return app().request('/api/rich-menu-groups/g1/publish', {
    method: 'POST', headers: { 'Idempotency-Key': key },
  });
}

function setupDb() {
  db.getRichMenuGroupWithPages.mockResolvedValue(group);
  db.getLineAccountById.mockResolvedValue({ channel_access_token: 'token' });
  db.createRichMenuManualPublishRequestAtomic.mockImplementation(async (_db: unknown, input: {
    id: string; groupId: string; accountId: string; requestFingerprint: string; idempotencyKey: string;
  }) => {
    const key = requestKey(input.accountId, input.idempotencyKey);
    const existing = requests.get(key);
    if (existing) return { outcome: 'existing', request: existing };
    const request: RequestRow = {
      id: input.id, group_id: input.groupId, account_id: input.accountId,
      request_fingerprint: input.requestFingerprint, idempotency_key: input.idempotencyKey,
      status: 'running', result_json: null, execution_token: null,
    };
    requests.set(key, request);
    return { outcome: 'created', request };
  });
  db.getRichMenuManualPublishRequest.mockImplementation(async (_db: unknown, accountId: string, idempotencyKey: string) => {
    return requests.get(requestKey(accountId, idempotencyKey)) ?? null;
  });
  db.getRichMenuManualPublishShells.mockImplementation(async (_db: unknown, requestId: string) => shells.get(requestId) ?? []);
  db.recordRichMenuManualPublishShells.mockImplementation(async (_db: unknown, requestId: string, rows: Array<{ pageId: string; orderIndex: number; newRichMenuId: string; oldRichMenuId: string | null }>) => {
    if (rejectJournalOnce) {
      rejectJournalOnce = false;
      throw new Error('journal unavailable');
    }
    const existing = shells.get(requestId) ?? [];
    for (const row of rows) {
      if (!existing.some((shell) => shell.page_id === row.pageId)) {
        existing.push({ request_id: requestId, page_id: row.pageId, order_index: row.orderIndex, new_richmenu_id: row.newRichMenuId, old_richmenu_id: row.oldRichMenuId });
      }
    }
    shells.set(requestId, existing);
  });
  db.claimRichMenuManualPublishRequest.mockImplementation(async (_db: unknown, requestId: string, token: string) => {
    const request = [...requests.values()].find((row) => row.id === requestId);
    if (!request || request.status !== 'running') return false;
    request.execution_token = token;
    return true;
  });
  db.markRichMenuManualPublishSucceeded.mockImplementation(async (_db: unknown, requestId: string, token: string, result: string) => {
    const request = [...requests.values()].find((row) => row.id === requestId);
    if (!request || request.status !== 'running' || request.execution_token !== token) return false;
    request.status = 'succeeded'; request.result_json = result;
    return true;
  });
  db.markRichMenuManualPublishFailed.mockImplementation(async (_db: unknown, requestId: string, token: string) => {
    const request = [...requests.values()].find((row) => row.id === requestId);
    if (!request || request.status !== 'running' || request.execution_token !== token) return false;
    request.status = 'failed';
    return true;
  });
  db.restartRichMenuManualPublishRequest.mockImplementation(async (_db: unknown, requestId: string) => {
    const request = [...requests.values()].find((row) => row.id === requestId);
    if (!request || request.status !== 'failed') return false;
    request.status = 'running'; request.execution_token = null;
    return true;
  });
  db.isPublishLeaseHeld.mockResolvedValue(false);
  db.acquirePublishLease.mockResolvedValue(1);
  db.renewPublishLease.mockResolvedValue(true);
  db.releasePublishLease.mockResolvedValue(true);
  db.setPageRichMenuId.mockResolvedValue(true);
  db.markRichMenuGroupPublished.mockResolvedValue(true);
}

function lineFetch(url: unknown, init?: RequestInit) {
  const target = String(url);
  const method = init?.method ?? 'GET';
  if (target === 'https://api.line.me/v2/bot/richmenu/list') {
    return Promise.resolve(new Response(JSON.stringify({ richmenus: [...menus.values()] }), { status: 200 }));
  }
  if (target === 'https://api.line.me/v2/bot/richmenu' && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as { name: string };
    const id = `new-${createCalls.length + 1}`;
    createCalls.push({ id, name: body.name });
    menus.set(id, { richMenuId: id, name: body.name });
    return Promise.resolve(new Response(JSON.stringify({ richMenuId: id }), { status: 200 }));
  }
  if (target.startsWith('https://api-data.line.me/v2/bot/richmenu/') && target.endsWith('/content')) {
    return Promise.resolve(new Response('', { status: 200 }));
  }
  if (target.startsWith('https://api.line.me/v2/bot/richmenu/alias/') && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as { richMenuId: string };
    aliases.push({ aliasId: target.split('/').at(-1)!, richMenuId: body.richMenuId });
    return Promise.resolve(new Response('', { status: 200 }));
  }
  if (target.startsWith('https://api.line.me/v2/bot/user/all/richmenu/') && method === 'POST') {
    const richMenuId = target.split('/').at(-1)!;
    defaultCalls.push(richMenuId);
    if (rejectDefaultOnce) {
      rejectDefaultOnce = false;
      return Promise.resolve(new Response('default unavailable', { status: 503 }));
    }
    return Promise.resolve(new Response('', { status: 200 }));
  }
  if (target.startsWith('https://api.line.me/v2/bot/richmenu/') && method === 'DELETE') {
    // journal失敗後の通常cleanupは外部障害で残った想定。次のrequestだけが決定名から回収する。
    return Promise.resolve(new Response('delete unavailable', { status: 503 }));
  }
  throw new Error(`unexpected LINE request: ${method} ${target}`);
}

describe('手動公開のroute冪等性（実LINE相当）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests = new Map(); shells = new Map(); menus = new Map(); aliases = []; defaultCalls = []; createCalls = [];
    rejectJournalOnce = false; rejectDefaultOnce = false;
    setupDb();
    access.canAccessAllLineAccounts.mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn(lineFetch));
  });

  it('同keyの実並行2要求は、LINE createを1回だけにして片方を409へ止める', async () => {
    let arrived = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    db.isPublishLeaseHeld.mockImplementation(async () => {
      arrived += 1;
      if (arrived === 2) releaseBarrier();
      await barrier;
      return false;
    });
    let acquired = false;
    db.acquirePublishLease.mockImplementation(async () => {
      if (acquired) return null;
      acquired = true;
      return 1;
    });

    const [first, second] = await Promise.all([post('same-key'), post('same-key')]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].name).toMatch(/^lhm:[^:]+:p1$/);
  });

  it('LINE create成功後にjournalが失敗しても、次requestは決定名の同じshellを回収する', async () => {
    rejectJournalOnce = true;

    const first = await post('journal-key');
    expect(first.status).toBe(500);
    expect(createCalls).toEqual([{ id: 'new-1', name: expect.stringMatching(/^lhm:[^:]+:p1$/) }]);

    const retry = await post('journal-key');

    expect(retry.status).toBe(200);
    expect(createCalls).toHaveLength(1);
    const body = await retry.json() as { data: { pages: Array<{ pageId: string; newRichMenuId: string }> } };
    expect(body.data.pages).toEqual([{ pageId: 'p1', newRichMenuId: 'new-1' }]);
  });

  it('alias成功後default失敗でも、同key再開は同じshellでalias/defaultを安全に完走する', async () => {
    rejectDefaultOnce = true;

    const first = await post('default-key');
    expect(first.status).toBe(500);
    const retry = await post('default-key');

    expect(retry.status).toBe(200);
    expect(createCalls).toHaveLength(1);
    expect(aliases).toEqual([
      { aliasId: 'lhx-g1-0', richMenuId: 'new-1' },
      { aliasId: 'lhx-g1-0', richMenuId: 'new-1' },
    ]);
    expect(defaultCalls).toEqual(['new-1', 'new-1']);
  });
});
