import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const openai = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('../services/openai-images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/openai-images.js')>();
  return { ...actual, generateOpenAIImage: openai.generate };
});

const { hqBanners } = await import('./hq-banners.js');
const { OpenAIImageError } = await import('../services/openai-images.js');

let testDb: SqliteD1;

/** R2 のかわり。put した中身を get で返せるだけの入れ物。 */
function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    store,
    bucket: {
      put: vi.fn(async (key: string, value: Uint8Array | ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
        store.set(key, {
          bytes: value instanceof Uint8Array ? value : new Uint8Array(value),
          contentType: opts?.httpMetadata?.contentType ?? 'application/octet-stream',
        });
      }),
      get: vi.fn(async (key: string) => {
        const hit = store.get(key);
        if (!hit) return null;
        return { arrayBuffer: async () => hit.bytes.buffer.slice(hit.bytes.byteOffset, hit.bytes.byteOffset + hit.bytes.byteLength) };
      }),
      delete: vi.fn(async (key: string) => { store.delete(key); }),
    } as unknown as R2Bucket,
  };
}

let r2: ReturnType<typeof fakeBucket>;

const hqAdmin = (overrides: Partial<AuthenticatedStaff> = {}): AuthenticatedStaff => ({
  id: 'staff-1',
  name: '統括管理者',
  role: 'admin',
  readOnly: false,
  tenantId: DEFAULT_TENANT_ID,
  ...overrides,
});

function app(staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', staff);
    return next();
  });
  instance.route('/', hqBanners);
  return instance;
}

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    DB: testDb.db,
    IMAGES: r2.bucket,
    WORKER_URL: 'https://api.example.com',
    OPENAI_API_KEY: 'sk-test',
    ...overrides,
  } as Env['Bindings'];
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  opts: { staff?: AuthenticatedStaff; env?: Partial<Env['Bindings']> } = {},
) {
  return app(opts.staff ?? hqAdmin()).request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env(opts.env));
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function createProject(name = '春のキャンペーン') {
  const res = await call('POST', '/api/hq/banners/projects', { name, description: '桜' });
  expect(res.status).toBe(201);
  return (await res.json<{ data: { id: string } }>()).data;
}

const GENERATE_BODY = {
  presetKey: 'line_rich_message',
  count: 2,
  textLines: ['春の感謝祭', '今すぐチェック'],
  mainColor: '#FF6600',
  personOption: 'without',
};

beforeEach(() => {
  testDb = createTestD1();
  r2 = fakeBucket();
  openai.generate.mockReset();
  testDb.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-2', '別の統括')").run();
  testDb.raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-1', 'channel-1', '店舗1', '', '', 1, ?)`,
  ).run(DEFAULT_TENANT_ID);
  testDb.raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-2', 'channel-2', '店舗2', '', '', 1, ?)`,
  ).run(DEFAULT_TENANT_ID);
  testDb.raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-other', 'channel-x', 'よその店舗', '', '', 1, 'tenant-2')`,
  ).run();
});

describe('権限', () => {
  it('担当者（staff）は統括のバナー生成に入れない', async () => {
    const res = await call('GET', '/api/hq/banners/projects', undefined, { staff: hqAdmin({ role: 'staff' }) });
    expect(res.status).toBe(403);
  });

  it('別の統括のプロジェクトは見えない', async () => {
    const project = await createProject();
    const res = await call('GET', `/api/hq/banners/projects/${project.id}`, undefined, {
      staff: hqAdmin({ tenantId: 'tenant-2' }),
    });
    expect(res.status).toBe(404);
    const list = await call('GET', '/api/hq/banners/projects', undefined, { staff: hqAdmin({ tenantId: 'tenant-2' }) });
    expect((await list.json<{ data: unknown[] }>()).data).toHaveLength(0);
  });
});

