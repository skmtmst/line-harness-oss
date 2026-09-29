/**
 * 飲食店向け「Googleビジネス」第3段：投稿（最新情報・イベント・特典）。
 * 設計正本：Googleビジネス正本.pen GB-4（MAozg）/ GB-5（fxNNJ・hZb3O）/ GB-6（sZEnK）
 *           / GB-7（Z2XI3）/ GB-8（x3GFSa）/ GB-14（jqSak）
 *
 * 考え方
 * - 投稿は rt_google_posts に1行＝1投稿として持つ。「案（draft）→ 確認 → 送信」は第2段と同じ流れだが、
 *   送信は更新ではなく作成（Local Posts APIには冪等キーが無い）。競合検出ではなく重複検出になる。
 * - 送信直前に必ずGoogle側の最新を取り直し、pending_confirmの行に限りcontent_fingerprintで照合してから
 *   作成する（同じ内容を二重に送らない）。
 * - 第3段は「今すぐ公開」のみ。日時指定の予約投稿・繰り返し開催・投稿の編集・動画は受け付けない
 *   （画面には見えるが押せない。Google側の実際の挙動が未検証なため）。
 * - 画像は社内の登録メディアから選ぶ（Local Postsのmediaはpublic URLのsourceUrlしか対応しないため）。
 * - 書き込みは GOOGLE_BUSINESS_WRITE_ENABLED=true の環境だけ。送信・削除は owner / admin だけ。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getMediaById } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { auditLog } from '../lib/audit-log.js';
import { dbFor } from '../services/db-router.js';
import { GoogleBusinessError, type RequestOptions } from '../services/google-business.js';
import { todayIn } from '../services/google-business-profile.js';
import {
  createLocalPost,
  deleteLocalPost,
  fingerprintOfGooglePost,
  listLocalPosts,
  postFingerprintOf,
  validatePostDraft,
  type GooglePost,
  type LocalPostKind,
  type PostCta,
  type PostCtaType,
  type PostDraft,
  type PostOffer,
  type PostSchedule,
} from '../services/google-business-posts.js';
import {
  accessTokenFor,
  fail,
  googleAccessGuard,
  googleErrorResponse,
  nowIso,
  requireConnectedStore,
  setConnectionStatus,
  storeFor,
  writeEnabled,
  type StoreContext,
} from './restaurant-google.js';

export const restaurantGooglePosts = new Hono<Env>();
restaurantGooglePosts.use('/api/restaurant-test/google/*', googleAccessGuard);

const LIST_LIMIT_MAX = 100;

type PostStatus = 'draft' | 'scheduled' | 'pending_confirm' | 'accepted' | 'published' | 'rejected' | 'failed' | 'cancelled' | 'deleted';
type PostFilter = 'all' | 'draft' | 'published' | 'attention' | 'scheduled';

interface PostRow {
  id: string;
  store_id: string;
  kind: LocalPostKind | 'alert';
  origin: 'admin' | 'google';
  summary: string;
  title: string | null;
  event_start_date: string | null;
  event_start_time: string | null;
  event_end_date: string | null;
  event_end_time: string | null;
  cta_type: PostCtaType | 'none' | null;
  cta_url: string | null;
  coupon_code: string | null;
  redeem_online_url: string | null;
  terms_conditions: string | null;
  media_json: string;
  publish_mode: 'now' | 'scheduled';
  publish_at: string | null;
  status: PostStatus;
  google_post_name: string | null;
  google_state: string | null;
  search_url: string | null;
  google_create_time: string | null;
  google_update_time: string | null;
  content_fingerprint: string | null;
  request_id: string | null;
  staff_id: string | null;
  staff_name: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  published_at: string | null;
  checked_at: string | null;
  deleted_at: string | null;
  updated_at: string;
}

interface MediaRef {
  mediaId: string;
  filename: string;
  sourceUrl: string;
}

function parseMedia(json: string): MediaRef[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as MediaRef[]) : [];
  } catch {
    return [];
  }
}

/** Google側から届いた画像URL（sourceUrl）を media_json 用に変換する。Google発の画像には社内の登録メディアIDが無い。 */
function mediaRefsFromUrls(urls: string[]): MediaRef[] {
  return urls.map((url) => ({ mediaId: '', filename: '', sourceUrl: url }));
}

