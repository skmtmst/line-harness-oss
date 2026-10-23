import { buildCursorListResponse } from '../lib/list-paging.js';
import { sqlIdSet } from '@line-crm/db/id-queries';
import { inputError } from '../lib/input-errors.js';
import { getPublicationThirtyDayViews } from '@line-crm/db';

import { findRewardedAdoptedDuplicate, getEffectivePhotoRewardPolicy, jstNow, publishPhoto, savePhotoPublicationOrder, nextVersionToken, toJstString } from '@line-crm/db';
import type { Env } from '../worker-env.js';

import { getFileScanBySubject } from '../services/file-scan.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { photoRewardDisplayState, PHOTO_REWARD_REASON_LABELS, PHOTO_REWARD_STALE_MS } from '../services/photo-reward-sync.js';
import { petCallName } from '../services/nen-pet-name.js';
import { syncNenHealthTags } from '../services/nen-tag-sync.js';
import { photoPageSize, photoPageOffset, PHOTO_REWARD_STATE_CASE } from './nen-members-definition.js';
import type { Context } from 'hono';

export const put__api_nen_members_care_flags_id_1 = async (c: Context<Env, "/api/nen-members/care-flags/:id">) => {
  const body = await c.req.json<{ status?: string; adviceReady?: boolean; expectedUpdatedAt?: string }>().catch(() => null);
  if (!body || !['active', 'resolved'].includes(String(body.status))) return inputError(c, { success: false, error: 'Invalid status' }, 400, ["status"]);
  const flag = await c.env.DB.prepare(`SELECT cf.friend_id, cf.status, cf.advice_ready, cf.updated_at, f.line_account_id FROM nen_care_flags cf JOIN friends f ON f.id=cf.friend_id WHERE cf.id=?`)
    .bind(c.req.param('id')).first<{ friend_id: string; status: string; advice_ready: number; updated_at: string; line_account_id: string | null }>();
  if (!flag || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [flag.line_account_id])) return c.json({ success: false, error: 'Not found' }, 404);
  /*
   * M509: 見守りフラグの同時解決＋再開は後勝ちで先の変更が黙って消えていた。
   * 版（expectedUpdatedAt）が送られてきたときだけ updated_at の一致も
   * 条件に入れる。古い画面からの保存は409で止め、最新の状態を
   * data.latest で返す。送られてこない従来の呼び出しはそのまま通す。
   */
  const flagExpectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null;
  // M509: 版つきの保存は版を必ず単調に進める（同じミリ秒の連打でも見分けられる）。
  const flagNewUpdatedAt = flagExpectedUpdatedAt === null ? jstNow() : nextVersionToken(flag.updated_at);
  const written = await c.env.DB.prepare(`UPDATE nen_care_flags SET status=?, advice_ready=?, resolved_at=CASE WHEN ?='resolved' THEN ? ELSE NULL END, updated_at=? WHERE (? IS NULL OR updated_at=?) AND id=?`)
    .bind(body.status, body.adviceReady === false ? 0 : 1, body.status, jstNow(), flagNewUpdatedAt, flagExpectedUpdatedAt, flagExpectedUpdatedAt, c.req.param('id')).run();
  if (!written.meta.changes) {
    const latest = await c.env.DB.prepare(`SELECT cf.status, cf.advice_ready, cf.updated_at, f.line_account_id FROM nen_care_flags cf JOIN friends f ON f.id=cf.friend_id WHERE cf.id=?`)
      .bind(c.req.param('id')).first<{ status: string; advice_ready: number; updated_at: string; line_account_id: string | null }>();
    if (!latest) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: false, code: 'VERSION_CONFLICT',
      error: 'ほかの人が先に見守りの状態を変えました。最新の内容を確認してから保存し直してください。',
      data: { latest: { status: latest.status, adviceReady: latest.advice_ready === 1, updatedAt: latest.updated_at } },
    }, 409);
  }
  await syncNenHealthTags(c.env.DB, flag.friend_id);
  return c.json({ success: true });
};