describe('プロジェクト', () => {
  it('作成・一覧・名前変更・お気に入り・アーカイブ・復元ができる', async () => {
    const project = await createProject();
    let res = await call('GET', '/api/hq/banners/projects');
    let list = (await res.json<{ data: Array<{ id: string; name: string; imageCount: number }> }>()).data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: project.id, name: '春のキャンペーン', imageCount: 0 });

    res = await call('PATCH', `/api/hq/banners/projects/${project.id}`, { name: '夏のキャンペーン', isFavorite: true });
    expect(res.status).toBe(200);
    expect((await res.json<{ data: { name: string; isFavorite: boolean } }>()).data).toMatchObject({ name: '夏のキャンペーン', isFavorite: true });

    res = await call('PATCH', `/api/hq/banners/projects/${project.id}`, { archived: true });
    expect(res.status).toBe(200);
    res = await call('GET', '/api/hq/banners/projects');
    expect((await res.json<{ data: unknown[] }>()).data).toHaveLength(0);
    res = await call('GET', '/api/hq/banners/projects?archived=1');
    list = (await res.json<{ data: Array<{ id: string; name: string; imageCount: number }> }>()).data;
    expect(list).toHaveLength(1);

    res = await call('PATCH', `/api/hq/banners/projects/${project.id}`, { archived: false });
    res = await call('GET', '/api/hq/banners/projects');
    expect((await res.json<{ data: unknown[] }>()).data).toHaveLength(1);
  });

  it('名前が空か長すぎると断る', async () => {
    expect((await call('POST', '/api/hq/banners/projects', { name: '' })).status).toBe(400);
    expect((await call('POST', '/api/hq/banners/projects', { name: 'あ'.repeat(101) })).status).toBe(400);
  });

  it('検索は名前と説明の部分一致', async () => {
    await createProject('春のキャンペーン');
    await createProject('新規友だち向け');
    const res = await call('GET', '/api/hq/banners/projects?q=%E6%98%A5');
    const list = (await res.json<{ data: Array<{ name: string }> }>()).data;
    expect(list.map((p) => p.name)).toEqual(['春のキャンペーン']);
  });
});