/** DB行 → 投稿案（Googleへ送る形）。 */
function draftFromRow(row: PostRow): PostDraft {
  const schedule: PostSchedule | null =
    row.event_start_date && row.event_start_time && row.event_end_date && row.event_end_time
      ? { startDate: row.event_start_date, startTime: row.event_start_time, endDate: row.event_end_date, endTime: row.event_end_time }
      : null;
  const cta: PostCta | null = row.cta_type && row.cta_type !== 'none' ? { type: row.cta_type, url: row.cta_url } : null;
  const offer: PostOffer | null =
    row.kind === 'offer' ? { couponCode: row.coupon_code, redeemOnlineUrl: row.redeem_online_url, termsConditions: row.terms_conditions } : null;
  return {
    kind: row.kind === 'alert' ? 'standard' : row.kind,
    summary: row.summary,
    title: row.title,
    schedule,
    cta,
    offer,
    media: parseMedia(row.media_json).map((m) => ({ sourceUrl: m.sourceUrl })),
  };
}

function publicPost(row: PostRow) {
  return {
    id: row.id,
    kind: row.kind,
    origin: row.origin,
    summary: row.summary,
    title: row.title,
    schedule:
      row.event_start_date && row.event_start_time && row.event_end_date && row.event_end_time
        ? { startDate: row.event_start_date, startTime: row.event_start_time, endDate: row.event_end_date, endTime: row.event_end_time }
        : null,
    cta: row.cta_type && row.cta_type !== 'none' ? { type: row.cta_type, url: row.cta_url } : null,
    offer: row.kind === 'offer' ? { couponCode: row.coupon_code, redeemOnlineUrl: row.redeem_online_url, termsConditions: row.terms_conditions } : null,
    media: parseMedia(row.media_json),
    publishMode: row.publish_mode,
    status: row.status,
    googleState: row.google_state,
    searchUrl: row.search_url,
    staffName: row.staff_name,
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

async function postFor(c: Context<Env>, storeId: string, id: string): Promise<PostRow | null> {
  return dbFor(c.env, storeId).prepare('SELECT * FROM rt_google_posts WHERE id = ? AND store_id = ? LIMIT 1').bind(id, storeId).first<PostRow>();
}

async function storeTimeZone(c: Context<Env>, storeId: string): Promise<string> {
  const row = await dbFor(c.env, storeId).prepare('SELECT timezone FROM rt_stores WHERE id = ? LIMIT 1').bind(storeId).first<{ timezone: string | null }>();
  return row?.timezone || 'Asia/Tokyo';
}

/** GB-8：登録メディア（社内）から選んだ画像を投稿用に解決する。参照するだけで元ファイルは変更しない。 */
async function resolveMedia(c: Context<Env>, store: StoreContext, mediaId: string | null): Promise<{ ok: true; media: MediaRef[] } | { ok: false; error: string }> {
  if (!mediaId) return { ok: true, media: [] };
  const media = await getMediaById(dbFor(c.env), mediaId, store.lineAccountId);
  if (!media || media.kind !== 'image' || media.archived_at) return { ok: false, error: '登録メディアに画像が見つかりません' };
  const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
  const sourceUrl = media.public_url ?? `${workerUrl}/images/${media.r2_key}`;
  return { ok: true, media: [{ mediaId: media.id, filename: media.filename, sourceUrl }] };
}

interface DraftInput {
  kind: LocalPostKind;
  summary: string;
  title: string | null;
  schedule: PostSchedule | null;
  cta: PostCta | null;
  offer: PostOffer | null;
  mediaId: string | null;
}

function parseDraftInput(body: Record<string, unknown>): DraftInput | null {
  const kind = body.kind;
  if (kind !== 'standard' && kind !== 'event' && kind !== 'offer') return null;
  const summary = typeof body.summary === 'string' ? body.summary : '';
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
  const rawSchedule = body.schedule as Record<string, unknown> | undefined;
  const schedule: PostSchedule | null =
    rawSchedule && typeof rawSchedule.startDate === 'string' && typeof rawSchedule.startTime === 'string' && typeof rawSchedule.endDate === 'string' && typeof rawSchedule.endTime === 'string'
      ? { startDate: rawSchedule.startDate, startTime: rawSchedule.startTime, endDate: rawSchedule.endDate, endTime: rawSchedule.endTime }
      : null;
  const rawCta = body.cta as Record<string, unknown> | undefined;
  const ctaTypes: PostCtaType[] = ['book', 'order', 'shop', 'learn_more', 'sign_up', 'call'];
  const cta: PostCta | null =
    rawCta && typeof rawCta.type === 'string' && (ctaTypes as string[]).includes(rawCta.type)
      ? { type: rawCta.type as PostCtaType, url: typeof rawCta.url === 'string' && rawCta.url ? rawCta.url : null }
      : null;
  const rawOffer = body.offer as Record<string, unknown> | undefined;
  const offer: PostOffer | null =
    kind === 'offer'
      ? {
          couponCode: typeof rawOffer?.couponCode === 'string' && rawOffer.couponCode ? rawOffer.couponCode : null,
          redeemOnlineUrl: typeof rawOffer?.redeemOnlineUrl === 'string' && rawOffer.redeemOnlineUrl ? rawOffer.redeemOnlineUrl : null,
          termsConditions: typeof rawOffer?.termsConditions === 'string' && rawOffer.termsConditions ? rawOffer.termsConditions : null,
        }
      : null;
  const mediaId = typeof body.mediaId === 'string' && body.mediaId ? body.mediaId : null;
  return { kind, summary, title, schedule, cta, offer, mediaId };
}

async function insertDraft(c: Context<Env>, store: StoreContext, input: DraftInput, media: MediaRef[]): Promise<PostRow> {
  const id = crypto.randomUUID();
  const staff = c.get('staff');
  await dbFor(c.env, store.id)
    .prepare(
      `INSERT INTO rt_google_posts
         (id, store_id, kind, summary, title, event_start_date, event_start_time, event_end_date, event_end_time,
          cta_type, cta_url, coupon_code, redeem_online_url, terms_conditions, media_json, status, staff_id, staff_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    )
    .bind(
      id,
      store.id,
      input.kind,
      input.summary,
      input.title,
      input.schedule?.startDate ?? null,
      input.schedule?.startTime ?? null,
      input.schedule?.endDate ?? null,
      input.schedule?.endTime ?? null,
      input.cta?.type ?? null,
      input.cta?.url ?? null,
      input.offer?.couponCode ?? null,
      input.offer?.redeemOnlineUrl ?? null,
      input.offer?.termsConditions ?? null,
      JSON.stringify(media),
      staff?.id ?? null,
      staff?.name ?? null,
    )
    .run();
  return (await postFor(c, store.id, id))!;
}

async function updateDraft(c: Context<Env>, store: StoreContext, id: string, input: DraftInput, media: MediaRef[]): Promise<void> {
  await dbFor(c.env, store.id)
    .prepare(
      `UPDATE rt_google_posts SET
         kind = ?, summary = ?, title = ?, event_start_date = ?, event_start_time = ?, event_end_date = ?, event_end_time = ?,
         cta_type = ?, cta_url = ?, coupon_code = ?, redeem_online_url = ?, terms_conditions = ?, media_json = ?, updated_at = ?
       WHERE id = ? AND store_id = ?`,
    )
    .bind(
      input.kind,
      input.summary,
      input.title,
      input.schedule?.startDate ?? null,
      input.schedule?.startTime ?? null,
      input.schedule?.endDate ?? null,
      input.schedule?.endTime ?? null,
      input.cta?.type ?? null,
      input.cta?.url ?? null,
      input.offer?.couponCode ?? null,
      input.offer?.redeemOnlineUrl ?? null,
      input.offer?.termsConditions ?? null,
      JSON.stringify(media),
      nowIso(),
      id,
      store.id,
    )
    .run();
}

type PostStatusPatch = Partial<{ status: PostStatus; error: string | null; requestId: string | null; sentAt: string | null; publishedAt: string | null; checkedAt: string | null; deletedAt: string | null; contentFingerprint: string | null; googlePostName: string | null; googleState: string | null; searchUrl: string | null; googleCreateTime: string | null; googleUpdateTime: string | null; origin: 'admin' | 'google'; mediaJson: string }>;

async function setStatusForEnv(env: Env['Bindings'], storeId: string, id: string, patch: PostStatusPatch): Promise<void> {
  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [nowIso()];
  const columns: Record<string, unknown> = {
    status: patch.status,
    error: patch.error,
    request_id: patch.requestId,
    sent_at: patch.sentAt,
    published_at: patch.publishedAt,
    checked_at: patch.checkedAt,
    deleted_at: patch.deletedAt,
    content_fingerprint: patch.contentFingerprint,
    google_post_name: patch.googlePostName,
    google_state: patch.googleState,
    search_url: patch.searchUrl,
    google_create_time: patch.googleCreateTime,
    google_update_time: patch.googleUpdateTime,
    origin: patch.origin,
    media_json: patch.mediaJson,
  };
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  values.push(id, storeId);
  await dbFor(env, storeId)
    .prepare(`UPDATE rt_google_posts SET ${sets.join(', ')} WHERE id = ? AND store_id = ?`)
    .bind(...values)
    .run();
}

async function setStatus(c: Context<Env>, storeId: string, id: string, patch: PostStatusPatch): Promise<void> {
  await setStatusForEnv(c.env, storeId, id, patch);
}

// ---------- GB-4：一覧 ----------

restaurantGooglePosts.get('/api/restaurant-test/google/posts', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const filter = (c.req.query('filter') ?? 'all') as PostFilter;
  const kind = c.req.query('kind') ?? 'all';
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1);
  const perPage = Math.min(LIST_LIMIT_MAX, Math.max(1, Number.parseInt(c.req.query('per_page') ?? '20', 10) || 20));

  const rows = (await dbFor(c.env, store.id).prepare('SELECT * FROM rt_google_posts WHERE store_id = ? ORDER BY created_at DESC LIMIT 1000').bind(store.id).all<PostRow>()).results;

  const byKind = (r: PostRow) => kind === 'all' || r.kind === kind;
  const byFilter = (r: PostRow) =>
    filter === 'all' ||
    (filter === 'draft' && r.status === 'draft') ||
    (filter === 'published' && r.status === 'published') ||
    (filter === 'attention' && (r.status === 'rejected' || r.status === 'failed')) ||
    (filter === 'scheduled' && r.status === 'scheduled');
  // deleted（Googleから消えた／削除した）も「すべて」には残す。理由が分からないまま消えたように
  // 見えないようにするため（GB-17統合前はこの一覧だけが唯一の記録）。
  const filtered = rows.filter((r) => byKind(r) && byFilter(r));
  const counts = {
    all: rows.length,
    draft: rows.filter((r) => r.status === 'draft').length,
    published: rows.filter((r) => r.status === 'published').length,
    attention: rows.filter((r) => r.status === 'rejected' || r.status === 'failed').length,
    scheduled: rows.filter((r) => r.status === 'scheduled').length,
  };
  const staff = c.get('staff');
  return c.json({
    success: true,
    posts: filtered.slice((page - 1) * perPage, page * perPage).map(publicPost),
    total: filtered.length,
    page,
    perPage,
    counts,
    writeEnabled: writeEnabled(c.env),
    permissions: { canPublish: staff?.role === 'owner' || staff?.role === 'admin' },
  });
});

// ---------- 取り込み（sync） ----------

/** Google側の投稿一覧をDBへ写す。手動sync（下のエンドポイント）と定期再同期の両方から使う。 */
export async function applyGooglePostsSync(env: Env['Bindings'], storeId: string, googlePosts: GooglePost[]): Promise<void> {
  const rows = (await dbFor(env, storeId).prepare('SELECT * FROM rt_google_posts WHERE store_id = ?').bind(storeId).all<PostRow>()).results;
  const byName = new Map(rows.filter((r) => r.google_post_name).map((r) => [r.google_post_name as string, r]));
  const seenNames = new Set<string>();
  const now = nowIso();

  for (const post of googlePosts) {
    seenNames.add(post.name);
    const stateStatus: PostStatus = post.state === 'LIVE' ? 'published' : post.state === 'REJECTED' ? 'rejected' : post.state === 'SCHEDULED' ? 'scheduled' : 'accepted';
    const existing = byName.get(post.name);
    if (existing) {
      await setStatusForEnv(env, storeId, existing.id, {
        status: stateStatus,
        googleState: post.state,
        searchUrl: post.searchUrl,
        googleUpdateTime: post.updateTime,
        checkedAt: now,
        publishedAt: stateStatus === 'published' && !existing.published_at ? now : undefined,
        // Google発の投稿（origin='google'）はGoogle側が正なので、画像も毎回最新化する（過去の取りこぼし分もここで自己修復する）。
        // アプリ発（origin='admin'）は社内の登録メディア参照を保持するため触らない。
        mediaJson: existing.origin === 'google' ? JSON.stringify(mediaRefsFromUrls(post.mediaUrls)) : undefined,
      });
      continue;
    }
    // pending_confirm の行に限り、送信直後にできた投稿を指紋で照合して確定させる（結果不明の解消）。
    let matched: PostRow | null = null;
    for (const row of rows) {
      if (row.status !== 'pending_confirm' || !row.content_fingerprint || !row.sent_at) continue;
      if (row.google_post_name) continue;
      if (post.createTime && post.createTime < row.sent_at) continue;
      if ((await fingerprintOfGooglePost(post)) === row.content_fingerprint) {
        matched = row;
        break;
      }
    }
    if (matched) {
      await setStatusForEnv(env, storeId, matched.id, {
        status: stateStatus,
        googlePostName: post.name,
        googleState: post.state,
        searchUrl: post.searchUrl,
        googleCreateTime: post.createTime,
        googleUpdateTime: post.updateTime,
        checkedAt: now,
        publishedAt: stateStatus === 'published' ? now : undefined,
      });
      continue;
    }
    // Google側で直接作られた投稿。編集はさせず、一覧に「Googleで作成」として出す。
    const id = crypto.randomUUID();
    await dbFor(env, storeId)
      .prepare(
        `INSERT INTO rt_google_posts
           (id, store_id, kind, origin, summary, title, media_json, status, google_post_name, google_state, search_url,
            google_create_time, google_update_time, checked_at, published_at)
         VALUES (?, ?, ?, 'google', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        storeId,
        post.kind === 'unknown' || post.kind === 'alert' ? 'standard' : post.kind,
        post.summary,
        post.title,
        JSON.stringify(mediaRefsFromUrls(post.mediaUrls)),
        stateStatus,
        post.name,
        post.state,
        post.searchUrl,
        post.createTime,
        post.updateTime,
        now,
        stateStatus === 'published' ? now : null,
      )
      .run();
  }

  // Google側から消えた公開済み投稿を検知する。
  for (const row of rows) {
    if (row.status === 'published' && row.google_post_name && !seenNames.has(row.google_post_name)) {
      await setStatusForEnv(env, storeId, row.id, { status: 'deleted', deletedAt: now, checkedAt: now });
    }
  }
}

restaurantGooglePosts.post('/api/restaurant-test/google/posts/sync', async (c) => {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  const { store, connection } = ctx;
  let options: RequestOptions;
  try {
    options = { fetch, accessToken: await accessTokenFor(c, connection) };
  } catch (error) {
    return googleErrorResponse(c, error);
  }

  let googlePosts: GooglePost[];
  try {
    googlePosts = await listLocalPosts(options, connection.location_name!);
  } catch (error) {
    if (error instanceof GoogleBusinessError && error.kind === 'no_permission') await setConnectionStatus(c, store.id, 'no_permission', 'no_permission');
    return googleErrorResponse(c, error);
  }

  await applyGooglePostsSync(c.env, store.id, googlePosts);
  return c.json({ success: true });
});

// ---------- 下書き ----------

restaurantGooglePosts.post('/api/restaurant-test/google/posts', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const input = parseDraftInput(body);
  if (!input) return fail(c, 400, 'kind が不正です', { code: 'invalid_request' });
  const mediaResult = await resolveMedia(c, store, input.mediaId);
  if (!mediaResult.ok) return fail(c, 404, mediaResult.error, { code: 'media_not_found' });
  const row = await insertDraft(c, store, input, mediaResult.media);
  return c.json({ success: true, post: publicPost(row) });
});

restaurantGooglePosts.get('/api/restaurant-test/google/posts/:id', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const row = await postFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '投稿が見つかりません');
  const staff = c.get('staff');
  return c.json({
    success: true,
    post: publicPost(row),
    store: { id: store.id, name: store.name },
    writeEnabled: writeEnabled(c.env),
    canPublish: staff?.role === 'owner' || staff?.role === 'admin',
  });
});