export const get__api_nen_members_photos_2 = async (c: Context<Env, "/api/nen-members/photos">) => {
  const accountId = c.req.query('accountId')?.trim();
  if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
  }
  /*
   * 続きを取れるようにする。前は 200 枚で打ち切りだったので、審査待ちが
   * 201 枚以上あるとダッシュボードの件数に届かなかった（#666）。
   * 1ページの上限は 200 のまま。offset で次の 200 枚を取る。
   */
  const limit = photoPageSize(c.req.query('limit'));
  const offset = photoPageOffset(c.req.query('offset'));
  /*
   * 名前・ペット名・コメントの部分一致で絞る（#931 N-308）。
   * 200 枚ずつの区切りでしか見られない一覧だと、目的の1枚を探すのに
   * 全部を読み進めるしかなかった。%・_・\ は LIKE の記号なので逃がす。
   */
  const q = (c.req.query('q') ?? '').trim().slice(0, 100);
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const staleCutoff = toJstString(new Date(Date.now() - PHOTO_REWARD_STALE_MS));
  const rows = await c.env.DB.prepare(
    `SELECT ps.id, ps.friend_id, ps.pet_id, ps.review_image_url AS image_url,
            ps.caption, ps.status, ps.awarded_points, ps.created_at, ps.reviewed_at,
            ps.updated_at, ps.review_version, ps.publication_consent_at,
            ps.publication_withdrawn_at, ps.public_pet_name, ps.review_reason_code,
            ps.review_reason_note, ps.review_notification_status,
            ps.display_rotation, f.photo_watch_required AS submitter_watch,
            p.name pet_name, p.gender AS pet_gender, f.display_name owner_name,
            (SELECT ${PHOTO_REWARD_STATE_CASE} FROM nen_photo_reward_outbox o
              WHERE o.photo_id = ps.id AND o.line_account_id = ps.line_account_id) AS point_sync_status,
            (SELECT r.flag FROM nen_photo_risk_assessments r
              WHERE r.photo_id = ps.id AND r.line_account_id = ps.line_account_id
              ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_risk_flag,
            (SELECT r.confidence FROM nen_photo_risk_assessments r
              WHERE r.photo_id = ps.id AND r.line_account_id = ps.line_account_id
              ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_risk_confidence,
            CASE WHEN EXISTS (
              SELECT 1 FROM nen_photo_asset_jobs j
               WHERE j.photo_id = ps.id AND j.line_account_id = ps.line_account_id AND j.status = 'failed'
            ) THEN 1 ELSE 0 END AS has_failed_asset_job
       FROM nen_photo_submissions ps
       JOIN nen_pet_profiles p ON p.id = ps.pet_id
       JOIN friends f ON f.id = ps.friend_id
      WHERE ps.line_account_id = ? AND f.line_account_id = ?
        AND EXISTS (SELECT 1 FROM media_file_scans scan WHERE scan.subject_kind='photo'
          AND scan.subject_id=ps.id AND scan.line_account_id=ps.line_account_id AND scan.status='clean')
        ${q ? `AND (ps.caption LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR f.display_name LIKE ? ESCAPE '\\')` : ''}
      ORDER BY ps.created_at DESC, ps.id DESC LIMIT ? OFFSET ?`,
  ).bind(staleCutoff, ...(q ? [accountId, accountId, like, like, like] : [accountId, accountId]), limit, offset).all<Record<string, unknown>>();
  const responseItems = rows.results.map((row) => ({
      ...row,
      pet_call_name: petCallName(String(row.pet_name ?? ''), row.pet_gender),
    }));
  return c.json(buildCursorListResponse({ success: true,
    data: responseItems, items: responseItems, paging: { limit }, sort: [{ field: 'created_at', direction: 'desc' }, { field: 'id', direction: 'desc' }] }));
};

