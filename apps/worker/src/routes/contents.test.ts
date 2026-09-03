import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getMedia: vi.fn(),
  getMediaById: vi.fn(),
  createMedia: vi.fn(),
  updateMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMediaUsages: vi.fn(),
  countMediaUsages: vi.fn(),
  getMediaDeleteImpact: vi.fn(),
  getMediaReplacementPlan: vi.fn(),
  applyMediaReplacementPlan: vi.fn(),
  jstNow: vi.fn(() => '2026-08-31T10:00:00.000+09:00'),
  getCommonVars: vi.fn(),
  getCommonVarById: vi.fn(),
  createCommonVar: vi.fn(),
  updateCommonVar: vi.fn(),
  deleteCommonVar: vi.fn(),
  getCommonVarUsageImpact: vi.fn(),
  getCommonVarSchedules: vi.fn(),
  createCommonVarSchedule: vi.fn(),
  deleteCommonVarSchedule: vi.fn(),
  COMMON_VAR_TYPES: ['text', 'url', 'image', 'number'],
  validateFieldKey: (key: unknown) =>
    typeof key === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(key) && key !== 'name'
      ? { ok: true as const }
      : { ok: false as const, error: 'bad key' },
};
vi.mock('@line-crm/db', () => mocks);
const accessMocks = { canAccessAllLineAccounts: vi.fn(async () => true) };
vi.mock('../services/account-access.js', () => accessMocks);
const scanMocks = { scanSingleMediaUsage: vi.fn() };
vi.mock('../services/media-usage-scan.js', () => scanMocks);

const { contents } = await import('./contents.js');

// R2 の put/delete は Promise を返す。undefined を返すモックにすると、
// 実装の .catch() が落ちて本物と違う結果になる。
const put = vi.fn().mockResolvedValue(undefined);
const del = vi.fn().mockResolvedValue(undefined);
const env = {
  DB: {} as D1Database,
  IMAGES: { put, delete: del } as unknown as R2Bucket,
  WORKER_URL: 'https://api.example.com',
};

function makeApp(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role, readOnly: false });
    return next();
  });
  app.route('/', contents);
  return app;
}

function req(path: string, method: string, body?: unknown, role: 'owner' | 'admin' | 'staff' = 'owner') {
  return makeApp(role).fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env as unknown as Env['Bindings'],
  );
}

const MEDIA = {
  id: 'md-1',
  line_account_id: 'account-1',
  folder_id: null,
  kind: 'image',
  filename: 'a.png',
  mime_type: 'image/png',
  size_bytes: 100,
  width: null,
  height: null,
  duration_ms: null,
  r2_key: 'media/xxx.png',
  public_url: null,
  uploaded_by: 'u-1',
  created_at: '2026-08-16',
  usage_count: 3,
};

const DELETE_IMPACT = {
  media: { id: 'md-1', filename: 'a.png', kind: 'image' },
  usageCount: 0,
  references: [],
  checkedAt: '2026-08-31T10:00:00.000',
  lastScannedAt: null,
  canDelete: true,
  recommendedAction: 'delete',
};

const REPLACEMENT_PLAN = {
  source: MEDIA,
  replacement: {
    ...MEDIA,
    id: 'md-2',
    filename: 'b.png',
    r2_key: 'media/yyy.png',
  },
  usages: [{
    media_id: 'md-1',
    ref_kind: 'template',
    ref_id: 'template-1',
    scanned_at: '2026-08-31T10:00:00.000',
  }],
  impact: {
    source: { id: 'md-1', filename: 'a.png', kind: 'image' },
    replacement: { id: 'md-2', filename: 'b.png', kind: 'image' },
    usageCount: 1,
    replaceableCount: 1,
    references: [{
      kind: 'template',
      name: '来店後のご案内',
      href: '/templates/edit?id=template-1',
      state: 'available',
      scannedAt: '2026-08-31T10:00:00.000',
      replaceable: true,
      blocker: null,
      reason: null,
    }],
    blockers: [],
    canReplace: true,
    checkedAt: '2026-08-31T10:00:00.000+09:00',
  },
};

