import { Hono, type Context } from 'hono';
import {
  createBannerGeneration,
  createBannerImage,
  createBannerImageDelivery,
  createBannerProject,
  createMedia,
  getBannerGeneration,
  getBannerImage,
  getBannerImageDelivery,
  getBannerImageWithDetail,
  getBannerProject,
  getBannerStats,
  getBannerUsageThisMonth,
  getBannerUsageToday,
  getTenantBilling,
  countRecentFailedBannerGenerations,
  listBannerGenerations,
  listBannerImages,
  listBannerProjects,
  recordBannerUsage,
  touchBannerProject,
  updateBannerGenerationProgress,
  updateBannerImage,
  updateBannerProject,
  type BannerGeneration,
  type BannerImageWithDetail,
  type BannerProject,
  type Media,
} from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { resolveEntitlements } from '../services/billing-plans.js';
import {
  BANNER_MAX_COUNT,
  BANNER_PRESETS,
  buildBannerPrompt,
  resolveBannerQuality,
  validateBannerRequest,
} from '../services/banner-prompt.js';
import { toJstString } from '@line-crm/db';
import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  generateOpenAIImage,
  OpenAIImageError,
  type OpenAIReferenceImage,
} from '../services/openai-images.js';

/**
 * 統括の「バナー生成」。
 *
 * 画像はここで作って統括の登録メディアに保存し、必要な店舗へ「渡す」。
 * 渡した先では店舗の登録メディアとして見えるので、配信やリッチメニューから
 * そのまま選べる。
 */
export const hqBanners = new Hono<Env>();

/**
 * 利用上限は「枚数」だけで数える。クレジットや品質の選択は運用者に見せない。
 * 月の上限は当面この環境変数で、料金プラン導入後はプランの値に置き換える。
 * 1日の上限は月の 1/5、一度に作れるのは 4 枚まで、短時間に失敗が続いたら自動で一時停止する。
 */
const DEFAULT_MONTHLY_IMAGES = 150;
const DAILY_DIVISOR = 5;
const AUTO_PAUSE_FAILURES = 3;
const AUTO_PAUSE_WINDOW_MS = 15 * 60 * 1000;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** 参照画像が実行時に見つからない（一覧から外された・実体が消えた）。 */
class ReferenceMissingError extends Error {
  constructor() {
    super('参照画像が見つかりません。ライブラリから選び直してください');
    this.name = 'ReferenceMissingError';
  }
}
const UPLOAD_ALLOWED: Record<string, { ext: string }> = {
  'image/png': { ext: 'png' },
  'image/jpeg': { ext: 'jpg' },
  'image/webp': { ext: 'webp' },
};

hqBanners.use('/api/hq/banners/*', requireRole('owner', 'admin'));

function tenantOf(c: Context<Env>): string {
  return c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
}

function workerUrl(c: Context<Env>): string {
  return c.env.WORKER_URL || new URL(c.req.url).origin;
}

/**
 * 課金対象外（運営）の統括の月間上限。`BANNER_MONTHLY_IMAGES` で上書きできる。
 * 契約中・トライアル中の統括はプランの値を使う（`resolveEntitlements`）。
 */
function exemptMonthlyImages(c: Context<Env>): number {
  const raw = Number(c.env.BANNER_MONTHLY_IMAGES ?? '');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MONTHLY_IMAGES;
}

async function tenantEntitlements(c: Context<Env>, tenantId: string) {
  const billing = await getTenantBilling(c.env.DB, tenantId).catch(() => null);
  return resolveEntitlements(billing, { exemptMonthlyImages: exemptMonthlyImages(c) });
}

type UsageSnapshot = {
  month: { used: number; limit: number; remaining: number };
  today: { used: number; limit: number; remaining: number };
  paused: boolean;
  pausedReason: string | null;
  /** 課金の状態で止まっているとき（トライアル終了・解約）。理由は blockedReason。 */
  blocked: boolean;
  blockedReason: string | null;
  planState: string;
};

