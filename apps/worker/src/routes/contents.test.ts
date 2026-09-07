import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

class MockCommonVarVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super('conflict');
  }
}

class MockMediaVersionConflictError extends Error {
  constructor(readonly currentVersionNo: number) {
    super('conflict');
  }
}

const mocks = {
  getMedia: vi.fn(),
  countMedia: vi.fn(),
  getMediaById: vi.fn(),
  createMedia: vi.fn(),
  updateMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMediaUsages: vi.fn(),
  countMediaUsages: vi.fn(),
  getMediaDeleteImpact: vi.fn(),
  getMediaReplacementPlan: vi.fn(),
  applyMediaReplacementPlan: vi.fn(),
  getMediaStorageQuota: vi.fn(),
  createMediaUploadSession: vi.fn(),
  getMediaUploadSession: vi.fn(),
  failMediaUploadSession: vi.fn(),
  verifyMediaUploadSession: vi.fn(),
  completeNewMediaUpload: vi.fn(),
  createMediaVersionFromUpload: vi.fn(),
  getCurrentMediaVersionNo: vi.fn(),
  MediaVersionConflictError: MockMediaVersionConflictError,
  jstNow: vi.fn(() => '2026-08-31T10:00:00.000+09:00'),
  getCommonVars: vi.fn(),
  getCommonVarUsageSummaries: vi.fn(),
  getCommonVarById: vi.fn(),
  createCommonVar: vi.fn(),
  updateCommonVar: vi.fn(),
  deleteCommonVar: vi.fn(),
  getCommonVarUsageImpact: vi.fn(),
  getCommonVarVersions: vi.fn(),
  getCommonVarReplacementCandidates: vi.fn(),
  getCommonVarReplacementPlan: vi.fn(),
  applyCommonVarReplacementPlan: vi.fn(),
  CommonVarVersionConflictError: MockCommonVarVersionConflictError,
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
const signingMocks = { createR2PresignedPutUrl: vi.fn() };
vi.mock('../services/r2-presigned-upload.js', () => signingMocks);

const { contents } = await import('./contents.js');

// R2 の put/delete は Promise を返す。undefined を返すモックにすると、
// 実装の .catch() が落ちて本物と違う結果になる。
const put = vi.fn().mockResolvedValue(undefined);
const del = vi.fn().mockResolvedValue(undefined);
const head = vi.fn();
const get = vi.fn();
const env = {
  DB: {} as D1Database,
  IMAGES: { put, delete: del, head, get } as unknown as R2Bucket,
  WORKER_URL: 'https://api.example.com',
  CF_ACCOUNT_ID: 'cf-account',
  MEDIA_R2_ACCESS_KEY_ID: 'access-key',
  MEDIA_R2_SECRET_ACCESS_KEY: 'secret-key',
  MEDIA_R2_BUCKET_NAME: 'media-bucket',
};

function makeApp(role: 'owner' | 'admin' | 'staff' | null = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (role) c.set('staff', { id: 'u-1', name: 'テスト', role, readOnly: false });
    return next();
  });
  app.route('/', contents);
  return app;
}

function req(
  path: string,
  method: string,
  body?: unknown,
  role: 'owner' | 'admin' | 'staff' | null = 'owner',
) {
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

const QUOTA = {
  usageBytes: 100,
  reservedBytes: 0,
  limitBytes: 1000,
  remainingBytes: 900,
  usageRate: 0.1,
  state: 'normal',
};

const UPLOAD_SESSION = {
  id: 'upload-1',
  line_account_id: 'account-1',
  target_media_id: null,
  result_media_id: null,
  folder_id: null,
  filename: 'a.png',
  kind: 'image',
  expected_mime: 'image/png',
  expected_size: 8,
  r2_key: 'media/account-1/a.png',
  status: 'pending',
  failure_code: null,
  etag: null,
  expires_at: '2099-01-01T00:00:00.000Z',
  created_by: 'u-1',
  created_at: '2026-09-07T00:00:00.000Z',
  completed_at: null,
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
  memo: '店舗共通の営業時間',
  version: 3,
  updated_by: 'u-1',
  archived_at: null,
  replacement_run_id: null,
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
    friend_add: 0,
    common_action: 0,
  },
  items: [],
};