describe('生成', () => {
  it('接続設定が無いときは生成を503で断る', async () => {
    const project = await createProject();
    const res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, GENERATE_BODY, {
      env: { OPENAI_API_KEY: undefined },
    });
    expect(res.status).toBe(503);
  });

  it('条件を保存し、1回の実行で1枚ずつ作って統括のメディアに保存する', async () => {
    const project = await createProject();
    let res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, GENERATE_BODY);
    expect(res.status).toBe(201);
    const generation = (await res.json<{ data: { id: string; status: string; finalPrompt: string; unitsPerImage: number; requestedCount: number; quality: string } }>()).data;
    expect(generation.status).toBe('queued');
    expect(generation.unitsPerImage).toBe(1);
    expect(generation.quality).toBe('medium');
    expect(generation.requestedCount).toBe(2);
    expect(generation.finalPrompt).toContain('「春の感謝祭」');

    openai.generate.mockResolvedValue({ bytes: JPEG, mimeType: 'image/jpeg', model: 'gpt-image-1' });

    res = await call('POST', `/api/hq/banners/generations/${generation.id}/run`);
    expect(res.status).toBe(200);
    let run = (await res.json<{ data: { generation: { status: string; doneCount: number }; image: { id: string; sequence: number; media: { url: string; width: number } } | null; finished: boolean } }>()).data;
    expect(run.finished).toBe(false);
    expect(run.generation).toMatchObject({ status: 'running', doneCount: 1 });
    expect(run.image?.sequence).toBe(1);
    expect(run.image?.media.width).toBe(1024);
    expect(run.image?.media.url).toMatch(/^https:\/\/api\.example\.com\/images\/banner\/.+\.jpg$/);

    // 呼び出しに渡した条件が保存したプロンプトと同じ
    const sent = openai.generate.mock.calls[0][0] as { prompt: string; size: string; quality: string };
    expect(sent.prompt).toBe(generation.finalPrompt);
    expect(sent).toMatchObject({ size: '1024x1024', quality: 'medium' });

    res = await call('POST', `/api/hq/banners/generations/${generation.id}/run`);
    run = (await res.json<typeof run extends infer T ? { data: T } : never>()).data;
    expect(run.finished).toBe(true);
    expect(run.generation).toMatchObject({ status: 'done', doneCount: 2 });

    // 3回目は何もせず「終わっている」と返す
    res = await call('POST', `/api/hq/banners/generations/${generation.id}/run`);
    run = (await res.json<{ data: typeof run }>()).data;
    expect(run.finished).toBe(true);
    expect(run.image).toBeNull();
    expect(openai.generate).toHaveBeenCalledTimes(2);

    // 統括のメディアとして保存されている（店舗には属さない）
    const media = testDb.raw.prepare('SELECT line_account_id, kind, mime_type, r2_key FROM media').all() as Array<{ line_account_id: string | null; kind: string; r2_key: string }>;
    expect(media).toHaveLength(2);
    expect(media.every((m) => m.line_account_id === null && m.kind === 'image' && m.r2_key.startsWith('banner/'))).toBe(true);
    expect(r2.store.size).toBe(2);

    // 利用量は 2枚（品質は数えない）
    res = await call('GET', '/api/hq/banners/usage');
    const usage = (await res.json<{ data: { month: { used: number; limit: number }; today: { used: number; limit: number }; paused: boolean } }>()).data;
    expect(usage.month).toMatchObject({ used: 2, limit: 150 });
    expect(usage.today).toMatchObject({ used: 2, limit: 30 });
    expect(usage.paused).toBe(false);

    // プロジェクト詳細に画像と生成条件が並ぶ
    res = await call('GET', `/api/hq/banners/projects/${project.id}`);
    const detail = (await res.json<{ data: { project: { imageCount: number }; images: Array<{ generation: { textLines: string[] } }> } }>()).data;
    expect(detail.project.imageCount).toBe(2);
    expect(detail.images[0].generation.textLines).toEqual(['春の感謝祭', '今すぐチェック']);
  });

  it('AIが安全基準で断ったら、その生成は止めて理由を残す。利用量は減らない', async () => {
    const project = await createProject();
    let res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, { ...GENERATE_BODY, count: 3 });
    const generation = (await res.json<{ data: { id: string } }>()).data;
    openai.generate.mockRejectedValue(new OpenAIImageError('safety', 'rejected by safety system', 400));

    res = await call('POST', `/api/hq/banners/generations/${generation.id}/run`);
    expect(res.status).toBe(422);
    const body = await res.json<{ success: boolean; error: string; data: { generation: { status: string; failedCount: number; errorMessage: string } } }>();
    expect(body.success).toBe(false);
    expect(body.error).toContain('安全基準');
    expect(body.data.generation).toMatchObject({ status: 'failed', failedCount: 1 });
    expect(body.data.generation.errorMessage).toContain('安全基準');

    res = await call('GET', '/api/hq/banners/usage');
    expect((await res.json<{ data: { month: { used: number } } }>()).data.month.used).toBe(0);
    expect(r2.store.size).toBe(0);
  });

  it('1枚成功したあとで失敗しても、成功分は残して done で締める', async () => {
    const project = await createProject();
    let res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, GENERATE_BODY);
    const generation = (await res.json<{ data: { id: string } }>()).data;
    openai.generate
      .mockResolvedValueOnce({ bytes: JPEG, mimeType: 'image/jpeg', model: 'gpt-image-1' })
      .mockRejectedValueOnce(new OpenAIImageError('timeout', 'timed out'));

    await call('POST', `/api/hq/banners/generations/${generation.id}/run`);
    res = await call('POST', `/api/hq/banners/generations/${generation.id}/run`);
    expect(res.status).toBe(502);
    const body = await res.json<{ data: { generation: { status: string; doneCount: number; failedCount: number } } }>();
    expect(body.data.generation).toMatchObject({ status: 'done', doneCount: 1, failedCount: 1 });
    expect(r2.store.size).toBe(1);
  });

  it('月の上限を超える生成は受け付けない', async () => {
    const project = await createProject();
    const res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, { ...GENERATE_BODY, count: 4 }, {
      env: { BANNER_MONTHLY_IMAGES: '3' },
    });
    expect(res.status).toBe(409);
    expect((await res.json<{ error: string }>()).error).toContain('今月の生成上限');
  });

  it('1日の上限（月の1/5）も見る', async () => {
    const project = await createProject();
    // 月 10枚 → 1日 2枚。3枚は断る
    const res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, { ...GENERATE_BODY, count: 3 }, {
      env: { BANNER_MONTHLY_IMAGES: '10' },
    });
    expect(res.status).toBe(409);
    expect((await res.json<{ error: string }>()).error).toContain('今日の生成上限');
  });

  it('短時間に失敗が3回続いたら自動で一時停止する', async () => {
    const project = await createProject();
    openai.generate.mockRejectedValue(new OpenAIImageError('server', 'boom', 500));
    for (let i = 0; i < 3; i += 1) {
      const res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, { ...GENERATE_BODY, count: 1 });
      const g = (await res.json<{ data: { id: string } }>()).data;
      await call('POST', `/api/hq/banners/generations/${g.id}/run`);
    }
    const res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, { ...GENERATE_BODY, count: 1 });
    expect(res.status).toBe(409);
    expect((await res.json<{ error: string }>()).error).toContain('失敗が続いた');
    const usage = await call('GET', '/api/hq/banners/usage');
    expect((await usage.json<{ data: { paused: boolean } }>()).data.paused).toBe(true);
  });

  it('品質を指定しても無視して固定値で作る', async () => {
    const project = await createProject();
    const res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, { ...GENERATE_BODY, quality: 'high' }, {
      env: { BANNER_IMAGE_QUALITY: 'low' },
    });
    expect(res.status).toBe(201);
    expect((await res.json<{ data: { quality: string } }>()).data.quality).toBe('low');
  });

  it('用途は LINE と SNS の規格を網羅している', async () => {
    const res = await call('GET', '/api/hq/banners/presets');
    const data = (await res.json<{ data: { presets: Array<{ key: string; group: string; targetWidth: number; targetHeight: number }>; maxCount: number; usage: { month: { limit: number }; today: { limit: number } } } }>()).data;
    const keys = data.presets.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['line_rich_message', 'line_rich_menu_large', 'line_rich_menu_small', 'line_card', 'sns_instagram_feed', 'sns_story', 'sns_ogp', 'sns_youtube_thumbnail']));
    expect(data.presets.find((p) => p.key === 'line_rich_menu_large')).toMatchObject({ group: 'line', targetWidth: 2500, targetHeight: 1686 });
    expect(data.maxCount).toBe(4);
    expect(data.usage.month.limit).toBe(150);
    expect(data.usage.today.limit).toBe(30);
  });

  it('アーカイブ済みのプロジェクトでは生成できない', async () => {
    const project = await createProject();
    await call('PATCH', `/api/hq/banners/projects/${project.id}`, { archived: true });
    const res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, GENERATE_BODY);
    expect(res.status).toBe(409);
  });

  it('途中でキャンセルすると、それ以上は作らない', async () => {
    const project = await createProject();
    let res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, GENERATE_BODY);
    const generation = (await res.json<{ data: { id: string } }>()).data;
    res = await call('POST', `/api/hq/banners/generations/${generation.id}/cancel`);
    expect((await res.json<{ data: { status: string } }>()).data.status).toBe('canceled');
    res = await call('POST', `/api/hq/banners/generations/${generation.id}/run`);
    expect((await res.json<{ data: { finished: boolean } }>()).data.finished).toBe(true);
    expect(openai.generate).not.toHaveBeenCalled();
  });
});