const VAR = {
  id: 'cv-1',
  line_account_id: 'account-1',
  folder_id: null,
  name: '営業時間',
  var_key: 'shop_hours',
  type: 'text',
  value: '10-19',
  created_at: '2026-08-16',
  updated_at: '2026-08-16',
};

const EMPTY_COMMON_VAR_IMPACT = {
  total: 0,
  blockingTotal: 0,
  historicalTotal: 0,
  unscopedFormTotal: 0,
  byKind: {
    template: 0,
    broadcast: 0,
    scenario: 0,
    reminder: 0,
    auto_reply: 0,
    form: 0,
    automation: 0,
  },
  items: [],
};

/** 1x1 の PNG。中身は問わないので短い base64 で足りる。 */
const TINY_PNG = 'iVBORw0KGgo=';

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue(undefined);
  del.mockResolvedValue(undefined);
  accessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  scanMocks.scanSingleMediaUsage.mockResolvedValue({ scanned: 1, matched: 0, pruned: 0 });
  mocks.getMedia.mockResolvedValue([MEDIA]);
  mocks.getMediaById.mockResolvedValue(MEDIA);
  mocks.createMedia.mockResolvedValue(MEDIA);
  mocks.updateMedia.mockResolvedValue(MEDIA);
  mocks.countMediaUsages.mockResolvedValue(0);
  mocks.getMediaUsages.mockResolvedValue([]);
  mocks.getMediaDeleteImpact.mockResolvedValue(DELETE_IMPACT);
  mocks.getMediaReplacementPlan.mockResolvedValue(REPLACEMENT_PLAN);
  mocks.applyMediaReplacementPlan.mockResolvedValue(1);
  mocks.getCommonVars.mockResolvedValue([VAR]);
  mocks.getCommonVarById.mockResolvedValue(VAR);
  mocks.createCommonVar.mockResolvedValue(VAR);
  mocks.updateCommonVar.mockResolvedValue(VAR);
  mocks.getCommonVarUsageImpact.mockResolvedValue(EMPTY_COMMON_VAR_IMPACT);
  mocks.createCommonVarSchedule.mockResolvedValue({
    id: 'sc-1',
    var_id: 'cv-1',
    effective_from: '2099-01-01T00:00',
    value: 'x',
    applied_at: null,
  });
});