export const get__api_nen_members_photos_publications_3 = async (c: Context<Env, "/api/nen-members/photos/publications">) => {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const staleCutoff = toJstString(new Date(Date.now() - PHOTO_REWARD_STALE_MS));
    const rows = await c.env.DB.prepare(
      `SELECT pub.id, pub.photo_id, pub.status, pub.show_owner_name, pub.view_count,
              pub.version, pub.sort_order, pub.reward_points AS publication_points,
              (SELECT status FROM nen_photo_publication_reward_outbox pr WHERE pr.photo_id=ps.id) AS publication_point_sync_status,
              pub.published_at, ps.public_image_url AS image_url,
              ps.publication_consent_at, ps.publication_consent_version,
              ps.awarded_points, ps.reviewed_at, ps.reviewed_by_name,
              p.name AS pet_name,
              CASE WHEN pub.show_owner_name = 1 THEN f.display_name ELSE NULL END AS owner_name,
              (SELECT ${PHOTO_REWARD_STATE_CASE} FROM nen_photo_reward_outbox o
                WHERE o.photo_id = ps.id AND o.line_account_id = pub.line_account_id) AS point_sync_status
         FROM nen_photo_publications pub
         JOIN nen_photo_submissions ps ON ps.id = pub.photo_id AND ps.line_account_id = pub.line_account_id
         JOIN nen_pet_profiles p ON p.id = ps.pet_id
         JOIN friends f ON f.id = ps.friend_id AND f.line_account_id = pub.line_account_id
        WHERE pub.line_account_id = ? AND pub.status = 'published'
          AND ps.status = 'adopted' AND ps.publication_consent_at IS NOT NULL
          AND ps.publication_withdrawn_at IS NULL
        ORDER BY pub.sort_order, pub.published_at DESC, pub.id LIMIT 200`,
    ).bind(staleCutoff, accountId).all<Record<string, unknown>>();
    /*
     * 公開中ではない掲載も同じ画面で追う（Issue #1040 IDEA-22）。
     * ご本人がLIFFで同意を撤回すると写真側の publication_withdrawn_at が
     * 立つが、掲載先の登録（placements.active=1）は残る。上の一覧の条件から
     * 外れるだけでは「撤回後に残る公開先」を追えないため、掲載管理の対象を
     * まとめて返す。公開そのものは変えず、整理操作は既存の withdraw 口。
     */
    const inactiveRows = await c.env.DB.prepare(
      `SELECT pub.id, pub.photo_id, pub.status, pub.show_owner_name, pub.view_count,
              pub.version, pub.published_at, pub.withdrawn_at, pub.updated_at,
              sm.name AS withdrawn_by_name,
              COALESCE(ps.public_image_url, ps.review_image_url) AS image_url,
              ps.publication_consent_at, ps.publication_consent_version,
              ps.publication_withdrawn_at, ps.status AS photo_status,
              ps.awarded_points, ps.reviewed_at, ps.reviewed_by_name,
              p.name AS pet_name,
              CASE WHEN pub.show_owner_name = 1 THEN f.display_name ELSE NULL END AS owner_name,
              (SELECT ${PHOTO_REWARD_STATE_CASE} FROM nen_photo_reward_outbox o
                WHERE o.photo_id = ps.id AND o.line_account_id = pub.line_account_id) AS point_sync_status
         FROM nen_photo_publications pub
         JOIN nen_photo_submissions ps ON ps.id = pub.photo_id AND ps.line_account_id = pub.line_account_id
         JOIN nen_pet_profiles p ON p.id = ps.pet_id
         JOIN friends f ON f.id = ps.friend_id AND f.line_account_id = pub.line_account_id
         LEFT JOIN staff_members sm ON sm.id = pub.withdrawn_by
        WHERE pub.line_account_id = ?
          AND NOT (pub.status = 'published' AND ps.status = 'adopted'
                   AND ps.publication_consent_at IS NOT NULL
                   AND ps.publication_withdrawn_at IS NULL)
        ORDER BY pub.updated_at DESC LIMIT 200`,
    ).bind(staleCutoff, accountId).all<Record<string, unknown>>();
    /*
     * 掲載先は1発で取る。写真ごとに1件ずつ取りに行くと、掲載数が増えるほど
     * 遅くなる（N+1）。公開先ごとの掲載状態を追えるよう、外した先
     * （active=0）も外した日時つきで返す（Issue #1040 IDEA-22）。
     */
    const allPublications = [...rows.results, ...inactiveRows.results];
    const publicationIds = allPublications.map((row) => String(row.id));
    const placementRows = publicationIds.length === 0 ? [] : (await c.env.DB.prepare(
      `SELECT publication_id, id, placement_type, placement_label, view_count,
              active, created_at, removed_at
         FROM nen_photo_publication_placements
        WHERE publication_id IN (${sqlIdSet(publicationIds).sql})
          AND line_account_id = ?
        ORDER BY created_at`,
    ).bind(...(publicationIds.length ? sqlIdSet(publicationIds).binds : []), accountId).all<Record<string, unknown>>()).results;
    const placementsByPublication = new Map<string, Array<Record<string, unknown>>>();
    for (const placement of placementRows) {
      const key = String(placement.publication_id);
      const list = placementsByPublication.get(key) ?? [];
      // publication_id は振り分け用で返さない。掲載中か外したかは active で見る。
      list.push({
        id: placement.id,
        placement_type: placement.placement_type,
        placement_label: placement.placement_label,
        view_count: placement.view_count,
        active: placement.active,
        created_at: placement.created_at,
        removed_at: placement.removed_at,
      });
      placementsByPublication.set(key, list);
    }
    const thirtyDayViews = await getPublicationThirtyDayViews(c.env.DB, accountId);
    const withPlacements = (row: Record<string, unknown>) => (
      { ...row, view_count_30_days: thirtyDayViews.get(String(row.id)) ?? null, placements: placementsByPublication.get(String(row.id)) ?? [] }
    ) as Record<string, unknown> & { placements: Array<Record<string, unknown>> };
    const items = rows.results.map(withPlacements);
    const inactive = inactiveRows.results.map(withPlacements);
    // ご本人が同意を撤回したのに掲載先の整理が残っているものと、
    // 掲載先から外し終えたものを分ける（Issue #1040 IDEA-22）。
    const pendingWithdrawals = inactive.filter((row) => String(row.status) !== 'withdrawn');
    const withdrawnItems = inactive.filter((row) => String(row.status) === 'withdrawn');
    const measured = items.filter((item) => item.view_count !== null && item.view_count !== undefined);
    return c.json({ success: true, data: {
      summary: {
        publishedCount: items.length,
        placementCount: new Set(items.flatMap((item) => (
          item.placements.filter((placement) => Number(placement.active ?? 1) === 1)
        ).map((placement) => `${placement.placement_type}:${placement.placement_label}`))).size,
        topPhoto30Days: items.filter(item => item.view_count_30_days != null).reduce<Record<string,unknown> | null>((top,item) => !top || Number(item.view_count_30_days) > Number(top.view_count_30_days) ? item : top,null),
        topPhoto: measured.length
          ? measured.reduce((top, item) => Number(item.view_count) > Number(top.view_count) ? item : top)
          : null,
        consentedCount: items.length,
        attentionCount: pendingWithdrawals.length,
        withdrawnCount: withdrawnItems.length,
      },
      items,
      pendingWithdrawals,
      withdrawnItems,
    } });
  };