restaurantGooglePosts.put('/api/restaurant-test/google/posts/:id', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const row = await postFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '投稿が見つかりません');
  if (row.status !== 'draft') return fail(c, 409, 'この投稿は編集できません', { code: 'not_editable' });
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const input = parseDraftInput(body);
  if (!input) return fail(c, 400, 'kind が不正です', { code: 'invalid_request' });
  const mediaResult = await resolveMedia(c, store, input.mediaId);
  if (!mediaResult.ok) return fail(c, 404, mediaResult.error, { code: 'media_not_found' });
  await updateDraft(c, store, row.id, input, mediaResult.media);
  return c.json({ success: true, post: publicPost((await postFor(c, store.id, row.id))!) });
});

restaurantGooglePosts.post('/api/restaurant-test/google/posts/:id/cancel', async (c) => {
  const store = await storeFor(c);
  if (!store) return fail(c, 404, 'このLINEアカウントに店舗が紐付いていません');
  const row = await postFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '投稿が見つかりません');
  if (row.status !== 'draft' && row.status !== 'failed') return fail(c, 409, 'この投稿は取り消せません', { code: 'not_cancellable' });
  await setStatus(c, store.id, row.id, { status: 'cancelled' });
  return c.json({ success: true, post: publicPost((await postFor(c, store.id, row.id))!) });
});

