import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  getRichMenuGroups: vi.fn(), getRichMenuGroupById: vi.fn(), getRichMenuGroupWithPages: vi.fn(), getRichMenuDeleteImpact: vi.fn(),
  createRichMenuGroup: vi.fn(), updateRichMenuGroupMeta: vi.fn(), replaceRichMenuPages: vi.fn(), deleteRichMenuGroup: vi.fn(), setRichMenuPageImage: vi.fn(), pageBelongsToGroup: vi.fn(),
  acquirePublishLease: vi.fn(), releasePublishLease: vi.fn(), renewPublishLease: vi.fn(), isPublishLeaseHeld: vi.fn(), setPageRichMenuId: vi.fn(), markRichMenuGroupPublished: vi.fn(), markRichMenuGroupUnpublished: vi.fn(),
  getLineAccountById: vi.fn(), getFollowingLineUserIdsByTag: vi.fn(), getTrackedLinkById: vi.fn(), getRichMenuTapStats: vi.fn(), getRichMenuAudienceStats: vi.fn(), recordRichMenuAssignmentsByLineUserIds: vi.fn(), clearRichMenuAssignmentsForGroup: vi.fn(), listRichMenuSchedulesByGroup: vi.fn(), cancelRichMenuSchedule: vi.fn(),
  createRichMenuScheduleAtomic: vi.fn(), createRichMenuManualPublishRequestAtomic: vi.fn(), getRichMenuManualPublishRequest: vi.fn(), getRichMenuManualPublishShells: vi.fn(), recordRichMenuManualPublishShells: vi.fn(), markRichMenuManualPublishSucceeded: vi.fn(), markRichMenuManualPublishFailed: vi.fn(), restartRichMenuManualPublishRequest: vi.fn(), jstNow: vi.fn(() => '2026-09-16T00:00:00.000Z'),
}));
vi.mock('@line-crm/db', () => db);
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: vi.fn(async () => true) }));
const publisher = vi.hoisted(() => ({
  createRichMenuShells: vi.fn(), switchRichMenuLive: vi.fn(), deleteRichMenuShells: vi.fn(),
  unpublishRichMenuGroup: vi.fn(), linkRichMenuBulkChunked: vi.fn(),
  PublishLeaseLostError: class PublishLeaseLostError extends Error {},
  RichMenuValidationError: class RichMenuValidationError extends Error {},
}));
vi.mock('../lib/rich-menu-publisher.js', () => publisher);

const { richMenuGroups } = await import('./rich-menu-groups.js');

const group = {
  id: 'g1', account_id: 'a1', name: 'menu', chat_bar_text: 'menu', size: 'large', default_page_id: null,
  is_default_for_all: 0, status: 'draft', targeting_condition: null, targeting_priority: 0, targeting_enabled: 0,
  folder_id: null, display_order: 0, created_at: '', updated_at: '', pages: [{
    id: 'p1', order_index: 0, name: 'page', alias_id: 'alias', line_richmenu_id: 'old', image_r2_key: 'image', image_content_type: 'image/png', areas: [],
  }],
};

function app() {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => { c.set('staff', { id: 's1', role: 'owner' }); c.env = { DB: {}, IMAGES: { get: vi.fn() } }; await next(); });
  instance.route('/', richMenuGroups);
  return instance;
}
function post() { return app().request('/api/rich-menu-groups/g1/publish', { method: 'POST', headers: { 'Idempotency-Key': 'key-1' } }); }

describe('手動公開のroute冪等性', () => {
  let request: { id: string; status: 'running' | 'failed' | 'succeeded'; result_json?: string };
  let shells: Array<{ request_id: string; page_id: string; order_index: number; new_richmenu_id: string; old_richmenu_id: string | null }>;
  beforeEach(() => {
    vi.clearAllMocks(); request = { id: 'r1', status: 'running' }; shells = [];
    db.getRichMenuGroupWithPages.mockResolvedValue(group); db.getLineAccountById.mockResolvedValue({ channel_access_token: 'token' });
    db.createRichMenuManualPublishRequestAtomic.mockImplementation(async () => ({ outcome: request.status === 'running' && !request.result_json ? 'created' : 'existing', request }));
    db.getRichMenuManualPublishRequest.mockImplementation(async () => request);
    db.getRichMenuManualPublishShells.mockImplementation(async () => shells);
    db.recordRichMenuManualPublishShells.mockImplementation(async (_db: unknown, requestId: string, rows: any[]) => { shells = rows.map((row) => ({ request_id: requestId, page_id: row.pageId, order_index: row.orderIndex, new_richmenu_id: row.newRichMenuId, old_richmenu_id: row.oldRichMenuId })); });
    db.markRichMenuManualPublishSucceeded.mockImplementation(async (_db: unknown, _id: string, result: string) => { request.status = 'succeeded'; request.result_json = result; });
    db.markRichMenuManualPublishFailed.mockImplementation(async () => { request.status = 'failed'; });
    db.restartRichMenuManualPublishRequest.mockImplementation(async () => { request.status = 'running'; return true; });
    db.isPublishLeaseHeld.mockResolvedValue(false); db.acquirePublishLease.mockResolvedValue(1); db.renewPublishLease.mockResolvedValue(true); db.releasePublishLease.mockResolvedValue(true); db.setPageRichMenuId.mockResolvedValue(true); db.markRichMenuGroupPublished.mockResolvedValue(true);
    publisher.createRichMenuShells.mockResolvedValue({ shells: [{ pageId: 'p1', orderIndex: 0, newRichMenuId: 'new-1' }] }); publisher.switchRichMenuLive.mockResolvedValue(undefined); publisher.deleteRichMenuShells.mockResolvedValue(undefined);
  });

  it('同key同内容の同時要求は2本目を409にし、完了後の再試行はLINEを再実行せず再生する', async () => {
    db.isPublishLeaseHeld.mockResolvedValueOnce(true);
    await expect(post()).resolves.toHaveProperty('status', 409);
    expect(publisher.createRichMenuShells).not.toHaveBeenCalled();
    db.isPublishLeaseHeld.mockResolvedValue(false);
    await expect(post()).resolves.toHaveProperty('status', 200);
    expect(publisher.createRichMenuShells).toHaveBeenCalledTimes(1);
    const replay = await post();
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    expect(publisher.createRichMenuShells).toHaveBeenCalledTimes(1);
  });

  it('lease取得直前に先行要求が成功した競合でも、再読してLINEを再実行しない', async () => {
    // 最初のreadは古いrunning、lease取得後のreadだけ先行要求のsucceededを見る。
    db.getRichMenuManualPublishRequest.mockResolvedValue({
      id: 'r1', status: 'succeeded', result_json: JSON.stringify({ pages: [{ pageId: 'p1', newRichMenuId: 'new-1' }] }),
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get('Idempotency-Replayed')).toBe('true');
    expect(publisher.createRichMenuShells).not.toHaveBeenCalled();
    expect(publisher.switchRichMenuLive).not.toHaveBeenCalled();
  });

  it('shell作成後の切替失敗は同key再試行で作り直さずjournalのshellを使う', async () => {
    publisher.switchRichMenuLive.mockRejectedValueOnce(new Error('LINE unavailable'));
    await expect(post()).resolves.toHaveProperty('status', 500);
    expect(shells).toHaveLength(1);
    await expect(post()).resolves.toHaveProperty('status', 200);
    expect(publisher.createRichMenuShells).toHaveBeenCalledTimes(1);
    expect(publisher.switchRichMenuLive).toHaveBeenCalledTimes(2);
  });
});