export const get__api_nen_members_photos_publications_order_4 = async (c: Context<Env, "/api/nen-members/photos/publications/order">) => {
  const accountId = c.req.query('accountId')?.trim();
  if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
  const rows = await c.env.DB.prepare(`SELECT pub.id,pub.version,p.name AS pet_name
    FROM nen_photo_publications pub JOIN nen_photo_submissions ps ON ps.id=pub.photo_id AND ps.line_account_id=pub.line_account_id
    JOIN nen_pet_profiles p ON p.id=ps.pet_id
    WHERE pub.line_account_id=? AND pub.status='published' AND ps.status='adopted'
      AND ps.publication_consent_at IS NOT NULL AND ps.publication_withdrawn_at IS NULL
    ORDER BY pub.sort_order,pub.published_at DESC,pub.id`).bind(accountId).all();
  return c.json({ success: true, data: { items: rows.results } });
};

export const put__api_nen_members_photos_publications_order_5 = async (c: Context<Env, "/api/nen-members/photos/publications/order">) => {
  if (c.get('staff').readOnly) return c.json({ success: false, error: '閲覧のみの権限です' }, 403);
  const body = await c.req.json<import('@line-crm/shared').PhotoPublicationOrderInput>().catch(() => null);
  if (!body || typeof body.accountId !== 'string' || !body.accountId.trim()
    || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 5000
    || body.items.some(item => !item || typeof item.id !== 'string' || !item.id.trim()
      || !Number.isInteger(item.expectedVersion) || item.expectedVersion < 1)
    || new Set(body.items.map(item => item.id)).size !== body.items.length) {
    return inputError(c, { success: false, error: '掲載IDと確認した版を重複なく指定してください' }, 400, ["accountId","items"]);
  }
  body.accountId = body.accountId.trim();
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  if (!await savePhotoPublicationOrder(c.env.DB, body)) {
    return c.json({ success: false, error: '掲載の集合か版が変わりました。全件を読み直してください' }, 409);
  }
  return c.json({ success: true, data: { items: body.items.map((item, sortOrder) => ({ id: item.id, version: item.expectedVersion+1, sortOrder })) } });
};