describe('メディアのアップロード', () => {
  it('一覧に使用先件数を含める', async () => {
    const res = await req('/api/media?accountId=account-1', 'GET');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ usageCount: number }> };
    expect(body.data[0]?.usageCount).toBe(3);
    expect(mocks.getMedia).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-1',
      kind: undefined,
      folderId: undefined,
    });
  });

  it('LINEアカウントを指定しない一覧取得は止める', async () => {
    const res = await req('/api/media', 'GET');
    expect(res.status).toBe(400);
    expect(mocks.getMedia).not.toHaveBeenCalled();
  });

  it('権限のないLINEアカウントは存在も返さない', async () => {
    accessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const res = await req('/api/media?accountId=other', 'GET');
    expect(res.status).toBe(404);
    expect(mocks.getMedia).not.toHaveBeenCalled();
  });

  it('形式と拡張子が揃っていれば通る', async () => {
    const res = await req('/api/media', 'POST', {
      accountId: 'account-1',
      filename: 'a.png',
      mimeType: 'image/png',
      data: TINY_PNG,
    });
    expect(res.status).toBe(201);
    expect(put).toHaveBeenCalled();
  });

  it('対応していない形式は弾く', async () => {
    const res = await req('/api/media', 'POST', {
      accountId: 'account-1',
      filename: 'a.exe',
      mimeType: 'application/x-msdownload',
      data: TINY_PNG,
    });
    expect(res.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  it('中身と拡張子が食い違えば弾く', async () => {
    // MIMEだけだと送る側が名乗った値をそのまま信じることになり、
    // 拡張子だけだと中身が違うものを .png と名付けるだけで通る。
    const res = await req('/api/media', 'POST', {
      accountId: 'account-1',
      filename: 'a.txt',
      mimeType: 'image/png',
      data: TINY_PNG,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('拡張子');
    expect(put).not.toHaveBeenCalled();
  });

  it('ブラウザがPNGと申告しても実ファイルが違えば弾く', async () => {
    const res = await req('/api/media', 'POST', {
      accountId: 'account-1',
      filename: 'a.png',
      mimeType: 'image/png',
      data: btoa('not png'),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('実際の形式') });
    expect(put).not.toHaveBeenCalled();
  });

  it('data: URL の種別を優先する', async () => {
    const res = await req('/api/media', 'POST', {
      accountId: 'account-1',
      filename: 'a.png',
      data: `data:image/png;base64,${TINY_PNG}`,
    });
    expect(res.status).toBe(201);
  });

  it('大きすぎるファイルは 413', async () => {
    // 11MB ぶんの base64。上限は画像 10MB。
    const big = 'A'.repeat(11 * 1024 * 1024 * 2);
    const res = await req('/api/media', 'POST', {
      accountId: 'account-1',
      filename: 'a.png',
      mimeType: 'image/png',
      data: big,
    });
    expect(res.status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it('ファイル名が無ければ弾く', async () => {
    const res = await req('/api/media', 'POST', { accountId: 'account-1', mimeType: 'image/png', data: TINY_PNG });
    expect(res.status).toBe(400);
  });

  it('R2保存後にDB登録が失敗したら孤児ファイルを消す', async () => {
    mocks.createMedia.mockRejectedValueOnce(new Error('D1 unavailable'));
    const res = await req('/api/media', 'POST', {
      accountId: 'account-1',
      filename: 'a.png',
      mimeType: 'image/png',
      data: TINY_PNG,
    });
    expect(res.status).toBe(500);
    expect(put).toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith(expect.stringMatching(/^media\/.+\.png$/));
  });
});

describe('メディアの削除', () => {
  it('影響確認は使用先の名前と導線を返す', async () => {
    mocks.getMediaDeleteImpact.mockResolvedValue({
      ...DELETE_IMPACT,
      usageCount: 1,
      canDelete: false,
      recommendedAction: 'review_references',
      lastScannedAt: '2026-08-31T10:00:00.000',
      references: [{
        kind: 'broadcast',
        name: '来店後のご案内',
        href: '/broadcasts/detail?id=broadcast-1',
        state: 'available',
        scannedAt: '2026-08-31T10:00:00.000',
      }],
    });
    const res = await req('/api/media/md-1/delete-impact?accountId=account-1', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: {
        usageCount: 1,
        references: [{ name: '来店後のご案内' }],
        canDelete: false,
      },
    });
  });

  it('影響を取得できないときは0件を作らず503', async () => {
    scanMocks.scanSingleMediaUsage.mockRejectedValueOnce(new Error('D1 unavailable'));
    const res = await req('/api/media/md-1/delete-impact?accountId=account-1', 'GET');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      success: false,
      error: '削除したときの影響を確認できませんでした',
    });
  });

  it('使われていれば最新の影響を返して止める', async () => {
    mocks.getMediaDeleteImpact.mockResolvedValue({
      ...DELETE_IMPACT,
      usageCount: 5,
      canDelete: false,
      recommendedAction: 'review_references',
    });
    const res = await req('/api/media/md-1?accountId=account-1', 'DELETE');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; data: { usageCount: number } };
    expect(body.code).toBe('media_delete_blocked');
    expect(body.data.usageCount).toBe(5);
    expect(mocks.deleteMedia).not.toHaveBeenCalled();
  });

  it('force=1 を付けても使用中は消さない', async () => {
    mocks.getMediaDeleteImpact.mockResolvedValue({
      ...DELETE_IMPACT,
      usageCount: 5,
      canDelete: false,
      recommendedAction: 'review_references',
    });
    const res = await req('/api/media/md-1?accountId=account-1&force=1', 'DELETE');
    expect(res.status).toBe(409);
    expect(mocks.deleteMedia).not.toHaveBeenCalled();
  });

  it('削除時に影響を読み直せなければ削除しない', async () => {
    scanMocks.scanSingleMediaUsage.mockRejectedValueOnce(new Error('D1 unavailable'));
    const res = await req('/api/media/md-1?accountId=account-1', 'DELETE');
    expect(res.status).toBe(503);
    expect(mocks.deleteMedia).not.toHaveBeenCalled();
  });

  it('DBの行を先に消す', async () => {
    // 逆にすると「行はあるが実体が無い」状態になる。この順なら
    // 孤児のファイルが残るだけで、画面には出てこない。
    await req('/api/media/md-1?accountId=account-1', 'DELETE');
    expect(mocks.deleteMedia).toHaveBeenCalledWith(env.DB, 'md-1', 'account-1');
  });
});

describe('メディア使用先の一括差し替え', () => {
  async function currentRevision(): Promise<string> {
    const response = await req(
      '/api/media/md-1/replacement-impact?accountId=account-1&replacementId=md-2',
      'GET',
    );
    const body = (await response.json()) as { data: { revision: string } };
    return body.data.revision;
  }

  it('内部IDを返さず、差し替え可否と改版値を返す', async () => {
    const response = await req(
      '/api/media/md-1/replacement-impact?accountId=account-1&replacementId=md-2',
      'GET',
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { revision: string; references: unknown[] } };
    expect(body.data.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.references).toEqual([
      expect.objectContaining({ name: '来店後のご案内', replaceable: true }),
    ]);
    expect(body.data.references[0]).not.toHaveProperty('refId');
  });

  it('影響確認後に使用先が変わったら409で最新の影響を返す', async () => {
    const response = await req('/api/media/md-1/replace-usages?accountId=account-1', 'POST', {
      replacementMediaId: 'md-2',
      expectedRevision: 'old',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'media_replacement_changed',
      data: { usageCount: 1 },
    });
    expect(mocks.applyMediaReplacementPlan).not.toHaveBeenCalled();
  });

  it('共有など差し替え不能の使用先が1件でもあれば全体を止める', async () => {
    mocks.getMediaReplacementPlan.mockResolvedValueOnce({
      ...REPLACEMENT_PLAN,
      impact: {
        ...REPLACEMENT_PLAN.impact,
        canReplace: false,
        replaceableCount: 0,
        blockers: ['shared_reference'],
      },
    });
    const revision = await currentRevision();
    mocks.getMediaReplacementPlan.mockResolvedValueOnce({
      ...REPLACEMENT_PLAN,
      impact: {
        ...REPLACEMENT_PLAN.impact,
        canReplace: false,
        replaceableCount: 0,
        blockers: ['shared_reference'],
      },
    });
    const response = await req('/api/media/md-1/replace-usages?accountId=account-1', 'POST', {
      replacementMediaId: 'md-2',
      expectedRevision: revision,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'media_replacement_blocked' });
    expect(mocks.applyMediaReplacementPlan).not.toHaveBeenCalled();
  });

  it('実行直前に同じ改版値を照合してからD1の差し替えを呼ぶ', async () => {
    const revision = await currentRevision();
    const response = await req('/api/media/md-1/replace-usages?accountId=account-1', 'POST', {
      replacementMediaId: 'md-2',
      expectedRevision: revision,
    });
    expect(response.status).toBe(200);
    expect(mocks.applyMediaReplacementPlan).toHaveBeenCalledWith(env.DB, REPLACEMENT_PLAN, 'account-1');
    expect(await response.json()).toMatchObject({
      data: {
        replacedUsageCount: 1,
        remainingUsageCount: 0,
        verification: 'verified',
      },
    });
  });

  it('本文が16KiBを超えたら読む前後の両方で413', async () => {
    const response = await req('/api/media/md-1/replace-usages?accountId=account-1', 'POST', {
      replacementMediaId: 'md-2',
      expectedRevision: 'x'.repeat(17 * 1024),
    });
    expect(response.status).toBe(413);
    expect(mocks.getMediaReplacementPlan).not.toHaveBeenCalled();
  });

  it('確認の再走査に失敗したとき0件を作らない', async () => {
    const revision = await currentRevision();
    scanMocks.scanSingleMediaUsage
      .mockResolvedValueOnce({ scanned: 1, matched: 1, pruned: 0 })
      .mockRejectedValueOnce(new Error('D1 unavailable'))
      .mockResolvedValueOnce({ scanned: 1, matched: 1, pruned: 0 });
    const response = await req('/api/media/md-1/replace-usages?accountId=account-1', 'POST', {
      replacementMediaId: 'md-2',
      expectedRevision: revision,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { remainingUsageCount: null, verification: 'unavailable' },
    });
  });
});

describe('共通情報', () => {
  it('LINEアカウントを指定しない一覧取得は止める', async () => {
    const res = await req('/api/common-vars', 'GET');
    expect(res.status).toBe(400);
    expect(mocks.getCommonVars).not.toHaveBeenCalled();
  });

  it('権限のないLINEアカウントは存在も返さない', async () => {
    accessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const res = await req('/api/common-vars?accountId=other', 'GET');
    expect(res.status).toBe(404);
    expect(mocks.getCommonVars).not.toHaveBeenCalled();
  });

  it('一覧は選択中のLINEアカウントで絞る', async () => {
    const res = await req('/api/common-vars?accountId=account-1', 'GET');
    expect(res.status).toBe(200);
    expect(mocks.getCommonVars).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-1',
      folderId: undefined,
    });
  });

  it('差し込み名の形が違えば422', async () => {
    const res = await req('/api/common-vars', 'POST', { accountId: 'account-1', name: 'x', varKey: '営業時間' });
    expect(res.status).toBe(422);
    expect(mocks.createCommonVar).not.toHaveBeenCalled();
  });

  it('差し込み名の決まりは友だち情報欄と同じ', async () => {
    // 片方だけ緩めると「情報欄では使えないのに共通情報では使える名前」ができる。
    const res = await req('/api/common-vars', 'POST', { accountId: 'account-1', name: 'x', varKey: 'name' });
    expect(res.status).toBe(422);
  });

  it('重複したら409', async () => {
    mocks.createCommonVar.mockRejectedValue(new Error('UNIQUE constraint failed'));
    const res = await req('/api/common-vars', 'POST', { accountId: 'account-1', name: 'x', varKey: 'dup' });
    expect(res.status).toBe(409);
  });

  it('差し込み名は変えられない', async () => {
    const res = await req('/api/common-vars/cv-1?accountId=account-1', 'PATCH', { varKey: 'other' });
    expect(res.status).toBe(422);
    expect(mocks.updateCommonVar).not.toHaveBeenCalled();
  });

  it('値だけの変更は通る', async () => {
    const res = await req('/api/common-vars/cv-1?accountId=account-1', 'PATCH', { value: '11-20' });
    expect(res.status).toBe(200);
  });

  it('削除影響は運用者向けの名前と導線を返し、内部IDの専用項目を作らない', async () => {
    mocks.getCommonVarUsageImpact.mockResolvedValue({
      ...EMPTY_COMMON_VAR_IMPACT,
      total: 1,
      blockingTotal: 1,
      byKind: { ...EMPTY_COMMON_VAR_IMPACT.byKind, template: 1 },
      items: [{
        kind: 'template',
        source_id: 'template-1',
        source_parent_id: null,
        source_name: '来店後のご案内',
        source_status: 'active',
        source_content: '営業時間は{{var.shop_hours}}です',
        is_historical: 0,
      }],
    });
    const res = await req('/api/common-vars/cv-1/delete-impact?accountId=account-1', 'GET');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> & { items: Record<string, unknown>[] } };
    expect(body.data).toMatchObject({
      variable: { id: 'cv-1', name: '営業時間', varKey: 'shop_hours' },
      total: 1,
      blockingTotal: 1,
      canDelete: false,
      recommendedAction: 'review_references',
      items: [{
        kindLabel: 'テンプレート',
        name: '来店後のご案内',
        href: '/templates/edit?id=template-1',
        currentPreview: '営業時間は10-19です',
      }],
    });
    expect(body.data.checkedAt).toEqual(expect.any(String));
    expect(body.data.items[0]).not.toHaveProperty('sourceId');
    expect(mocks.getCommonVarUsageImpact).toHaveBeenCalledWith(
      env.DB,
      'shop_hours',
      'account-1',
    );
  });

  it('共通情報を変更する操作は内部JSONを表示しない', async () => {
    mocks.getCommonVarUsageImpact.mockResolvedValue({
      ...EMPTY_COMMON_VAR_IMPACT,
      total: 1,
      blockingTotal: 1,
      byKind: { ...EMPTY_COMMON_VAR_IMPACT.byKind, friend_add: 1 },
      items: [{
        kind: 'friend_add',
        source_id: 'friend-add-setting',
        source_parent_id: null,
        source_name: '友だち追加時の設定',
        source_status: 'active',
        source_content: '{"actionType":"common_var","config":{"varKey":"shop_hours"}}',
        is_historical: 0,
      }],
    });

    const res = await req('/api/common-vars/cv-1/delete-impact?accountId=account-1', 'GET');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<Record<string, unknown>> } };
    expect(body.data.items[0]).toMatchObject({
      kindLabel: '友だち追加時の配信',
      href: '/friend-add-settings',
      currentPreview: 'この設定の中で使われています',
    });
    expect(JSON.stringify(body.data.items[0])).not.toContain('varKey');
    expect(JSON.stringify(body.data.items[0])).not.toContain('shop_hours');
  });

  it('所属不明の古いフォームは名前を返さず、件数だけで削除を止める', async () => {
    mocks.getCommonVarUsageImpact.mockResolvedValue({
      ...EMPTY_COMMON_VAR_IMPACT,
      total: 1,
      blockingTotal: 1,
      unscopedFormTotal: 1,
      byKind: { ...EMPTY_COMMON_VAR_IMPACT.byKind, form: 1 },
    });
    const res = await req('/api/common-vars/cv-1/delete-impact?accountId=account-1', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: {
        canDelete: false,
        items: [],
        unavailableReferences: [{ kind: 'form', count: 1 }],
      },
    });
  });

  it('影響を取得できないときは0件を作らず503', async () => {
    mocks.getCommonVarUsageImpact.mockRejectedValueOnce(new Error('D1 unavailable'));
    const res = await req('/api/common-vars/cv-1/delete-impact?accountId=account-1', 'GET');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      success: false,
      error: '使用先を確認できないため削除できません',
    });
  });

  it('変更前後の文と遷移先を、選択中アカウントの使用先だけで返す', async () => {
    mocks.getCommonVarUsageImpact.mockResolvedValue({
      ...EMPTY_COMMON_VAR_IMPACT,
      total: 2,
      blockingTotal: 1,
      historicalTotal: 1,
      byKind: { ...EMPTY_COMMON_VAR_IMPACT.byKind, template: 1, broadcast: 1 },
      items: [
        {
          kind: 'template', source_id: 'template-1', source_parent_id: null,
          source_name: '予約案内', source_status: 'active',
          source_content: JSON.stringify({ text: '受付は{{var.shop_hours}}です', secret: '画面へ出さない' }),
          is_historical: 0,
        },
        {
          kind: 'broadcast', source_id: 'broadcast-1', source_parent_id: null,
          source_name: '配信済み', source_status: 'sent',
          source_content: '{{var.shop_hours}}でした', is_historical: 1,
        },
      ],
    });

    const res = await req('/api/common-vars/cv-1/impact-preview', 'POST', {
      accountId: 'account-1', nextValue: '11-20',
    });

    expect(res.status).toBe(200);
    expect(mocks.getCommonVarUsageImpact).toHaveBeenCalledWith(env.DB, 'shop_hours', 'account-1');
    const text = await res.text();
    expect(text).not.toContain('画面へ出さない');
    expect(JSON.parse(text)).toMatchObject({
      data: {
        canSave: true,
        items: [
          {
            name: '予約案内', href: '/templates/edit?id=template-1',
            status: '使われています', changesOnSave: true,
            currentPreview: '受付は10-19です', nextPreview: '受付は11-20です',
          },
          {
            name: '配信済み', status: '送信済み・変わりません',
            changesOnSave: false, currentPreview: '10-19でした', nextPreview: '10-19でした',
          },
        ],
      },
    });
  });

  it.each([
    ['accountId不足', { nextValue: '11-20' }, 'accountId is required'],
    ['nextValue不足', { accountId: 'account-1' }, '変更後の値を入力してください'],
  ])('%sは400で返し、使用先を走査しない', async (_case, body, error) => {
    const res = await req('/api/common-vars/cv-1/impact-preview', 'POST', body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error });
    expect(mocks.getCommonVarUsageImpact).not.toHaveBeenCalled();
  });

  it('対象の共通情報が存在しないときは404で返し、使用先を走査しない', async () => {
    mocks.getCommonVarById.mockResolvedValue(null);

    const res = await req('/api/common-vars/missing/impact-preview', 'POST', {
      accountId: 'account-1', nextValue: '11-20',
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Not found' });
    expect(mocks.getCommonVarUsageImpact).not.toHaveBeenCalled();
  });

  it('変更後の空値とLINE文字数超過をエラーとして返す', async () => {
    mocks.getCommonVarUsageImpact.mockResolvedValue({
      ...EMPTY_COMMON_VAR_IMPACT,
      total: 1,
      blockingTotal: 1,
      byKind: { ...EMPTY_COMMON_VAR_IMPACT.byKind, template: 1 },
      items: [{
        kind: 'template', source_id: 'template-1', source_parent_id: null,
        source_name: '長い案内', source_status: 'active',
        source_content: '{{var.shop_hours}}', is_historical: 0,
      }],
    });

    const tooLong = await req('/api/common-vars/cv-1/impact-preview', 'POST', {
      accountId: 'account-1', nextValue: 'あ'.repeat(5_001),
    });
    expect(await tooLong.json()).toMatchObject({
      data: {
        canSave: false,
        errorTotal: 1,
        recommendedAction: 'fix_errors',
        items: [{
          nextCharacterCount: 5_001,
          characterLimit: 5_000,
          exceedsCharacterLimit: true,
        }],
      },
    });

    const empty = await req('/api/common-vars/cv-1/impact-preview', 'POST', {
      accountId: 'account-1', nextValue: '',
    });
    expect(await empty.json()).toMatchObject({
      data: { canSave: false, items: [{ errors: ['変更後の値が空になります'] }] },
    });
  });

  it('変更影響も権限外アカウントの存在と使用先を返さない', async () => {
    accessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const res = await req('/api/common-vars/cv-1/impact-preview', 'POST', {
      accountId: 'other', nextValue: '11-20',
    });
    expect(res.status).toBe(404);
    expect(mocks.getCommonVarById).not.toHaveBeenCalled();
    expect(mocks.getCommonVarUsageImpact).not.toHaveBeenCalled();
  });

  it('スタッフ権限では変更影響の本文を返さない', async () => {
    const res = await req('/api/common-vars/cv-1/impact-preview', 'POST', {
      accountId: 'account-1', nextValue: '11-20',
    }, 'staff');
    expect(res.status).toBe(403);
    expect(mocks.getCommonVarById).not.toHaveBeenCalled();
    expect(mocks.getCommonVarUsageImpact).not.toHaveBeenCalled();
  });

  it('変更影響の走査失敗を0件にせず503で返す', async () => {
    mocks.getCommonVarUsageImpact.mockRejectedValueOnce(new Error('D1 unavailable'));
    const res = await req('/api/common-vars/cv-1/impact-preview', 'POST', {
      accountId: 'account-1', nextValue: '11-20',
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: '影響する場所を確認できませんでした' });
  });

  it('使用中の共通情報はAPIを直接呼んでも削除できない', async () => {
    mocks.getCommonVarUsageImpact.mockResolvedValue({
      ...EMPTY_COMMON_VAR_IMPACT,
      total: 3,
      blockingTotal: 3,
      byKind: { ...EMPTY_COMMON_VAR_IMPACT.byKind, template: 2, broadcast: 1 },
    });
    const res = await req('/api/common-vars/cv-1?accountId=account-1', 'DELETE');
    expect(res.status).toBe(409);
    expect(mocks.deleteCommonVar).not.toHaveBeenCalled();
    expect(mocks.getCommonVarUsageImpact).toHaveBeenCalledWith(env.DB, 'shop_hours', 'account-1');
    expect(await res.json()).toMatchObject({
      code: 'common_var_delete_blocked',
      data: { total: 3, canDelete: false },
    });
  });

  it('使用先を確認できないときは0件扱いせず削除を止める', async () => {
    mocks.getCommonVarUsageImpact.mockRejectedValue(new Error('D1 unavailable'));
    const res = await req('/api/common-vars/cv-1?accountId=account-1', 'DELETE');
    expect(res.status).toBe(503);
    expect(mocks.deleteCommonVar).not.toHaveBeenCalled();
  });

  it('未使用なら影響確認後に削除できる', async () => {
    const res = await req('/api/common-vars/cv-1?accountId=account-1', 'DELETE');
    expect(res.status).toBe(200);
    expect(mocks.deleteCommonVar).toHaveBeenCalledWith(env.DB, 'cv-1', 'account-1');
  });

  it('送信済み配信だけなら履歴を残したまま削除できる', async () => {
    mocks.getCommonVarUsageImpact.mockResolvedValue({
      ...EMPTY_COMMON_VAR_IMPACT,
      total: 1,
      historicalTotal: 1,
      byKind: { ...EMPTY_COMMON_VAR_IMPACT.byKind, broadcast: 1 },
      items: [{
        kind: 'broadcast', source_id: 'broadcast-1', source_parent_id: null,
        source_name: '過去のお知らせ', source_status: 'sent',
        source_content: '{{var.shop_hours}}でした', is_historical: 1,
      }],
    });
    const res = await req('/api/common-vars/cv-1?accountId=account-1', 'DELETE');
    expect(res.status).toBe(200);
    expect(mocks.deleteCommonVar).toHaveBeenCalled();
  });
});

describe('日付での切り替え', () => {
  it('未来の日時なら予約できる', async () => {
    const res = await req('/api/common-vars/cv-1/schedules?accountId=account-1', 'POST', {
      effectiveFrom: '2099-01-01T00:00',
      value: '新しい値',
    });
    expect(res.status).toBe(201);
  });

  it('過去の日時は受け付けない', async () => {
    // 入れた瞬間に次のCronで当たり、「予約したつもりが今すぐ変わった」になる。
    const res = await req('/api/common-vars/cv-1/schedules?accountId=account-1', 'POST', {
      effectiveFrom: '2020-01-01T00:00',
      value: 'x',
    });
    expect(res.status).toBe(400);
    expect(mocks.createCommonVarSchedule).not.toHaveBeenCalled();
  });

  it('日時の形が違えば弾く', async () => {
    const res = await req('/api/common-vars/cv-1/schedules?accountId=account-1', 'POST', {
      effectiveFrom: '2099年1月1日',
      value: 'x',
    });
    expect(res.status).toBe(400);
  });
});