/** 1x1 の PNG。中身は問わないので短い base64 で足りる。 */
const TINY_PNG = 'iVBORw0KGgo=';

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue(undefined);
  del.mockResolvedValue(undefined);
  head.mockResolvedValue({
    size: 8,
    etag: 'etag-1',
    httpMetadata: { contentType: 'image/png' },
    customMetadata: {
      'line-account-id': 'account-1',
      'upload-session-id': 'upload-1',
    },
  });
  get.mockResolvedValue({
    arrayBuffer: async () => Uint8Array.from(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ).buffer,
  });
  accessMocks.canAccessAllLineAccounts.mockResolvedValue(true);
  scanMocks.scanSingleMediaUsage.mockResolvedValue({ scanned: 1, matched: 0, pruned: 0 });
  mocks.getMedia.mockResolvedValue([MEDIA]);
  mocks.countMedia.mockResolvedValue(1);
  mocks.getMediaById.mockResolvedValue(MEDIA);
  mocks.createMedia.mockResolvedValue(MEDIA);
  mocks.updateMedia.mockResolvedValue(MEDIA);
  mocks.countMediaUsages.mockResolvedValue(0);
  mocks.getMediaUsages.mockResolvedValue([]);
  mocks.getMediaDeleteImpact.mockResolvedValue(DELETE_IMPACT);
  mocks.getMediaReplacementPlan.mockResolvedValue(REPLACEMENT_PLAN);
  mocks.applyMediaReplacementPlan.mockResolvedValue(1);
  mocks.getMediaStorageQuota.mockResolvedValue(QUOTA);
  mocks.createMediaUploadSession.mockResolvedValue(UPLOAD_SESSION);
  mocks.getMediaUploadSession.mockResolvedValue(UPLOAD_SESSION);
  mocks.verifyMediaUploadSession.mockResolvedValue({
    ...UPLOAD_SESSION, status: 'verified', etag: 'etag-1',
  });
  mocks.completeNewMediaUpload.mockResolvedValue(MEDIA);
  mocks.createMediaVersionFromUpload.mockResolvedValue({
    id: 'version-2', media_id: 'md-1', version_no: 2,
    mime_type: 'image/png', size_bytes: 8, change_reason: 'ロゴを更新',
    created_at: '2026-09-07T00:00:00.000Z',
  });
  mocks.getCurrentMediaVersionNo.mockResolvedValue(1);
  signingMocks.createR2PresignedPutUrl.mockResolvedValue({
    url: 'https://r2.example.com/upload?signature=hidden',
    headers: {
      'Content-Type': 'image/png',
      'x-amz-meta-line-account-id': 'account-1',
      'x-amz-meta-upload-session-id': 'upload-1',
    },
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
  mocks.getCommonVars.mockResolvedValue([VAR]);
  mocks.getCommonVarUsageSummaries.mockResolvedValue(new Map([['shop_hours', {
    total: 3,
    byKind: { ...EMPTY_COMMON_VAR_IMPACT.byKind, template: 2, broadcast: 1 },
  }]]));
  mocks.getCommonVarById.mockImplementation(async (_db: D1Database, id: string) =>
    id === 'cv-2'
      ? { ...VAR, id: 'cv-2', name: '新営業時間', var_key: 'new_hours', value: '11-20', version: 1 }
      : VAR);
  mocks.createCommonVar.mockResolvedValue(VAR);
  mocks.updateCommonVar.mockResolvedValue(VAR);
  mocks.getCommonVarUsageImpact.mockResolvedValue(EMPTY_COMMON_VAR_IMPACT);
  mocks.getCommonVarVersions.mockResolvedValue([{
    id: 'cv-1-v3', common_var_id: 'cv-1', version_no: 3,
    name: '営業時間', value: '10-19', memo: '店舗共通の営業時間',
    change_reason: '営業時間を更新', actor_id: 'u-1', actor_name: '川野 健太', created_at: '2026-08-16',
  }]);
  mocks.getCommonVarReplacementCandidates.mockResolvedValue([{
    ...VAR, id: 'cv-2', name: '新営業時間', var_key: 'new_hours', value: '11-20', version: 1,
  }]);
  mocks.getCommonVarReplacementPlan.mockResolvedValue({
    source: VAR,
    replacement: { ...VAR, id: 'cv-2', name: '新営業時間', var_key: 'new_hours', version: 1 },
    targets: [{
      table: 'templates', id: 'template-1', kind: 'template',
      columns: { message_content: '{{var.new_hours}}' },
      originalColumns: { message_content: '{{var.shop_hours}}' },
      fingerprint: '{{var.shop_hours}}',
    }],
    usageTotal: 1,
    replaceableTotal: 1,
    blockedTotal: 0,
    historicalTotal: 0,
    unscopedFormTotal: 0,
  });
  mocks.applyCommonVarReplacementPlan.mockResolvedValue({
    runId: 'replace-1', replacedUsageCount: 1, archivedVersion: 4,
  });
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
    const body = (await res.json()) as { data: { items: Array<{ usageCount: number }>; total: number } };
    expect(body.data.items[0]?.usageCount).toBe(3);
    expect(body.data.total).toBe(1);
    expect(mocks.getMedia).toHaveBeenCalledWith(env.DB, {
      lineAccountId: 'account-1',
      kind: undefined,
      folderId: undefined,
      excludeId: undefined,
      query: undefined,
      unusedOnly: false,
      nearLimitOnly: false,
      sort: 'newest',
      limit: 20,
      offset: 0,
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

describe('メディアの容量・直接アップロード・版', () => {
  it.each([
    ['normal', 0.5],
    ['notice', 0.8],
    ['warning', 0.9],
    ['full', 1],
  ])('容量の%s状態を固定値にせず返す', async (state, usageRate) => {
    mocks.getMediaStorageQuota.mockResolvedValueOnce({ ...QUOTA, state, usageRate });
    const res = await req('/api/media/quota?accountId=account-1', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { state, usageRate, limitBytes: 1000 } });
  });

  it('最大20件のR2直接PUT用セッションを作る', async () => {
    mocks.getMediaStorageQuota.mockResolvedValueOnce({
      ...QUOTA, limitBytes: 1024 * 1024 * 1024, remainingBytes: 1024 * 1024 * 1024,
    });
    const res = await req('/api/media/upload-sessions', 'POST', {
      accountId: 'account-1',
      files: [{ filename: 'movie.mp4', mimeType: 'video/mp4', sizeBytes: 200 * 1024 * 1024 }],
    }, 'staff');
    expect(res.status).toBe(201);
    expect(mocks.createMediaUploadSession).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      lineAccountId: 'account-1', kind: 'video', sizeBytes: 200 * 1024 * 1024,
    }));
    expect(await res.json()).toMatchObject({
      data: { sessions: [{ method: 'PUT', uploadUrl: expect.stringContaining('https://') }] },
    });
  });

  it('容量超過はR2セッションを作らず409にする', async () => {
    mocks.getMediaStorageQuota.mockResolvedValueOnce({ ...QUOTA, remainingBytes: 7 });
    const res = await req('/api/media/upload-sessions', 'POST', {
      accountId: 'account-1',
      files: [{ filename: 'a.png', mimeType: 'image/png', sizeBytes: 8 }],
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'media_quota_exceeded' });
    expect(mocks.createMediaUploadSession).not.toHaveBeenCalled();
  });

  it('担当者情報がなければアップロードと版追加を403で止める', async () => {
    expect((await req('/api/media/upload-sessions', 'POST', {
      accountId: 'account-1',
      files: [{ filename: 'a.png', mimeType: 'image/png', sizeBytes: 8 }],
    }, null)).status).toBe(403);
    expect((await req('/api/media/md-1/versions', 'POST', {
      accountId: 'account-1', uploadSessionId: 'upload-1', previewToken: 'preview-1',
      changeReason: '更新',
    }, null)).status).toBe(403);
  });

  it('R2実体をHEAD・メタデータ・シグネチャで確認して新規登録する', async () => {
    const res = await req('/api/media/upload-sessions/upload-1/complete', 'POST', {
      accountId: 'account-1', etag: '"etag-1"',
    });
    expect(res.status).toBe(201);
    expect(head).toHaveBeenCalledWith(UPLOAD_SESSION.r2_key);
    expect(get).toHaveBeenCalledWith(UPLOAD_SESSION.r2_key, { range: { offset: 0, length: 16 } });
    expect(mocks.verifyMediaUploadSession).toHaveBeenCalledWith(
      env.DB, 'upload-1', 'account-1', 'etag-1',
    );
    expect(mocks.completeNewMediaUpload).toHaveBeenCalled();
  });

  it('R2実体がセッションと違えば削除して409にする', async () => {
    head.mockResolvedValueOnce({
      size: 9,
      etag: 'etag-1',
      httpMetadata: { contentType: 'image/png' },
      customMetadata: {
        'line-account-id': 'account-1',
        'upload-session-id': 'upload-1',
      },
    });
    const res = await req('/api/media/upload-sessions/upload-1/complete', 'POST', {
      accountId: 'account-1', etag: 'etag-1',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'media_upload_mismatch' });
    expect(mocks.failMediaUploadSession).toHaveBeenCalledWith(
      env.DB, 'upload-1', 'account-1', 'object_mismatch',
    );
    expect(del).toHaveBeenCalledWith(UPLOAD_SESSION.r2_key);
  });

  it('既存メディア用は確認済みで止め、版APIで不変の次版を作る', async () => {
    mocks.getMediaUploadSession.mockResolvedValueOnce({
      ...UPLOAD_SESSION, target_media_id: 'md-1',
    });
    mocks.verifyMediaUploadSession.mockResolvedValueOnce({
      ...UPLOAD_SESSION, target_media_id: 'md-1', status: 'verified', etag: 'etag-1',
    });
    const complete = await req('/api/media/upload-sessions/upload-1/complete', 'POST', {
      accountId: 'account-1', etag: 'etag-1',
    });
    expect(complete.status).toBe(200);
    expect(await complete.json()).toMatchObject({
      data: { status: 'verified', targetMediaId: 'md-1' },
    });
    expect(mocks.completeNewMediaUpload).not.toHaveBeenCalled();

    mocks.getMediaUploadSession.mockResolvedValue({
      ...UPLOAD_SESSION, target_media_id: 'md-1', status: 'verified', etag: 'etag-1',
    });
    const previewResponse = await req('/api/media/md-1/replacement-preview', 'POST', {
      accountId: 'account-1', uploadSessionId: 'upload-1',
    });
    const preview = (await previewResponse.json()) as { data: { previewToken: string } };
    expect(previewResponse.status).toBe(200);
    expect(preview.data.previewToken).toMatch(/^[0-9a-f]{64}$/);

    const version = await req('/api/media/md-1/versions', 'POST', {
      accountId: 'account-1', uploadSessionId: 'upload-1', previewToken: preview.data.previewToken,
      changeReason: 'ロゴを更新',
    });
    expect(version.status).toBe(201);
    expect(await version.json()).toMatchObject({ data: { mediaId: 'md-1', versionNo: 2 } });
  });

  it('版が先に進んでいれば現在版を添えて409にする', async () => {
    mocks.getMediaUploadSession.mockResolvedValue({
      ...UPLOAD_SESSION, target_media_id: 'md-1', status: 'verified', etag: 'etag-1',
    });
    const previewResponse = await req('/api/media/md-1/replacement-preview', 'POST', {
      accountId: 'account-1', uploadSessionId: 'upload-1',
    });
    const preview = (await previewResponse.json()) as { data: { previewToken: string } };
    mocks.createMediaVersionFromUpload.mockRejectedValueOnce(new MockMediaVersionConflictError(3));
    const res = await req('/api/media/md-1/versions', 'POST', {
      accountId: 'account-1', uploadSessionId: 'upload-1', previewToken: preview.data.previewToken,
      changeReason: 'ロゴを更新',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'media_version_conflict', currentVersionNo: 3,
    });
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
    expect(mocks.getCommonVarUsageSummaries).toHaveBeenCalledWith(
      env.DB,
      ['shop_hours'],
      'account-1',
    );
    const body = (await res.json()) as { data: Array<{ usageCount: number; usageByKind: { template: number } }> };
    expect(body.data[0]?.usageCount).toBe(3);
    expect(body.data[0]?.usageByKind.template).toBe(2);
  });

  it('使用先件数を確認できないときは0件と見せず一覧取得を止める', async () => {
    mocks.getCommonVarUsageSummaries.mockRejectedValueOnce(new Error('D1 unavailable'));
    const res = await req('/api/common-vars?accountId=account-1', 'GET');
    expect(res.status).toBe(500);
  });

  it('詳細は社内メモ・版・使用先先頭15件・変更履歴を実データで返す', async () => {
    mocks.getCommonVarUsageImpact.mockResolvedValue({
      ...EMPTY_COMMON_VAR_IMPACT,
      total: 1,
      blockingTotal: 1,
      byKind: { ...EMPTY_COMMON_VAR_IMPACT.byKind, template: 1 },
      items: [{
        kind: 'template', source_id: 'template-1', source_parent_id: null,
        source_name: '予約案内', source_status: 'active',
        source_content: '営業時間は{{var.shop_hours}}です', is_historical: 0,
      }],
    });
    const res = await req('/api/common-vars/cv-1?accountId=account-1', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: {
        id: 'cv-1', memo: '店舗共通の営業時間', version: 3,
        usageCount: 1, usageByKind: { template: 1 },
        usages: [{ name: '予約案内', currentPreview: '営業時間は10-19です' }],
        usagePage: { total: 1, shown: 1, hasMore: false, unavailableCount: 0 },
        history: [{ version: 3, changeReason: '営業時間を更新', actorName: '川野 健太' }],
      },
    });
  });

  it('詳細の使用先が空なら0件と空配列を区別して返す', async () => {
    mocks.getCommonVarVersions.mockResolvedValue([]);
    const res = await req('/api/common-vars/cv-1?accountId=account-1', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { usageCount: 0, usages: [], history: [], usagePage: { total: 0, hasMore: false } },
    });
  });

  it('詳細の所属外は404、走査失敗は0件にせず503', async () => {
    accessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    expect((await req('/api/common-vars/cv-1?accountId=other', 'GET')).status).toBe(404);
    mocks.getCommonVarUsageImpact.mockRejectedValueOnce(new Error('D1 unavailable'));
    expect((await req('/api/common-vars/cv-1?accountId=account-1', 'GET')).status).toBe(503);
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

  it('変更影響は予約中・公開中・種類別件数とrevisionを返す', async () => {
    mocks.getCommonVarUsageImpact.mockResolvedValue({
      ...EMPTY_COMMON_VAR_IMPACT,
      total: 2,
      blockingTotal: 2,
      byKind: { ...EMPTY_COMMON_VAR_IMPACT.byKind, broadcast: 1, form: 1 },
      items: [
        { kind: 'broadcast', source_id: 'b-1', source_parent_id: null, source_name: '予約配信', source_status: 'scheduled', source_content: '{{var.shop_hours}}', is_historical: 0 },
        { kind: 'form', source_id: 'f-1', source_parent_id: null, source_name: '予約フォーム', source_status: 'active', source_content: '{{var.shop_hours}}', is_historical: 0 },
      ],
    });
    const res = await req('/api/common-vars/cv-1/impact-preview', 'POST', {
      accountId: 'account-1', nextValue: '11-20', expectedVersion: 3,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: {
        version: 3,
        usageByKind: { broadcast: 1, form: 1 },
        scheduledUsageCount: 1,
        publishedUsageCount: 1,
        usageRevision: expect.any(String),
      },
    });
  });

  it('変更影響の古い版は409で再読込を求める', async () => {
    const res = await req('/api/common-vars/cv-1/impact-preview', 'POST', {
      accountId: 'account-1', nextValue: '11-20', expectedVersion: 2,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'common_var_version_conflict', currentVersion: 3,
    });
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

  it('差し替え候補は専用APIから取得できる', async () => {
    const res = await req('/api/common-vars/cv-1/replace', 'POST', { accountId: 'account-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: {
        source: { id: 'cv-1', version: 3 },
        candidates: [{ id: 'cv-2', varKey: 'new_hours', version: 1 }],
      },
    });
  });

  it('差し替えはプレビューrevisionを再照合してから実行する', async () => {
    const previewResponse = await req('/api/common-vars/cv-1/replace', 'POST', {
      accountId: 'account-1', replacementId: 'cv-2',
    });
    const preview = (await previewResponse.json()) as { data: { revision: string } };
    expect(previewResponse.status).toBe(200);
    expect(preview.data).toMatchObject({ replaceableTotal: 1, blockedTotal: 0, canReplace: true });

    const stale = await req('/api/common-vars/cv-1/replace', 'POST', {
      accountId: 'account-1', replacementId: 'cv-2', apply: true,
      expectedVersion: 3, expectedRevision: 'old-revision',
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'common_var_usage_changed' });
    expect(mocks.applyCommonVarReplacementPlan).not.toHaveBeenCalled();

    const applied = await req('/api/common-vars/cv-1/replace', 'POST', {
      accountId: 'account-1', replacementId: 'cv-2', apply: true,
      expectedVersion: 3, expectedRevision: preview.data.revision,
    });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      data: {
        runId: 'replace-1', sourceId: 'cv-1', replacementId: 'cv-2',
        replacedUsageCount: 1, remainingUsageCount: 0, verification: 'verified',
      },
    });
  });

  it('差し替えはスタッフ権限と所属外アカウントをサーバで止める', async () => {
    expect((await req('/api/common-vars/cv-1/replace', 'POST', {
      accountId: 'account-1', replacementId: 'cv-2',
    }, 'staff')).status).toBe(403);
    accessMocks.canAccessAllLineAccounts.mockResolvedValueOnce(false);
    expect((await req('/api/common-vars/cv-1/replace', 'POST', {
      accountId: 'other', replacementId: 'cv-2',
    })).status).toBe(404);
    expect(mocks.getCommonVarReplacementPlan).not.toHaveBeenCalled();
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