export const post__api_nen_members_photos_id_publish_6 = async (c: Context<Env, "/api/nen-members/photos/:id/publish">) => {
  if (c.get('staff').readOnly) return c.json({ success: false, error: '閲覧のみの権限です' }, 403);
  const body = await c.req.json<{accountId?: unknown; expectedVersion?: unknown}>().catch(() => null);
  const key = c.req.header('Idempotency-Key')?.trim();
  if (!body || typeof body.accountId !== 'string' || !body.accountId.trim()
    || typeof body.expectedVersion !== 'number' || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0
    || !key || key.length < 8 || key.length > 100) {
    return inputError(c, { success: false, error: 'accountId、expectedVersion、Idempotency-Keyを確認してください' }, 400, ["accountId","expectedVersion","placements"]);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId.trim()])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const result = await publishPhoto(c.env.DB, { photoId: c.req.param('id'), accountId: body.accountId.trim(), expectedVersion: body.expectedVersion, idempotencyKey: key });
  if (result.kind === 'missing') return c.json({ success: false, error: '写真が見つかりません' }, 404);
  if (result.kind === 'ineligible') return inputError(c, { success: false, error: '採用・現在の公開同意・公開用画像を確認してください' }, 422, ["accountId","expectedVersion"]);
  if (result.kind === 'conflict') return c.json({ success: false, error: '掲載状態が変わりました。読み直してください' }, 409);
  return c.json({ success: true, data: { id: result.id, version: result.version, status: 'published' as const } });
};