// ---------- 公開 ----------

restaurantGooglePosts.post('/api/restaurant-test/google/posts/:id/publish', requireRole('owner', 'admin'), async (c) => {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  const { store, connection } = ctx;
  const row = await postFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '投稿が見つかりません');
  const body = await c.req.json<{ confirmed?: boolean }>().catch(() => ({}) as { confirmed?: boolean });
  if (body.confirmed !== true) return fail(c, 400, '投稿先・種類・本文の確認が必要です', { code: 'confirmation_required' });
  if (!writeEnabled(c.env)) return fail(c, 403, 'この環境ではGoogleへ投稿できません', { code: 'write_disabled' });
  if (row.status === 'published' || row.status === 'accepted') return fail(c, 409, 'この投稿はすでに送信済みです', { code: 'already_sent' });
  if (row.status === 'cancelled' || row.status === 'deleted') return fail(c, 409, 'この投稿は取り消されています', { code: 'cancelled' });
  if (row.publish_mode === 'scheduled') return fail(c, 400, '日時指定の投稿はこの環境では未対応です', { code: 'not_supported' });

  const timeZone = await storeTimeZone(c, store.id);
  const draft = draftFromRow(row);
  const validated = validatePostDraft(draft, todayIn(timeZone));
  if (!validated.ok) return fail(c, 400, `投稿の内容を見直してください（${validated.reason}）`, { code: 'invalid_request' });

  let options: RequestOptions;
  try {
    options = { fetch, accessToken: await accessTokenFor(c, connection) };
  } catch (error) {
    return googleErrorResponse(c, error);
  }

  const fingerprint = await postFingerprintOf(validated.draft);

  // 送信直前にGoogle側を取り直す。既に投稿名を持っていればそれを確認し、無ければ一覧から内容照合で探す
  // （Local Posts APIには冪等キーが無いため、内容照合が二重投稿防止の唯一の手段）。
  try {
    if (row.google_post_name) {
      return c.json({ success: true, alreadyPublished: true, post: publicPost((await postFor(c, store.id, row.id))!) });
    }
    if (row.status === 'pending_confirm' && row.content_fingerprint === fingerprint && row.sent_at) {
      const existing = await listLocalPosts(options, connection.location_name!);
      for (const p of existing) {
        if (!p.createTime || p.createTime < row.sent_at) continue;
        if ((await fingerprintOfGooglePost(p)) !== fingerprint) continue;
        await setStatus(c, store.id, row.id, {
          status: p.state === 'LIVE' ? 'published' : p.state === 'REJECTED' ? 'rejected' : 'accepted',
          googlePostName: p.name,
          googleState: p.state,
          searchUrl: p.searchUrl,
          googleCreateTime: p.createTime,
          checkedAt: nowIso(),
          publishedAt: p.state === 'LIVE' ? nowIso() : undefined,
        });
        return c.json({ success: true, alreadyPublished: true, post: publicPost((await postFor(c, store.id, row.id))!) });
      }
    }
  } catch (error) {
    if (error instanceof GoogleBusinessError && error.kind === 'no_permission') await setConnectionStatus(c, store.id, 'no_permission', 'no_permission');
    return googleErrorResponse(c, error);
  }

  const requestId = crypto.randomUUID();
  await setStatus(c, store.id, row.id, { status: 'pending_confirm', requestId, sentAt: nowIso(), contentFingerprint: fingerprint });
  try {
    const created = await createLocalPost(options, connection.location_name!, validated.draft);
    await setStatus(c, store.id, row.id, {
      status: created.state === 'LIVE' ? 'published' : created.state === 'REJECTED' ? 'rejected' : 'accepted',
      googlePostName: created.name,
      googleState: created.state,
      searchUrl: created.searchUrl,
      googleCreateTime: created.createTime,
      googleUpdateTime: created.updateTime,
      publishedAt: created.state === 'LIVE' ? nowIso() : undefined,
    });
    auditLog(c, 'restaurant.google.post.publish', { id: row.id, kind: 'rt_google_post' }, { lineAccountId: store.lineAccountId });
    return c.json({ success: true, alreadyPublished: false, post: publicPost((await postFor(c, store.id, row.id))!) });
  } catch (error) {
    const kind = error instanceof GoogleBusinessError ? error.kind : 'unknown';
    // 通信結果が不明（ネットワーク断・5xx）ならpending_confirmのまま残し、次回のsyncで内容照合して確定させる。
    const unknownResult = kind === 'unavailable' || kind === 'unknown';
    const detail = error instanceof GoogleBusinessError && error.message && !error.message.startsWith('google_') ? error.message : null;
    if (!unknownResult) await setStatus(c, store.id, row.id, { status: 'failed', error: detail ?? kind });
    auditLog(c, 'restaurant.google.post.publish', { id: row.id, kind: 'rt_google_post' }, { result: 'failed', lineAccountId: store.lineAccountId });
    if (kind === 'no_permission') await setConnectionStatus(c, store.id, 'no_permission', 'no_permission');
    if (kind === 'invalid_request') {
      return fail(c, 400, `Googleに受け付けられない内容です${detail ? `（${detail}）` : ''}`, {
        code: 'invalid_request',
        post: publicPost((await postFor(c, store.id, row.id))!),
      });
    }
    return googleErrorResponse(c, error);
  }
});