describe('画像ライブラリと店舗への受け渡し', () => {
  async function generatedImage() {
    const project = await createProject();
    let res = await call('POST', `/api/hq/banners/projects/${project.id}/generations`, { ...GENERATE_BODY, count: 1 });
    const generation = (await res.json<{ data: { id: string } }>()).data;
    openai.generate.mockResolvedValue({ bytes: JPEG, mimeType: 'image/jpeg', model: 'gpt-image-1' });
    res = await call('POST', `/api/hq/banners/generations/${generation.id}/run`);
    const image = (await res.json<{ data: { image: { id: string } } }>()).data.image;
    return { project, image };
  }

  it('取り込んだ画像も一覧に並び、お気に入り・検索・用途で絞れる', async () => {
    const { project, image } = await generatedImage();
    let res = await call('POST', `/api/hq/banners/projects/${project.id}/uploads`, {
      filename: 'chirashi.png',
      data: `data:image/png;base64,${toB64(PNG)}`,
    });
    expect(res.status).toBe(201);
    const uploaded = (await res.json<{ data: { id: string; source: string; generation: unknown } }>()).data;
    expect(uploaded.source).toBe('upload');
    expect(uploaded.generation).toBeNull();

    res = await call('GET', '/api/hq/banners/images');
    expect((await res.json<{ data: unknown[] }>()).data).toHaveLength(2);

    await call('PATCH', `/api/hq/banners/images/${image.id}`, { isFavorite: true });
    res = await call('GET', '/api/hq/banners/images?favorite=1');
    const favorites = (await res.json<{ data: Array<{ id: string; isFavorite: boolean }> }>()).data;
    expect(favorites).toHaveLength(1);
    expect(favorites[0]).toMatchObject({ id: image.id, isFavorite: true });

    res = await call('GET', '/api/hq/banners/images?q=%E6%84%9F%E8%AC%9D%E7%A5%AD');
    expect((await res.json<{ data: Array<{ id: string }> }>()).data.map((i) => i.id)).toEqual([image.id]);

    res = await call('GET', '/api/hq/banners/images?preset=line_rich_menu_large');
    expect((await res.json<{ data: unknown[] }>()).data).toHaveLength(0);
  });

  it('形式の合わないファイルは取り込まない', async () => {
    const { project } = await generatedImage();
    const res = await call('POST', `/api/hq/banners/projects/${project.id}/uploads`, {
      filename: 'fake.png',
      data: `data:image/png;base64,${toB64(JPEG)}`,
    });
    expect(res.status).toBe(400);
  });

  it('店舗へ渡すと店舗の登録メディアが作られ、同じ店舗へは二度作らない', async () => {
    const { image } = await generatedImage();
    let res = await call('POST', `/api/hq/banners/images/${image.id}/deliver`, { lineAccountIds: ['account-1', 'account-2'] });
    expect(res.status).toBe(200);
    let body = (await res.json<{ data: { deliveries: Array<{ lineAccountId: string; alreadyDelivered: boolean }>; image: { deliveredAccountIds: string[] } } }>()).data;
    expect(body.deliveries.map((d) => d.alreadyDelivered)).toEqual([false, false]);
    expect(body.image.deliveredAccountIds.sort()).toEqual(['account-1', 'account-2']);

    const storeMedia = testDb.raw.prepare("SELECT line_account_id, r2_key, kind FROM media WHERE line_account_id IS NOT NULL ORDER BY line_account_id").all() as Array<{ line_account_id: string; r2_key: string; kind: string }>;
    expect(storeMedia.map((m) => m.line_account_id)).toEqual(['account-1', 'account-2']);
    expect(storeMedia.every((m) => m.r2_key.startsWith('media/') && m.kind === 'image')).toBe(true);
    expect(r2.store.size).toBe(3);

    res = await call('POST', `/api/hq/banners/images/${image.id}/deliver`, { lineAccountIds: ['account-1'] });
    body = (await res.json<{ data: typeof body }>()).data;
    expect(body.deliveries[0].alreadyDelivered).toBe(true);
    expect(r2.store.size).toBe(3);
  });

  it('別の統括の店舗へは渡せない', async () => {
    const { image } = await generatedImage();
    const res = await call('POST', `/api/hq/banners/images/${image.id}/deliver`, { lineAccountIds: ['account-other'] });
    expect(res.status).toBe(404);
    expect(r2.store.size).toBe(1);
  });

  it('一覧から外しても、渡した先の店舗メディアは残る', async () => {
    const { image } = await generatedImage();
    await call('POST', `/api/hq/banners/images/${image.id}/deliver`, { lineAccountIds: ['account-1'] });
    let res = await call('DELETE', `/api/hq/banners/images/${image.id}`);
    expect(res.status).toBe(200);
    res = await call('GET', '/api/hq/banners/images');
    expect((await res.json<{ data: unknown[] }>()).data).toHaveLength(0);
    const storeMedia = testDb.raw.prepare("SELECT COUNT(*) AS n FROM media WHERE line_account_id = 'account-1'").get() as { n: number };
    expect(storeMedia.n).toBe(1);
  });
});