export const put__api_nen_members_photos_publications_id_withdraw_7 = async (c: Context<Env, "/api/nen-members/photos/publications/:id/withdraw">) => {
  const body = await c.req.json<{ accountId?: string; expectedVersion?: number }>().catch(() => null);
  const accountId = body?.accountId?.trim();
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim().slice(0, 120);
  if (!accountId || !Number.isInteger(body?.expectedVersion) || !idempotencyKey) {
    return inputError(c, { success: false, error: 'accountId、expectedVersion、Idempotency-Key は必須です' }, 400, ["accountId","expectedVersion","placements"]);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const publication = await c.env.DB.prepare(
    `SELECT id, photo_id, status, version, last_idempotency_key
       FROM nen_photo_publications WHERE id = ? AND line_account_id = ?`,
  ).bind(c.req.param('id'), accountId).first<{
    id: string; photo_id: string; status: string; version: number; last_idempotency_key: string | null;
  }>();
  if (!publication) return c.json({ success: false, error: 'Not found' }, 404);
  if (publication.last_idempotency_key === idempotencyKey) {
    return c.json({ success: true, data: { status: publication.status, version: publication.version } });
  }
  if (publication.status !== 'published' || publication.version !== body!.expectedVersion) {
    return c.json({ success: false, error: '別の人が先に掲載状態を変更しました' }, 409);
  }
  const now = jstNow();
  const reviewer = c.get('staff');
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE nen_photo_publications
          SET status = 'withdrawn', withdrawn_at = ?, withdrawn_by = ?, version = version + 1,
              last_idempotency_key = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND status = 'published' AND version = ?`,
    ).bind(now, reviewer.id, idempotencyKey, now, publication.id, accountId, body!.expectedVersion),
    c.env.DB.prepare(
      `UPDATE nen_photo_publication_placements SET active = 0, removed_at = ?
        WHERE publication_id = ? AND line_account_id = ? AND active = 1`,
    ).bind(now, publication.id, accountId),
    c.env.DB.prepare(
      `UPDATE nen_photo_submissions SET publication_withdrawn_at = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ?`,
    ).bind(now, now, publication.photo_id, accountId),
  ]);
  if (!results[0]?.meta.changes) {
    return c.json({ success: false, error: '別の人が先に掲載状態を変更しました' }, 409);
  }
  return c.json({ success: true, data: { status: 'withdrawn', version: publication.version + 1 } });
};

export const put__api_nen_members_photos_publications_id_placements_8 = async (c: Context<Env, "/api/nen-members/photos/publications/:id/placements">) => {
  const body = await c.req.json<{
    accountId?: string;
    expectedVersion?: number;
    placements?: Array<{ type?: string; label?: string }>;
  }>().catch(() => null);
  const accountId = body?.accountId?.trim();
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim().slice(0, 120);
  const allowed = new Set(['rich_menu', 'column', 'form', 'site']);
  const placements = (body?.placements ?? []).map((placement) => ({
    type: String(placement.type || ''), label: String(placement.label || '').trim().slice(0, 120),
  }));
  if (!accountId || !Number.isInteger(body?.expectedVersion) || !idempotencyKey
      || placements.length > 20 || placements.some((placement) => !allowed.has(placement.type) || !placement.label)) {
    return inputError(c, { success: false, error: '掲載先、accountId、expectedVersion、Idempotency-Key を確認してください' }, 400, ["accountId","expectedVersion","placements"]);
  }
  if (new Set(placements.map((placement) => `${placement.type}:${placement.label}`)).size !== placements.length) {
    return inputError(c, { success: false, error: '同じ掲載先が重複しています' }, 400, ["placements"]);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const publication = await c.env.DB.prepare(
    `SELECT id, status, version, last_idempotency_key
       FROM nen_photo_publications WHERE id = ? AND line_account_id = ?`,
  ).bind(c.req.param('id'), accountId).first<{
    id: string; status: string; version: number; last_idempotency_key: string | null;
  }>();
  if (!publication) return c.json({ success: false, error: 'Not found' }, 404);
  if (publication.last_idempotency_key === idempotencyKey) {
    return c.json({ success: true, data: { version: publication.version, placementCount: placements.length } });
  }
  if (publication.status !== 'published' || publication.version !== body!.expectedVersion) {
    return c.json({ success: false, error: '別の人が先に掲載先を変更しました' }, 409);
  }
  const now = jstNow();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE nen_photo_publications SET version = version + 1, last_idempotency_key = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND status = 'published' AND version = ?`,
    ).bind(idempotencyKey, now, publication.id, accountId, body!.expectedVersion),
    c.env.DB.prepare(
      `UPDATE nen_photo_publication_placements SET active = 0, removed_at = ?
        WHERE publication_id = ? AND line_account_id = ? AND active = 1`,
    ).bind(now, publication.id, accountId),
    ...placements.map((placement) => c.env.DB.prepare(
      `INSERT INTO nen_photo_publication_placements
        (id, publication_id, line_account_id, placement_type, placement_label, active, created_at, removed_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, NULL)
       ON CONFLICT(publication_id, placement_type, placement_label)
       DO UPDATE SET active = 1, removed_at = NULL`,
    ).bind(crypto.randomUUID(), publication.id, accountId, placement.type, placement.label, now)),
  ]);
  if (!results[0]?.meta.changes) {
    return c.json({ success: false, error: '別の人が先に掲載先を変更しました' }, 409);
  }
  return c.json({ success: true, data: { version: publication.version + 1, placementCount: placements.length } });
};