restaurantGooglePosts.post('/api/restaurant-test/google/posts/:id/remove', requireRole('owner', 'admin'), async (c) => {
  const ctx = await requireConnectedStore(c);
  if (ctx instanceof Response) return ctx;
  const { store, connection } = ctx;
  const row = await postFor(c, store.id, c.req.param('id'));
  if (!row) return fail(c, 404, '投稿が見つかりません');
  const body = await c.req.json<{ confirmed?: boolean }>().catch(() => ({}) as { confirmed?: boolean });
  if (body.confirmed !== true) return fail(c, 400, '削除の確認が必要です', { code: 'confirmation_required' });
  if (!writeEnabled(c.env)) return fail(c, 403, 'この環境ではGoogleを操作できません', { code: 'write_disabled' });
  if (!row.google_post_name) return fail(c, 409, 'まだGoogleへ公開されていません', { code: 'not_published' });

  let options: RequestOptions;
  try {
    options = { fetch, accessToken: await accessTokenFor(c, connection) };
  } catch (error) {
    return googleErrorResponse(c, error);
  }
  try {
    await deleteLocalPost(options, row.google_post_name);
    await setStatus(c, store.id, row.id, { status: 'deleted', deletedAt: nowIso() });
    auditLog(c, 'restaurant.google.post.remove', { id: row.id, kind: 'rt_google_post' }, { lineAccountId: store.lineAccountId });
    return c.json({ success: true, post: publicPost((await postFor(c, store.id, row.id))!) });
  } catch (error) {
    const kind = error instanceof GoogleBusinessError ? error.kind : 'unknown';
    if (kind === 'not_found') {
      await setStatus(c, store.id, row.id, { status: 'deleted', deletedAt: nowIso() });
      return c.json({ success: true, post: publicPost((await postFor(c, store.id, row.id))!) });
    }
    return googleErrorResponse(c, error);
  }
});