async function usageSnapshot(c: Context<Env>, tenantId: string): Promise<UsageSnapshot> {
  const [usedMonth, usedToday, recentFailures, entitlements] = await Promise.all([
    getBannerUsageThisMonth(c.env.DB, tenantId),
    getBannerUsageToday(c.env.DB, tenantId),
    countRecentFailedBannerGenerations(c.env.DB, tenantId, toJstString(new Date(Date.now() - AUTO_PAUSE_WINDOW_MS))),
    tenantEntitlements(c, tenantId),
  ]);
  const monthLimit = entitlements.monthlyImages;
  const dayLimit = Math.max(1, Math.ceil(monthLimit / DAILY_DIVISOR));
  const paused = recentFailures >= AUTO_PAUSE_FAILURES;
  return {
    month: { used: usedMonth, limit: monthLimit, remaining: Math.max(monthLimit - usedMonth, 0) },
    today: { used: usedToday, limit: dayLimit, remaining: Math.max(dayLimit - usedToday, 0) },
    paused,
    blocked: !entitlements.canGenerate,
    blockedReason: entitlements.blockedReason,
    planState: entitlements.state,
    pausedReason: paused ? '短時間に生成の失敗が続いたため、15分ほど生成を止めています。時間をおいてからお試しください' : null,
  };
}

/** 生成を受け付けられないときは理由を返す。受け付けられるときは null。 */
function refusal(usage: UsageSnapshot, needed: number): string | null {
  if (usage.blocked) return usage.blockedReason;
  if (usage.paused) return usage.pausedReason;
  if (needed > usage.month.remaining) {
    return `今月の生成上限（${usage.month.limit}枚）に達します（残り ${usage.month.remaining}枚、必要 ${needed}枚）。枚数を減らすか、来月までお待ちください`;
  }
  if (needed > usage.today.remaining) {
    return `今日の生成上限（1日 ${usage.today.limit}枚）に達します（残り ${usage.today.remaining}枚、必要 ${needed}枚）。明日以降にお試しください`;
  }
  return null;
}

function serializeProject(p: BannerProject) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    isFavorite: p.is_favorite === 1,
    archivedAt: p.archived_at,
    imageCount: Number(p.image_count ?? 0),
    runningCount: Number(p.running_count ?? 0),
    createdBy: p.created_by,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function parseTextLines(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function serializeGeneration(g: BannerGeneration) {
  return {
    id: g.id,
    projectId: g.project_id,
    status: g.status,
    mode: g.mode,
    presetKey: g.preset_key,
    aspectRatio: g.aspect_ratio,
    apiSize: g.api_size,
    quality: g.quality,
    textLines: parseTextLines(g.text_lines),
    mainColor: g.main_color,
    subColor: g.sub_color,
    personOption: g.person_option,
    customPrompt: g.custom_prompt,
    freePrompt: g.free_prompt,
    finalPrompt: g.final_prompt,
    engine: g.engine,
    modelName: g.model_name,
    requestedCount: g.requested_count,
    doneCount: g.done_count,
    failedCount: g.failed_count,
    unitsPerImage: g.units_per_image,
    errorMessage: g.error_message,
    referenceImageId: g.reference_image_id ?? null,
    referenceMode: g.reference_mode ?? null,
    createdBy: g.created_by,
    createdAt: g.created_at,
    startedAt: g.started_at,
    finishedAt: g.finished_at,
  };
}

function serializeMedia(m: Media, base: string) {
  return {
    id: m.id,
    filename: m.filename,
    mimeType: m.mime_type,
    sizeBytes: m.size_bytes,
    width: m.width,
    height: m.height,
    url: m.public_url ?? `${base}/images/${m.r2_key}`,
  };
}

function serializeImage(i: BannerImageWithDetail, base: string) {
  return {
    id: i.id,
    projectId: i.project_id,
    generationId: i.generation_id,
    sequence: i.sequence,
    source: i.source,
    parentImageId: i.parent_image_id,
    isFavorite: i.is_favorite === 1,
    createdBy: i.created_by,
    createdAt: i.created_at,
    media: serializeMedia(i.media, base),
    generation: i.generation ? serializeGeneration(i.generation) : null,
    deliveredAccountIds: i.delivered_account_ids,
  };
}

async function readJson(c: Context<Env>): Promise<Record<string, unknown> | null> {
  return c.req.json<Record<string, unknown>>().catch(() => null);
}

function hasImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return bytes.length > 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

function sizeToDimensions(apiSize: string): { width: number | null; height: number | null } {
  const match = /^(\d+)x(\d+)$/.exec(apiSize);
  if (!match) return { width: null, height: null };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function safeFilenameBase(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>| -]/g, '').trim();
  return (cleaned || 'banner').slice(0, 40);
}