export const get__api_nen_members_photos_id_9 = async (c: Context<Env, "/api/nen-members/photos/:id">) => {
  const accountId = c.req.query('accountId')?.trim();
  if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
  }
  const photo = await c.env.DB.prepare(
    `SELECT ps.id, ps.review_image_url AS image_url, ps.caption, ps.status,
            ps.image_width, ps.image_height, ps.image_byte_size, ps.captured_device,
            ps.content_hash, ps.review_version, ps.created_at, ps.publication_consent_at,
            ps.publication_consent_version, ps.publication_withdrawn_at,
            ps.display_rotation, ps.awarded_points, ps.reviewed_at, ps.reviewed_by_name,
            f.photo_watch_required AS submitter_watch,
            p.name AS pet_name, p.gender AS pet_gender, p.animal_type, p.breed,
            p.birthday, f.display_name AS owner_name,
            (SELECT COUNT(*) FROM nen_photo_submissions prior
              WHERE prior.friend_id = ps.friend_id AND prior.created_at <= ps.created_at) AS submission_count,
            (SELECT COUNT(*) FROM nen_photo_submissions returned
              WHERE returned.friend_id = ps.friend_id AND returned.status = 'rejected') AS returned_count
       FROM nen_photo_submissions ps
       JOIN nen_pet_profiles p ON p.id = ps.pet_id
       JOIN friends f ON f.id = ps.friend_id
      WHERE ps.id = ? AND ps.line_account_id = ? AND f.line_account_id = ?`,
  ).bind(c.req.param('id'), accountId, accountId).first<Record<string, unknown>>();
  if (!photo) return c.json({ success: false, error: 'Not found' }, 404);
  const scan = await getFileScanBySubject(c.env.DB,'photo',c.req.param('id')!);
  if(scan?.status!=='clean') return c.json({success:false,code:'PHOTO_SCAN_PENDING',error:'写真の安全性を確認中です'},409);

  /*
   * 採用履歴・報酬・公開先を一緒に返す（Issue #1040 IDEA-22）。
   * 「通した1回につきポイントの手続きが1回」か、撤回後にどの掲載先が
   * 残っているかを、詳細を開いたときにその場で確認できるようにする。
   */
  const [risks, history, reward, publication] = await Promise.all([
    c.env.DB.prepare(
      `SELECT flag, confidence, note, provider, model_version, assessed_at
         FROM nen_photo_risk_assessments
        WHERE photo_id = ? AND line_account_id = ? ORDER BY created_at DESC`,
    ).bind(c.req.param('id'), accountId).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT to_status, reason_code, reason_note, awarded_points,
              reviewed_by_name, notification_status, created_at
         FROM nen_photo_review_events
        WHERE photo_id = ? AND line_account_id = ?
        ORDER BY created_at DESC LIMIT 20`,
    ).bind(c.req.param('id'), accountId).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT status, points, attempt_count, last_error, next_attempt_at, synced_at, updated_at
         FROM nen_photo_reward_outbox
        WHERE photo_id = ? AND line_account_id = ?`,
    ).bind(c.req.param('id'), accountId).first<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT pub.id, pub.status, pub.view_count, pub.published_at, pub.withdrawn_at,
              sm.name AS withdrawn_by_name
         FROM nen_photo_publications pub
         LEFT JOIN staff_members sm ON sm.id = pub.withdrawn_by
        WHERE pub.photo_id = ? AND pub.line_account_id = ?`,
    ).bind(c.req.param('id'), accountId).first<Record<string, unknown>>(),
  ]);
  const publicationPlacements = publication ? (await c.env.DB.prepare(
    `SELECT id, placement_type, placement_label, view_count, active, created_at, removed_at
       FROM nen_photo_publication_placements
      WHERE publication_id = ? AND line_account_id = ?
      ORDER BY created_at`,
  ).bind(publication.id, accountId).all<Record<string, unknown>>()).results : [];
  /*
   * 報酬は生のstatusではなく運用向けの派生状態（state）で返す
   * （PHOTO-06）。「手続き中」のまま24時間以上止まったものは stale、
   * 再試行しても直らない失敗は failed_permanent として、
   * 一覧（point_sync_status の CASE）と同じ顔ぶれで出す。
   */
  const rewardView = reward
    ? {
      ...reward,
      state: photoRewardDisplayState({
        status: reward.status as 'pending' | 'processing' | 'synced' | 'failed',
        last_error: reward.last_error as string | null,
        updated_at: String(reward.updated_at),
      }, new Date()),
      reason_label: PHOTO_REWARD_REASON_LABELS[String(reward.last_error ?? '')] ?? null,
    }
    : null;
  /*
   * 重複の判定 (#817)。完全に同じ中身の写真で、すでに採用されて
   * 報酬が付いたものがあれば、前の投稿と並べて見せる。
   * 似ている写真は自動で却下せず、注意の札だけに留める。
   */
  const [duplicate, rewardPolicy] = await Promise.all([
    findRewardedAdoptedDuplicate(c.env.DB, {
      contentHash: typeof photo.content_hash === 'string' ? photo.content_hash : null,
      lineAccountId: accountId,
      excludePhotoId: String(photo.id),
    }),
    getEffectivePhotoRewardPolicy(c.env.DB),
  ]);
  return c.json({
    success: true,
    data: {
      ...photo,
      pet_call_name: petCallName(String(photo.pet_name ?? ''), photo.pet_gender),
      risks: risks.results,
      history: history.results,
      reward: rewardView,
      publication: publication ? { ...publication, placements: publicationPlacements } : null,
      duplicate,
      rewardPolicy,
    },
  });
};
