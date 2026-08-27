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
  getCommonVars: vi.fn(),
  getCommonVarById: vi.fn(),
  createCommonVar: vi.fn(),
  updateCommonVar: vi.fn(),
  deleteCommonVar: vi.fn(),
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

function makeApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', contents);
  return app;
}

function req(path: string, method: string, body?: unknown) {
  return makeApp().fetch(
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

const VAR = {
  id: 'cv-1',
  folder_id: null,
  name: '営業時間',
  var_key: 'shop_hours',
  type: 'text',
  value: '10-19',
  created_at: '2026-08-16',
  updated_at: '2026-08-16',
};

/** 1x1 の PNG。中身は問わないので短い base64 で足りる。 */
const TINY_PNG = 'iVBORw0KGgo=';

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue(undefined);
  del.mockResolvedValue(undefined);
  mocks.getMedia.mockResolvedValue([MEDIA]);
  mocks.getMediaById.mockResolvedValue(MEDIA);
  mocks.createMedia.mockResolvedValue(MEDIA);
  mocks.updateMedia.mockResolvedValue(MEDIA);
  mocks.countMediaUsages.mockResolvedValue(0);
  mocks.getMediaUsages.mockResolvedValue([]);
  mocks.getCommonVars.mockResolvedValue([VAR]);
  mocks.getCommonVarById.mockResolvedValue(VAR);
  mocks.createCommonVar.mockResolvedValue(VAR);
  mocks.updateCommonVar.mockResolvedValue(VAR);
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
    const res = await req('/api/media', 'GET');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ usageCount: number }> };
    expect(body.data[0]?.usageCount).toBe(3);
  });

  it('形式と拡張子が揃っていれば通る', async () => {
    const res = await req('/api/media', 'POST', {
      filename: 'a.png',
      mimeType: 'image/png',
      data: TINY_PNG,
    });
    expect(res.status).toBe(201);
    expect(put).toHaveBeenCalled();
  });

  it('対応していない形式は弾く', async () => {
    const res = await req('/api/media', 'POST', {
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
      filename: 'a.txt',
      mimeType: 'image/png',
      data: TINY_PNG,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('拡張子');
    expect(put).not.toHaveBeenCalled();
  });

  it('data: URL の種別を優先する', async () => {
    const res = await req('/api/media', 'POST', {
      filename: 'a.png',
      data: `data:image/png;base64,${TINY_PNG}`,
    });
    expect(res.status).toBe(201);
  });

  it('大きすぎるファイルは 413', async () => {
    // 11MB ぶんの base64。上限は画像 10MB。
    const big = 'A'.repeat(11 * 1024 * 1024 * 2);
    const res = await req('/api/media', 'POST', {
      filename: 'a.png',
      mimeType: 'image/png',
      data: big,
    });
    expect(res.status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it('ファイル名が無ければ弾く', async () => {
    const res = await req('/api/media', 'POST', { mimeType: 'image/png', data: TINY_PNG });
    expect(res.status).toBe(400);
  });
});

describe('メディアの削除', () => {
  it('使われていれば件数を返して止める', async () => {
    mocks.countMediaUsages.mockResolvedValue(5);
    const res = await req('/api/media/md-1', 'DELETE');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { usageCount: number };
    expect(body.usageCount).toBe(5);
    expect(mocks.deleteMedia).not.toHaveBeenCalled();
  });

  it('force=1 を付けても使用中は消さない', async () => {
    mocks.countMediaUsages.mockResolvedValue(5);
    const res = await req('/api/media/md-1?force=1', 'DELETE');
    expect(res.status).toBe(409);
    expect(mocks.deleteMedia).not.toHaveBeenCalled();
  });

  it('DBの行を先に消す', async () => {
    // 逆にすると「行はあるが実体が無い」状態になる。この順なら
    // 孤児のファイルが残るだけで、画面には出てこない。
    await req('/api/media/md-1', 'DELETE');
    expect(mocks.deleteMedia).toHaveBeenCalled();
  });
});

describe('共通情報', () => {
  it('差し込み名の形が違えば422', async () => {
    const res = await req('/api/common-vars', 'POST', { name: 'x', varKey: '営業時間' });
    expect(res.status).toBe(422);
    expect(mocks.createCommonVar).not.toHaveBeenCalled();
  });

  it('差し込み名の決まりは友だち情報欄と同じ', async () => {
    // 片方だけ緩めると「情報欄では使えないのに共通情報では使える名前」ができる。
    const res = await req('/api/common-vars', 'POST', { name: 'x', varKey: 'name' });
    expect(res.status).toBe(422);
  });

  it('重複したら409', async () => {
    mocks.createCommonVar.mockRejectedValue(new Error('UNIQUE constraint failed'));
    const res = await req('/api/common-vars', 'POST', { name: 'x', varKey: 'dup' });
    expect(res.status).toBe(409);
  });

  it('差し込み名は変えられない', async () => {
    const res = await req('/api/common-vars/cv-1', 'PATCH', { varKey: 'other' });
    expect(res.status).toBe(422);
    expect(mocks.updateCommonVar).not.toHaveBeenCalled();
  });

  it('値だけの変更は通る', async () => {
    const res = await req('/api/common-vars/cv-1', 'PATCH', { value: '11-20' });
    expect(res.status).toBe(200);
  });
});

describe('日付での切り替え', () => {
  it('未来の日時なら予約できる', async () => {
    const res = await req('/api/common-vars/cv-1/schedules', 'POST', {
      effectiveFrom: '2099-01-01T00:00',
      value: '新しい値',
    });
    expect(res.status).toBe(201);
  });

  it('過去の日時は受け付けない', async () => {
    // 入れた瞬間に次のCronで当たり、「予約したつもりが今すぐ変わった」になる。
    const res = await req('/api/common-vars/cv-1/schedules', 'POST', {
      effectiveFrom: '2020-01-01T00:00',
      value: 'x',
    });
    expect(res.status).toBe(400);
    expect(mocks.createCommonVarSchedule).not.toHaveBeenCalled();
  });

  it('日時の形が違えば弾く', async () => {
    const res = await req('/api/common-vars/cv-1/schedules', 'POST', {
      effectiveFrom: '2099年1月1日',
      value: 'x',
    });
    expect(res.status).toBe(400);
  });
});