// ================================================================ presets

hqBanners.get('/api/hq/banners/presets', async (c) => {
  const usage = await usageSnapshot(c, tenantOf(c));
  return c.json({
    success: true,
    data: {
      presets: BANNER_PRESETS.map((p) => ({
        key: p.key,
        group: p.group,
        label: p.label,
        note: p.note,
        aspectRatio: p.aspectRatio,
        apiSize: p.apiSize,
        targetWidth: p.targetWidth,
        targetHeight: p.targetHeight,
      })),
      maxCount: BANNER_MAX_COUNT,
      usage,
      engineReady: Boolean(c.env.OPENAI_API_KEY),
    },
  });
});

hqBanners.get('/api/hq/banners/usage', async (c) => {
  const usage = await usageSnapshot(c, tenantOf(c));
  return c.json({ success: true, data: usage });
});

hqBanners.get('/api/hq/banners/stats', async (c) => {
  try {
    const stats = await getBannerStats(c.env.DB, tenantOf(c));
    return c.json({ success: true, data: stats });
  } catch (err) {
    console.error('GET /api/hq/banners/stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// =============================================================== projects

hqBanners.get('/api/hq/banners/projects', async (c) => {
  try {
    const archived = c.req.query('archived') === '1';
    const query = c.req.query('q')?.trim() || undefined;
    const items = await listBannerProjects(c.env.DB, { tenantId: tenantOf(c), archived, query });
    return c.json({ success: true, data: items.map(serializeProject) });
  } catch (err) {
    console.error('GET /api/hq/banners/projects error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

hqBanners.post('/api/hq/banners/projects', async (c) => {
  try {
    const body = await readJson(c);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      return c.json({ success: false, error: 'プロジェクト名は1〜100文字で入力してください' }, 400);
    }
    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 500) : '';
    const project = await createBannerProject(c.env.DB, {
      tenantId: tenantOf(c),
      name,
      description,
      createdBy: c.get('staff')?.id ?? null,
    });
    return c.json({ success: true, data: serializeProject(project) }, 201);
  } catch (err) {
    console.error('POST /api/hq/banners/projects error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

hqBanners.get('/api/hq/banners/projects/:id', async (c) => {
  try {
    const tenantId = tenantOf(c);
    const project = await getBannerProject(c.env.DB, c.req.param('id'), tenantId);
    if (!project) return c.json({ success: false, error: 'プロジェクトが見つかりません' }, 404);
    const [images, generations] = await Promise.all([
      listBannerImages(c.env.DB, { tenantId, projectId: project.id, limit: 100 }),
      listBannerGenerations(c.env.DB, project.id, tenantId),
    ]);
    const base = workerUrl(c);
    return c.json({
      success: true,
      data: {
        project: serializeProject(project),
        images: images.map((i) => serializeImage(i, base)),
        generations: generations.map(serializeGeneration),
      },
    });
  } catch (err) {
    console.error('GET /api/hq/banners/projects/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

hqBanners.patch('/api/hq/banners/projects/:id', async (c) => {
  try {
    const tenantId = tenantOf(c);
    const body = await readJson(c);
    const patch: { name?: string; description?: string; isFavorite?: boolean; archived?: boolean } = {};
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name || name.length > 100) {
        return c.json({ success: false, error: 'プロジェクト名は1〜100文字で入力してください' }, 400);
      }
      patch.name = name;
    }
    if (typeof body?.description === 'string') patch.description = body.description.trim().slice(0, 500);
    if (typeof body?.isFavorite === 'boolean') patch.isFavorite = body.isFavorite;
    if (typeof body?.archived === 'boolean') patch.archived = body.archived;
    const project = await updateBannerProject(c.env.DB, c.req.param('id'), tenantId, patch);
    if (!project) return c.json({ success: false, error: 'プロジェクトが見つかりません' }, 404);
    return c.json({ success: true, data: serializeProject(project) });
  } catch (err) {
    console.error('PATCH /api/hq/banners/projects/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

hqBanners.post('/api/hq/banners/projects/:id/duplicate', async (c) => {
  try {
    const tenantId = tenantOf(c);
    const source = await getBannerProject(c.env.DB, c.req.param('id'), tenantId);
    if (!source) return c.json({ success: false, error: 'プロジェクトが見つかりません' }, 404);
    const staffId = c.get('staff')?.id ?? null;
    const copy = await createBannerProject(c.env.DB, {
      tenantId,
      name: `${source.name} のコピー`.slice(0, 100),
      description: source.description,
      createdBy: staffId,
    });
    const images = await listBannerImages(c.env.DB, { tenantId, projectId: source.id, limit: 100 });
    for (const image of images) {
      await createBannerImage(c.env.DB, {
        tenantId,
        projectId: copy.id,
        generationId: image.generation_id,
        mediaId: image.media_id,
        sequence: image.sequence,
        source: image.source,
        parentImageId: image.id,
        createdBy: staffId,
      });
    }
    const refreshed = await getBannerProject(c.env.DB, copy.id, tenantId);
    return c.json({ success: true, data: serializeProject(refreshed ?? copy) }, 201);
  } catch (err) {
    console.error('POST /api/hq/banners/projects/:id/duplicate error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ============================================================ generations

hqBanners.post('/api/hq/banners/projects/:id/generations', async (c) => {
  try {
    const tenantId = tenantOf(c);
    const project = await getBannerProject(c.env.DB, c.req.param('id'), tenantId);
    if (!project) return c.json({ success: false, error: 'プロジェクトが見つかりません' }, 404);
    if (project.archived_at) {
      return c.json({ success: false, error: 'アーカイブ済みのプロジェクトでは生成できません。復元してからお試しください' }, 409);
    }
    if (!c.env.OPENAI_API_KEY) {
      return c.json({ success: false, error: '画像生成の接続設定がまだありません。運営にお問い合わせください' }, 503);
    }

    const validation = validateBannerRequest(await readJson(c));
    if (!validation.ok || !validation.value) {
      return c.json({ success: false, error: validation.error }, 400);
    }
    const v = validation.value;
    const usage = await usageSnapshot(c, tenantId);
    const refused = refusal(usage, v.count);
    if (refused) {
      return c.json({ success: false, error: refused, data: { usage, needed: v.count } }, 409);
    }
    const quality = resolveBannerQuality(c.env.BANNER_IMAGE_QUALITY);

    // 参照画像はこの統括のライブラリにある、消していない画像だけ。
    if (v.referenceImageId) {
      const reference = await getBannerImageWithDetail(c.env.DB, v.referenceImageId, tenantId);
      if (!reference || reference.deleted_at) {
        return c.json({ success: false, error: '参照画像が見つかりません。ライブラリから選び直してください' }, 400);
      }
      if (!(reference.media.mime_type in UPLOAD_ALLOWED)) {
        return c.json({ success: false, error: '参照画像は PNG・JPEG・WebP の画像だけ使えます' }, 400);
      }
    }

    const finalPrompt = buildBannerPrompt({
      mode: v.mode,
      preset: v.preset,
      referenceMode: v.referenceMode,
      textLines: v.textLines,
      mainColor: v.mainColor,
      subColor: v.subColor,
      personOption: v.personOption,
      customPrompt: v.customPrompt,
      freePrompt: v.freePrompt,
    });
    const generation = await createBannerGeneration(c.env.DB, {
      tenantId,
      projectId: project.id,
      mode: v.mode,
      presetKey: v.preset.key,
      aspectRatio: v.preset.aspectRatio,
      apiSize: v.preset.apiSize,
      quality,
      textLines: v.textLines,
      mainColor: v.mainColor,
      subColor: v.subColor,
      personOption: v.personOption,
      customPrompt: v.customPrompt,
      freePrompt: v.freePrompt,
      finalPrompt,
      engine: 'openai',
      modelName: c.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL,
      requestedCount: v.count,
      unitsPerImage: 1,
      referenceImageId: v.referenceImageId,
      referenceMode: v.referenceMode,
      createdBy: c.get('staff')?.id ?? null,
    });
    await touchBannerProject(c.env.DB, project.id);
    return c.json({ success: true, data: serializeGeneration(generation) }, 201);
  } catch (err) {
    console.error('POST /api/hq/banners/projects/:id/generations error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

hqBanners.get('/api/hq/banners/generations/:id', async (c) => {
  const generation = await getBannerGeneration(c.env.DB, c.req.param('id'), tenantOf(c));
  if (!generation) return c.json({ success: false, error: '生成が見つかりません' }, 404);
  return c.json({ success: true, data: serializeGeneration(generation) });
});

/**
 * 1枚だけ生成して保存する。画面はこれを requested_count 回呼ぶ。
 *
 * 1リクエスト＝1枚にしているのは、画像生成に数十秒かかるため。
 * まとめて待つと途中で切れたときに全部消えるが、1枚ずつなら成功分が残る。
 */
hqBanners.post('/api/hq/banners/generations/:id/run', async (c) => {
  const tenantId = tenantOf(c);
  const db = c.env.DB;
  const generation = await getBannerGeneration(db, c.req.param('id'), tenantId);
  if (!generation) return c.json({ success: false, error: '生成が見つかりません' }, 404);

  const base = workerUrl(c);
  const finished = (g: BannerGeneration) => g.done_count + g.failed_count >= g.requested_count;
  if (generation.status === 'done' || generation.status === 'failed' || generation.status === 'canceled' || finished(generation)) {
    return c.json({ success: true, data: { generation: serializeGeneration(generation), image: null, finished: true } });
  }
  if (!c.env.OPENAI_API_KEY) {
    return c.json({ success: false, error: '画像生成の接続設定がまだありません。運営にお問い合わせください' }, 503);
  }

  // 上限は1枚ごとにも見る。作成後に別の生成で使い切っている場合がある。
  const usage = await usageSnapshot(c, tenantId);
  const refused = refusal(usage, 1);
  if (refused) {
    await updateBannerGenerationProgress(db, generation.id, {
      status: generation.done_count > 0 ? 'done' : 'failed',
      errorMessage: refused,
      markFinished: true,
    });
    const latest = await getBannerGeneration(db, generation.id, tenantId);
    return c.json({ success: true, data: { generation: serializeGeneration(latest!), image: null, finished: true } });
  }

  await updateBannerGenerationProgress(db, generation.id, { status: 'running', markStarted: true });
  const model = generation.model_name || c.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
  const sequence = generation.done_count + generation.failed_count + 1;

  try {
    // 参照画像（★V6 35-2）。R2 から読んで OpenAI へ添える。消えていれば分かる言葉で止める。
    let referenceImage: OpenAIReferenceImage | undefined;
    if (generation.reference_image_id) {
      const reference = await getBannerImageWithDetail(db, generation.reference_image_id, tenantId);
      const object = reference ? await c.env.IMAGES.get(reference.media.r2_key) : null;
      if (!reference || !object) {
        throw new ReferenceMissingError();
      }
      referenceImage = {
        bytes: new Uint8Array(await object.arrayBuffer()),
        mimeType: reference.media.mime_type,
        filename: reference.media.filename || 'reference',
      };
    }
    const result = await generateOpenAIImage({
      apiKey: c.env.OPENAI_API_KEY,
      model,
      prompt: generation.final_prompt,
      size: generation.api_size as '1024x1024' | '1536x1024' | '1024x1536',
      quality: generation.quality,
      referenceImage,
    });

    const project = await getBannerProject(db, generation.project_id, tenantId);
    const r2Key = `banner/${crypto.randomUUID()}.jpg`;
    await c.env.IMAGES.put(r2Key, result.bytes, {
      httpMetadata: { contentType: result.mimeType },
      customMetadata: { source: 'banner-generation', generationId: generation.id },
    });
    const { width, height } = sizeToDimensions(generation.api_size);
    let media: Media;
    try {
      media = await createMedia(db, {
        lineAccountId: null,
        kind: 'image',
        filename: `${safeFilenameBase(project?.name ?? 'banner')}-${sequence}.jpg`,
        mimeType: result.mimeType,
        sizeBytes: result.bytes.byteLength,
        r2Key,
        width,
        height,
        uploadedBy: c.get('staff')?.id ?? null,
      });
    } catch (error) {
      await c.env.IMAGES.delete(r2Key).catch(() => undefined);
      throw error;
    }
    const image = await createBannerImage(db, {
      tenantId,
      projectId: generation.project_id,
      generationId: generation.id,
      mediaId: media.id,
      sequence,
      // 描き直しは「元の画像の派生」として source='edited'。参考は新しい画像だが元をたどれるよう parent を持つ。
      source: generation.reference_mode === 'edit' ? 'edited' : 'generated',
      parentImageId: generation.reference_image_id ?? null,
      createdBy: c.get('staff')?.id ?? null,
    });
    await recordBannerUsage(db, {
      tenantId,
      generationId: generation.id,
      units: 1,
      reason: generation.reference_mode === 'edit' ? 'edit' : 'generate',
    });
    const nowDone = generation.done_count + 1;
    const isFinished = nowDone + generation.failed_count >= generation.requested_count;
    await updateBannerGenerationProgress(db, generation.id, {
      doneDelta: 1,
      status: isFinished ? 'done' : 'running',
      markFinished: isFinished,
    });
    await touchBannerProject(db, generation.project_id);

    const latest = await getBannerGeneration(db, generation.id, tenantId);
    const detail = await getBannerImageWithDetail(db, image.id, tenantId);
    return c.json({
      success: true,
      data: {
        generation: serializeGeneration(latest!),
        image: detail ? serializeImage(detail, base) : null,
        finished: isFinished,
      },
    });
  } catch (error) {
    const message = error instanceof OpenAIImageError
      ? error.userMessage
      : error instanceof ReferenceMissingError
        ? error.message
        : '画像の保存に失敗しました。もう一度お試しください';
    if (error instanceof OpenAIImageError) {
      console.warn('banner generation rejected:', error.kind, error.status);
    } else if (error instanceof ReferenceMissingError) {
      console.warn('banner generation rejected: reference image missing');
    } else {
      console.error('banner generation run error:', error);
    }
    // 失敗したら、その生成はそこで止める。成功分はそのまま残す。
    await updateBannerGenerationProgress(db, generation.id, {
      failedDelta: 1,
      status: generation.done_count > 0 ? 'done' : 'failed',
      errorMessage: message,
      markFinished: true,
    });
    const latest = await getBannerGeneration(db, generation.id, tenantId);
    return c.json({
      success: false,
      error: message,
      data: { generation: serializeGeneration(latest!), image: null, finished: true },
    }, error instanceof OpenAIImageError && error.kind === 'safety' ? 422 : error instanceof ReferenceMissingError ? 400 : 502);
  }
});

hqBanners.post('/api/hq/banners/generations/:id/cancel', async (c) => {
  const tenantId = tenantOf(c);
  const generation = await getBannerGeneration(c.env.DB, c.req.param('id'), tenantId);
  if (!generation) return c.json({ success: false, error: '生成が見つかりません' }, 404);
  if (generation.status === 'queued' || generation.status === 'running') {
    await updateBannerGenerationProgress(c.env.DB, generation.id, {
      status: generation.done_count > 0 ? 'done' : 'canceled',
      markFinished: true,
    });
  }
  const latest = await getBannerGeneration(c.env.DB, generation.id, tenantId);
  return c.json({ success: true, data: serializeGeneration(latest!) });
});

// ================================================================= images

hqBanners.get('/api/hq/banners/images', async (c) => {
  try {
    const tenantId = tenantOf(c);
    const limitRaw = Number(c.req.query('limit') ?? '30');
    const items = await listBannerImages(c.env.DB, {
      tenantId,
      projectId: c.req.query('projectId')?.trim() || undefined,
      favoriteOnly: c.req.query('favorite') === '1',
      presetKey: c.req.query('preset')?.trim() || undefined,
      query: c.req.query('q')?.trim() || undefined,
      before: c.req.query('before')?.trim() || undefined,
      limit: Number.isFinite(limitRaw) ? limitRaw : 30,
    });
    const base = workerUrl(c);
    const last = items[items.length - 1];
    return c.json({
      success: true,
      data: items.map((i) => serializeImage(i, base)),
      nextBefore: items.length >= Math.min(Math.max(limitRaw || 30, 1), 100) && last ? last.created_at : null,
    });
  } catch (err) {
    console.error('GET /api/hq/banners/images error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

hqBanners.get('/api/hq/banners/images/:id', async (c) => {
  const detail = await getBannerImageWithDetail(c.env.DB, c.req.param('id'), tenantOf(c));
  if (!detail || detail.deleted_at) return c.json({ success: false, error: '画像が見つかりません' }, 404);
  return c.json({ success: true, data: serializeImage(detail, workerUrl(c)) });
});

hqBanners.patch('/api/hq/banners/images/:id', async (c) => {
  try {
    const tenantId = tenantOf(c);
    const body = await readJson(c);
    const patch: { isFavorite?: boolean; projectId?: string } = {};
    if (typeof body?.isFavorite === 'boolean') patch.isFavorite = body.isFavorite;
    if (typeof body?.projectId === 'string') {
      const target = await getBannerProject(c.env.DB, body.projectId, tenantId);
      if (!target) return c.json({ success: false, error: '移動先のプロジェクトが見つかりません' }, 404);
      patch.projectId = target.id;
    }
    const existing = await getBannerImage(c.env.DB, c.req.param('id'), tenantId);
    if (!existing || existing.deleted_at) return c.json({ success: false, error: '画像が見つかりません' }, 404);
    await updateBannerImage(c.env.DB, existing.id, tenantId, patch);
    const detail = await getBannerImageWithDetail(c.env.DB, existing.id, tenantId);
    return c.json({ success: true, data: serializeImage(detail!, workerUrl(c)) });
  } catch (err) {
    console.error('PATCH /api/hq/banners/images/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 画像を一覧から外す。実体と店舗へ渡した分は残す（渡した先の配信を壊さない）。 */
hqBanners.delete('/api/hq/banners/images/:id', async (c) => {
  const tenantId = tenantOf(c);
  const existing = await getBannerImage(c.env.DB, c.req.param('id'), tenantId);
  if (!existing || existing.deleted_at) return c.json({ success: false, error: '画像が見つかりません' }, 404);
  await updateBannerImage(c.env.DB, existing.id, tenantId, { deleted: true });
  return c.json({ success: true, data: null });
});

/** 統括が手持ちの画像をプロジェクトへ取り込む。生成画像と同じように店舗へ渡せる。 */
hqBanners.post('/api/hq/banners/projects/:id/uploads', async (c) => {
  try {
    const tenantId = tenantOf(c);
    const project = await getBannerProject(c.env.DB, c.req.param('id'), tenantId);
    if (!project) return c.json({ success: false, error: 'プロジェクトが見つかりません' }, 404);
    const body = await readJson(c);
    const data = typeof body?.data === 'string' ? body.data : '';
    const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';
    if (!data) return c.json({ success: false, error: 'ファイルの中身がありません' }, 400);
    if (!filename) return c.json({ success: false, error: 'ファイル名がありません' }, 400);

    let base64 = data;
    let mimeType = typeof body?.mimeType === 'string' ? body.mimeType : '';
    const dataUrl = /^data:([^;]+);base64,(.+)$/.exec(base64);
    if (dataUrl) {
      mimeType = dataUrl[1];
      base64 = dataUrl[2];
    }
    const spec = UPLOAD_ALLOWED[mimeType];
    if (!spec) {
      return c.json({ success: false, error: '画像は PNG・JPEG・WebP のみ取り込めます' }, 400);
    }
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    } catch {
      return c.json({ success: false, error: 'ファイルの中身を読み取れませんでした' }, 400);
    }
    if (bytes.byteLength > UPLOAD_MAX_BYTES) {
      return c.json({ success: false, error: 'ファイルが大きすぎます（上限 10MB）' }, 413);
    }
    if (!hasImageSignature(bytes, mimeType)) {
      return c.json({ success: false, error: 'ファイルの実際の形式が、選択された形式と一致しません' }, 400);
    }

    const r2Key = `banner/${crypto.randomUUID()}.${spec.ext}`;
    await c.env.IMAGES.put(r2Key, bytes, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename, source: 'banner-upload' },
    });
    let media: Media;
    try {
      media = await createMedia(c.env.DB, {
        lineAccountId: null,
        kind: 'image',
        filename,
        mimeType,
        sizeBytes: bytes.byteLength,
        r2Key,
        width: typeof body?.width === 'number' ? body.width : null,
        height: typeof body?.height === 'number' ? body.height : null,
        uploadedBy: c.get('staff')?.id ?? null,
      });
    } catch (error) {
      await c.env.IMAGES.delete(r2Key).catch(() => undefined);
      throw error;
    }
    const image = await createBannerImage(c.env.DB, {
      tenantId,
      projectId: project.id,
      generationId: null,
      mediaId: media.id,
      sequence: Number(project.image_count ?? 0) + 1,
      source: 'upload',
      createdBy: c.get('staff')?.id ?? null,
    });
    await touchBannerProject(c.env.DB, project.id);
    const detail = await getBannerImageWithDetail(c.env.DB, image.id, tenantId);
    return c.json({ success: true, data: serializeImage(detail!, workerUrl(c)) }, 201);
  } catch (err) {
    console.error('POST /api/hq/banners/projects/:id/uploads error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ============================================================== deliveries

/**
 * 画像を店舗（LINE公式アカウント）へ渡す。
 *
 * 店舗ごとに実体を複製し、店舗の登録メディアとして1行作る。同じ店舗へ
 * 二度渡しても増えない。統括側の画像を消しても、渡した先は残る。
 */
hqBanners.post('/api/hq/banners/images/:id/deliver', async (c) => {
  try {
    const tenantId = tenantOf(c);
    const staff = c.get('staff');
    const image = await getBannerImageWithDetail(c.env.DB, c.req.param('id'), tenantId);
    if (!image || image.deleted_at) return c.json({ success: false, error: '画像が見つかりません' }, 404);

    const body = await readJson(c);
    const rawIds = Array.isArray(body?.lineAccountIds) ? body.lineAccountIds : [];
    const lineAccountIds = [...new Set(rawIds.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))];
    if (lineAccountIds.length === 0) {
      return c.json({ success: false, error: '渡す先の店舗を1つ以上選んでください' }, 400);
    }
    if (lineAccountIds.length > 50) {
      return c.json({ success: false, error: '一度に渡せる店舗は50件までです' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, staff, lineAccountIds)) {
      return c.json({ success: false, error: '渡す先に、この統括の店舗ではないものが含まれています' }, 404);
    }

    const results: Array<{ lineAccountId: string; mediaId: string; alreadyDelivered: boolean }> = [];
    for (const lineAccountId of lineAccountIds) {
      const existing = await getBannerImageDelivery(c.env.DB, image.id, lineAccountId);
      if (existing) {
        results.push({ lineAccountId, mediaId: existing.media_id, alreadyDelivered: true });
        continue;
      }
      const source = await c.env.IMAGES.get(image.media.r2_key);
      if (!source) {
        return c.json({ success: false, error: '画像の実体が見つかりません。もう一度生成してください' }, 409);
      }
      const bytes = new Uint8Array(await source.arrayBuffer());
      const ext = image.media.r2_key.split('.').pop() || 'jpg';
      const r2Key = `media/${crypto.randomUUID()}.${ext}`;
      await c.env.IMAGES.put(r2Key, bytes, {
        httpMetadata: { contentType: image.media.mime_type },
        customMetadata: { originalFilename: image.media.filename, source: 'banner-delivery', bannerImageId: image.id },
      });
      let media: Media;
      try {
        media = await createMedia(c.env.DB, {
          lineAccountId,
          kind: 'image',
          filename: image.media.filename,
          mimeType: image.media.mime_type,
          sizeBytes: bytes.byteLength,
          r2Key,
          width: image.media.width,
          height: image.media.height,
          uploadedBy: staff?.id ?? null,
        });
      } catch (error) {
        await c.env.IMAGES.delete(r2Key).catch(() => undefined);
        throw error;
      }
      await createBannerImageDelivery(c.env.DB, {
        bannerImageId: image.id,
        lineAccountId,
        mediaId: media.id,
        deliveredBy: staff?.id ?? null,
      });
      results.push({ lineAccountId, mediaId: media.id, alreadyDelivered: false });
    }
    const detail = await getBannerImageWithDetail(c.env.DB, image.id, tenantId);
    return c.json({
      success: true,
      data: { image: serializeImage(detail!, workerUrl(c)), deliveries: results },
    });
  } catch (err) {
    console.error('POST /api/hq/banners/images/:id/deliver error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
